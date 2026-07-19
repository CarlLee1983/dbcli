import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'path'
import type { TableSchema } from '@/adapters/types'
import {
  executeLintCommand,
  loadLintCommandDeps,
  lintCommand,
  runLint,
  type LintCommandLoaders,
} from '@/commands/lint'
import { setGlobalConnectionName } from '@/core/config'
import { buildSchemaContext } from '@/core/lint/context'
import type { DbcliConfig } from '@/utils/validation'

const baseConfig = {
  connection: { system: 'postgresql' },
  permission: 'query-only',
} as DbcliConfig

const users: TableSchema = {
  name: 'users',
  columns: [{ name: 'id', type: 'integer', nullable: false }],
}
const schema = buildSchemaContext({ users })
const noSnippets = async () => null

afterEach(() => {
  setGlobalConnectionName(undefined)
})

describe('runLint', () => {
  test('lints an inline query and returns reports', async () => {
    const { reports } = await runLint(['SELECT * FROM users'], { format: 'json' }, {
      config: baseConfig,
      schema,
      loadSavedQuery: noSnippets,
    })

    expect(reports).toHaveLength(1)
    expect(reports[0].findings.map((finding) => finding.rule)).toContain('select-star')
  })

  for (const system of ['postgresql', 'mysql', 'mariadb'] as const) {
    test(`routes ${system} to the matching parser dialect`, async () => {
      const { reports } = await runLint(['SELECT id FROM users'], {}, {
        config: {
          ...baseConfig,
          connection: { ...baseConfig.connection, system },
        },
        schema,
        loadSavedQuery: noSnippets,
      })

      expect(reports[0].dialect).toBe(system)
    })
  }

  test('rejects non-SQL systems', async () => {
    await expect(
      runLint(['SELECT 1'], {}, {
        config: {
          ...baseConfig,
          connection: { ...baseConfig.connection, system: 'redis' },
        } as DbcliConfig,
        schema,
        loadSavedQuery: noSnippets,
      })
    ).rejects.toThrow(
      'dbcli lint requires a SQL connection (postgresql/mysql/mariadb), got: redis'
    )
  })

  test('errors when no query is given', async () => {
    await expect(
      runLint([], {}, { config: baseConfig, schema, loadSavedQuery: noSnippets })
    ).rejects.toThrow('No query provided')
  })

  test('passes --no-schema through to every schema-aware rule', async () => {
    const { reports } = await runLint(
      ["SELECT id FROM users WHERE id = '1' AND id NOT IN (1, NULL)"],
      { noSchema: true },
      { config: baseConfig, schema, loadSavedQuery: noSnippets }
    )

    expect(reports[0].skippedRules).toEqual(
      expect.arrayContaining([
        { rule: 'implicit-cast', reason: 'blocked: --no-schema' },
        { rule: 'not-in-nullable', reason: 'blocked: --no-schema' },
      ])
    )
  })

  test('resolves saved-query inputs through the injected loader', async () => {
    const loader = async (name: string) =>
      name === 'perf/top' ? [{ name: 'perf/top', sql: 'SELECT * FROM users' }] : null
    const { reports } = await runLint(['@perf/top'], {}, {
      config: baseConfig,
      schema,
      loadSavedQuery: loader,
    })

    expect(reports[0].label).toBe('perf/top')
    expect(reports[0].findings.map((finding) => finding.rule)).toContain('select-star')
  })

  test('resolves SQL files and comma-separated bulk inputs', async () => {
    const dir = await Bun.$`mktemp -d`.text()
    const sqlPath = join(dir.trim(), 'queries.sql')
    await Bun.write(sqlPath, 'SELECT * FROM users; SELECT id FROM users;')
    try {
      const { reports } = await runLint([], { bulk: `@${sqlPath},SELECT * FROM users` }, {
        config: baseConfig,
        schema,
        loadSavedQuery: noSnippets,
      })

      expect(reports).toHaveLength(3)
      expect(reports[0].label).toBe('queries.sql#1')
    } finally {
      await Bun.$`rm -rf ${dir.trim()}`
    }
  })

  test('validates output format', async () => {
    await expect(
      runLint(['SELECT 1'], { format: 'yaml' }, {
        config: baseConfig,
        schema,
        loadSavedQuery: noSnippets,
      })
    ).rejects.toThrow("Unknown format 'yaml'. Allowed: text, json, markdown")
  })

  test('validates minimum severity', async () => {
    await expect(
      runLint(['SELECT 1'], { minSeverity: 'critical' }, {
        config: baseConfig,
        schema,
        loadSavedQuery: noSnippets,
      })
    ).rejects.toThrow(
      "Unknown --min-severity 'critical'. Allowed: info, warn, error"
    )
  })
})

describe('loadLintCommandDeps', () => {
  function loaders(
    config: DbcliConfig,
    onSchemaLoad: (storagePath: string, connectionName?: string) => void
  ): LintCommandLoaders {
    return {
      readConfig: async () => config,
      resolveStoragePath: async () => '/cache',
      resolveConnectionName: async () => 'primary',
      loadSchema: async (storagePath, connectionName) => {
        onSchemaLoad(storagePath, connectionName)
        return schema
      },
    }
  }

  test('rejects unsupported systems before invoking the schema loader', async () => {
    let schemaLoads = 0
    const redisConfig = {
      ...baseConfig,
      connection: { ...baseConfig.connection, system: 'redis' },
    } as DbcliConfig

    await expect(
      loadLintCommandDeps('.dbcli', {}, loaders(redisConfig, () => schemaLoads++))
    ).rejects.toThrow('dbcli lint requires a SQL connection')
    expect(schemaLoads).toBe(0)
  })

  test('--no-schema avoids all schema path and loader IO', async () => {
    let schemaCalls = 0
    const noSchemaLoaders: LintCommandLoaders = {
      readConfig: async () => baseConfig,
      resolveStoragePath: async () => {
        schemaCalls++
        return '/cache'
      },
      resolveConnectionName: async () => {
        schemaCalls++
        return 'primary'
      },
      loadSchema: async () => {
        schemaCalls++
        return schema
      },
    }

    const deps = await loadLintCommandDeps('.dbcli', { noSchema: true }, noSchemaLoaders)

    expect(schemaCalls).toBe(0)
    expect(deps.schema.available).toBe(false)
  })

  test('--no-schema avoids SchemaLayeredLoader IO during the real config read', async () => {
    const tempRoot = (await Bun.$`mktemp -d`.text()).trim()
    const configPath = join(tempRoot, '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await Bun.write(
      join(configPath, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'primary',
        connections: {
          primary: {
            system: 'postgresql',
            host: 'primary.db',
            port: 5432,
            user: 'primary',
            password: '',
            database: 'app',
          },
        },
      })
    )
    try {
      const deps = await loadLintCommandDeps(configPath, { noSchema: true })

      expect(deps.schema.available).toBe(false)
      expect(await Bun.file(join(configPath, 'schemas')).exists()).toBe(false)
    } finally {
      await Bun.$`rm -rf ${tempRoot}`
    }
  })

  test('unsupported real config is rejected without SchemaLayeredLoader IO', async () => {
    const tempRoot = (await Bun.$`mktemp -d`.text()).trim()
    const configPath = join(tempRoot, '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await Bun.write(
      join(configPath, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'cache',
        connections: {
          cache: {
            system: 'redis',
            host: 'localhost',
            port: 6379,
            user: '',
            password: '',
            database: '0',
          },
        },
      })
    )
    try {
      await expect(loadLintCommandDeps(configPath, {})).rejects.toThrow(
        'dbcli lint requires a SQL connection'
      )
      expect(await Bun.file(join(configPath, 'schemas')).exists()).toBe(false)
    } finally {
      await Bun.$`rm -rf ${tempRoot}`
    }
  })

  test('global --use selects the isolated named schema-cache slot', async () => {
    const tempRoot = (await Bun.$`mktemp -d`.text()).trim()
    const configPath = join(tempRoot, '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await Bun.write(
      join(configPath, 'config.json'),
      JSON.stringify({
        version: 2,
        default: 'primary',
        connections: {
          primary: {
            system: 'postgresql',
            host: 'primary.db',
            port: 5432,
            user: 'primary',
            password: '',
            database: 'app',
          },
          staging: {
            system: 'postgresql',
            host: 'staging.db',
            port: 5432,
            user: 'staging',
            password: '',
            database: 'app',
          },
        },
      })
    )
    setGlobalConnectionName('staging')
    let selectedSlot: string | undefined
    try {
      await loadLintCommandDeps(configPath, {}, {
        readConfig: async () => baseConfig,
        resolveStoragePath: async (path) => path,
        resolveConnectionName: async (path) => {
          const { getSchemaIsolationConnectionName } = await import('@/core/config')
          return getSchemaIsolationConnectionName(path)
        },
        loadSchema: async (_path, connectionName) => {
          selectedSlot = connectionName
          return schema
        },
      })
    } finally {
      await Bun.$`rm -rf ${tempRoot}`
    }

    expect(selectedSlot).toBe('staging')
  })
})

describe('lint command registration surface', () => {
  test('exports the lint command with static-analysis options', () => {
    expect(lintCommand.name()).toBe('lint')
    expect(lintCommand.options.map((option) => option.long)).toEqual(
      expect.arrayContaining([
        '--format',
        '--min-severity',
        '--no-schema',
        '--bulk',
        '--recovery',
      ])
    )
    expect(lintCommand.options.map((option) => option.long)).not.toContain('--use')
  })

  test('buildProgram registers lint exactly once and keeps --use global', async () => {
    const { buildProgram } = await import('@/program')
    const program = buildProgram()

    expect(program.commands.filter((command) => command.name() === 'lint')).toHaveLength(1)
    expect(program.options.map((option) => option.long)).toContain('--use')
  })
})

describe('executeLintCommand audit and recovery wiring', () => {
  const loadedDeps = {
    config: baseConfig,
    schema,
  }

  test('audits successful report and finding totals', async () => {
    const auditCalls: unknown[][] = []
    const result = await executeLintCommand(
      ['SELECT * FROM users'],
      { format: 'json' },
      '/project/.dbcli',
      {
        loadDeps: async () => loadedDeps,
        loadSavedQuery: noSnippets,
        writeAudit: async (...args) => {
          auditCalls.push(args)
          return 'audit-id'
        },
      }
    )

    expect(result.reports).toHaveLength(1)
    expect(auditCalls).toHaveLength(1)
    expect(auditCalls[0][1]).toBe('lint')
    expect(auditCalls[0][2]).toEqual(
      expect.objectContaining({ config: '/project/.dbcli' })
    )
    expect(auditCalls[0][3]).toEqual({
      success: true,
      target: '*',
      metadata: { queries: 1, findings: result.reports[0].findings.length },
    })
  })

  test('audits failures after config loading', async () => {
    const outcomes: Array<Record<string, unknown>> = []

    await expect(
      executeLintCommand([], {}, '/project/.dbcli', {
        loadDeps: async () => loadedDeps,
        loadSavedQuery: noSnippets,
        writeAudit: async (_config, _command, _options, outcome) => {
          outcomes.push(outcome as Record<string, unknown>)
          return 'failure-audit'
        },
      })
    ).rejects.toThrow('No query provided')

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toEqual(
      expect.objectContaining({ success: false, target: '*', error: expect.any(Error) })
    )
  })

  test('links recovery envelope to the failure audit', async () => {
    const recoveryCalls: unknown[][] = []

    await expect(
      executeLintCommand([], { recovery: true }, '/project/.dbcli', {
        loadDeps: async () => loadedDeps,
        loadSavedQuery: noSnippets,
        randomUUID: () => 'recovery-id',
        writeAudit: async () => 'failure-audit',
        emitRecovery: async (...args) => {
          recoveryCalls.push(args)
          throw new Error('recovery emitted')
        },
      })
    ).rejects.toThrow('recovery emitted')

    expect(recoveryCalls).toEqual([
      [
        expect.any(Error),
        { operation: 'lint', system: 'postgresql' },
        { envelopeId: 'recovery-id', auditRef: 'failure-audit' },
      ],
    ])
  })
})
