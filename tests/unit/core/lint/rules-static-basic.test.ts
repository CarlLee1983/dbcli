import { describe, expect, test } from 'bun:test'
import type { TableSchema } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { parseSingleStatement } from '@/core/lint/parse'
import { missingLimitOffsetRule } from '@/core/lint/rules/missing-limit-offset'
import { selectStarRule } from '@/core/lint/rules/select-star'
import { unanchoredLikeRule } from '@/core/lint/rules/unanchored-like'
import type { LintRuleContext } from '@/core/lint/types'

function ctxFor(sql: string, schema?: Record<string, TableSchema>): LintRuleContext {
  return {
    system: 'postgresql',
    sql,
    ast: parseSingleStatement(sql, 'postgresql'),
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
