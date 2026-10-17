/** Supplementary G1 evidence. Only disposable compose credentials; original evidence is immutable. */
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const repo = resolve(import.meta.dir, '../../..')
const baseline = await Bun.file(join(import.meta.dir, 'evidence.json')).json()
const root = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-g1-probes-')))
const specs = {
  pg: { system: 'postgresql', port: 5433 },
  mysql: { system: 'mysql', port: 3307 },
  maria: { system: 'mariadb', port: 3308 },
} as const
const observations: unknown[] = []
const cases: unknown[] = []
const runQueries = process.argv.includes('--queries')
const redact = (value: string) =>
  value.replace(/\*[A-F0-9]{40}/g, '<REDACTED_FIXTURE_PASSWORD_HASH>')
try {
  for (const [engine, spec] of Object.entries(specs)) {
    const dir = join(root, engine)
    await mkdir(join(dir, 'home'), { recursive: true })
    const env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: join(dir, 'home'),
      XDG_CONFIG_HOME: join(dir, 'home', '.config'),
      DBCLI_CONFIG_HOME: join(dir, 'registry'),
      DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR: join(dir, 'anchors'),
      DBCLI_AGENT_MODE: '1',
      DBCLI_NO_UPDATE_CHECK: '1',
      NODE_ENV: 'test',
      DBCLI_LANG: 'en',
      NO_COLOR: '1',
    }
    async function execute(args: string[], setup = false, stdin?: string) {
      const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
        cwd: dir,
        env: { ...env, ...(setup && { DBCLI_AGENT_MODE: '0' }) },
        stdin: stdin ? new TextEncoder().encode(stdin) : 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { code, stdout: redact(stdout), stderr: redact(stderr) }
    }
    const config = {
      connection: {
        ...spec,
        host: '127.0.0.1',
        user: 'dbcli',
        password: 'testpass',
        database: 'dbcli_test',
      },
      permission: 'query-only',
      schema: {},
      blacklist: {
        tables: ['pg_authid', 'pg_catalog.pg_authid', 'mysql.global_priv'],
        columns: { '*': ['password', 'rolpassword', 'authentication_string', 'Priv'] },
      },
      audit: { enabled: false },
      metadata: { createdAt: '2026-10-18T00:00:00Z', version: '1.0' },
    }
    const setup = await execute(
      [
        '-e',
        `import { writeConfigWithIntegrity } from ${JSON.stringify(join(repo, 'src/core/config-integrity.ts'))}; await writeConfigWithIntegrity(process.argv[1], await Bun.stdin.text())`,
        join(dir, '.dbcli'),
      ],
      true,
      JSON.stringify(config)
    )
    if (setup.code) throw new Error('Isolated fixture config setup failed')
    async function cli(args: string[]) {
      const result = await execute(['run', join(repo, 'src/cli.ts'), ...args])
      observations.push({ engine, args, ...result })
      return result
    }
    const blacklist = await cli(['blacklist', 'list', '--format', 'json'])
    if (blacklist.code) throw new Error('Blacklist prerequisite failed')
    await cli(['query', 'SELECT version()', '--format', 'json'])
    if (engine !== 'pg') await cli(['query', 'SHOW GRANTS', '--format', 'json'])
    const schemas = new Map<string, { code: number; columns: string[] }>()
    for (const entry of baseline.cases) {
      if (
        entry.engine !== engine ||
        (entry.result !== 'schema-preflight-blocked' &&
          !['Q022', 'Q023', 'Q075', 'Q076', 'Q077', 'Q078'].includes(entry.id))
      )
        continue
      if (['Q009', 'Q010'].includes(entry.id)) {
        cases.push({ id: entry.id, engine, result: 'out-of-scope-function-source', sql: entry.sql })
        continue
      }
      const prerequisites: string[] = []
      let ready = true
      const columns = new Set<string>()
      for (const relation of entry.relations) {
        const qualified =
          engine === 'pg' && !relation.includes('.') ? `pg_catalog.${relation}` : relation
        prerequisites.push(qualified)
        if (!schemas.has(qualified)) {
          const result = await cli(['schema', qualified, '--format', 'json'])
          schemas.set(qualified, {
            code: result.code,
            columns: result.code
              ? []
              : JSON.parse(result.stdout).columns.map((c: { name: string }) => c.name),
          })
        }
        const schema = schemas.get(qualified)!
        ready &&= schema.code === 0
        for (const column of schema.columns) columns.add(column)
      }
      const versionFields: Record<string, string[]> = {
        Q040: [
          'status',
          'receive_start_lsn',
          'written_lsn',
          'flushed_lsn',
          'latest_end_lsn',
          'latest_end_time',
          'slot_name',
          'sender_host',
          'sender_port',
        ],
        Q043: [
          'slot_name',
          'slot_type',
          'database',
          'active',
          'active_pid',
          'wal_status',
          'safe_wal_size',
          'restart_lsn',
          'confirmed_flush_lsn',
          'inactive_since',
          'conflicting',
          'invalidation_reason',
          'failover',
          'synced',
        ],
      }
      const missingColumns = (versionFields[entry.id] ?? []).filter((name) => !columns.has(name))
      let result = ready ? 'schema-confirmed' : 'absent-or-native-invisible'
      let queryCode: number | undefined
      if (ready && missingColumns.length) result = 'version-column-mismatch'
      else if (ready && runQueries) {
        const query = await cli(['query', entry.sql, '--format', 'json', '--no-limit'])
        queryCode = query.code
        result = query.code === 0 ? 'query-succeeded' : 'query-failed'
      }
      cases.push({
        id: entry.id,
        engine,
        sql: entry.sql,
        prerequisites,
        missingColumns,
        result,
        queryCode,
      })
    }
  }
  const output = {
    recordedAt: new Date().toISOString(),
    baseline: 'evidence.json',
    scope: 'G1 only; local compose dbcli account; no RDS or replica topology',
    queriesExecuted: runQueries,
    cases,
    observations,
  }
  await Bun.write(join(import.meta.dir, 'g1-evidence.json'), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(cases, null, 2))
} finally {
  await rm(root, { recursive: true, force: true })
}
