// tests/unit/core/result-snapshot/fingerprint.test.ts
import { describe, it, expect } from 'bun:test'
import { buildFingerprint } from '@/core/result-snapshot/fingerprint'
import type { QueryResult } from '@/types/query'

function qr(
  rows: Record<string, unknown>[],
  columnNames: string[],
  columnTypes?: string[]
): QueryResult<Record<string, unknown>> {
  return { rows, rowCount: rows.length, columnNames, columnTypes }
}

describe('buildFingerprint', () => {
  it('captures rowCount, null/distinct counts and numeric aggregates', () => {
    const result = qr(
      [
        { id: 1, amount: 10 },
        { id: 2, amount: 30 },
        { id: 3, amount: null },
      ],
      ['id', 'amount'],
      ['integer', 'integer']
    )
    const fp = buildFingerprint(result, {})
    expect(fp.rowCount).toBe(3)
    const amount = fp.columns.find((c) => c.name === 'amount')!
    expect(amount.nullCount).toBe(1)
    expect(amount.distinctCount).toBe(2)
    expect(amount.min).toBe(10)
    expect(amount.max).toBe(30)
    expect(amount.sum).toBe(40)
  })

  it('is row-order independent (same checksum regardless of order)', () => {
    const a = buildFingerprint(qr([{ id: 1 }, { id: 2 }], ['id']), {})
    const b = buildFingerprint(qr([{ id: 2 }, { id: 1 }], ['id']), {})
    expect(a.resultChecksum).toBe(b.resultChecksum)
    expect(a.columns[0].checksum).toBe(b.columns[0].checksum)
  })

  it('omits rows by default and includes them with includeRows', () => {
    const result = qr([{ id: 1 }], ['id'])
    expect(buildFingerprint(result, {}).rows).toBeUndefined()
    expect(buildFingerprint(result, { includeRows: true }).rows).toEqual([{ id: 1 }])
  })

  it('appends redacted placeholder columns', () => {
    const fp = buildFingerprint(qr([{ id: 1 }], ['id']), { redactedColumns: ['ssn'] })
    const ssn = fp.columns.find((c) => c.name === 'ssn')!
    expect(ssn.redacted).toBe(true)
    expect(ssn.checksum).toBe('')
  })
})
