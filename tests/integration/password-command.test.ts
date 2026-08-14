import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

const V2_CONFIG = {
  version: 2,
  default: 'primary',
  connections: {
    primary: {
      system: 'postgresql',
      host: 'primary.invalid',
      port: 5432,
      user: 'test',
      password: { $env: 'PRIMARY_PW' },
      database: 'primary_db',
      permission: 'query-only',
      envFile: '.env.primary',
    },
  },
  schema: {},
  metadata: { version: '2.0' },
}

let workspace: string
let configDir: string

async function run(
  args: string[],
  options: { stdin?: string; env?: Record<string, string> } = {}
): Promise<{ stdout: string; stderr: string; code: number }> {
  const processHandle = Bun.spawn({
    cmd: ['bun', 'run', CLI, '--config', configDir, ...args],
    cwd: workspace,
    env: { ...process.env, NODE_ENV: 'test', DBCLI_NO_UPDATE_CHECK: '1', ...options.env },
    stdin: options.stdin === undefined ? 'ignore' : new TextEncoder().encode(options.stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ])
  return { stdout, stderr, code }
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-password-cli-'))
  configDir = join(workspace, '.dbcli')
  await Bun.write(join(configDir, 'config.json'), JSON.stringify(V2_CONFIG, null, 2))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

describe('dbcli password', () => {
  test('--stdin --skip-test writes the value and reports where it landed', async () => {
    const result = await run(
      ['password', 'primary', '--stdin', '--skip-test', '--format', 'json'],
      {
        stdin: 'rotated-42\n',
      }
    )

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      success: true,
      connection: 'primary',
      envFile: '.env.primary',
      varName: 'PRIMARY_PW',
      convertedToEnvRef: false,
    })

    const envText = await readFile(join(configDir, '.env.primary'), 'utf8')
    expect(envText).toContain('PRIMARY_PW="rotated-42"')
  })

  test('never echoes the new password', async () => {
    const result = await run(['password', 'primary', '--stdin', '--skip-test'], {
      stdin: 'super-secret-value\n',
    })

    expect(result.code).toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toContain('super-secret-value')
  })

  test('--password and --stdin together fail without writing anything', async () => {
    const result = await run(
      ['password', 'primary', '--stdin', '--password', 'x', '--skip-test', '--format', 'json'],
      { stdin: 'y\n' }
    )

    expect(result.code).toBe(1)
    expect(JSON.parse(result.stderr).success).toBe(false)
    expect(await Bun.file(join(configDir, '.env.primary')).exists()).toBe(false)
  })

  test('a failed connection test leaves the stored password untouched', async () => {
    await run(['password', 'primary', '--password', 'original', '--skip-test'])
    const result = await run(['password', 'primary', '--password', 'replacement'])

    expect(result.code).toBe(1)
    const envText = await readFile(join(configDir, '.env.primary'), 'utf8')
    expect(envText).toContain('PRIMARY_PW="original"')
    expect(envText).not.toContain('replacement')
  })

  test('agent mode refuses before prompting or writing', async () => {
    const result = await run(['password', 'primary', '--stdin', '--skip-test'], {
      stdin: 'rotated-42\n',
      env: { DBCLI_AGENT_MODE: '1' },
    })

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Agent mode')
    expect(await Bun.file(join(configDir, '.env.primary')).exists()).toBe(false)
  })
})
