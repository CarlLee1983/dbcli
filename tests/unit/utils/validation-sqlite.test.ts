/**
 * SQLite 連線設定的 schema 驗證（DBCLI-034 / ADR-0038）
 */

import { describe, test, expect } from 'bun:test'
import { ZodError, type ZodIssue } from 'zod'
import { ConnectionConfigSchema, NamedConnectionSchema } from '@/utils/validation'

/**
 * `ConnectionConfigSchema` 是 union，一支分支的失敗會被包進 `unionErrors`，
 * 頂層只剩一個 path 為 [] 的 invalid_union。要斷言「哪個欄位錯了」就得展平。
 */
function flattenIssues(error: ZodError): ZodIssue[] {
  return error.issues.flatMap((issue) =>
    issue.code === 'invalid_union'
      ? [issue, ...issue.unionErrors.flatMap((inner) => flattenIssues(inner))]
      : [issue]
  )
}

describe('SQLite connection config', () => {
  test('接受只帶 system 與 file 的連線', () => {
    const parsed = ConnectionConfigSchema.parse({
      system: 'sqlite',
      file: '/tmp/app.sqlite',
    })

    expect(parsed.system).toBe('sqlite')
    expect((parsed as { file: string }).file).toBe('/tmp/app.sqlite')
  })

  test('接受 $env 參照作為 file', () => {
    const parsed = ConnectionConfigSchema.parse({
      system: 'sqlite',
      file: { $env: 'APP_DB_PATH' },
    })

    expect((parsed as { file: unknown }).file).toEqual({ $env: 'APP_DB_PATH' })
  })

  test('缺少 file 時失敗', () => {
    const result = ConnectionConfigSchema.safeParse({ system: 'sqlite' })
    expect(result.success).toBe(false)
  })

  test('接受 timeout 與 statementTimeout', () => {
    const parsed = ConnectionConfigSchema.parse({
      system: 'sqlite',
      file: '/tmp/app.sqlite',
      timeout: 3000,
      statementTimeout: 0,
    })

    expect((parsed as { timeout?: number }).timeout).toBe(3000)
    expect((parsed as { statementTimeout?: number }).statementTimeout).toBe(0)
  })

  // ADR-0038：記憶體資料庫每次開啟都是不同的資料庫，無法作為 blacklist、
  // audit、schema cache 掛靠的連線身分，因此在 parse 就拒絕。
  describe('拒絕記憶體資料庫（ADR-0038）', () => {
    const memoryForms = [
      ':memory:',
      'file::memory:',
      'file::memory:?cache=shared',
      'file:app.db?mode=memory',
      'file:app.db?cache=shared&mode=memory',
      ':MEMORY:',
    ]

    for (const file of memoryForms) {
      test(`拒絕 ${file}`, () => {
        const result = ConnectionConfigSchema.safeParse({ system: 'sqlite', file })
        expect(result.success).toBe(false)
        if (!result.success) {
          const issue = flattenIssues(result.error).find(
            (i) => i.path.includes('file') && i.message.includes('memory')
          )
          expect(issue).toBeDefined()
          expect(issue?.message).toContain('ADR-0038')
        }
      })
    }

    test('不誤傷路徑中含有 memory 字樣的真實檔案', () => {
      const parsed = ConnectionConfigSchema.parse({
        system: 'sqlite',
        file: '/var/data/memory-usage.sqlite',
      })
      expect((parsed as { file: string }).file).toBe('/var/data/memory-usage.sqlite')
    })
  })

  describe('v2 具名連線', () => {
    test('接受帶 permission 與 envFile 的 SQLite 連線', () => {
      const parsed = NamedConnectionSchema.parse({
        system: 'sqlite',
        file: '/tmp/app.sqlite',
        permission: 'query-only',
        envFile: '.env.local',
      })

      expect((parsed as { system: string }).system).toBe('sqlite')
      expect((parsed as { permission: string }).permission).toBe('query-only')
    })

    test('permission 預設為 query-only', () => {
      const parsed = NamedConnectionSchema.parse({
        system: 'sqlite',
        file: '/tmp/app.sqlite',
      })

      expect((parsed as { permission: string }).permission).toBe('query-only')
    })

    test('具名連線同樣拒絕記憶體資料庫', () => {
      const result = NamedConnectionSchema.safeParse({
        system: 'sqlite',
        file: ':memory:',
        permission: 'admin',
      })
      expect(result.success).toBe(false)
    })
  })
})

describe('欄位語意（R9 / AC-017）', () => {
  test('路徑只存在於 file，database 與其餘欄位是空字串', () => {
    const parsed = ConnectionConfigSchema.parse({
      system: 'sqlite',
      file: '/var/data/app.sqlite',
    }) as Record<string, unknown>

    expect(parsed.file).toBe('/var/data/app.sqlite')
    expect(parsed.database).toBe('')
    expect(parsed.host).toBe('')
    expect(parsed.user).toBe('')
    expect(parsed.password).toBe('')
    expect(parsed.port).toBe(0)

    // 路徑不得洩漏到任何其他欄位——那正是「把路徑塞進 database」會造成的
    // 混淆：audit 與 use 的顯示會把一串檔案路徑當成資料庫名字印出來。
    const leaked = Object.entries(parsed).filter(
      ([key, value]) => key !== 'file' && value === '/var/data/app.sqlite'
    )
    expect(leaked).toEqual([])
  })
})
