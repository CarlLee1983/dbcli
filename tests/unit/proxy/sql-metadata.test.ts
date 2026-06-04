// tests/unit/proxy/sql-metadata.test.ts
import { describe, it, expect } from 'bun:test'
import { detectStatement, extractTables, redactLiterals } from '@/proxy/sql-metadata'

describe('detectStatement', () => {
  it('detects common statement types case-insensitively', () => {
    expect(detectStatement('  select * from users')).toBe('SELECT')
    expect(detectStatement('INSERT INTO t VALUES (1)')).toBe('INSERT')
    expect(detectStatement('update t set a=1')).toBe('UPDATE')
    expect(detectStatement('Delete from t')).toBe('DELETE')
    expect(detectStatement('BEGIN')).toBe('BEGIN')
    expect(detectStatement('commit')).toBe('COMMIT')
    expect(detectStatement('explain analyze select 1')).toBe('OTHER')
  })
})

describe('extractTables', () => {
  it('extracts FROM / JOIN / INTO / UPDATE targets, deduped, schema-stripped', () => {
    expect(extractTables('SELECT * FROM users')).toEqual(['users'])
    expect(extractTables('SELECT * FROM a JOIN b ON a.id=b.id')).toEqual(['a', 'b'])
    expect(extractTables('insert into `orders` (x) values (1)')).toEqual(['orders'])
    expect(extractTables('UPDATE public.accounts SET x=1')).toEqual(['accounts'])
    expect(extractTables('SELECT 1')).toEqual([])
  })
})

describe('redactLiterals', () => {
  it('replaces string and numeric literals with ?', () => {
    expect(redactLiterals("SELECT * FROM t WHERE name='bob' AND age=42")).toBe(
      'SELECT * FROM t WHERE name=? AND age=?'
    )
  })
  it('handles escaped single quotes and decimals', () => {
    expect(redactLiterals("SELECT 'a''b', 3.14 FROM t")).toBe('SELECT ?, ? FROM t')
  })
  it('does not corrupt identifiers containing digits', () => {
    expect(redactLiterals('SELECT col1, col2 FROM t LIMIT 100')).toBe(
      'SELECT col1, col2 FROM t LIMIT ?'
    )
  })
})
