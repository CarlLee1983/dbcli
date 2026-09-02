import { afterAll, describe, expect, test } from 'bun:test'
import en from '../../../resources/lang/en/messages.json'
import zhTW from '../../../resources/lang/zh-TW/messages.json'
import { messageLoader } from '@/i18n/message-loader'
import { queryOnlyBoundaryError, queryOnlyCleanupError } from '@/adapters/sql-adapter-utils'

const KEYS = [
  'query_only_boundary_failed',
  'query_only_boundary_verify',
  'query_only_boundary_not_executed',
  'query_only_cleanup_completed',
  'query_only_cleanup_uncertain',
  'query_only_cleanup_completed_retry',
  'query_only_cleanup_uncertain_retry',
  'query_only_cleanup_reconnect',
] as const

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{(\w+)}/g)].map((match) => match[1] as string).sort()

describe('query-only boundary messages', () => {
  const previousLang = Bun.env.DBCLI_LANG ?? 'en'

  afterAll(() => messageLoader.setLanguage(previousLang))

  test('English and Traditional Chinese keys have matching placeholders', () => {
    for (const key of KEYS) {
      expect(placeholders(zhTW.errors[key])).toEqual(placeholders(en.errors[key]))
      expect(zhTW.errors[key]).not.toBe(en.errors[key])
    }
  })

  test('boundary and cleanup errors render in both languages', () => {
    messageLoader.setLanguage('en')
    const englishBoundary = queryOnlyBoundaryError('postgresql', new Error('denied'))
    const englishCleanup = queryOnlyCleanupError('mysql', new Error('lost'), true)

    expect(englishBoundary.message).toContain('Could not establish')
    expect(englishBoundary.hints.join(' ')).toContain('target statement was not executed')
    expect(englishCleanup.message).toContain('query-only target completed')
    expect(englishCleanup.hints.join(' ')).toContain('connection was discarded')

    messageLoader.setLanguage('zh-TW')

    const boundary = queryOnlyBoundaryError('postgresql', new Error('拒絕'))
    const cleanup = queryOnlyCleanupError('mysql', new Error('中斷'), true)

    expect(boundary.message).toContain('無法為 postgresql 建立')
    expect(boundary.hints.join(' ')).toContain('目標語句尚未執行')
    expect(cleanup.message).toContain('query-only 目標已完成')
    expect(cleanup.hints.join(' ')).toContain('此連線已丟棄')
  })
})
