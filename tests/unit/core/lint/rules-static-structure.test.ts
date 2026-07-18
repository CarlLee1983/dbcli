import { describe, expect, test } from 'bun:test'
import type { SqlDatabaseSystem } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { parseSingleStatement } from '@/core/lint/parse'
import { distinctGroupbyAbuseRule } from '@/core/lint/rules/distinct-groupby-abuse'
import { nonSargableWhereRule } from '@/core/lint/rules/non-sargable-where'
import { orToUnionRule } from '@/core/lint/rules/or-to-union'
import { subqueryToJoinRule } from '@/core/lint/rules/subquery-to-join'
import type { LintRuleContext } from '@/core/lint/types'

function ctxFor(
  sql: string,
  system: SqlDatabaseSystem = 'postgresql'
): LintRuleContext {
  return {
    system,
    sql,
    ast: parseSingleStatement(sql, system),
    schema: buildSchemaContext(),
  }
}

describe('non-sargable-where', () => {
  test('flags function wrapping a column in a comparison', () => {
    const findings = nonSargableWhereRule.check(
      ctxFor("SELECT id FROM users WHERE LOWER(email) = 'a@x.com'")
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('LOWER')
  })

  test('flags arithmetic on a column in a comparison', () => {
    const findings = nonSargableWhereRule.check(
      ctxFor('SELECT id FROM orders WHERE amount * 100 > 5000')
    )

    expect(findings).toHaveLength(1)
  })

  test('does not flag a bare column comparison', () => {
    expect(
      nonSargableWhereRule.check(
        ctxFor("SELECT id FROM users WHERE email = 'a@x.com'")
      )
    ).toHaveLength(0)
  })

  test('does not flag functions over literals on the value side', () => {
    expect(
      nonSargableWhereRule.check(
        ctxFor('SELECT id FROM users WHERE created_at > NOW()')
      )
    ).toHaveLength(0)
  })
})

describe('or-to-union', () => {
  test('flags top-level OR across different columns', () => {
    const findings = orToUnionRule.check(
      ctxFor("SELECT id FROM users WHERE email = 'a' OR name = 'b'")
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
    expect(findings[0].message).toContain('UNION ALL')
  })

  test('does not flag OR on the same column', () => {
    expect(
      orToUnionRule.check(
        ctxFor("SELECT id FROM users WHERE email = 'a' OR email = 'b'")
      )
    ).toHaveLength(0)
  })
})

describe('subquery-to-join', () => {
  test('flags IN with a SELECT subquery', () => {
    const findings = subqueryToJoinRule.check(
      ctxFor('SELECT id FROM users WHERE id IN (SELECT user_id FROM orders)')
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('JOIN')
  })

  test('does not flag IN over a literal list', () => {
    expect(
      subqueryToJoinRule.check(
        ctxFor('SELECT id FROM users WHERE id IN (1, 2, 3)')
      )
    ).toHaveLength(0)
  })
})

describe('distinct-groupby-abuse', () => {
  test('flags DISTINCT combined with GROUP BY', () => {
    const findings = distinctGroupbyAbuseRule.check(
      ctxFor('SELECT DISTINCT user_id FROM orders GROUP BY user_id')
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
  })

  test('does not flag plain DISTINCT', () => {
    expect(
      distinctGroupbyAbuseRule.check(
        ctxFor('SELECT DISTINCT user_id FROM orders')
      )
    ).toHaveLength(0)
  })

  test('does not flag plain GROUP BY', () => {
    expect(
      distinctGroupbyAbuseRule.check(
        ctxFor('SELECT user_id FROM orders GROUP BY user_id')
      )
    ).toHaveLength(0)
  })
})
