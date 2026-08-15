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
