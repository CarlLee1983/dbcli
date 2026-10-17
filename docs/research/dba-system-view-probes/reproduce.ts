/** Local fixture replay for #240; never uses user dbcli config or DB environment variables. */
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { writeConfigWithIntegrity } from '../../../src/core/config-integrity'

if (process.argv.includes('--help')) {
  console.log('From repo root: bun --no-env-file docs/research/dba-system-view-probes/reproduce.ts')
  console.log(
    'Requires existing repo compose SQL services. Writes sanitized evidence in a temporary directory.'
  )
  process.exit(0)
}
// Trusted fixture provisioning only. Every CLI subprocess below runs in agent mode.
for (const key of Object.keys(process.env)) {
  if (/^(DBCLI_|DB_|PG_|MYSQL_|MARIADB_)/i.test(key) || key === 'DATABASE_URL')
    delete process.env[key]
}
const repo = resolve(import.meta.dir, '../../..')
const evidence = await Bun.file(join(import.meta.dir, 'evidence.json')).json()
const root = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-240-replay-')))
const profiles = new Map<string, { dir: string; env: Record<string, string> }>()
const specs: Record<string, { system: string; port: number }> = {
  pg: { system: 'postgresql', port: 5433 },
  mysql: { system: 'mysql', port: 3307 },
  maria: { system: 'mariadb', port: 3308 },
}
const outcomes: unknown[] = []
const byId = new Map<string, any>(evidence.observations.map((o: any) => [o.id, o]))
const visited = new Set<string>()
const redact = (text: string) => text.replace(/\*[A-F0-9]{40}/g, '<REDACTED_FIXTURE_PASSWORD_HASH>')
async function run(id: string) {
  if (visited.has(id)) return
  const observation = byId.get(id)
  const profile = profiles.get(observation.profile)!
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', 'run', join(repo, 'src/cli.ts'), ...observation.args],
    {
      cwd: profile.dir,
      env: profile.env,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  outcomes.push({
    id,
    profile: observation.profile,
    args: observation.args,
    code,
    stdout: redact(stdout),
    stderr: redact(stderr),
  })
  visited.add(id)
  console.log(`${id}: exit ${code} (recorded ${observation.code})`)
  // A changed prerequisite needs human reassessment, never blindly replay dependent queries.
  if (observation.code === 0 && code !== 0 && observation.args[0] !== 'query') {
    throw new Error(`${id}: previously successful prerequisite failed; replay stopped`)
  }
}
try {
  for (const [name, value] of Object.entries(evidence.profiles) as Array<[string, any]>) {
    const spec = specs[value.engine]!
    const dir = join(root, name)
    const home = join(dir, 'home')
    await mkdir(home, { recursive: true })
    const blacklist: { tables: string[]; columns: Record<string, string[]> } = {
      tables: ['pg_authid', 'pg_catalog.pg_authid', 'mysql.global_priv'],
      columns: { '*': ['password', 'rolpassword', 'authentication_string', 'Priv'] },
    }
    if (value.blacklistControl === 'table')
      blacklist.tables.push('TABLES', 'information_schema.TABLES')
    if (value.blacklistControl === 'column')
      blacklist.columns['information_schema.USER_PRIVILEGES'] = ['GRANTEE']
    await writeConfigWithIntegrity(
      join(dir, '.dbcli'),
      JSON.stringify({
        connection: {
          ...spec,
          host: '127.0.0.1',
          user: 'dbcli',
          password: 'testpass',
          database: value.database,
        },
        permission: 'query-only',
        schema: {},
        blacklist,
        audit: { enabled: false },
        metadata: { createdAt: new Date().toISOString(), version: '1.0' },
      })
    )
    profiles.set(name, {
      dir,
      env: {
        PATH: process.env.PATH ?? dirname(process.execPath),
        HOME: home,
        XDG_CONFIG_HOME: join(home, '.config'),
        DBCLI_CONFIG_HOME: join(home, 'dbcli'),
        NODE_ENV: 'test',
        DBCLI_AGENT_MODE: '1',
        DBCLI_NO_UPDATE_CHECK: '1',
        NO_COLOR: '1',
        LANG: 'en_US.UTF-8',
      },
    })
  }
  for (const id of evidence.preflight) await run(id)
  for (const id of evidence.additional) {
    const args = byId.get(id).args
    if (args[0] !== 'query' || /version\(\)/i.test(args[1])) await run(id)
  }
  for (const entry of evidence.cases) {
    for (const id of entry.observations.filter((id: string) => byId.get(id).args[0] !== 'query'))
      await run(id)
    for (const id of entry.scopedSchema) await run(id)
    for (const id of entry.observations.filter((id: string) => byId.get(id).args[0] === 'query'))
      await run(id)
  }
  for (const entry of evidence.blacklistControls) for (const id of entry.observations) await run(id)
} finally {
  const output = join(root, 'replay.json')
  await Bun.write(
    output,
    JSON.stringify(
      { revision: 'current working tree; compare separately to original evidence', outcomes },
      null,
      2
    ) + '\n'
  )
  for (const profile of profiles.values()) await rm(profile.dir, { recursive: true, force: true })
  console.log(`Sanitized replay evidence: ${output}`)
}
