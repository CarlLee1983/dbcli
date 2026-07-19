import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function safeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DBCLI_NO_UPDATE_CHECK: '1',
  }
}

function run(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((done) => {
    const child = spawn('bun', ['run', CLI, ...args], {
      cwd,
      env: safeEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('close', (code) => done({ stdout, stderr, code: code ?? 1 }))
  })
}

async function writeConfig(
  configPath: string,
  connectionName: string,
  system: 'postgresql' | 'mysql' | 'mariadb' = 'postgresql'
): Promise<void> {
  await Bun.write(
    join(configPath, 'config.json'),
    JSON.stringify({
      version: 2,
      default: connectionName,
      connections: {
        [connectionName]: {
          system,
          host: 'localhost',
          port: 1,
          user: 'test',
          password: '',
          database: 'test',
        },
      },
      audit: {
        enabled: true,
        rotation: { max_bytes: 10_485_760, max_entries: 1000 },
      },
    })
  )
}

describe('lint subprocess safety and redaction', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dbcli-lint-process-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('success audit redacts multiple SQL inputs, global values, and bulk values', async () => {
    const configPath = join(root, 'CONFIG_SENTINEL', '.dbcli')
    const connectionName = 'USE_SENTINEL'
    await Bun.$`mkdir -p ${configPath}`
    await writeConfig(configPath, connectionName)
    const bulkPath = join(root, 'BULK_SENTINEL.sql')
    await writeFile(bulkPath, 'SELECT 1;', 'utf8')

    const result = await run(
      [
        '--config',
        configPath,
        '--use',
        connectionName,
        'lint',
        "SELECT 'POSITIONAL_SENTINEL_ONE'",
        "SELECT 'POSITIONAL_SENTINEL_TWO'",
        '--bulk',
        `@${bulkPath}`,
        '--format',
        'json',
        '--no-schema',
      ],
      root
    )

    expect(result.code).toBe(0)
    const audit = await readFile(
      join(configPath, '.dbcli', 'audit', `${connectionName}.jsonl`),
      'utf8'
    )
    for (const sentinel of [
      'CONFIG_SENTINEL',
      'USE_SENTINEL',
      'BULK_SENTINEL',
      'POSITIONAL_SENTINEL_ONE',
      'POSITIONAL_SENTINEL_TWO',
    ]) {
      expect(audit).not.toContain(sentinel)
    }
    expect(audit).toContain('--format json')
    expect(audit).toContain('--no-schema')
  })

  test('failure audit and last-recovery redact global, positional, and bulk values', async () => {
    const configPath = join(root, 'FAIL_CONFIG_SENTINEL', '.dbcli')
    const connectionName = 'FAIL_USE_SENTINEL'
    await Bun.$`mkdir -p ${configPath}`
    await writeConfig(configPath, connectionName)

    const result = await run(
      [
        '--config',
        configPath,
        '--use',
        connectionName,
        'lint',
        "SELECT 'FAIL_POSITIONAL_SENTINEL_ONE'",
        "SELECT 'FAIL_POSITIONAL_SENTINEL_TWO'",
        '--bulk',
        '@FAIL_BULK_SENTINEL.sql',
        '--recovery',
        '--no-schema',
      ],
      root
    )

    expect(result.code).toBe(1)
    const audit = await readFile(
      join(configPath, '.dbcli', 'audit', `${connectionName}.jsonl`),
      'utf8'
    )
    const recovery = await readFile(join(root, '.dbcli', 'last-recovery.json'), 'utf8')
    for (const sentinel of [
      'FAIL_CONFIG_SENTINEL',
      'FAIL_USE_SENTINEL',
      'FAIL_BULK_SENTINEL',
      'FAIL_POSITIONAL_SENTINEL_ONE',
      'FAIL_POSITIONAL_SENTINEL_TWO',
    ]) {
      expect(audit).not.toContain(sentinel)
      expect(recovery).not.toContain(sentinel)
    }
    expect(recovery).toContain('--recovery')
    expect(recovery).toContain('--no-schema')
  })

  test('success audit redacts leading-comment SQL after the end-of-options delimiter', async () => {
    const configPath = join(root, 'DELIMITER_SUCCESS_CONFIG', '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await writeConfig(configPath, 'primary')
    const sql =
      "-- SUCCESS_COMMENT_SENTINEL\nSELECT 'SUCCESS_VALUE_SENTINEL'"

    const result = await run(
      [
        '--config',
        configPath,
        '--use',
        'primary',
        'lint',
        '--format',
        'json',
        '--no-schema',
        '--',
        sql,
      ],
      root
    )

    expect(result.code).toBe(0)
    const audit = await readFile(
      join(configPath, '.dbcli', 'audit', 'primary.jsonl'),
      'utf8'
    )
    expect(audit).not.toContain('SUCCESS_COMMENT_SENTINEL')
    expect(audit).not.toContain('SUCCESS_VALUE_SENTINEL')
    expect(audit).toContain('--format json --no-schema -- <sql>')
  })

  test('failure audit and recovery scrub leading-comment SQL after the delimiter', async () => {
    const configPath = join(root, 'DELIMITER_FAILURE_CONFIG', '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await writeConfig(configPath, 'primary')
    const sql =
      "-- FAILURE_COMMENT_SENTINEL\nSELECT 'FAILURE_VALUE_SENTINEL' FROM"

    const result = await run(
      [
        '--config',
        configPath,
        '--use',
        'primary',
        'lint',
        '--format',
        'invalid',
        '--recovery',
        '--no-schema',
        '--',
        sql,
      ],
      root
    )

    expect(result.code).toBe(1)
    const audit = await readFile(
      join(configPath, '.dbcli', 'audit', 'primary.jsonl'),
      'utf8'
    )
    const recovery = await readFile(
      join(root, '.dbcli', 'last-recovery.json'),
      'utf8'
    )
    for (const sentinel of [
      'FAILURE_COMMENT_SENTINEL',
      'FAILURE_VALUE_SENTINEL',
    ]) {
      expect(audit).not.toContain(sentinel)
      expect(recovery).not.toContain(sentinel)
    }
    expect(audit).toContain('--recovery --no-schema -- <sql>')
    expect(recovery).toContain('--recovery --no-schema -- <sql>')
  })

  test('lint suggests analyze only for proven read-only SQL without creating an adapter', async () => {
    const configPath = join(root, '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await writeConfig(configPath, 'primary')
    const unsafeStatements = [
      'UPDATE users SET active = false',
      'DELETE FROM users',
      'INSERT INTO users (id) VALUES (1)',
      'CREATE TABLE scratch (id integer)',
      'WITH changed AS (UPDATE users SET active = false RETURNING id) SELECT id FROM changed',
      'SELECT nextval(sequence_name)',
      'SELECT pg_advisory_lock(1)',
      'SELECT arbitrary_udf(id) FROM users',
      'SELECT * FROM arbitrary_table_function(1)',
    ]

    for (const sql of unsafeStatements) {
      const result = await run(
        ['--config', configPath, 'lint', sql, '--format', 'json', '--no-schema'],
        root
      )
      expect(result.code).toBe(0)
      const report = JSON.parse(result.stdout)[0] as {
        relatedCommands: string[]
      }
      expect(report.relatedCommands[1]).toStartWith('dbcli explain "')
    }

    const safe = await run(
      [
        '--config',
        configPath,
        'lint',
        'WITH active AS (SELECT id FROM users) SELECT id FROM active',
        '--format',
        'json',
        '--no-schema',
      ],
      root
    )
    expect(safe.code).toBe(0)
    const report = JSON.parse(safe.stdout)[0] as { relatedCommands: string[] }
    expect(report.relatedCommands[1]).toStartWith('dbcli explain --analyze "')
  })

  test('explain --analyze rejects unproven SQL before attempting a connection', async () => {
    const configPath = join(root, '.dbcli')
    await Bun.$`mkdir -p ${configPath}`
    await writeConfig(configPath, 'primary')

    for (const sql of [
      'UPDATE users SET active = false',
      'DELETE FROM users',
      'INSERT INTO users (id) VALUES (1)',
      'CREATE TABLE scratch (id integer)',
      'WITH changed AS (UPDATE users SET active = false RETURNING id) SELECT id FROM changed',
      'SELECT nextval(sequence_name)',
      'SELECT set_config(\'application_name\', \'dbcli\', false)',
      'SELECT arbitrary_udf(id) FROM users',
      'SELECT * FROM arbitrary_table_function(1)',
    ]) {
      const result = await run(
        ['--config', configPath, 'explain', sql, '--analyze'],
        root
      )
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(
        '--analyze requires a proven read-only SELECT'
      )
      expect(result.stderr).not.toContain('ECONNREFUSED')
    }
  })

  test.each(['mysql', 'mariadb'] as const)(
    'session assignment gets plain lint guidance and --analyze rejects before connecting (%s)',
    async (system) => {
      const configPath = join(root, `.dbcli-${system}`)
      await Bun.$`mkdir -p ${configPath}`
      await writeConfig(configPath, 'primary', system)
      const sql = 'SELECT @session_value := 1'

      const lintResult = await run(
        ['--config', configPath, 'lint', sql, '--format', 'json', '--no-schema'],
        root
      )
      expect(lintResult.code).toBe(0)
      const report = JSON.parse(lintResult.stdout)[0] as {
        relatedCommands: string[]
      }
      expect(report.relatedCommands[1]).toStartWith('dbcli explain "')

      const explainResult = await run(
        ['--config', configPath, 'explain', sql, '--analyze'],
        root
      )
      expect(explainResult.code).toBe(1)
      expect(explainResult.stderr).toContain(
        '--analyze requires a proven read-only SELECT'
      )
      expect(explainResult.stderr).not.toContain('ECONNREFUSED')
    }
  )
})
