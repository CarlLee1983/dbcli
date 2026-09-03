import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterFactory } from '@/adapters'
import type { TableSchema } from '@/adapters/types'
import {
  diffAction,
  diffCommand,
  expandOrmPaths,
  parseAgainstOrmValues,
  runDrift,
  validateDiffModes,
} from '@/commands/diff'
import { configModule } from '@/core/config'

const usersTable: TableSchema = {
  schema: 'public',
  name: 'users',
  columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
  indexes: [],
}

const config = {
  connection: { system: 'postgresql' },
  schema: { users: usersTable },
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'dbcli-diff-orm-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  process.exitCode = undefined
})

async function write(relativePath: string, contents: string): Promise<string> {
  const path = join(tempDir, relativePath)
  await Bun.write(path, contents)
  return path
}

function ddl(table: string): string {
  return `CREATE TABLE ${table} (id INTEGER PRIMARY KEY);`
}

describe('ORM drift input expansion', () => {
  test('expands globs in deterministic sorted order and deduplicates paths', async () => {
    const first = await write('001-first.sql', ddl('first'))
    const second = await write('002-second.sql', ddl('second'))

    expect(
      await expandOrmPaths([join(tempDir, '*.sql'), second, join(tempDir, '001-*.sql')])
    ).toEqual([first, second])
  })

  test('fails hard when a glob matches no files', async () => {
    await expect(expandOrmPaths([join(tempDir, '*.sql')])).rejects.toThrow('matched no files')
  })

  test('normalizes repeatable and comma-separated values', () => {
    expect(parseAgainstOrmValues(['a.sql,b.sql', ' c.sql ', 'a.sql'])).toEqual([
      'a.sql',
      'b.sql',
      'c.sql',
    ])
  })

  test('collects repeatable command options before splitting comma-separated values', () => {
    try {
      diffCommand.parseOptions(['--against-orm', 'a.sql,b.sql', '--against-orm', 'c.sql'])
      expect(parseAgainstOrmValues(diffCommand.opts().againstOrm)).toEqual([
        'a.sql',
        'b.sql',
        'c.sql',
      ])
    } finally {
      diffCommand.setOptionValueWithSource('againstOrm', [], 'default')
    }
  })

  test('rejects empty input values', () => {
    expect(() => parseAgainstOrmValues([' , ', ''])).toThrow(
      'At least one ORM schema input is required'
    )
  })
})

describe('runDrift', () => {
  test('compares a Prisma file against the schema cache', async () => {
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/schema.prisma'],
      {},
      config as never
    )

    expect(report.ormSource).toBe('prisma')
    expect(report.entries.some((entry) => entry.category === 'missing_in_db')).toBe(true)
  })

  test('drizzle snapshot path flows end-to-end', async () => {
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/drizzle-snapshot.json'],
      {},
      config as never
    )

    expect(report.ormSource).toBe('drizzle')
  })

  test('typeorm alias parses DDL and tags ormSource', async () => {
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/create-tables.sql'],
      { ormFormat: 'typeorm' },
      config as never
    )
    expect(report.ormSource).toBe('typeorm')
  })

  test('typeorm bookkeeping tables in DB are unmanaged by default', async () => {
    const cfg = {
      ...config,
      schema: {
        ...config.schema,
        typeorm_metadata: { name: 'typeorm_metadata', columns: [], indexes: [] },
        migrations: { name: 'migrations', columns: [], indexes: [] },
      },
    }
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/create-tables.sql'],
      { ormFormat: 'typeorm' },
      cfg as never
    )
    expect(report.entries.find((e) => e.table === 'public.typeorm_metadata')?.category).toBe(
      'unmanaged'
    )
    expect(report.entries.find((e) => e.table === 'public.migrations')?.category).toBe('unmanaged')
  })

  test('sequelize alias ignores SequelizeMeta', async () => {
    const cfg = {
      ...config,
      schema: {
        ...config.schema,
        SequelizeMeta: { name: 'SequelizeMeta', columns: [], indexes: [] },
      },
    }
    const { report } = await runDrift(
      ['tests/fixtures/orm-drift/create-tables.sql'],
      { ormFormat: 'sequelize' },
      cfg as never
    )
    expect(report.ormSource).toBe('sequelize')
    expect(report.entries.find((e) => e.table === 'public.SequelizeMeta')?.category).toBe(
      'unmanaged'
    )
  })

  test('typeorm alias aggregates multiple DDL files', async () => {
    const table = await write('001-typeorm-table.sql', ddl('users'))
    const index = await write('002-typeorm-index.sql', 'CREATE INDEX users_id_idx ON users (id);')
    const indexedConfig = {
      ...config,
      schema: {
        users: {
          ...usersTable,
          indexes: [{ name: 'users_id_idx', columns: ['id'], unique: false }],
        },
      },
    }

    const { report } = await runDrift(
      [table, index],
      { ormFormat: 'typeorm' },
      indexedConfig as never
    )

    expect(report.ormSource).toBe('typeorm')
    expect(report.entries).toEqual([])
    expect(report.unparsed).toEqual([])
  })

  test('sequelize alias accepts a matching DDL glob', async () => {
    await write('sequelize-schema.sql', ddl('users'))

    const { report } = await runDrift(
      [join(tempDir, 'sequelize-*.sql')],
      { ormFormat: 'sequelize' },
      config as never
    )

    expect(report.ormSource).toBe('sequelize')
  })

  test('forced unsupported drizzle snapshot fails closed with version and dialect guidance', async () => {
    const unsupported = structuredClone(
      JSON.parse(await Bun.file('tests/fixtures/orm-drift/drizzle-snapshot.json').text())
    )
    unsupported.version = '6'
    unsupported.dialect = 'mysql'
    const path = await write('unsupported-snapshot.json', JSON.stringify(unsupported))

    const { report } = await runDrift([path], { ormFormat: 'drizzle' }, config as never)

    expect(report.ormSource).toBe('drizzle')
    expect(report.entries.some((entry) => entry.category === 'missing_in_db')).toBe(false)
    expect(report.unparsed).toEqual(
      expect.arrayContaining([
        {
          location: 'version',
          reason: expect.stringMatching(/^blocked:.*version '6'.*version '7'/),
        },
        {
          location: 'dialect',
          reason: expect.stringMatching(/^blocked:.*dialect 'mysql'.*'postgresql'/),
        },
      ])
    )
  })

  test('.ts schema file gets a drizzle-kit hint before attempting to read it', async () => {
    await expect(
      runDrift([join(tempDir, 'missing-schema.TS')], {}, config as never)
    ).rejects.toThrow('drizzle-kit generate')
  })

  for (const scenario of [
    {
      name: '.ts input with typeorm alias gives the exact generated-DDL recipe',
      path: 'src/entity/User.ts',
      ormFormat: 'typeorm' as const,
      expected: ["'typeorm schema:log -d <datasource>' > schema.sql", 'then pass schema.sql'],
    },
    {
      name: '.mjs input with typeorm alias gives the exact generated-DDL recipe',
      path: 'src/entity/User.mjs',
      ormFormat: 'typeorm' as const,
      expected: ["'typeorm schema:log -d <datasource>' > schema.sql", 'then pass schema.sql'],
    },
    {
      name: '.js input with sequelize alias gives the complete scratch-DB recipe',
      path: 'models/user.js',
      ormFormat: 'sequelize' as const,
      expected: [
        'sequelize db:migrate',
        'pg_dump --schema-only <scratch-db> > schema.sql',
        'mysqldump --no-data <scratch-db> > schema.sql',
        'pass schema.sql to dbcli',
      ],
    },
    {
      name: '.cjs input with sequelize alias gives the complete scratch-DB recipe',
      path: 'models/user.cjs',
      ormFormat: 'sequelize' as const,
      expected: [
        'sequelize db:migrate',
        'pg_dump --schema-only <scratch-db> > schema.sql',
        'mysqldump --no-data <scratch-db> > schema.sql',
        'pass schema.sql to dbcli',
      ],
    },
  ]) {
    test(scenario.name, async () => {
      const error = await runDrift(
        [scenario.path],
        { ormFormat: scenario.ormFormat },
        config as never
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      for (const text of scenario.expected) {
        expect((error as Error).message).toContain(text)
      }
    })
  }

  test('honors the JSON format escape hatch', async () => {
    const path = await write(
      'schema.data',
      JSON.stringify({
        source: 'json',
        tables: [
          {
            identity: { table: 'users' },
            columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
            indexes: [],
            foreignKeys: [],
          },
        ],
        unparsed: [],
      })
    )

    const { report } = await runDrift([path], { ormFormat: 'json' }, config as never)
    expect(report.ormSource).toBe('json')
    expect(report.summary.errors).toBe(0)
  })

  test('merges multiple DDL files by exact identity', async () => {
    const first = await write('001.sql', ddl('alpha'))
    const second = await write('002.sql', ddl('"Beta"'))

    const { report } = await runDrift([second, first], {}, config as never)

    expect(report.ormSource).toBe('ddl')
    expect(report.entries.map((entry) => entry.table)).toContain('public.alpha')
    expect(report.entries.map((entry) => entry.table)).toContain('public.Beta')
  })

  test('attaches an index from a later DDL file to a table from an earlier file', async () => {
    const table = await write('001-table.sql', ddl('users'))
    const index = await write('002-index.sql', 'CREATE INDEX users_id_idx ON users (id);')
    const indexedConfig = {
      ...config,
      schema: {
        users: {
          ...usersTable,
          indexes: [{ name: 'users_id_idx', columns: ['id'], unique: false }],
        },
      },
    }

    const { report } = await runDrift([index, table], {}, indexedConfig as never)

    expect(report.entries).toEqual([])
    expect(report.unparsed).toEqual([])
    expect(report.summary.errors).toBe(0)
  })

  test('rejects duplicate exact identities across DDL files', async () => {
    const first = await write('001.sql', ddl('users'))
    const second = await write('002.sql', ddl('users'))

    await expect(runDrift([first, second], {}, config as never)).rejects.toThrow(
      "duplicate table identity 'users'"
    )
  })

  test('rejects DDL identities that collide after PostgreSQL default-schema resolution', async () => {
    const first = await write('001.sql', ddl('users'))
    const second = await write('002.sql', ddl('public.users'))

    await expect(runDrift([first, second], {}, config as never)).rejects.toThrow(
      "duplicate resolved table identity 'public.users' in ddl schema"
    )
  })

  test('restricts multi-file inputs to DDL', async () => {
    const first = await write('one.prisma', 'model One { id Int @id }')
    const second = await write('two.prisma', 'model Two { id Int @id }')

    await expect(runDrift([first, second], {}, config as never)).rejects.toThrow(
      'Multiple ORM schema files are supported only for DDL'
    )
  })

  test('rejects mixed auto-detected formats in a multi-file input', async () => {
    const first = await write('one.sql', ddl('one'))
    const second = await write('two.prisma', 'model Two { id Int @id }')

    await expect(runDrift([first, second], {}, config as never)).rejects.toThrow(
      'Multiple ORM schema files are supported only for DDL'
    )
  })

  test('restricts glob inputs to DDL even when only one file matches', async () => {
    await write('one.prisma', 'model One { id Int @id }')

    await expect(runDrift([join(tempDir, '*.prisma')], {}, config as never)).rejects.toThrow(
      'Glob ORM schema inputs are supported only for DDL'
    )
  })

  test('rejects an invalid ORM format at runtime', async () => {
    const path = await write('schema.sql', ddl('users'))

    await expect(runDrift([path], { ormFormat: 'yaml' as never }, config as never)).rejects.toThrow(
      'Invalid format "yaml" for diff --orm-format'
    )
  })

  test('empty schema cache is a hard error', async () => {
    await expect(
      runDrift(['tests/fixtures/orm-drift/schema.prisma'], {}, { ...config, schema: {} } as never)
    ).rejects.toThrow("Schema cache is empty. Run 'dbcli schema' first.")
  })

  test('missing files and empty path lists are hard errors', async () => {
    await expect(runDrift([join(tempDir, 'missing.prisma')], {}, config as never)).rejects.toThrow(
      'not found'
    )
    await expect(runDrift([], {}, config as never)).rejects.toThrow(
      'At least one ORM schema input is required'
    )
  })

  test('keeps users and Users as distinct cache identities', async () => {
    const path = await write('both.sql', [ddl('users'), ddl('"Users"')].join('\n'))
    const caseConfig = {
      ...config,
      schema: {
        lower: usersTable,
        upper: { ...usersTable, name: 'Users' },
      },
    }

    const { report } = await runDrift([path], {}, caseConfig as never)
    expect(report.summary.errors).toBe(0)
    expect(report.entries).toEqual([])
  })

  test('forwards qualified case-sensitive ignore patterns', async () => {
    const path = await write('upper.sql', ddl('"Users"'))
    const caseConfig = {
      ...config,
      schema: { upper: { ...usersTable, name: 'Users' } },
    }

    const { report } = await runDrift([path], { ignore: 'public.Users' }, caseConfig as never)
    expect(report.entries).toContainEqual(
      expect.objectContaining({
        table: 'public.Users',
        category: 'unmanaged',
      })
    )
  })

  test('malformed ORM input degrades to unparsed entries instead of throwing', async () => {
    const path = await write('bad.prisma', 'model Broken {')
    const { report } = await runDrift([path], {}, config as never)

    expect(report.unparsed.length).toBeGreaterThan(0)
  })

  test('non-SQL connections are rejected before any ORM input is read', async () => {
    // A path that does not exist: reading the artifact first would report
    // 'ORM schema file not found' instead, so this pins the ordering.
    const absent = 'tests/fixtures/orm-drift/does-not-exist.prisma'

    await expect(
      runDrift([absent], {}, {
        ...config,
        connection: { system: 'mongodb' },
      } as never)
    ).rejects.toThrow('This command requires a SQL connection, got: mongodb')

    await expect(runDrift([absent], {}, { schema: config.schema } as never)).rejects.toThrow(
      'This command requires a SQL connection, got: none'
    )
  })

  test('ignore patterns mutate neither the schema cache nor the supplied artifact', async () => {
    const path = await write('ignored.sql', ddl('users'))
    const artifactBefore = await Bun.file(path).text()
    const liveConfig = structuredClone(config)
    const configBefore = structuredClone(config)

    await runDrift([path], { ignore: 'public.*' }, liveConfig as never)

    expect(liveConfig).toEqual(configBefore)
    expect(await Bun.file(path).text()).toBe(artifactBefore)
  })

  test('surfaces blocked DDL table options without silently managing the table', async () => {
    const path = await write(
      'partitioned.sql',
      'CREATE TABLE users (id INTEGER PRIMARY KEY) PARTITION BY RANGE (id);'
    )
    const { report } = await runDrift([path], {}, config as never)

    expect(report.entries).toContainEqual(
      expect.objectContaining({
        category: 'missing_in_orm',
        table: 'public.users',
        object: 'table',
      })
    )
    expect(report.unparsed).toEqual([
      expect.objectContaining({
        location: 'users',
        reason: expect.stringContaining('blocked: unsupported CREATE TABLE table_options'),
      }),
    ])
    expect(report.summary.errors).toBe(0)
  })
})

describe('malformed JSON ORM artifacts', () => {
  // Message shape and the Drizzle-by-path route are pinned in
  // tests/unit/core/orm-drift/artifact-json.test.ts; this asserts runDrift
  // surfaces that error instead of the raw parser text.
  test('reach runDrift as a bounded error naming the file', async () => {
    const path = await write('broken-normalized.json', '{ "tables": [')

    const error = await runDrift([path], { ormFormat: 'json' }, config as never).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('Malformed normalized JSON schema')
    expect((error as Error).message).toContain(path)
  })
})

describe('diff command drift mode', () => {
  test('advertises typeorm and sequelize ORM formats in help', () => {
    const help = diffCommand.helpInformation()
    expect(help).toContain('Force ORM input format: prisma | ddl | json | drizzle |')
    expect(help).toContain('typeorm | sequelize')
  })

  test('rejects conflicting snapshot, against, and against-orm modes', () => {
    expect(() =>
      validateDiffModes({
        snapshot: 'snapshot.json',
        againstOrm: ['schema.prisma'],
      })
    ).toThrow('Choose exactly one')
    expect(() =>
      validateDiffModes({
        against: 'snapshot.json',
        againstOrm: ['schema.prisma'],
      })
    ).toThrow('Choose exactly one')
  })

  test('rejects a diff invocation that selects no mode at all', () => {
    expect(() => validateDiffModes({})).toThrow(
      'Specify --snapshot <path> to save, --against <path> to compare, or --against-orm <path> for ORM drift'
    )
    expect(() => validateDiffModes({ againstOrm: [] })).toThrow('Specify --snapshot')
  })

  test('table output renders a drift report without creating an adapter', async () => {
    const configSpy = spyOn(configModule, 'read').mockResolvedValue(config as never)
    const adapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
    const lines: string[] = []
    const logSpy = spyOn(console, 'log').mockImplementation((message: unknown) => {
      lines.push(String(message))
    })

    try {
      await diffAction({
        againstOrm: ['tests/fixtures/orm-drift/schema.prisma'],
        format: 'table',
        config: '.dbcli',
      })

      expect(lines.join('\n')).toContain('Drift vs prisma:')
      expect(lines.join('\n')).toContain('Summary:')
      expect(adapterSpy).not.toHaveBeenCalled()
    } finally {
      configSpy.mockRestore()
      adapterSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  test('sets exit code 1 for drift errors and never creates an adapter', async () => {
    const configSpy = spyOn(configModule, 'read').mockResolvedValue(config as never)
    const adapterSpy = spyOn(AdapterFactory, 'createSqlAdapter')
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})

    try {
      await diffAction({
        againstOrm: ['tests/fixtures/orm-drift/schema.prisma'],
        format: 'json',
        config: '.dbcli',
      })

      expect(process.exitCode).toBe(1)
      expect(adapterSpy).not.toHaveBeenCalled()
    } finally {
      configSpy.mockRestore()
      adapterSpy.mockRestore()
      logSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  test('sets exit code 0 when drift has no errors', async () => {
    const path = await write(
      'schema.json',
      JSON.stringify({
        source: 'json',
        tables: [
          {
            identity: { table: 'users' },
            columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
            indexes: [],
            foreignKeys: [],
          },
        ],
        unparsed: [],
      })
    )
    const configSpy = spyOn(configModule, 'read').mockResolvedValue(config as never)
    const logSpy = spyOn(console, 'log').mockImplementation(() => {})

    try {
      await diffAction({
        againstOrm: [path],
        ormFormat: 'json',
        format: 'markdown',
        config: '.dbcli',
      })

      expect(process.exitCode).toBe(0)
    } finally {
      configSpy.mockRestore()
      logSpy.mockRestore()
    }
  })

  test('validates drift and snapshot output formats independently', async () => {
    const configSpy = spyOn(configModule, 'read').mockResolvedValue(config as never)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never)

    try {
      await expect(
        diffAction({
          againstOrm: ['tests/fixtures/orm-drift/schema.prisma'],
          format: 'xml',
          config: '.dbcli',
        })
      ).rejects.toThrow('exit:1')
      expect(errorSpy).toHaveBeenCalledWith(
        'Invalid format "xml" for diff --against-orm. Allowed: json, table, markdown'
      )

      await expect(
        diffAction({
          snapshot: join(tempDir, 'snapshot.json'),
          format: 'markdown',
          config: '.dbcli',
        })
      ).rejects.toThrow('exit:1')
      expect(errorSpy).toHaveBeenCalledWith(
        'Invalid format "markdown" for diff. Allowed: json, table'
      )
    } finally {
      configSpy.mockRestore()
      errorSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })

  test('--recovery emits a structured envelope for drift failures', async () => {
    const cliPath = resolveTestPath('src/cli.ts')
    const child = Bun.spawn(
      [
        process.execPath,
        'run',
        cliPath,
        'diff',
        '--against-orm',
        join(tempDir, 'missing.prisma'),
        '--config',
        join(tempDir, 'missing-config'),
        '--recovery',
      ],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DBCLI_NO_UPDATE_CHECK: '1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      }
    )

    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    expect(exitCode).toBe(1)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      schemaVersion: 1,
      ok: false,
      error: { category: expect.any(String) },
    })
  })

  test('--recovery uses diff context, suppresses human stderr, and excludes snapshot mode', async () => {
    const contexts: unknown[] = []
    const recoverySentinel = new Error('recovery-emitted')
    mock.module('@/core/recovery', () => ({
      emitRecoveryEnvelope(_error: unknown, context: unknown): never {
        contexts.push(context)
        throw recoverySentinel
      },
    }))

    const configSpy = spyOn(configModule, 'read').mockResolvedValue(config as never)
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('snapshot-exit')
    }) as never)

    try {
      await expect(
        diffAction({
          againstOrm: [join(tempDir, 'missing.prisma')],
          format: 'json',
          config: '.dbcli',
          recovery: true,
        })
      ).rejects.toBe(recoverySentinel)
      expect(contexts).toEqual([{ operation: 'diff' }])
      expect(errorSpy).not.toHaveBeenCalled()

      await expect(
        diffAction({
          snapshot: join(tempDir, 'snapshot.json'),
          format: 'xml',
          config: '.dbcli',
          recovery: true,
        })
      ).rejects.toThrow('snapshot-exit')
      expect(contexts).toHaveLength(1)
      expect(errorSpy).toHaveBeenCalledWith('Invalid format "xml" for diff. Allowed: json, table')
    } finally {
      configSpy.mockRestore()
      errorSpy.mockRestore()
      exitSpy.mockRestore()
      mock.restore()
    }
  })
})

function resolveTestPath(relativePath: string): string {
  return join(import.meta.dir, '../../..', relativePath)
}
