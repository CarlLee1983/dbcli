/**
 * Named-init regression coverage. Every command runs the real CLI in a separate
 * process with disposable storage and a SQLite fixture. Interactive cases use
 * the repository's scripted prompt seam, not an operating-system PTY: only
 * stdin.isTTY and promptUser are replaced, while parsing and writes stay real.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DbcliConfigV2 } from '@/core/public'
import { DbcliConfigV2Schema } from '@/utils/validation'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const PROMPTS = pathToFileURL(resolve(import.meta.dir, '../../src/utils/prompts.ts')).href
const NAME_PROMPT = 'Connection name'
const TIMEOUT = 15_000
let workspace: string
let databasePath: string

interface PromptRecord {
  kind: string
  message: string
  fallback: string | null
}

interface Result {
  stdout: string
  stderr: string
  code: number
  prompts: PromptRecord[]
}

interface RunOptions {
  tty?: boolean
  agentMode?: boolean
  answers?: Array<string | null>
  confirmations?: boolean[]
  closedInput?: 'readableEnded' | 'destroyed'
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-init-name-'))
  await mkdir(join(workspace, 'home'))
  await mkdir(join(workspace, 'harness'))
  databasePath = join(workspace, 'fixture.sqlite')
  const database = new Database(databasePath, { create: true })
  database.run('CREATE TABLE fixture_marker (id INTEGER PRIMARY KEY)')
  database.close(true)
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

async function run(args: string[], options: RunOptions = {}): Promise<Result> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(key) || /^DB_/i.test(key) || key === 'DATABASE_URL') continue
    env[key] = value
  }
  Object.assign(env, {
    HOME: join(workspace, 'home'),
    XDG_CONFIG_HOME: join(workspace, 'home', '.config'),
    // Bun's own caches are harness artifacts, not application writes. Pin both
    // paths so snapshots stay strict regardless of the developer/CI cache env.
    BUN_INSTALL_CACHE_DIR: join(workspace, 'harness', 'bun-install-cache'),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(workspace, 'harness', 'bun-transpiler-cache'),
    DBCLI_CONFIG_HOME: join(workspace, 'registry'),
    DBCLI_CONFIG_INTEGRITY_ANCHOR_DIR: join(workspace, 'anchors'),
    DBCLI_LANG: 'en',
    DBCLI_NO_UPDATE_CHECK: '1',
    ...(options.agentMode ? { DBCLI_AGENT_MODE: '1' } : {}),
    NODE_ENV: 'test',
    NO_COLOR: '1',
  })

  const tracePath = join(workspace, 'harness', 'prompts.json')
  await Bun.write(tracePath, '[]')
  const preloadPath = join(workspace, 'harness', 'prompts.ts')
  if (options.tty) {
    // Fail on an unexpected/depleted prompt rather than returning blank forever.
    // A null answer reproduces the cancellation error from @inquirer/prompts.
    await Bun.write(
      preloadPath,
      `import { promptUser } from ${JSON.stringify(PROMPTS)}
Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
${options.closedInput ? `Object.defineProperty(process.stdin, ${JSON.stringify(options.closedInput)}, { configurable: true, value: true })` : ''}
const answers = ${JSON.stringify(options.answers ?? [])}
const confirmations = ${JSON.stringify(options.confirmations ?? [])}
const trace = []
async function record(kind, message, fallback) {
  trace.push({ kind, message, fallback: fallback ?? null })
  await Bun.write(${JSON.stringify(tracePath)}, JSON.stringify(trace))
}
promptUser.text = async (message, fallback) => {
  await record('text', message, fallback)
  if (!answers.length) throw new Error('Unexpected text prompt: ' + message)
  const answer = answers.shift()
  if (answer === null) {
    const error = new Error('User force closed the prompt with SIGINT')
    error.name = 'ExitPromptError'
    throw error
  }
  return answer
}
promptUser.confirm = async (message) => {
  await record('confirm', message)
  if (!confirmations.length) throw new Error('Unexpected confirmation: ' + message)
  return confirmations.shift()
}
for (const kind of ['select', 'secret']) {
  promptUser[kind] = async (message) => {
    await record(kind, message)
    throw new Error('Unexpected ' + kind + ' prompt: ' + message)
  }
}
`
    )
  }

  const child = Bun.spawn({
    cmd: [
      process.execPath,
      'run',
      ...(options.tty ? ['--preload', preloadPath] : []),
      CLI,
      ...args,
    ],
    cwd: workspace,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 12_000)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (timedOut) throw new Error(`init CLI timed out: ${stderr}`)
    const prompts = (await Bun.file(tracePath).json()) as PromptRecord[]
    return { stdout, stderr, code, prompts }
  } finally {
    clearTimeout(timer)
  }
}

function sqliteInit(extra: readonly string[] = []): string[] {
  return [
    'init',
    '--system',
    'sqlite',
    '--file',
    databasePath,
    '--permission',
    'query-only',
    '--skip-test',
    ...extra,
  ]
}

async function storedConfig(configPath = join(workspace, '.dbcli')): Promise<DbcliConfigV2> {
  const raw = await Bun.file(join(configPath, 'config.json')).json()
  // Match readV2Config's schema defaults when comparing pre/post connection
  // entries; an existing read-and-write may materialize optional SQLite fields.
  return DbcliConfigV2Schema.parse(
    raw.version === 3 ? await Bun.file(join(raw.binding.storagePath, 'config.json')).json() : raw
  )
}

/** Includes directories, config, bindings, credentials, integrity records and the database. */
async function snapshot(): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(directory: string, relative = ''): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!relative && entry.name === 'harness') continue
      const name = relative ? `${relative}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        files[`${name}/`] = 'directory'
        await visit(path, name)
      } else {
        files[name] = createHash('sha256')
          .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
          .digest('hex')
      }
    }
  }
  await visit(workspace)
  return files
}

function expectSuccess(result: Result): void {
  expect(result, result.stderr).toEqual(expect.objectContaining({ code: 0 }))
}

function expectRequiredName(result: Result): void {
  expect(result.code).toBe(1)
  expect(`${result.stdout}\n${result.stderr}`).toContain('--conn-name')
  expect(`${result.stdout}\n${result.stderr}`).toMatch(/connection name is required/i)
  expect(result.prompts).toEqual([])
}

async function seedRegistry(withDefault = true): Promise<DbcliConfigV2> {
  expectSuccess(await run(sqliteInit(['--conn-name', 'primary', '--no-interactive'])))
  expectSuccess(await run(sqliteInit(['--conn-name', 'other', '--no-interactive', '--force'])))
  if (!withDefault) expectSuccess(await run(['use', '--unset']))
  const binding = await Bun.file(join(workspace, '.dbcli', 'config.json')).json()
  await Bun.write(join(binding.binding.storagePath, '.env.local'), 'FIXTURE_VALUE=preserve-me\n')
  return storedConfig()
}

describe('interactive init obtains an explicit connection name', () => {
  test.each(['plain', 'explicit-config', 'global'] as const)(
    '%s init actively prompts without suggesting default and writes named v2',
    async (layout) => {
      const configPath = join(workspace, 'custom-config')
      const prefix =
        layout === 'global'
          ? ['--global']
          : layout === 'explicit-config'
            ? ['--config', configPath]
            : []
      const result = await run([...prefix, ...sqliteInit()], { tty: true, answers: ['analytics'] })
      expectSuccess(result)
      expect(result.prompts).toEqual([{ kind: 'text', message: NAME_PROMPT, fallback: null }])
      const config = await storedConfig(
        layout === 'global'
          ? join(workspace, 'registry')
          : layout === 'explicit-config'
            ? configPath
            : undefined
      )
      expect(config.version).toBe(2)
      expect(Object.keys(config.connections)).toEqual(['analytics'])
      expect(config.default).toBe('analytics')
      expect(config.connections.analytics).toMatchObject({ system: 'sqlite', file: databasePath })
    },
    TIMEOUT
  )

  test(
    'empty and whitespace-only responses explain the requirement and re-prompt',
    async () => {
      const result = await run(sqliteInit(), { tty: true, answers: ['', ' \t ', ' analytics '] })
      expectSuccess(result)
      expect(result.prompts).toEqual(
        Array.from({ length: 3 }, () => ({ kind: 'text', message: NAME_PROMPT, fallback: null }))
      )
      expect(`${result.stdout}\n${result.stderr}`).toMatch(/connection name is required/i)
      expect(Object.keys((await storedConfig()).connections)).toEqual(['analytics'])
    },
    TIMEOUT
  )

  test(
    'a blank explicit flag is rejected even on a TTY without prompting or writing',
    async () => {
      const before = await snapshot()
      const result = await run(sqliteInit(['--conn-name', ' \t ']), {
        tty: true,
      })
      expectRequiredName(result)
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test.each([false, true])(
    'cancelling the name prompt leaves existing=%j files untouched',
    async (existing) => {
      if (existing) await seedRegistry(false)
      const before = await snapshot()
      const result = await run(sqliteInit(['--force']), { tty: true, answers: [null] })
      expect(result.code).not.toBe(0)
      expect(result.prompts).toEqual([{ kind: 'text', message: NAME_PROMPT, fallback: null }])
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test.each(['readableEnded', 'destroyed'] as const)(
    'closed TTY input (%s) fails promptly without prompting or changing files',
    async (closedInput) => {
      await seedRegistry(false)
      const before = await snapshot()
      const result = await run(sqliteInit(['--force']), { tty: true, closedInput })
      expectRequiredName(result)
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )
})

describe('unattended init never silently chooses a name', () => {
  test.each([
    { label: 'pipe', args: [], tty: false },
    { label: 'no-interactive', args: ['--no-interactive'], tty: false },
    { label: 'TTY no-interactive', args: ['--no-interactive'], tty: true },
    { label: 'empty flag', args: ['--conn-name', ''], tty: false },
    { label: 'whitespace flag', args: ['--conn-name', ' \t '], tty: false },
    {
      label: 'TTY no-interactive blank',
      args: ['--conn-name', ' ', '--no-interactive'],
      tty: true,
    },
  ])(
    '$label fails without any writes',
    async ({ args, tty }) => {
      const before = await snapshot()
      const result = await run(sqliteInit(args), { tty })
      expectRequiredName(result)
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test.each(['--global', '--config'])(
    '%s cannot bypass required naming',
    async (flag) => {
      const before = await snapshot()
      const prefix = flag === '--config' ? [flag, join(workspace, 'custom-config')] : [flag]
      expectRequiredName(await run([...prefix, ...sqliteInit(['--no-interactive'])]))
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test(
    'complete env-reference flags remain noninteractive even on a TTY',
    async () => {
      const before = await snapshot()
      const result = await run(
        [
          'init',
          '--system',
          'postgresql',
          '--use-env-refs',
          '--env-host',
          'FIXTURE_HOST',
          '--env-port',
          'FIXTURE_PORT',
          '--env-user',
          'FIXTURE_USER',
          '--env-password',
          'FIXTURE_PASSWORD',
          '--env-database',
          'FIXTURE_DATABASE',
          '--skip-test',
        ],
        { tty: true }
      )
      expectRequiredName(result)
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test(
    'database --name alone does not name a connection or access its database',
    async () => {
      const before = await snapshot()
      let connectionAttempts = 0
      const listener = Bun.listen({
        hostname: '127.0.0.1',
        port: 0,
        socket: {
          open(socket) {
            connectionAttempts++
            socket.end()
          },
          data() {},
        },
      })
      try {
        const result = await run([
          'init',
          '--system',
          'postgresql',
          '--host',
          '127.0.0.1',
          '--port',
          String(listener.port),
          '--user',
          'fixture',
          '--password',
          'fixture',
          '--name',
          'database_only',
          '--no-interactive',
        ])
        expectRequiredName(result)
        expect(connectionAttempts).toBe(0)
        expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
          /ECONNREFUSED|connection testing|testing connection/i
        )
        expect(await snapshot()).toEqual(before)
      } finally {
        listener.stop(true)
      }
    },
    TIMEOUT
  )

  test(
    'missing name preserves an existing no-default registry and credentials',
    async () => {
      await seedRegistry(false)
      const before = await snapshot()
      expectRequiredName(await run(sqliteInit(['--no-interactive', '--force'])))
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )
})

describe('explicit names preserve established configuration semantics', () => {
  test.each([
    { name: 'chosen', tty: true },
    { name: 'default', tty: true },
    { name: 'default', tty: false },
  ])(
    'explicit $name with TTY=$tty skips the name prompt and remains valid',
    async ({ name, tty }) => {
      const result = await run(sqliteInit(['--conn-name', name]), { tty })
      expectSuccess(result)
      expect(result.prompts).toEqual([])
      const config = await storedConfig()
      expect(Object.keys(config.connections)).toEqual([name])
      expect(config.default).toBe(name)
    },
    TIMEOUT
  )

  test(
    'connection --conn-name and database --name retain separate values',
    async () => {
      const result = await run([
        'init',
        '--conn-name',
        'reporting',
        '--system',
        'postgresql',
        '--host',
        '127.0.0.1',
        '--port',
        '1',
        '--user',
        'fixture',
        '--password',
        'fixture',
        '--name',
        'warehouse',
        '--skip-test',
        '--no-interactive',
      ])
      expectSuccess(result)
      const config = await storedConfig()
      expect(Object.keys(config.connections)).toEqual(['reporting'])
      expect(config.connections.reporting).toMatchObject({ database: 'warehouse' })
    },
    TIMEOUT
  )

  test(
    'existing v1 remains readable and named import preserves its default connection',
    async () => {
      const configPath = join(workspace, 'legacy-config')
      await Bun.write(
        join(configPath, 'config.json'),
        JSON.stringify({
          connection: {
            system: 'postgresql',
            host: '127.0.0.1',
            port: 1,
            user: 'fixture',
            password: 'fixture',
            database: 'legacy_database',
          },
          permission: 'query-only',
          schema: {},
          metadata: { version: '1.0' },
          blacklist: { tables: [], columns: {} },
          audit: {
            enabled: false,
            strict: false,
            rotation: { max_bytes: 10485760, max_entries: 1000 },
          },
        })
      )
      const inventory = await run(['--config', configPath, 'use', '--list', '--format', 'json'])
      expectSuccess(inventory)
      expect(inventory.stdout).toContain('default')
      expectSuccess(
        await run([
          '--config',
          configPath,
          ...sqliteInit(['--conn-name', 'added', '--no-interactive', '--force']),
        ])
      )
      const config = await storedConfig(configPath)
      expect(config.version).toBe(2)
      expect(config.default).toBe('default')
      expect(Object.keys(config.connections).sort()).toEqual(['added', 'default'])
      expect(config.connections.default).toMatchObject({
        system: 'postgresql',
        database: 'legacy_database',
      })
      expect(config.connections.added).toMatchObject({ system: 'sqlite', file: databasePath })
    },
    TIMEOUT
  )

  test.each([false, true])(
    'prompted addition preserves default-present=%j and existing entries',
    async (withDefault) => {
      const original = await seedRegistry(withDefault)
      const result = await run(sqliteInit(['--force']), { tty: true, answers: ['added'] })
      expectSuccess(result)
      const config = await storedConfig()
      expect(config.default).toBe(original.default)
      expect(Object.hasOwn(config, 'default')).toBe(withDefault)
      for (const [name, connection] of Object.entries(original.connections)) {
        expect(config.connections[name]).toEqual(connection)
      }
      expect(Object.keys(config.connections).sort()).toEqual(['added', 'other', 'primary'])
    },
    TIMEOUT
  )

  test(
    'an explicit duplicate without force is refused without writes',
    async () => {
      await seedRegistry()
      const before = await snapshot()
      const result = await run(sqliteInit(['--conn-name', 'primary', '--no-interactive']))
      expect(result.code).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain('--force')
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test(
    'declining duplicate overwrite confirmation leaves all files untouched',
    async () => {
      await seedRegistry()
      const before = await snapshot()
      const result = await run(sqliteInit(['--conn-name', 'primary']), {
        tty: true,
        confirmations: [false],
      })
      expectSuccess(result)
      expect(result.prompts).toHaveLength(1)
      expect(result.prompts[0]?.kind).toBe('confirm')
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test.each([false, true])(
    'explicit force keeps default-present=%j and unrelated connections',
    async (withDefault) => {
      const original = await seedRegistry(withDefault)
      expectSuccess(
        await run(
          sqliteInit([
            '--conn-name',
            'other',
            '--permission',
            'read-write',
            '--no-interactive',
            '--force',
          ])
        )
      )
      const config = await storedConfig()
      expect(config.default).toBe(original.default)
      expect(Object.hasOwn(config, 'default')).toBe(withDefault)
      expect(config.connections.primary).toEqual(original.connections.primary)
      expect(config.connections.other).toMatchObject({ permission: 'read-write' })
    },
    TIMEOUT
  )

  test(
    'explicit force cannot bypass the agent-mode configuration and permission guard',
    async () => {
      expectSuccess(await run(sqliteInit(['--conn-name', 'default', '--no-interactive'])))
      const binding = await Bun.file(join(workspace, '.dbcli', 'config.json')).json()
      await Bun.write(
        join(binding.binding.storagePath, '.env.local'),
        'FIXTURE_VALUE=preserve-me\n'
      )
      const before = await snapshot()
      const result = await run(
        sqliteInit([
          '--conn-name',
          'default',
          '--permission',
          'admin',
          '--no-interactive',
          '--force',
        ]),
        { agentMode: true }
      )
      expect(result.code).toBe(1)
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Agent mode blocks configuration, permission, and credential changes.'
      )
      expect(result.prompts).toEqual([])
      expect((await storedConfig()).connections.default?.permission).toBe('query-only')
      expect(await snapshot()).toEqual(before)
    },
    TIMEOUT
  )

  test(
    'rename and remove do not require a new-connection name or prompt',
    async () => {
      await seedRegistry()
      const renamed = await run(['init', '--rename', 'other:renamed'], { tty: true })
      expectSuccess(renamed)
      expect(renamed.prompts).toEqual([])
      const removed = await run(['init', '--remove', 'renamed'], { tty: true })
      expectSuccess(removed)
      expect(removed.prompts).toEqual([])
      expect(Object.keys((await storedConfig()).connections)).toEqual(['primary'])
    },
    TIMEOUT
  )
})
