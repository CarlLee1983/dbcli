import { describe, expect, test } from 'bun:test'
import type { SqlDatabaseSystem, TableSchema } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { parseSingleStatement } from '@/core/lint/parse'
import { missingLimitOffsetRule } from '@/core/lint/rules/missing-limit-offset'
import { selectStarRule } from '@/core/lint/rules/select-star'
import { unanchoredLikeRule } from '@/core/lint/rules/unanchored-like'
import type { LintRuleContext } from '@/core/lint/types'

function ctxFor(
  sql: string,
  schema?: Record<string, TableSchema>,
  system: SqlDatabaseSystem = 'postgresql'
): LintRuleContext {
  return {
    system,
    sql,
    ast: parseSingleStatement(sql, system),
    schema: buildSchemaContext(schema),
  }
}

describe('select-star', () => {
  test('flags SELECT *', () => {
    const findings = selectStarRule.check(ctxFor('SELECT * FROM users'))
    expect(findings).toHaveLength(1)
    expect(findings[0].rule).toBe('select-star')
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('with schema + single table, offers explicit-column rewrite', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'email', type: 'varchar(255)', nullable: true },
      ],
    }
    const findings = selectStarRule.check(ctxFor('SELECT * FROM users', { users }))
    expect(findings[0].rewrite?.sql).toBe('SELECT id, email FROM users')
    expect(findings[0].rewrite?.confidence).toBe('high')
    expect(findings[0].verifyCommand).toContain('dbcli explain --analyze')
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('withholds PostgreSQL select-star rewrite for a case-folded schema collision', () => {
    const lower: TableSchema = {
      name: 'foo',
      columns: [{ name: 'lower_id', type: 'integer', nullable: false }],
    }
    const quoted: TableSchema = {
      name: 'Foo',
      columns: [{ name: 'quoted_id', type: 'integer', nullable: false }],
    }
    const findings = selectStarRule.check(
      ctxFor('SELECT * FROM FOO', { foo: lower, Foo: quoted }, 'postgresql')
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].rewrite).toBeUndefined()
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('withholds an unquoted mixed-case table rewrite when its folded bucket collides', () => {
    const lower: TableSchema = {
      name: 'foo',
      columns: [{ name: 'lower_id', type: 'integer', nullable: false }],
    }
    const mixed: TableSchema = {
      name: 'Foo',
      columns: [{ name: 'mixed_id', type: 'integer', nullable: false }],
    }
    const findings = selectStarRule.check(
      ctxFor('SELECT * FROM Foo', { foo: lower, Foo: mixed }, 'postgresql')
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].rewrite).toBeUndefined()
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('withholds a quoted mixed-case table rewrite when quote provenance is unavailable', () => {
    const lower: TableSchema = {
      name: 'foo',
      columns: [{ name: 'lower_id', type: 'integer', nullable: false }],
    }
    const mixed: TableSchema = {
      name: 'Foo',
      columns: [{ name: 'mixed_id', type: 'integer', nullable: false }],
    }
    const findings = selectStarRule.check(
      ctxFor('SELECT * FROM "Foo"', { foo: lower, Foo: mixed }, 'postgresql')
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].rewrite).toBeUndefined()
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('keeps a unique case-insensitive select-star schema lookup', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [{ name: 'id', type: 'integer', nullable: false }],
    }
    const findings = selectStarRule.check(
      ctxFor('SELECT * FROM USERS', { users }, 'postgresql')
    )

    expect(findings[0].rewrite?.sql).toBe('SELECT id FROM USERS')
    expect(findings[0].rewrite?.confidence).toBe('high')
  })

  test('rewrites the projection wildcard instead of a star in a leading comment', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'email', type: 'varchar(255)', nullable: true },
      ],
    }
    const findings = selectStarRule.check(
      ctxFor('/* retain * marker */ SELECT * FROM users', { users })
    )

    expect(findings[0].rewrite?.sql).toBe(
      '/* retain * marker */ SELECT id, email FROM users'
    )
    expect(findings[0].rewrite?.confidence).toBe('high')
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('withholds rewrite for a mixed projection containing multiplication and a wildcard', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [
        { name: 'price', type: 'numeric', nullable: false },
        { name: 'quantity', type: 'integer', nullable: false },
      ],
    }
    const findings = selectStarRule.check(
      ctxFor('SELECT price * quantity, * FROM users', { users })
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].rewrite).toBeUndefined()
    expect(findings[0].verifyCommand).toBeUndefined()
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('quotes and escapes unsafe PostgreSQL schema column identifiers', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [
        { name: 'select', type: 'text', nullable: false },
        { name: 'full name', type: 'text', nullable: false },
        { name: 'display"name', type: 'text', nullable: false },
      ],
    }
    const findings = selectStarRule.check(ctxFor('SELECT * FROM users', { users }))

    expect(findings[0].rewrite?.sql).toBe(
      'SELECT "select", "full name", "display""name" FROM users'
    )
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('quotes and escapes unsafe MySQL schema column identifiers', () => {
    const users: TableSchema = {
      name: 'users',
      columns: [
        { name: 'select', type: 'text', nullable: false },
        { name: 'full name', type: 'text', nullable: false },
        { name: 'tick`name', type: 'text', nullable: false },
      ],
    }
    const findings = selectStarRule.check(
      ctxFor('SELECT * FROM users', { users }, 'mysql')
    )

    expect(findings[0].rewrite?.sql).toBe(
      'SELECT `select`, `full name`, `tick``name` FROM users'
    )
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('does not flag a backtick-quoted asterisk column in MySQL', () => {
    expect(
      selectStarRule.check(ctxFor('SELECT `*` FROM users', undefined, 'mysql'))
    ).toHaveLength(0)
  })

  test('does not flag a backtick-quoted asterisk column in MariaDB', () => {
    expect(
      selectStarRule.check(ctxFor('SELECT `*` FROM users', undefined, 'mariadb'))
    ).toHaveLength(0)
  })

  test('does not flag explicit columns', () => {
    expect(selectStarRule.check(ctxFor('SELECT id FROM users'))).toHaveLength(0)
  })

  test('no-ops on non-SELECT', () => {
    expect(
      selectStarRule.check(ctxFor("UPDATE users SET name = 'x' WHERE id = 1"))
    ).toHaveLength(0)
  })
})

describe('unanchored-like', () => {
  test("flags LIKE '%...'", () => {
    const findings = unanchoredLikeRule.check(
      ctxFor("SELECT id FROM users WHERE email LIKE '%@x.com'")
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
  })

  test("does not flag anchored LIKE 'abc%'", () => {
    expect(
      unanchoredLikeRule.check(ctxFor("SELECT id FROM users WHERE email LIKE 'a%'"))
    ).toHaveLength(0)
  })
})

describe('missing-limit-offset', () => {
  test('flags OFFSET >= 1000', () => {
    const findings = missingLimitOffsetRule.check(
      ctxFor('SELECT id FROM users ORDER BY id LIMIT 20 OFFSET 5000')
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
    expect(findings[0].message).toContain('keyset')
  })

  test('does not flag small offsets or no offset', () => {
    expect(
      missingLimitOffsetRule.check(ctxFor('SELECT id FROM users LIMIT 20 OFFSET 40'))
    ).toHaveLength(0)
    expect(missingLimitOffsetRule.check(ctxFor('SELECT id FROM users LIMIT 20'))).toHaveLength(0)
  })
})
