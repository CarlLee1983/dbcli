import { expect, test, beforeAll } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const repoRoot = resolve(import.meta.dir, '..', '..')
const distEntry = join(repoRoot, 'dist', 'agent-core.mjs')

/**
 * `agent-core` exists to be consumed by downstream agent-facing tools, and those
 * tools do not necessarily run on Bun (logq runs on Node). Every other test in
 * this repo runs under Bun, so a Bun-only builtin inside agent-core is invisible
 * to them — that is exactly how `loadEnvFile` shipped calling `Bun.file` and
 * broke the first Node consumer. This test spawns a real `node` process against
 * the built bundle so that failure mode cannot ship again.
 */
beforeAll(async () => {
  await run('bun', ['run', 'build'], { cwd: repoRoot })
}, 120_000)

async function inNode(script: string): Promise<string> {
  // Deliberately `node`, not `process.execPath` — this suite runs under Bun and
  // the whole point is to leave Bun behind.
  const { stdout } = await run('node', ['--input-type=module', '-e', script])
  return stdout.trim()
}

test('every agent-core export is callable from Node', async () => {
  const output = await inNode(`
    import * as agentCore from ${JSON.stringify(distEntry)}
    const names = Object.keys(agentCore).sort()
    agentCore.resolveEnvRef({ $env: 'PATH' }, 'field')
    agentCore.trimAppliedLimit([1, 2, 3], 2)
    agentCore.parseConnectionNames('a,b')
    agentCore.resolveConnectionSelector({ command: 'primary' })
    new agentCore.ConfigError('probe')
    console.log(names.join(','))
  `)

  expect(output).toBe(
    'ConfigError,loadEnvFile,parseConnectionNames,resolveConnectionSelector,resolveEnvRef,trimAppliedLimit'
  )
})

test('loadEnvFile works under Node without overwriting existing values', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dbcli-node-env-'))
  const envFile = join(directory, '.env')
  await writeFile(envFile, 'DBCLI_NODE_FRESH=from-file\nDBCLI_NODE_EXISTING=from-file\n', 'utf8')

  try {
    const output = await inNode(`
      import { loadEnvFile } from ${JSON.stringify(distEntry)}
      process.env.DBCLI_NODE_EXISTING = 'from-environment'
      await loadEnvFile(${JSON.stringify(envFile)})
      console.log([process.env.DBCLI_NODE_FRESH, process.env.DBCLI_NODE_EXISTING].join('|'))
    `)

    expect(output).toBe('from-file|from-environment')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('loadEnvFile reports a missing file as ConfigError under Node', async () => {
  const output = await inNode(`
    import { loadEnvFile, ConfigError } from ${JSON.stringify(distEntry)}
    try {
      await loadEnvFile('/definitely/not/here/.env')
      console.log('no-throw')
    } catch (error) {
      console.log(error instanceof ConfigError ? 'ConfigError' : error.constructor.name)
    }
  `)

  expect(output).toBe('ConfigError')
})
