/**
 * 設定檔驗證錯誤的可讀化格式
 *
 * 動機：連線設定是 z.union（SQL / MongoDB / Redis / Elasticsearch），
 * 少填一個欄位時 Zod 會吐出整包 unionErrors 巢狀 JSON，
 * 呼叫端（尤其是 AI agent）看不出到底哪個欄位錯。
 */

import { describe, test, expect } from 'bun:test'
import { ZodError } from 'zod'
import { DbcliConfigV2Schema, DbcliConfigSchema } from '@/utils/validation'
import { formatConfigValidationError } from '@/utils/config-error-format'

function captureError(parse: () => unknown): ZodError {
  try {
    parse()
  } catch (error) {
    if (error instanceof ZodError) return error
    throw error
  }
  throw new Error('expected the schema to reject this input')
}

describe('formatConfigValidationError', () => {
  const v2WithBrokenMongo = {
    version: 2,
    default: 'm',
    connections: {
      m: { system: 'mongodb', port: 'not-a-number' },
    },
  }

  test('只報告與該連線 system 相符的分支問題', () => {
    const error = captureError(() => DbcliConfigV2Schema.parse(v2WithBrokenMongo))
    const message = formatConfigValidationError(error, v2WithBrokenMongo)

    expect(message).toContain('connections.m')
    expect(message).toContain('port')
    // 不該把其他引擎分支的抱怨一起倒出來
    expect(message).not.toContain('postgresql')
    expect(message).not.toContain('elasticsearch')
  })

  test('不外洩 Zod 內部結構', () => {
    const error = captureError(() => DbcliConfigV2Schema.parse(v2WithBrokenMongo))
    const message = formatConfigValidationError(error, v2WithBrokenMongo)

    expect(message).not.toContain('unionErrors')
    expect(message).not.toContain('invalid_union')
    expect(message).not.toContain('"code"')
  })

  test('每個問題一行，帶欄位路徑', () => {
    const raw = {
      version: 2,
      default: 'p',
      connections: {
        p: { system: 'postgresql', host: 'localhost', port: 5432, user: 'u' },
      },
    }
    const error = captureError(() => DbcliConfigV2Schema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    const lines = message.split('\n').filter((line: string) => line.trim().startsWith('-'))
    expect(lines.length).toBeGreaterThan(0)
    expect(message).toContain('connections.p.database')
  })

  test('MongoDB 連線缺 host 與 uri 時給出可操作的提示', () => {
    const raw = {
      version: 2,
      default: 'm',
      connections: { m: { system: 'mongodb', host: 123 } },
    }
    const error = captureError(() => DbcliConfigV2Schema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    expect(message).toContain('connections.m.host')
    expect(message).not.toContain('unionErrors')
  })

  test('v1 單一連線設定同樣可讀', () => {
    const raw = {
      connection: { system: 'mysql', host: 'localhost', port: 3306, user: 'u' },
      permission: 'query-only',
    }
    const error = captureError(() => DbcliConfigSchema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    expect(message).toContain('connection.database')
    expect(message).not.toContain('unionErrors')
  })

  test('system 不是支援的引擎時，列出完整支援清單而非只有 SQL 三種', () => {
    const raw = {
      connection: { system: 'oracle', host: 'h', port: 1521, user: 'u', database: 'd' },
      permission: 'query-only',
    }
    const error = captureError(() => DbcliConfigSchema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    for (const system of ['postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'elasticsearch']) {
      expect(message).toContain(system)
    }
    expect(message).toContain('oracle')
  })

  test('system 整個缺漏時同樣列出支援清單', () => {
    const raw = { connection: { host: 'h', port: 5432 }, permission: 'query-only' }
    const error = captureError(() => DbcliConfigSchema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    expect(message).toContain('mongodb')
    expect(message).toContain('missing')
  })

  test('欄位層級的 union 失敗不會被誤報成未知引擎', () => {
    const raw = {
      version: 2,
      default: 'p',
      connections: {
        p: {
          system: 'postgresql',
          host: 'h',
          port: 5432,
          user: 'u',
          password: { wrong: 'shape' },
          database: 'd',
        },
      },
    }
    const error = captureError(() => DbcliConfigV2Schema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    expect(message).toContain('connections.p.password')
    expect(message).not.toContain('must be one of')
  })

  test('無法判定 system 時退回列出所有問題，但仍不吐 Zod 結構', () => {
    const raw = { version: 2, default: 'x', connections: { x: { host: 'localhost' } } }
    const error = captureError(() => DbcliConfigV2Schema.parse(raw))
    const message = formatConfigValidationError(error, raw)

    expect(message.length).toBeGreaterThan(0)
    expect(message).not.toContain('unionErrors')
  })
})
