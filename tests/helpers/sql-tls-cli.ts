import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dir, '../..')
export interface TlsWorkspace {
  dir: string
  config: string
  env: Record<string, string>
  close(): Promise<void>
}
export async function tlsWorkspace(): Promise<TlsWorkspace> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dbcli-sql-tls-')))
  await mkdir(join(dir, 'home'))
  return {
    dir,
    config: join(dir, '.dbcli'),
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: join(dir, 'home'),
      DBCLI_CONFIG_HOME: join(dir, 'registry'),
      DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR: join(dir, 'anchors'),
      DBCLI_LANG: 'en',
      DBCLI_AGENT_MODE: '0',
      DBCLI_NO_UPDATE_CHECK: '1',
      NODE_ENV: 'test',
      NO_COLOR: '1',
    },
    close: () => rm(dir, { recursive: true, force: true }),
  }
}
export async function tlsProcess(work: TlsWorkspace, args: string[], extraEnv = {}) {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
    cwd: work.dir,
    env: { ...work.env, ...extraEnv },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}
export function tlsCli(work: TlsWorkspace, args: string[], extraEnv = {}) {
  return tlsProcess(
    work,
    ['run', join(ROOT, 'src/cli.ts'), '--config', work.config, ...args],
    extraEnv
  )
}
export const initArgs = (name: string, port = 5432, host = 'localhost') => [
  'init',
  '--conn-name',
  name,
  '--no-interactive',
  '--system',
  'postgresql',
  '--host',
  host,
  '--port',
  String(port),
  '--user',
  'dbcli',
  '--password',
  'fixture-only',
  '--name',
  'dbcli_test',
  '--permission',
  'query-only',
  '--force',
]
export async function readTlsProfile(work: TlsWorkspace, name?: string) {
  return tlsProcess(work, [
    '-e',
    `import { configModule } from ${JSON.stringify(join(ROOT, 'src/core/config.ts'))}; console.log(JSON.stringify(await configModule.read(process.argv[1], process.argv[2], {loadLayeredSchema:false})))`,
    work.config,
    ...(name ? [name] : []),
  ])
}
