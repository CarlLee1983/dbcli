import { describe, expect, test } from 'bun:test'
import type { TableSchema } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { parseSingleStatement } from '@/core/lint/parse'
import { implicitCastRule } from '@/core/lint/rules/implicit-cast'
import { notInNullableRule } from '@/core/lint/rules/not-in-nullable'
import type { LintRuleContext } from '@/core/lint/types'

function ctxFor(
  sql: string,
  schema: Record<string, TableSchema>
): LintRuleContext {
  return {
    system: 'postgresql',
    sql,
    ast: parseSingleStatement(sql, 'postgresql'),
    schema: buildSchemaContext(schema),
  }
}

const schema = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'integer', nullable: false, primaryKey: true },
      { name: 'email', type: 'varchar(255)', nullable: true },
      { name: 'ref_code', type: 'varchar(32)', nullable: true },
    ],
  },
} satisfies Record<string, TableSchema>

describe('implicit-cast', () => {
  test('flags string literal compared to numeric column', () => {
    const findings = implicitCastRule.check(
      ctxFor("SELECT id FROM users WHERE id = '42'", schema)
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].schemaVerified).toBe(true)
    expect(findings[0].rewrite?.sql).toContain('id = 42')
  })

  test('flags number literal compared to string column', () => {
    const findings = implicitCastRule.check(
      ctxFor('SELECT id FROM users WHERE ref_code = 12345', schema)
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('ref_code')
  })

  test('does not flag number literal compared to numeric column', () => {
    expect(
      implicitCastRule.check(
        ctxFor('SELECT id FROM users WHERE id = 42', schema)
      )
    ).toHaveLength(0)
  })

  test('does not flag string literal compared to string column', () => {
    expect(
      implicitCastRule.check(
        ctxFor("SELECT id FROM users WHERE email = 'a@x.com'", schema)
      )
    ).toHaveLength(0)
  })

  test('ignores columns not present in schema', () => {
    expect(
      implicitCastRule.check(
        ctxFor("SELECT id FROM users WHERE ghost = '1'", schema)
      )
    ).toHaveLength(0)
  })
})

describe('not-in-nullable', () => {
  test('flags NOT IN over a nullable column', () => {
    const findings = notInNullableRule.check(
      ctxFor("SELECT id FROM users WHERE email NOT IN ('a', 'b')", schema)
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('NOT EXISTS')
    expect(findings[0].schemaVerified).toBe(true)
  })

  test('does not flag NOT IN over a NOT NULL column', () => {
    expect(
      notInNullableRule.check(
        ctxFor('SELECT id FROM users WHERE id NOT IN (1, 2)', schema)
      )
    ).toHaveLength(0)
  })
})
