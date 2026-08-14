/**
 * Which statements have to be confirmed, and how hard.
 *
 * The gate has two tiers and the difference between them is the whole point of
 * #70: tier one is a keypress an automated caller may skip, tier two is a typed
 * table name nobody may skip. Everything asserted here is a property of the
 * statement alone — whether a terminal is attached, what the connection may do,
 * and how the question is worded are decided elsewhere.
 */

import { describe, test, expect } from 'bun:test'
import { classifySqlWriteGate } from '@/commands/write-gate'

describe('tier one — a write that a person should see before it runs', () => {
  test('a read needs no gate at all', async () => {
    expect((await classifySqlWriteGate('SELECT * FROM users')).tier).toBe('none')
  })

  test('an insert is an ordinary write', async () => {
    const verdict = await classifySqlWriteGate("INSERT INTO users (name) VALUES ('a')")
    expect(verdict.tier).toBe('one')
  })

  test('an update with a where clause is an ordinary write', async () => {
    const verdict = await classifySqlWriteGate('UPDATE users SET banned = 1 WHERE id = 3')
    expect(verdict.tier).toBe('one')
  })

  test('a write hidden inside a CTE is still a write', async () => {
    // It has a WHERE and would otherwise be tier one, but the AST parser cannot
    // read a CTE-wrapped DELETE, and an unreadable write resolves upwards. The
    // classifier still refuses to call it a read, which is the part that matters
    // here — the permission guard and the gate agree that this writes.
    const verdict = await classifySqlWriteGate(
      'WITH doomed AS (SELECT id FROM users WHERE id = 1) DELETE FROM users WHERE id IN (SELECT id FROM doomed)'
    )
    expect(verdict.tier).not.toBe('none')
  })
})

describe('tier two — a write nobody can wave through', () => {
  test('an update with no where clause names the table it would rewrite', async () => {
    const verdict = await classifySqlWriteGate('UPDATE users SET banned = 1')
    expect(verdict.tier).toBe('two')
    expect(verdict.table).toBe('users')
    expect(verdict.reason).toBe('no_where')
  })

  test('a delete with no where clause is the same statement in the other direction', async () => {
    const verdict = await classifySqlWriteGate('DELETE FROM users')
    expect(verdict.tier).toBe('two')
    expect(verdict.table).toBe('users')
    expect(verdict.reason).toBe('no_where')
  })

  test('DROP is destruction the SQL cannot qualify', async () => {
    const verdict = await classifySqlWriteGate('DROP TABLE users')
    expect(verdict.tier).toBe('two')
    expect(verdict.table).toBe('users')
    expect(verdict.reason).toBe('ddl_destruction')
  })

  test('TRUNCATE empties a table without a where clause to add', async () => {
    const verdict = await classifySqlWriteGate('TRUNCATE TABLE users')
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('ddl_destruction')
  })

  test('a write hiding behind a read in a statement list does not pass as tier one', async () => {
    // One statement to a classifier reading the leading keyword, two to a driver
    // using the simple query protocol.
    const verdict = await classifySqlWriteGate('SELECT 1; DELETE FROM users', {
      dialect: 'postgresql',
    })
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multiple_statements')
  })

  test('a statement the parser cannot read is treated as the worse case', async () => {
    const verdict = await classifySqlWriteGate('UPDATE (((')
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })

  test('an unparseable statement still asks for something typeable', async () => {
    const verdict = await classifySqlWriteGate('UPDATE (((')
    expect(verdict.confirmationPhrase.length).toBeGreaterThan(0)
  })

  test('a qualified statement the parser rejects is not locked out', async () => {
    // PostgreSQL's DELETE … USING is valid, qualified, and unparseable to the
    // bundled grammar. Treating it as tier two would leave a correct statement
    // with no escape route at all, since it already has the WHERE the remedy
    // would ask for.
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users u USING orders o WHERE u.id = o.user_id',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('a WHERE that exists only inside a string literal does not qualify anything', async () => {
    const verdict = await classifySqlWriteGate("UPDATE ((( SET note = 'WHERE'")
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })
})

describe('the escape route lives in the statement', () => {
  test('WHERE 1=1 states the intent and drops the statement to tier one', async () => {
    const verdict = await classifySqlWriteGate('UPDATE users SET banned = 1 WHERE 1=1')
    expect(verdict.tier).toBe('one')
  })

  test('a LIMIT bounds the damage and does the same', async () => {
    const verdict = await classifySqlWriteGate('DELETE FROM users LIMIT 10', { dialect: 'mysql' })
    expect(verdict.tier).toBe('one')
  })

  test('the escape cannot be composed — appending it twice is a syntax error, not a wider bypass', async () => {
    // The load-bearing argument for choosing this over a flag, and a property of
    // SQL rather than of this module: a statement carrying two WHERE clauses is
    // rejected by the database, so "append it to everything" cannot become a
    // habit. The gate reads it as qualified — it says WHERE twice — and lets the
    // database refuse it, which is where a syntax error belongs. What matters
    // here is that composing the escape buys nothing.
    const verdict = await classifySqlWriteGate('UPDATE users SET banned = 1 WHERE id = 3 WHERE 1=1')
    expect(verdict.tier).toBe('one')
  })
})

describe('what the operator has to type', () => {
  test('the phrase is the target table, so confirming means reading the table name', async () => {
    const verdict = await classifySqlWriteGate('DELETE FROM accounts')
    expect(verdict.confirmationPhrase).toBe('accounts')
  })

  test('a drop that names something other than one table asks for the fixed phrase', async () => {
    // Typing `DATABASE` to confirm `DROP DATABASE prod` would satisfy the gate
    // without reading what the statement targets, which is the whole point of
    // the typed phrase.
    const verdict = await classifySqlWriteGate('DROP DATABASE prod')
    expect(verdict.tier).toBe('two')
    expect(verdict.table).toBeUndefined()
    expect(verdict.confirmationPhrase).toBe('CONFIRM')
  })

  test('an index drop does not pass itself off as a table drop', async () => {
    const verdict = await classifySqlWriteGate('DROP INDEX idx_users_email ON users')
    expect(verdict.confirmationPhrase).not.toBe('INDEX')
  })

  test('a multi-table drop does not name only the first table', async () => {
    const verdict = await classifySqlWriteGate('DROP TABLE users, orders')
    expect(verdict.confirmationPhrase).toBe('CONFIRM')
  })

  test('a schema-qualified table is asked for as written', async () => {
    const verdict = await classifySqlWriteGate('DELETE FROM public.accounts')
    expect(verdict.confirmationPhrase).toBe('public.accounts')
  })
})
