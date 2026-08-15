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
import { classifySqlWriteGate, WRITE_GATE_FALLBACK_PHRASE } from '@/commands/write-gate'

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

  test('a qualified statement the parser rejects is still tier two once a join is in it', async () => {
    // This is the measured cost of the criterion, recorded rather than hidden.
    // PostgreSQL's DELETE … USING is valid, qualified, and unreadable to the
    // bundled grammar, so this statement is refused for an unattended caller
    // even though it touches exactly the rows it names.
    //
    // It used to be tier one, on the grounds that a correct statement needs a
    // reachable escape route. #80 measured what that concession bought: of the
    // parser-rejected statements it let through, as many were unqualified as
    // qualified — `DELETE FROM t USING o WHERE o.x > 0` emptied a 2000-row table
    // under the same rule. Without a parse tree there is nothing to tell the two
    // apart, so the tie goes to the table.
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users u USING orders o WHERE u.id = o.user_id',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })

  test('a single-table statement the parser rejects keeps its escape route', async () => {
    // The concession above is narrowed, not withdrawn: with no second table in
    // the statement, a WHERE in the text can only be about the table being
    // written, so an unattended caller is not locked out of ordinary work.
    // PostgreSQL's multi-column assignment, which the bundled grammar rejects.
    const verdict = await classifySqlWriteGate(
      "UPDATE users SET (name, email) = ('a', 'b') WHERE id = 1",
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

describe('a WHERE only qualifies the write it restricts', () => {
  // Measured, not supposed (#80): against a 2000-row table this statement
  // overwrote all 2000. The WHERE picks one row of `orders`, and every row of
  // `users` is joined to it — filtering the far side of a join removes nothing
  // from the target. The gate read "there is a WHERE" and called it tier one.
  test('an UPDATE … FROM whose WHERE only touches the joined table is tier two', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 FROM orders WHERE orders.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multi_table')
  })

  // MySQL's multi-table DELETE reaches the same shape by another syntax. Measured
  // the same way: five rows in, five rows deleted, gate said tier one.
  test('a MySQL multi-table DELETE with no join condition is tier two', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE p FROM users p JOIN orders o WHERE o.id > 0',
      {
        dialect: 'mysql',
      }
    )
    expect(verdict.tier).toBe('two')
  })

  // The parser cannot read a CTE-wrapped DELETE, so this goes through the
  // unparseable path. The text plainly contains WHERE — inside the CTE, where it
  // restricts the CTE and nothing else. Measured: 2000 rows in, 2000 deleted.
  test('a CTE whose WHERE restricts only the CTE does not qualify the DELETE', async () => {
    const verdict = await classifySqlWriteGate(
      "WITH doomed AS (SELECT id FROM users WHERE status = 'x') DELETE FROM users",
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })

  // The other side of the criterion. Tightening it is only worth anything if it
  // leaves correlated writes alone, so these pin the cases the measurement
  // confirmed do narrow the target: a condition naming it counts, whether it
  // sits in the WHERE or in a join's ON.
  // The correlated spelling is tier two as well, and this is the decision the
  // fifth round of measurement forced. `DELETE p FROM p JOIN o ON p.id = o.ref
  // WHERE o.x > 0` deleted 2 of 5 rows against one dataset and all 2000 against
  // another: whether a multi-table write is limited to particular rows is a
  // property of the data, not of the statement. A join's ON necessarily names
  // the target, so reading it as evidence let the whole #80 class back in.
  test('a correlated UPDATE … FROM is tier two too', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 FROM orders WHERE users.id = orders.user_id',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multi_table')
  })

  test('so is a MySQL multi-table DELETE whose ON names the target', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE p FROM users p JOIN orders o ON p.id = o.user_id WHERE o.id > 0',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multi_table')
  })

  test('a WHERE reaching the target through a subquery still qualifies', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE id IN (SELECT user_id FROM orders WHERE total > 0)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('a WHERE whose only column references sit inside a subquery does not', async () => {
    // A real top-level WHERE, so this fails if the walk descends into subqueries
    // rather than stepping over them. Measured: every row deleted.
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.id = 1)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('no_where')
  })
})

/**
 * Shapes an adversarial review executed against live servers after the first
 * version of the criterion. Each one was tier one and emptied or rewrote every
 * row of a 2000-row table; they are the reason the criterion reads the way it
 * does, so they are pinned by the statement rather than by the rule.
 */
describe('full-table writes that dressed up as qualified ones', () => {
  test('an unqualified column is not evidence once a second table is in scope', async () => {
    // `ref` exists only on `orders`, so the database resolves it there and every
    // row of `users` is rewritten. One alias away from the shape above.
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 FROM orders WHERE ref > 0',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a function in the FROM is a second source, however unnamed', async () => {
    // `generate_series(1,10) g` carries no table name, so counting scope by name
    // read this as single-table and let the unqualified `g` pass as evidence
    // about `users`. Measured: every row rewritten.
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 FROM generate_series(1,10) g WHERE g = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('the written table comes from the SET clause, not from whatever was typed first', async () => {
    // MySQL's comma form: `users` is written, `orders` is filtered. Reading the
    // target positionally found "evidence" for a table this does not touch.
    const verdict = await classifySqlWriteGate(
      'UPDATE orders, users SET users.banned = 1 WHERE orders.id = 1',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('an unparseable UPDATE … FROM is a second table even without USING or JOIN', async () => {
    // PostgreSQL's multi-column assignment defeats the parser, and the text scan
    // had no plain-FROM alternative.
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET (name, email) = (orders.name, orders.email) FROM orders WHERE orders.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })

  test('an unparseable aliased comma-UPDATE is a second table too', async () => {
    // `<=>` defeats the parser; the old comma pattern wanted exactly one word
    // between the comma and SET, so an alias walked past it.
    const verdict = await classifySqlWriteGate(
      'UPDATE users AS x, orders AS y SET x.banned = 1 WHERE y.id = 1 AND y.z <=> 1',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })
})

describe('shapes a second adversarial pass found still open', () => {
  test('two schemas holding the same table name are two tables', async () => {
    // `distinct` keyed on the bare name read this as single-table, and the
    // joined table's alias then passed as evidence about the target. Measured:
    // 2000 of 2000 rewritten.
    const verdict = await classifySqlWriteGate(
      'UPDATE app.users AS x SET banned = 1 FROM archive.users AS y WHERE y.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a joined table aliased to the target name is not the target', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users AS x SET banned = 1 FROM orders AS users WHERE users.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('an unqualified SET column in a multi-table UPDATE names no target to confirm', async () => {
    // Which table `banned` belongs to needs the schema, which this module does
    // not have. Guessing picked the table typed first and asked the operator to
    // confirm it while the other one was rewritten.
    const verdict = await classifySqlWriteGate(
      'UPDATE orders, users SET banned = 1 WHERE orders.id = 1',
      {
        dialect: 'mysql',
      }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.confirmationPhrase).toBe(WRITE_GATE_FALLBACK_PHRASE)
  })

  test('narrowing one of two written tables does not qualify the other', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users a, orders b SET a.banned = 1, b.total = 2 WHERE b.id = 1',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('two')
    // Two tables rewritten and one phrase to type: naming either would authorise
    // the other without naming it.
    expect(verdict.confirmationPhrase).toBe(WRITE_GATE_FALLBACK_PHRASE)
  })

  test('a data-modifying CTE under a SELECT head is not waved through', async () => {
    // The parser returns the outer SELECT, whose `limit` is an empty object
    // rather than null — enough to satisfy the row-cap branch. Measured: 2000 of
    // 2000 rewritten, with no WHERE anywhere in the statement.
    const verdict = await classifySqlWriteGate(
      'WITH z AS (UPDATE users SET banned = 1 RETURNING *) SELECT count(*) FROM z',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })
})

describe('conditions that do narrow the target through a subquery', () => {
  // The standard "delete the matching rows" idiom. Refusing to look inside any
  // subquery refused all three of these, which are the everyday shape, while the
  // uncorrelated version below is the one that empties the table.
  test('a correlated EXISTS is evidence about the target', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('a correlated NOT EXISTS is too', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 WHERE NOT EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('an uncorrelated one is still not', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.id = 1)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })
})

describe('a subquery is evidence only when it reaches out of itself', () => {
  // The correlation rule, tightened after a third pass. Matching the target's
  // name was not enough: a subquery that binds that name is talking about its
  // own rows. Each of these deleted or rewrote every row of a 2000-row table
  // while the gate read them as narrowed.
  test('a subquery selecting from the target itself is not a correlation', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM sessions WHERE EXISTS (SELECT 1 FROM sessions WHERE expired_at < now())',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a subquery table aliased to the target name is not one either', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders AS users WHERE users.id = 1)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('nor is a same-named table from another schema', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM app.users WHERE EXISTS (SELECT 1 FROM archive.users u2 WHERE u2.id = 1)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a genuine outer reference still is', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })
})

describe('a join inside a subquery is still a second table', () => {
  test('an unreadable statement whose subquery joins is tier two', async () => {
    // Stripping parentheses before the text scan erased the JOIN and the bare
    // WHERE then bought tier one. Measured: 2000 rows deleted.
    const verdict = await classifySqlWriteGate(
      'DELETE FROM users WHERE EXISTS (SELECT 1 FROM orders JOIN carts ON carts.id = orders.cart_id WHERE orders.total > 0 FOR UPDATE)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })
})

describe('the text path proves one table rather than listing the ways to have two', () => {
  // A denylist of second-table keywords was defeated once per review round —
  // USING, then JOIN, then a CTE, then a subquery, then `TABLE` as a subquery.
  // These are the spellings that beat the last version of it; what refuses them
  // now is the allowlist, which asks the statement to look like a single-table
  // write and nothing else.
  test('a CTE with a column list', async () => {
    const verdict = await classifySqlWriteGate(
      'WITH c (x) AS (DELETE FROM orders WHERE id = 1 RETURNING id) DELETE FROM users',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a CTE written without spaces around a quoted name', async () => {
    const verdict = await classifySqlWriteGate(
      'WITH"c"AS(DELETE FROM orders WHERE id=1 RETURNING id)DELETE FROM users',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a subquery spelled TABLE rather than SELECT', async () => {
    // Valid PostgreSQL, and it contains none of SELECT, JOIN, USING or WITH.
    // Measured: 2000 of 2000 deleted.
    const verdict = await classifySqlWriteGate('DELETE FROM users WHERE EXISTS (TABLE orders)', {
      dialect: 'postgresql',
    })
    expect(verdict.tier).toBe('two')
  })
})

describe('a table really called "only"', () => {
  test('is a table, not a modifier', async () => {
    // `ONLY` is not reserved in MySQL and can be quoted in PostgreSQL. Rewriting
    // it unconditionally refused a single-row write by primary key.
    const verdict = await classifySqlWriteGate(`UPDATE "only" SET c = 'x' WHERE "only".id = 1`, {
      dialect: 'postgresql',
    })
    expect(verdict.tier).toBe('one')
  })
})

describe('the phrase is never a word the operator can produce without looking', () => {
  test("PostgreSQL's ONLY is a modifier, not the table name", async () => {
    // The parser reads `ONLY` as the table and puts the real name in the alias
    // slot. Asking the operator to type `ONLY` would confirm nothing about which
    // table dies — the defect `DDL_TARGET` was narrowed to remove.
    const verdict = await classifySqlWriteGate('DELETE FROM ONLY users', {
      dialect: 'postgresql',
    })
    expect(verdict.tier).toBe('two')
    expect(verdict.confirmationPhrase).toBe('users')
  })

  test('ONLY on both sides of a join does not collapse them into one table', async () => {
    // Every `ONLY` source shared the identity `only`, which read the statement as
    // single-table and let an unqualified column — one that exists on the joined
    // table — pass as evidence about the target. Measured: 2000 of 2000 rewritten.
    const verdict = await classifySqlWriteGate(
      'UPDATE ONLY users SET banned = 1 FROM ONLY orders WHERE total = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })
})

describe('an unreadable statement with a subquery has nothing to judge it by', () => {
  test('a subquery is a second table on the text path too', async () => {
    // Multi-column assignment defeats the grammar, `stripParenthesised` erases
    // the subquery, and the bare WHERE that is left bought tier one. Measured:
    // 2000 of 2000 rewritten.
    const verdict = await classifySqlWriteGate(
      "UPDATE users SET (name, email) = ('a', 'b') WHERE EXISTS (SELECT 1 FROM orders WHERE orders.id = 1)",
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('unparseable')
  })

  test('a MySQL fulltext modifier is not a CTE', async () => {
    // `WITH QUERY EXPANSION` is not `WITH x AS (…)`. Matching the bare keyword
    // refused a single-table update that already carried its WHERE.
    const verdict = await classifySqlWriteGate(
      "UPDATE users SET name = 'x' WHERE id <=> 1 AND MATCH(bio) AGAINST ('a' WITH QUERY EXPANSION)",
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('one')
  })
})

describe('a MySQL multi-table DELETE is a multi-table write', () => {
  test('listing two tables to delete from does not make either one narrowed', async () => {
    const verdict = await classifySqlWriteGate(
      'DELETE p, o FROM users p JOIN orders o ON p.id = o.user_id WHERE p.id = 1',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multi_table')
  })
})

describe('a FROM inside an expression is not a second table', () => {
  // These parse nowhere near a join, and refusing them left an unattended caller
  // with no escape route at all — the statement already has the WHERE the remedy
  // would ask for.
  test('SUBSTRING(x FROM n FOR m) keeps its tier', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET name = SUBSTRING(name FROM 2 FOR 3) WHERE id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('a FROM in the WHERE side of the same statement keeps it too', async () => {
    const verdict = await classifySqlWriteGate(
      "UPDATE users SET banned = 1 WHERE substring(name from 1 for 2) = 'ab'",
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })
})

describe('the confirmation phrase is never a name the statement does not target', () => {
  // Deriving the written table from a multi-table statement was wrong twice
  // over: it named the joined table for `UPDATE b, a SET a.c = 1`, and for an
  // unqualified `SET c = 1` it could not be derived at all. A multi-table write
  // now asks for the fallback, which claims nothing.
  test('a multi-table write asks for the fallback phrase', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 FROM orders WHERE orders.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.confirmationPhrase).toBe(WRITE_GATE_FALLBACK_PHRASE)
  })

  test('a single-table write still asks for its table', async () => {
    const verdict = await classifySqlWriteGate('DELETE FROM accounts', {
      dialect: 'postgresql',
    })
    expect(verdict.confirmationPhrase).toBe('accounts')
  })
})

describe('the cost of the multi-table rule, recorded rather than hidden', () => {
  // The most common MySQL multi-table update idiom, refused for an unattended
  // caller. It is genuinely narrowed against some data and touches every row
  // against other data, and the statement does not say which — that is the
  // trade this rule makes, and it is the reason it is written down here.
  test("MySQL's UPDATE … JOIN … SET is tier two", async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users p JOIN orders o ON p.id = o.user_id SET p.banned = 1 WHERE o.total > 0',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multi_table')
  })

  test('and on mariadb', async () => {
    const verdict = await classifySqlWriteGate(
      'UPDATE users p JOIN orders o ON p.id = o.user_id SET p.banned = 1 WHERE o.total > 0',
      { dialect: 'mariadb' }
    )
    expect(verdict.tier).toBe('two')
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

describe('a write nested inside another statement is not read off the head', () => {
  // The statement type used to be whatever the leading keyword said, and
  // PostgreSQL's data-modifying CTEs put an arbitrary write in front of it.
  // Measured against a 2000-row table on PostgreSQL 16 (#94).

  test('a CTE that deletes every row is not an INSERT', async () => {
    // Measured: 2000 of 2000 deleted, admitted as tier one.
    const verdict = await classifySqlWriteGate(
      'WITH moved AS (DELETE FROM users RETURNING *) INSERT INTO archive (id) SELECT id FROM moved',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
    expect(verdict.operation).toBe('DELETE')
  })

  test('a CTE that rewrites every row is not an INSERT either', async () => {
    // Measured: 2000 of 2000 rewritten, admitted as tier one.
    const verdict = await classifySqlWriteGate(
      'WITH u AS (UPDATE users SET banned = 1 RETURNING *) INSERT INTO archive (id) SELECT id FROM u',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.operation).toBe('UPDATE')
  })

  test('the same CTE under a CREATE head is the same statement', async () => {
    // Which is why the rule is not attached to INSERT. Measured: 2000 of 2000
    // deleted, admitted as tier one because `CREATE` is an ordinary write.
    const verdict = await classifySqlWriteGate(
      'CREATE TABLE t2 AS WITH moved AS (DELETE FROM users RETURNING *) SELECT id FROM moved',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('a CTE that only reads leaves the insert alone', async () => {
    const verdict = await classifySqlWriteGate(
      'WITH s AS (SELECT id FROM users WHERE id < 5) INSERT INTO archive (id) SELECT id FROM s',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('an upsert is not a nested write, however much DO UPDATE reads like one', async () => {
    // The parenthesised group here is `(id)`, a conflict target. Measured: 1 row
    // rewritten on PostgreSQL, and the MySQL spelling below likewise.
    const postgres = await classifySqlWriteGate(
      "INSERT INTO users (id, name) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET name = 'b'",
      { dialect: 'postgresql' }
    )
    expect(postgres.tier).toBe('one')

    const mysql = await classifySqlWriteGate(
      "INSERT INTO users (id, name) VALUES (1, 'a') ON DUPLICATE KEY UPDATE name = 'b'",
      { dialect: 'mysql' }
    )
    expect(mysql.tier).toBe('one')
  })

  test('a MERGE head does not shelter the CTE in front of it', async () => {
    // The first version of this fix classified the MERGE first and returned tier
    // one for its insert-only action list, which ended the classification before
    // the CTE was ever looked at. Measured: `MERGE 2000`, and `p` left empty.
    const verdict = await classifySqlWriteGate(
      'WITH moved AS (DELETE FROM p RETURNING *) MERGE INTO archive a USING moved m ON a.id = m.id WHEN NOT MATCHED THEN INSERT VALUES (m.id, m.c)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('an UPDATE head does not shelter it either', async () => {
    // This one was hidden by an assumption rather than by an ordering: a
    // CTE-wrapped DELETE defeats the parser and resolves upwards through
    // `unparseable`, but a CTE-wrapped UPDATE parses, and its `with` clause was
    // never read. Measured: `UPDATE 1` reported, 2000 rows of `p` rewritten.
    const verdict = await classifySqlWriteGate(
      'WITH m AS (UPDATE p SET c = 99 RETURNING *) UPDATE q SET c = 1 WHERE q.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('and neither does a qualified DELETE head', async () => {
    // Measured: 2000 rows appended to `log` while the DELETE removed one row.
    const verdict = await classifySqlWriteGate(
      'WITH m AS (INSERT INTO log SELECT g FROM generate_series(1, 2000) g RETURNING *) DELETE FROM q WHERE q.id = 1',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('a CTE body may open with a CTE of its own, and the write is still in there', async () => {
    // The criterion asked whether a write *opened* the group, which a nested
    // `WITH` is enough to prevent — the word standing after the parenthesis is
    // `WITH`. Measured: `MERGE 2000`, and `p` left empty, as tier one.
    const verdict = await classifySqlWriteGate(
      'WITH m AS (WITH i AS (SELECT 1) DELETE FROM p RETURNING *) MERGE INTO archive a USING m ON a.id = m.id WHEN NOT MATCHED THEN INSERT VALUES (m.id, m.c)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('the same body under a CREATE head', async () => {
    // Measured: `SELECT 2000`, and `p` left empty, as tier one. The heads that
    // do not pass through the parser — MERGE, CREATE, ALTER — have no accidental
    // second line of defence, which is why this criterion has to hold alone.
    const verdict = await classifySqlWriteGate(
      'CREATE TABLE t9 AS WITH m AS (WITH i AS (SELECT 1) DELETE FROM p RETURNING *) SELECT * FROM m',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('a column called merge is a column', async () => {
    // `MERGE` is not reserved in any supported dialect, unlike INSERT, UPDATE
    // and DELETE, which have to be quoted to be a column name — and quoting
    // removes them from this text entirely. Measured on PostgreSQL 16 and MySQL
    // 8.4: `merge int` builds, and this rewrites exactly the one row it names.
    const verdict = await classifySqlWriteGate('UPDATE t SET total = (merge + 1) WHERE id = 1', {
      dialect: 'postgresql',
    })
    expect(verdict.tier).toBe('one')
  })

  test('a MERGE inside a CTE body is still caught, INTO and all', async () => {
    const verdict = await classifySqlWriteGate(
      'WITH m AS (MERGE INTO p USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN DELETE RETURNING *) SELECT * FROM m',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('a locking read inside a subquery is not a nested write', async () => {
    // `SELECT … FOR UPDATE` takes a lock; it writes nothing. The permission
    // guard drops the clause before looking for a write keyword for exactly this
    // reason, and a subquery is where the clause turns up. This statement is
    // still tier two — the bundled grammar rejects the clause, and an unreadable
    // statement carrying a subquery resolves upwards — but it is refused for not
    // being readable, not for containing a write it does not contain.
    const verdict = await classifySqlWriteGate(
      'UPDATE users SET banned = 1 WHERE id IN (SELECT id FROM sessions FOR UPDATE)',
      { dialect: 'postgresql' }
    )
    expect(verdict.reason).toBe('unparseable')
  })

  test("a foreign key's referential action is not a write", async () => {
    // `ON DELETE CASCADE` lives inside the column list, which is where widening
    // the criterion from "opens the group" to "anywhere inside it" put it. The
    // giveaway is the contrast: the same constraint added by `ALTER TABLE …`
    // sits at depth zero and was tier one, so the criterion was answering a
    // question about parentheses rather than about writes.
    const verdict = await classifySqlWriteGate(
      'CREATE TABLE child (id int PRIMARY KEY, pid int REFERENCES parent(id) ON DELETE CASCADE)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('nor is a named constraint carrying both actions', async () => {
    const verdict = await classifySqlWriteGate(
      'CREATE TABLE child (id int, pid int, CONSTRAINT fk FOREIGN KEY (pid) REFERENCES parent(id) ON UPDATE CASCADE ON DELETE SET NULL)',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test("nor is MySQL's ON UPDATE CURRENT_TIMESTAMP, which is on most tables", async () => {
    const verdict = await classifySqlWriteGate(
      'CREATE TABLE stamps (id int PRIMARY KEY, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)',
      { dialect: 'mysql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('but a CTE body is still read past a referential action in the same statement', async () => {
    const verdict = await classifySqlWriteGate(
      'CREATE TABLE child (id int REFERENCES parent(id) ON DELETE CASCADE) AS WITH m AS (DELETE FROM p RETURNING *) SELECT id FROM m',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('nested_write')
  })

  test('a scalar subquery in a VALUES row is not a nested write', async () => {
    const verdict = await classifySqlWriteGate(
      'INSERT INTO archive (id) VALUES ((SELECT max(id) FROM users))',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })
})

describe('MERGE is classified by the actions it carries', () => {
  // `MERGE` used to map to `INSERT`, which made every one of them tier one.
  // Measured against a 2000-row table on PostgreSQL 16 (#95).

  test('WHEN MATCHED THEN DELETE empties the table in one statement', async () => {
    // Measured: 2000 of 2000 deleted, admitted as tier one.
    const verdict = await classifySqlWriteGate(
      'MERGE INTO p USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN DELETE',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.operation).toBe('DELETE')
  })

  test('a MERGE is still a MERGE when a CTE goes in front of it', async () => {
    // Found by measuring the first fix rather than by reading it: anchoring on
    // the leading keyword was defeated by the one thing that can legally precede
    // a statement. Measured: 2000 of 2000 deleted, admitted as tier one.
    const verdict = await classifySqlWriteGate(
      'WITH s AS (SELECT 1 AS x) MERGE INTO p USING s ON true WHEN MATCHED THEN DELETE',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.operation).toBe('DELETE')
  })

  test('WHEN MATCHED THEN UPDATE rewrites it in one statement instead', async () => {
    // Measured: 2000 of 2000 rewritten, admitted as tier one.
    const verdict = await classifySqlWriteGate(
      "MERGE INTO p USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN UPDATE SET c = 'x'",
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.operation).toBe('UPDATE')
  })

  test('a MERGE that can only insert stays an ordinary write', async () => {
    // This is what keeps the fix a classification rather than a blanket refusal:
    // a MERGE with no destructive action cannot empty or rewrite the target.
    const verdict = await classifySqlWriteGate(
      "MERGE INTO p USING (SELECT 9001 AS id) s ON p.id = s.id WHEN NOT MATCHED THEN INSERT (id, c) VALUES (s.id, 'n')",
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
    expect(verdict.operation).toBe('INSERT')
  })

  test('WHEN MATCHED THEN DO NOTHING is not a destructive action', async () => {
    const verdict = await classifySqlWriteGate(
      'MERGE INTO p USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN DO NOTHING',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('one')
  })

  test('a MERGE names its target, so the phrase is a table rather than CONFIRM', async () => {
    const verdict = await classifySqlWriteGate(
      'MERGE INTO public.accounts USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN DELETE',
      { dialect: 'postgresql' }
    )
    expect(verdict.confirmationPhrase).toBe('public.accounts')
  })

  test('a quoted target asks for the fixed phrase rather than the next word along', async () => {
    // Quoted identifiers are erased along with string literals before any of
    // this is read, so there is no name left to ask for — and the word standing
    // where it was is `USING`, which the operator can type without having looked
    // at what the statement targets. Same fallback as an index drop.
    const verdict = await classifySqlWriteGate(
      'MERGE INTO "accounts" USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN DELETE',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.confirmationPhrase).toBe(WRITE_GATE_FALLBACK_PHRASE)
  })

  test('a schema-qualified quoted target does not ask for half a name either', async () => {
    const verdict = await classifySqlWriteGate(
      'MERGE INTO public."accounts" USING (SELECT 1 AS x) s ON true WHEN MATCHED THEN DELETE',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.confirmationPhrase).toBe(WRITE_GATE_FALLBACK_PHRASE)
  })
})

describe('the cost of these two rules, recorded rather than hidden', () => {
  // Both are refusals of statements that touch one row. Both are accepted for
  // the reason `multiple_statements` gives: a statement carrying two writes has
  // no single tier, and reading one off the other is what #94 and #95 were.

  test('a CTE deleting one row by primary key is refused with the rest', async () => {
    // Measured: 1 of 2000 deleted.
    const verdict = await classifySqlWriteGate(
      'WITH moved AS (DELETE FROM users WHERE id = 1 RETURNING *) INSERT INTO archive (id) SELECT id FROM moved',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
  })

  test('a publication option named after a write is refused, and left that way', async () => {
    // PostgreSQL's `WITH (option = value)` takes a reserved word as a bare
    // value, and logical replication's options are those words. Refusing it is
    // wrong, and fixing it would cost more than it buys: each removal the
    // criterion makes rests on a fact about the grammar, and this one would rest
    // on recognising a particular clause shape — the failure the criterion
    // exists to avoid. Recorded in ADR 0010 as a residual rather than patched.
    const verdict = await classifySqlWriteGate(
      'CREATE PUBLICATION pub FOR TABLE t WITH (publish = delete)',
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')

    // The quoted spelling, which is the one the documentation shows, is fine.
    const quoted = await classifySqlWriteGate(
      "CREATE PUBLICATION pub FOR TABLE t WITH (publish = 'insert, update, delete')",
      { dialect: 'postgresql' }
    )
    expect(quoted.tier).toBe('one')
  })

  test('the ordinary MERGE upsert is refused too', async () => {
    // Measured: 1 of 2000 rewritten. It is a multi-table write, and it is
    // refused on the same terms as `UPDATE p SET … FROM o WHERE p.id = o.ref`,
    // which ADR 0010 already refuses. The remedy is the same: run it where
    // someone can confirm it.
    const verdict = await classifySqlWriteGate(
      "MERGE INTO p USING (SELECT 1 AS id) s ON p.id = s.id WHEN MATCHED THEN UPDATE SET c = 'x' WHEN NOT MATCHED THEN INSERT (id, c) VALUES (s.id, 'n')",
      { dialect: 'postgresql' }
    )
    expect(verdict.tier).toBe('two')
    expect(verdict.reason).toBe('multi_table')
  })
})
