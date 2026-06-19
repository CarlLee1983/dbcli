import { describe, test, expect } from 'bun:test'
import {
  normalizeSafeBackfillInput,
  isReadOnlyOperation,
  isUpdateOperation,
  buildAfterWriteCommand,
  buildSafeBackfillSubject,
  VerifyInputError,
} from '@/core/verify/safe-backfill'

const RAW = {
  table: 'users',
  query: "UPDATE users SET status = 1 WHERE status IS NULL",
  verifyQuery: 'SELECT count(*)::int AS n FROM users WHERE status IS NULL',
  expect: 'value == 0',
}

describe('normalizeSafeBackfillInput', () => {
  test('accepts a complete input and defaults format=table, afterWrite=false', () => {
    const input = normalizeSafeBackfillInput({ ...RAW })
    expect(input.format).toBe('table')
    expect(input.afterWrite).toBe(false)
    expect(input.table).toBe('users')
  })

  test('honors afterWrite, format, subjectName, summary', () => {
    const input = normalizeSafeBackfillInput({
      ...RAW,
      afterWrite: true,
      format: 'json',
      subjectName: 'nightly',
      summary: 'manual note',
    })
    expect(input.afterWrite).toBe(true)
    expect(input.format).toBe('json')
    expect(input.subjectName).toBe('nightly')
    expect(input.summary).toBe('manual note')
  })

  test.each(['table', 'query', 'verifyQuery', 'expect'] as const)(
    'throws VerifyInputError when %s is empty',
    (field) => {
      expect(() => normalizeSafeBackfillInput({ ...RAW, [field]: '   ' })).toThrow(VerifyInputError)
    }
  )

  test('throws VerifyInputError on an unsupported format', () => {
    expect(() => normalizeSafeBackfillInput({ ...RAW, format: 'csv' })).toThrow(VerifyInputError)
  })
})

describe('operation classifiers', () => {
  test('isReadOnlyOperation', () => {
    expect(isReadOnlyOperation('SELECT')).toBe(true)
    expect(isReadOnlyOperation('SHOW')).toBe(true)
    expect(isReadOnlyOperation('UPDATE')).toBe(false)
    expect(isReadOnlyOperation('DELETE')).toBe(false)
  })

  test('isUpdateOperation', () => {
    expect(isUpdateOperation('UPDATE')).toBe(true)
    expect(isUpdateOperation('SELECT')).toBe(false)
  })
})

describe('buildAfterWriteCommand', () => {
  test('renders a runnable --after-write command with quoted sql', () => {
    const cmd = buildAfterWriteCommand(normalizeSafeBackfillInput({ ...RAW }))
    expect(cmd).toContain('dbcli verify safe-backfill')
    expect(cmd).toContain('--table users')
    expect(cmd).toContain(`--query "${RAW.query}"`)
    expect(cmd).toContain(`--verify-query "${RAW.verifyQuery}"`)
    expect(cmd).toContain(`--expect "${RAW.expect}"`)
    expect(cmd).toContain('--after-write')
  })

  test('includes --subject-name when set', () => {
    const cmd = buildAfterWriteCommand(
      normalizeSafeBackfillInput({ ...RAW, subjectName: 'nightly' })
    )
    expect(cmd).toContain('--subject-name nightly')
  })
})

describe('buildSafeBackfillSubject', () => {
  test('defaults subject name to the table', () => {
    const s = buildSafeBackfillSubject(normalizeSafeBackfillInput({ ...RAW }))
    expect(s).toEqual({ kind: 'backfill', name: 'users', command: 'verify safe-backfill' })
  })

  test('--subject-name overrides the subject name', () => {
    const s = buildSafeBackfillSubject(
      normalizeSafeBackfillInput({ ...RAW, subjectName: 'nightly' })
    )
    expect(s.name).toBe('nightly')
  })
})
