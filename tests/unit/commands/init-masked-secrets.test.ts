/**
 * Interactive `dbcli init` must collect credentials without echoing them.
 *
 * Story: DBCLI-004. The canary is never printed in an assertion message — an
 * assertion that reports it would put the secret in exactly the place this
 * suite exists to keep it out of.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { initCommand } from '@/commands/init'
import { promptUser } from '@/utils/prompts'
import { configModule } from '@/core/config'
import { AdapterFactory, ConnectionError } from '@/adapters'

const CANARY = 'Sup3r-Canary-Pw'
const CANARY_URI = `mongodb://app:${CANARY}@db.example.com:27017/shop`

class ProcessExited extends Error {}

interface RunResult {
  /** Labels of every prompt, split by how the value was collected. */
  askedByText: string[]
  askedBySecret: string[]
  written: any
  exited: boolean
  /** Everything the run put on stdout and stderr, joined. */
  output: string
  failure: Error | undefined
}

/**
 * Drive one init run with scripted answers, capturing both output streams.
 * `answers` matches on a label substring; a miss answers empty, as pressing
 * Enter would.
 */
async function runInit(
  argv: string[],
  answers: Array<[string, string | boolean]>,
  hooks: {
    tty?: boolean
    secret?: (label: string) => Promise<string>
    adapter?: () => unknown
    mongoAdapter?: () => unknown
  } = {}
): Promise<RunResult> {
  const askedByText: string[] = []
  const askedBySecret: string[] = []
  const captured: string[] = []
  let written: any = null
  let failure: Error | undefined

  const answerFor = (label: string): string | boolean => {
    const hit = answers.find(([needle]) => label.includes(needle))
    return hit ? hit[1] : ''
  }

  const textSpy = spyOn(promptUser, 'text').mockImplementation(
    async (label: string, fallback?: string) => {
      askedByText.push(label)
      const answer = answerFor(label)
      return answer === '' ? (fallback ?? '') : String(answer)
    }
  )
  const secretSpy = spyOn(promptUser, 'secret').mockImplementation(async (label: string) => {
    askedBySecret.push(label)
    if (hooks.secret) return await hooks.secret(label)
    const answer = answerFor(label)
    return answer === '' ? '' : String(answer)
  })
  const selectSpy = spyOn(promptUser, 'select').mockImplementation(
    async (label: string, choices: string[]) => {
      askedByText.push(label)
      const answer = answerFor(label)
      return answer === '' ? (choices[0] ?? '') : String(answer)
    }
  )
  const confirmSpy = spyOn(promptUser, 'confirm').mockImplementation(async (label: string) => {
    askedByText.push(label)
    return Boolean(answerFor(label))
  })

  const writeSpy = spyOn(configModule, 'write').mockImplementation(async (_path, config) => {
    written = config
  })
  const logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    captured.push(args.map(String).join(' '))
  })
  const errorSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    captured.push(args.map(String).join(' '))
  })
  const warnSpy = spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    captured.push(args.map(String).join(' '))
  })
  const stdoutSpy = spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    captured.push(String(chunk))
    return true
  }) as never)
  const stderrSpy = spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    captured.push(String(chunk))
    return true
  }) as never)
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExited(`process.exit(${code})`)
  }) as never)

  const adapterSpy = hooks.adapter
    ? spyOn(AdapterFactory, 'createAdapterWithoutRules').mockImplementation(hooks.adapter as never)
    : undefined
  const mongoSpy = hooks.mongoAdapter
    ? spyOn(AdapterFactory, 'createMongoDBAdapter').mockImplementation(hooks.mongoAdapter as never)
    : undefined

  const originalIsTTY = process.stdin.isTTY
  Object.defineProperty(process.stdin, 'isTTY', {
    value: hooks.tty === false ? undefined : true,
    configurable: true,
  })

  // The repository's own .env is auto-loaded and would satisfy the credential
  // before any prompt, which is correct behaviour but not what is under test.
  const ENV_KEYS = [
    'DATABASE_URL',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'DB_DATABASE',
  ]
  const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]

  const rootArgs: string[] = []
  const initArgs: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') {
      rootArgs.push('--config', argv[++i]!)
    } else {
      initArgs.push(argv[i]!)
    }
  }

  const program = new Command()
    .option('--config <path>', 'Config path', '.dbcli')
    .exitOverride()
    .addCommand(initCommand)

  let exited = false
  try {
    await program.parseAsync([...rootArgs, 'init', ...initArgs], { from: 'user' })
  } catch (error) {
    if (error instanceof ProcessExited) {
      exited = true
    } else {
      failure = error as Error
    }
  } finally {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const spy of [
      textSpy,
      secretSpy,
      selectSpy,
      confirmSpy,
      writeSpy,
      logSpy,
      errorSpy,
      warnSpy,
      stdoutSpy,
      stderrSpy,
      exitSpy,
      adapterSpy,
      mongoSpy,
    ]) {
      spy?.mockRestore()
    }
  }

  return { askedByText, askedBySecret, written, exited, output: captured.join('\n'), failure }
}

let dir = ''
let configPath = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dbcli-init-secret-'))
  configPath = join(dir, '.dbcli')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('interactive init collects credentials through the masked prompt', () => {
  for (const system of ['postgresql', 'mysql', 'mariadb', 'redis', 'elasticsearch'] as const) {
    test(`${system} routes the password through the masked prompt and never echoes it`, async () => {
      const { askedByText, askedBySecret, written, output, failure } = await runInit(
        ['--system', system, '--config', configPath, '--skip-test', '--force'],
        [
          ['host', 'db.example.com'],
          ['user', 'app'],
          ['password', CANARY],
          ['name', 'shop'],
        ]
      )

      expect(failure).toBeUndefined()
      expect(askedBySecret.some((label) => label.toLowerCase().includes('password'))).toBe(true)
      expect(askedByText.some((label) => label.toLowerCase().includes('password'))).toBe(false)
      expect(written?.connection?.password === CANARY).toBe(true)
      expect(written?.connection?.user).toBe('app')
      expect(output.includes(CANARY)).toBe(false)
    })
  }

  test('host, port, user, database, and env-var names stay visible prompts', async () => {
    const { askedByText, askedBySecret } = await runInit(
      ['--system', 'postgresql', '--config', configPath, '--skip-test', '--force'],
      [['password', CANARY]]
    )

    const visible = askedByText.join('|').toLowerCase()
    expect(visible).toContain('host')
    expect(visible).toContain('port')
    expect(visible).toContain('user')
    expect(visible).toContain('name')
    expect(askedBySecret).toHaveLength(1)
  })

  test('env-ref mode asks for variable names in the clear and never a value', async () => {
    const { askedBySecret, written } = await runInit(
      [
        '--system',
        'postgresql',
        '--config',
        configPath,
        '--use-env-refs',
        '--skip-test',
        '--force',
      ],
      [['password', 'DB_PASSWORD']]
    )

    expect(askedBySecret).toHaveLength(0)
    expect(written?.connection?.password).toEqual({ $env: 'DB_PASSWORD' })
  })

  test('MongoDB field mode masks the password', async () => {
    const { askedByText, askedBySecret, written, output } = await runInit(
      ['--system', 'mongodb', '--config', configPath, '--skip-test', '--force'],
      [
        ['Host', 'db.example.com'],
        ['User', 'app'],
        ['Password', CANARY],
        ['Database name', 'shop'],
      ]
    )

    expect(askedBySecret.some((label) => label.includes('Password'))).toBe(true)
    expect(askedByText.some((label) => label.includes('Password'))).toBe(false)
    expect(written?.connection?.password === CANARY).toBe(true)
    expect(output.includes(CANARY)).toBe(false)
  })

  test('MongoDB URI mode masks the pasted connection string', async () => {
    const { askedByText, askedBySecret, written, output } = await runInit(
      ['--system', 'mongodb', '--config', configPath, '--skip-test', '--force'],
      [
        ['連線設定方式', '貼上完整連線字串（進階）'],
        ['連線字串', CANARY_URI],
        ['Database name', 'shop'],
      ]
    )

    expect(askedBySecret.some((label) => label.includes('連線字串'))).toBe(true)
    expect(askedByText.some((label) => label.includes('連線字串'))).toBe(false)
    expect(written?.connection?.uri === CANARY_URI).toBe(true)
    expect(output.includes(CANARY)).toBe(false)
    expect(output.includes(CANARY_URI)).toBe(false)
  })
})

describe('explicit inputs bypass the secret prompt', () => {
  test('--password is kept and never re-asked', async () => {
    const { askedBySecret, written, output } = await runInit(
      [
        '--system',
        'postgresql',
        '--config',
        configPath,
        '--password',
        CANARY,
        '--skip-test',
        '--force',
      ],
      [['user', 'app']]
    )

    expect(askedBySecret).toHaveLength(0)
    expect(written?.connection?.password === CANARY).toBe(true)
    expect(output.includes(CANARY)).toBe(false)
  })

  test('MongoDB --password is kept and never re-asked', async () => {
    const { askedBySecret, written } = await runInit(
      [
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--password',
        CANARY,
        '--skip-test',
        '--force',
      ],
      [
        ['User', 'app'],
        ['Database name', 'shop'],
      ]
    )

    expect(askedBySecret).toHaveLength(0)
    expect(written?.connection?.password === CANARY).toBe(true)
  })

  test('MongoDB --uri skips the setup-mode and URI prompts', async () => {
    const { askedByText, askedBySecret, written } = await runInit(
      [
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--uri',
        CANARY_URI,
        '--skip-test',
        '--force',
      ],
      [['Database name', 'shop']]
    )

    expect(askedBySecret).toHaveLength(0)
    expect(askedByText.some((label) => label.includes('連線設定方式'))).toBe(false)
    expect(written?.connection?.uri === CANARY_URI).toBe(true)
  })

  test('--no-interactive never reaches a secret prompt', async () => {
    const { askedBySecret, written, exited } = await runInit(
      [
        '--system',
        'postgresql',
        '--config',
        configPath,
        '--no-interactive',
        '--user',
        'app',
        '--name',
        'shop',
        '--skip-test',
        '--force',
      ],
      []
    )

    expect(askedBySecret).toHaveLength(0)
    expect(exited).toBe(false)
    expect(written?.connection?.user).toBe('app')
  })

  test('--no-interactive with missing input fails validation and writes nothing', async () => {
    const { askedBySecret, written, failure, exited } = await runInit(
      ['--system', 'postgresql', '--config', configPath, '--no-interactive', '--skip-test'],
      []
    )

    expect(askedBySecret).toHaveLength(0)
    expect(written).toBeNull()
    expect(exited || failure !== undefined).toBe(true)
  })
})

describe('the secret prompt fails closed', () => {
  test('a non-TTY run stops before writing rather than reading plaintext', async () => {
    const { written, output, exited } = await runInit(
      ['--system', 'postgresql', '--config', configPath, '--skip-test', '--force'],
      [['password', CANARY]],
      {
        tty: false,
        // The real prompt refuses without a TTY; reproduce that here rather
        // than letting the mock answer where the shipped code would not.
        secret: async () => {
          throw new Error('Masked input is unavailable; pass --password.')
        },
      }
    )

    expect(written).toBeNull()
    expect(exited).toBe(true)
    expect(output.includes(CANARY)).toBe(false)
  })

  test('an unavailable masked prompt names a supported input and not --stdin', async () => {
    const { written, output } = await runInit(
      ['--system', 'postgresql', '--config', configPath, '--skip-test', '--force'],
      [],
      {
        secret: async (label) => {
          const { maskedInputUnavailableError } = await import('@/utils/prompts')
          throw maskedInputUnavailableError(
            `pass --password instead of typing ${label.trim()}`,
            new Error('bundler stripped @inquirer/prompts')
          )
        },
      }
    )

    expect(written).toBeNull()
    expect(output).toContain('--password')
    expect(output).not.toContain('--stdin')
    expect(output).not.toContain('bundler stripped')
  })

  test('cancelling the masked prompt propagates and writes nothing', async () => {
    const { written, output, exited } = await runInit(
      ['--system', 'postgresql', '--config', configPath, '--skip-test', '--force'],
      [],
      {
        secret: async () => {
          throw new Error('User force closed the prompt')
        },
      }
    )

    expect(written).toBeNull()
    expect(exited).toBe(true)
    expect(output).toContain('User force closed the prompt')
  })
})

describe('failed connection tests do not reproduce the credential', () => {
  const failingAdapter = (message: string, hints: string[]) => () => ({
    connect: async () => {
      throw new ConnectionError('AUTH_FAILED', message, hints)
    },
    testConnection: async () => true,
    disconnect: async () => {},
  })

  test('a SQL driver error quoting the password is redacted', async () => {
    const { output, exited } = await runInit(
      ['--system', 'postgresql', '--config', configPath, '--force'],
      [
        ['host', 'db.example.com'],
        ['user', 'app'],
        ['password', CANARY],
        ['name', 'shop'],
      ],
      {
        adapter: failingAdapter(`password authentication failed: ${CANARY}`, [
          `check the password ${CANARY}`,
        ]),
      }
    )

    expect(exited).toBe(true)
    expect(output.includes(CANARY)).toBe(false)
    expect(output).toContain('<redacted>')
  })

  test('a MongoDB driver error reproducing the URI is redacted', async () => {
    const { output, exited } = await runInit(
      ['--system', 'mongodb', '--config', configPath, '--force'],
      [
        ['連線設定方式', '貼上完整連線字串（進階）'],
        ['連線字串', CANARY_URI],
        ['Database name', 'shop'],
      ],
      {
        mongoAdapter: failingAdapter(`connect ECONNREFUSED for ${CANARY_URI}`, [
          `verify ${CANARY_URI}`,
        ]),
      }
    )

    expect(exited).toBe(true)
    expect(output.includes(CANARY)).toBe(false)
    expect(output.includes(CANARY_URI)).toBe(false)
  })
})
