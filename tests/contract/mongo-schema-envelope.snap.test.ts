import { describe, test, expect } from 'bun:test'
import { markRedactedColumns } from '@/commands/schema'
import type { ColumnSchema } from '@/adapters/types'

describe('mongo schema envelope contract', () => {
  test('TableSchema preserves presence + flags redacted', () => {
    const cols: ColumnSchema[] = [
      { name: '_id', type: 'ObjectId', nullable: false, presence: 1.0 },
      { name: 'profile.tokens.access', type: 'string', nullable: false, presence: 0.42 },
    ]
    const out = markRedactedColumns(cols, 'users', {
      tables: [],
      columns: { users: ['profile.tokens.*'] },
    })
    expect(out[0]).toEqual({
      name: '_id',
      type: 'ObjectId',
      nullable: false,
      presence: 1.0,
    })
    expect(out[1]).toEqual({
      name: 'profile.tokens.access',
      type: 'string',
      nullable: false,
      presence: 0.42,
      redacted: true,
    })
  })
})
