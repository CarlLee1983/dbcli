import { describe, test, expect } from 'bun:test'
import { markRedactedColumns } from '@/commands/schema'

describe('markRedactedColumns', () => {
  test('flags blacklist hits', () => {
    const cols = [
      { name: '_id', type: 'ObjectId', nullable: false },
      { name: 'profile.email', type: 'string', nullable: false },
      { name: 'profile.tokens.access', type: 'string', nullable: false },
    ]
    const out = markRedactedColumns(cols, 'users', {
      tables: [],
      columns: { users: ['profile.email', 'profile.tokens.*'] },
    })
    expect(out.find((c) => c.name === '_id')?.redacted).toBeUndefined()
    expect(out.find((c) => c.name === 'profile.email')?.redacted).toBe(true)
    expect(out.find((c) => c.name === 'profile.tokens.access')?.redacted).toBe(true)
  })

  test('no-op when collection has no blacklist', () => {
    const cols = [{ name: 'a', type: 'string', nullable: false }]
    const out = markRedactedColumns(cols, 'orders', { tables: [], columns: { users: ['x'] } })
    expect(out).toEqual(cols)
  })
})
