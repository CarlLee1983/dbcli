/**
 * MongoDB 逐欄連線設定的 init 互動流程
 *
 * 規格：docs/specs/2026-08-04-mongodb-field-first-connection.md（B 段）
 * 決策：docs/adr/ADR-0002-mongodb-connection-field-first-config.md
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { initCommand } from '@/commands/init'
import { promptUser } from '@/utils/prompts'
import * as configV2 from '@/core/config-v2'
import * as configBinding from '@/core/config-binding'
import { AdapterFactory } from '@/adapters'

interface RunResult {
  /** 依序記錄每一次提問的標籤，用來斷言提問順序 */
  askedLabels: string[]
  /** writeV2Config 收到的 named-v2 設定內容 */
  written: any
  /** init 是否走到 process.exit（錯誤路徑） */
  exited: boolean
  /** console.error 收到的訊息 */
  errors: string
}

/** process.exit 的攔截哨兵：讓錯誤路徑可觀測，而非直接殺掉測試行程 */
class ProcessExited extends Error {}

/**
 * 跑一次 init，把互動回答餵給 promptUser，並攔下最終寫入的設定。
 * answers 以「標籤子字串 → 回答」比對；未命中的提問回傳空字串（等同直接 Enter）。
 */
async function runInit(
  argv: string[],
  answers: Array<[string, string | boolean]>,
  /** 需要「同一個提問給不同回答」時，用它接管；回傳 undefined 表示交回 answers */
  override?: (label: string) => string | boolean | undefined
): Promise<RunResult> {
  const askedLabels: string[] = []
  let written: any = null

  function answerFor(label: string): string | boolean {
    askedLabels.push(label)
    const overridden = override?.(label)
    if (overridden !== undefined) return overridden
    const hit = answers.find(([needle]) => label.includes(needle))
    return hit ? hit[1] : ''
  }

  const textSpy = spyOn(promptUser, 'text').mockImplementation(
    async (label: string, fallback?: string) => {
      const answer = answerFor(label)
      return answer === '' ? (fallback ?? '') : String(answer)
    }
  )
  // Credential-bearing prompts are masked, so they carry no visible default —
  // an unanswered secret is an empty answer, not a fallback value.
  const secretSpy = spyOn(promptUser, 'secret').mockImplementation(async (label: string) => {
    const answer = answerFor(label)
    return answer === '' ? '' : String(answer)
  })
  const selectSpy = spyOn(promptUser, 'select').mockImplementation(
    async (label: string, choices: string[]) => {
      const answer = answerFor(label)
      return answer === '' ? (choices[0] ?? '') : String(answer)
    }
  )
  const confirmSpy = spyOn(promptUser, 'confirm').mockImplementation(async (label: string) => {
    const answer = answerFor(label)
    return answer === '' ? false : Boolean(answer)
  })
  const writeSpy = spyOn(configV2, 'writeV2Config').mockImplementation(async (_path, config) => {
    written = config
  })
  // Keep the named-v2 write boundary observable without creating a project
  // binding or home-storage directory for this prompt-only unit fixture.
  const bindingSpy = spyOn(configBinding, 'writeProjectBinding').mockImplementation(
    async (projectPath, storagePath = '') => ({
      version: 3,
      binding: {
        type: 'home-storage',
        storagePath,
        projectPath,
        createdAt: new Date().toISOString(),
      },
    })
  )

  // init 的 action 會攔下例外、印訊息後 process.exit(1)。不攔截的話整個
  // 測試行程會就地死掉，後面的 test 全部不會執行。
  const errorLines: string[] = []
  const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errorLines.push(args.map(String).join(' '))
  })
  const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExited(`process.exit(${code})`)
  }) as never)
  let exited = false

  // --config 是 root-level 選項：從 argv 抽出來放到父 command 前面，
  // 對應真實 CLI 的 `dbcli --config <path> init ...` 結構。
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

  try {
    await program.parseAsync([...rootArgs, 'init', ...initArgs], { from: 'user' })
  } catch (err) {
    if (!(err instanceof ProcessExited)) throw err
    exited = true
  } finally {
    textSpy.mockRestore()
    secretSpy.mockRestore()
    selectSpy.mockRestore()
    confirmSpy.mockRestore()
    writeSpy.mockRestore()
    bindingSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
  }

  return { askedLabels, written, exited, errors: errorLines.join('\n') }
}

describe('init — MongoDB 逐欄連線設定', () => {
  let dir: string
  let configPath: string
  let originalIsTTY: unknown

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dbcli-init-mongo-'))
    configPath = join(dir, '.dbcli')
    originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  })

  afterEach(async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    })
    await rm(dir, { recursive: true, force: true })
  })

  test('明示連線名稱後第一個提問是連線設定方式，且預設為逐欄填寫', async () => {
    const { askedLabels } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--skip-test',
        '--force',
      ],
      [['Database name', 'shop']]
    )

    expect(askedLabels[0]).toContain('連線設定方式')
    // 逐欄是預設選項，所以第二個提問就是 Host
    expect(askedLabels[1]).toContain('Host')
  })

  test('逐欄分支寫出的設定含 authSource 且不含 uri', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--skip-test',
        '--force',
      ],
      [
        ['Host', 'db.example.com'],
        ['Port', '27017'],
        ['User', 'app'],
        ['Password', 'secret'],
        ['Database name', 'shop'],
        ['authSource', 'appdb'],
      ]
    )

    expect(written.version).toBe(2)
    expect(written.default).toBe('default')
    expect(written.connections.default).toMatchObject({
      system: 'mongodb',
      host: 'db.example.com',
      user: 'app',
      database: 'shop',
      authSource: 'appdb',
    })
    expect(written.connections.default.uri).toBeUndefined()
  })

  test('無認證時 user/password 為空字串，且不寫 authSource', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--skip-test',
        '--force',
      ],
      [
        ['Host', 'db.example.com'],
        ['Database name', 'shop'],
      ]
    )

    expect(written.connections.default.host).toBe('db.example.com')
    // 空字串是 mongo schema 對「無認證」的既有表示法（與 Redis 一致），
    // 不是 URI 模式那種假的 host 佔位值。
    expect(written.connections.default.user).toBe('')
    expect(written.connections.default.password).toBe('')
    expect(written.connections.default.authSource).toBeUndefined()
  })

  test('Port 輸入非數字時重問，不會把 NaN 寫進設定', async () => {
    let portAsks = 0
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--skip-test',
        '--force',
      ],
      [
        ['Host', 'db.example.com'],
        ['Database name', 'shop'],
      ],
      (label) => {
        if (label.includes('Port')) {
          portAsks += 1
          return portAsks === 1 ? 'abc' : '27018'
        }
        return undefined
      }
    )

    expect(portAsks).toBe(2)
    expect(written.connections.default.port).toBe(27018)
  })

  test('選了貼上連線字串卻直接 Enter 時，退回逐欄而非寫出空 host', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--skip-test',
        '--force',
      ],
      [
        ['連線設定方式', '貼上完整連線字串（進階）'],
        ['Host', 'db.example.com'],
        ['Database name', 'shop'],
      ]
    )

    expect(written.connections.default.uri).toBeUndefined()
    expect(written.connections.default.host).toBe('db.example.com')
  })

  test('選擇貼上連線字串時才問 URI', async () => {
    const { askedLabels, written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--skip-test',
        '--force',
      ],
      [
        ['連線設定方式', '貼上完整連線字串（進階）'],
        ['連線字串', 'mongodb://user:pass@host:27017/shop'],
        ['Database name', 'shop'],
      ]
    )

    expect(askedLabels.join('\n')).toContain('連線字串')
    expect(written.connections.default.uri).toBe('mongodb://user:pass@host:27017/shop')
  })

  test('--uri 非互動用法不受影響，完全不提問連線設定方式', async () => {
    const { askedLabels, written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--uri',
        'mongodb://user:pass@host:27017/shop',
        '--name',
        'shop',
        '--permission',
        'query-only',
        '--skip-test',
        '--force',
      ],
      []
    )

    expect(askedLabels.join('\n')).not.toContain('連線設定方式')
    expect(written.connections.default.uri).toBe('mongodb://user:pass@host:27017/shop')
  })

  test('--use-env-refs 讓逐欄分支的密碼存成 env 參照而非明文', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--use-env-refs',
        '--env-host',
        'MONGO_HOST',
        '--env-user',
        'MONGO_USER',
        '--env-password',
        'MONGO_PASSWORD',
        '--env-database',
        'MONGO_DB',
        '--name',
        'shop',
        '--permission',
        'query-only',
        '--skip-test',
        '--force',
        '--no-interactive',
      ],
      []
    )

    expect(written.connections.default).toMatchObject({
      system: 'mongodb',
      host: { $env: 'MONGO_HOST' },
      user: { $env: 'MONGO_USER' },
      password: { $env: 'MONGO_PASSWORD' },
    })
  })

  test('env-ref 模式不做連線測試，設定仍會寫出（不帶 --skip-test）', async () => {
    const factorySpy = spyOn(AdapterFactory, 'createMongoDBAdapter')

    try {
      const { written } = await runInit(
        [
          '--conn-name',
          'default',
          '--system',
          'mongodb',
          '--config',
          configPath,
          '--use-env-refs',
          '--env-host',
          'MONGO_HOST',
          '--env-user',
          'MONGO_USER',
          '--env-password',
          'MONGO_PASSWORD',
          '--name',
          'shop',
          '--permission',
          'query-only',
          '--force',
          '--no-interactive',
        ],
        []
      )

      // env-ref 存的是變數名稱而非值，沒有東西可以拿去連線
      expect(factorySpy).not.toHaveBeenCalled()
      expect(written).not.toBeNull()
      expect(written.connections.default.host).toEqual({ $env: 'MONGO_HOST' })
    } finally {
      factorySpy.mockRestore()
    }
  })

  test('env-ref 模式下未指定的 user/password 不會被強制變成 $env 參照', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--use-env-refs',
        '--env-host',
        'MONGO_HOST',
        '--name',
        'shop',
        '--permission',
        'query-only',
        '--skip-test',
        '--force',
        '--no-interactive',
      ],
      []
    )

    // 指向未定義環境變數的 $env 會讓之後每一個指令都拋 ConfigError
    expect(written.connections.default.user).toBe('')
    expect(written.connections.default.password).toBe('')
  })

  test('非互動 env-ref 缺少 --env-host 時報錯，不靜默套用建議變數名', async () => {
    const { exited, errors, written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--use-env-refs',
        '--name',
        'shop',
        '--permission',
        'query-only',
        '--skip-test',
        '--force',
        '--no-interactive',
      ],
      []
    )

    expect(exited).toBe(true)
    expect(errors).toContain('env-host')
    expect(written).toBeNull()
  })

  test('互動 env-ref 下 database 變數名留空時，改問字面資料庫名稱而非報錯', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--use-env-refs',
        '--skip-test',
        '--force',
      ],
      [
        ['Host 的環境變數名稱', 'MONGO_HOST'],
        ['Database name', 'shop'],
      ]
    )

    expect(written.connections.default.database).toBe('shop')
  })

  test('--env-database 對 mongo 生效', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--use-env-refs',
        '--env-host',
        'MONGO_HOST',
        '--env-database',
        'MONGO_DB',
        '--permission',
        'query-only',
        '--skip-test',
        '--force',
        '--no-interactive',
      ],
      []
    )

    expect(written.connections.default.database).toEqual({ $env: 'MONGO_DB' })
  })

  test('--auth-source 真的會落盤（現況會被 schema 丟棄）', async () => {
    const { written } = await runInit(
      [
        '--conn-name',
        'default',
        '--system',
        'mongodb',
        '--config',
        configPath,
        '--host',
        'db.example.com',
        '--user',
        'app',
        '--password',
        'secret',
        '--name',
        'shop',
        '--auth-source',
        'appdb',
        '--permission',
        'query-only',
        '--skip-test',
        '--force',
        '--no-interactive',
      ],
      []
    )

    expect(written.connections.default.authSource).toBe('appdb')
  })

  describe('--replica-set / --srv / --tls', () => {
    const base = [
      '--conn-name',
      'default',
      '--system',
      'mongodb',
      '--host',
      'cluster.example.com',
      '--name',
      'shop',
      '--skip-test',
      '--force',
    ]
    const withConfig = () => [...base, '--config', configPath]
    const nonInteractive = () => [...withConfig(), '--no-interactive']

    test('--replica-set rs0 --srv --tls 寫出 replicaSet、srv、tls，且不寫 port', async () => {
      const { written } = await runInit(
        [...nonInteractive(), '--replica-set', 'rs0', '--srv', '--tls'],
        []
      )

      const conn = written.connections.default
      expect(conn).toMatchObject({ replicaSet: 'rs0', srv: true, tls: true })
      expect('port' in conn).toBe(false)
    })

    test('--no-tls 寫出 tls:false', async () => {
      const { written } = await runInit([...nonInteractive(), '--no-tls'], [])

      expect(written.connections.default.tls).toBe(false)
    })

    test('--tls 與 --no-tls 皆未給時不寫 tls，也不寫 replicaSet / srv', async () => {
      const { written } = await runInit(nonInteractive(), [])

      const conn = written.connections.default
      expect('tls' in conn).toBe(false)
      expect('replicaSet' in conn).toBe(false)
      expect('srv' in conn).toBe(false)
      expect(conn.port).toBe(27017)
    })

    test('互動模式給了 --srv 就不再問 SRV', async () => {
      const { askedLabels, written } = await runInit(
        [...withConfig(), '--srv'],
        [
          ['連線設定方式', '逐欄填寫（建議）'],
          ['Host', 'cluster.example.com'],
          ['User', ''],
          ['Database name', 'shop'],
        ]
      )

      expect(askedLabels.join('\n')).not.toContain('SRV')
      expect(written.connections.default.srv).toBe(true)
      expect('port' in written.connections.default).toBe(false)
    })

    test('互動模式給了 --replica-set 與 --no-tls 就不再問進階選項', async () => {
      const { askedLabels, written } = await runInit(
        [...withConfig(), '--replica-set', 'rs0', '--no-tls'],
        [
          ['連線設定方式', '逐欄填寫（建議）'],
          ['Host', 'db.example.com'],
          ['Database name', 'shop'],
        ]
      )

      const asked = askedLabels.join('\n')
      expect(asked).not.toContain('進階選項')
      expect(asked).not.toContain('replicaSet')
      expect(asked).not.toContain('tls')
      expect(written.connections.default).toMatchObject({ replicaSet: 'rs0', tls: false })
    })

    test('互動模式只給 --replica-set 時仍詢問 tls', async () => {
      const { askedLabels, written } = await runInit(
        [...withConfig(), '--replica-set', 'rs0'],
        [
          ['連線設定方式', '逐欄填寫（建議）'],
          ['Host', 'db.example.com'],
          ['進階選項', true],
          ['啟用 tls', true],
          ['Database name', 'shop'],
        ]
      )

      const asked = askedLabels.join('\n')
      expect(asked).not.toContain('複本集名稱')
      expect(asked).toContain('啟用 tls')
      expect(written.connections.default).toMatchObject({ replicaSet: 'rs0', tls: true })
    })

    test('--use-env-refs 的設定同樣帶入三個 flag', async () => {
      const { written } = await runInit(
        [
          ...nonInteractive(),
          '--use-env-refs',
          '--env-host',
          'MONGO_HOST',
          '--replica-set',
          'rs0',
          '--srv',
          '--no-tls',
        ],
        []
      )

      const conn = written.connections.default
      expect(conn).toMatchObject({
        host: { $env: 'MONGO_HOST' },
        replicaSet: 'rs0',
        srv: true,
        tls: false,
      })
      expect('port' in conn).toBe(false)
    })

    for (const [label, portArgs] of [
      ['--port', ['--port', '28017']],
      ['--env-port', ['--use-env-refs', '--env-host', 'MONGO_HOST', '--env-port', 'MONGO_PORT']],
    ] as const) {
      test(`--srv 搭配 ${label} 時警告 port 會被忽略，且不寫 port`, async () => {
        const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
        try {
          const { written } = await runInit([...nonInteractive(), '--srv', ...portArgs], [])

          expect('port' in written.connections.default).toBe(false)
          expect(warnSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('SRV')
        } finally {
          warnSpy.mockRestore()
        }
      })
    }

    test('互動式 --use-env-refs 搭配 srv 時不問 Port 的環境變數名稱', async () => {
      const { askedLabels, written } = await runInit(
        [...withConfig(), '--use-env-refs', '--srv'],
        [
          ['連線設定方式', '逐欄填寫（建議）'],
          ['Host 的環境變數名稱', 'MONGO_HOST'],
          ['Database name', 'shop'],
        ]
      )

      expect(askedLabels.join('\n')).not.toContain('Port')
      expect('port' in written.connections.default).toBe(false)
    })

    test('互動式 --use-env-refs 回答是 SRV 時也不問 Port 的環境變數名稱', async () => {
      const { askedLabels } = await runInit(
        [...withConfig(), '--use-env-refs'],
        [
          ['連線設定方式', '逐欄填寫（建議）'],
          ['SRV', true],
          ['Host 的環境變數名稱', 'MONGO_HOST'],
          ['Database name', 'shop'],
        ]
      )

      expect(askedLabels.join('\n')).not.toContain('Port')
    })
  })
})
