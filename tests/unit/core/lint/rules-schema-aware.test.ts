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
      { name: 'nullable_number', type: 'integer', nullable: true },
      { name: 'interval_value', type: 'interval', nullable: false },
      { name: 'point_value', type: 'point', nullable: false },
      { name: 'custom_value', type: 'my_int_domain', nullable: false },
      { name: 'shared_id', type: 'integer', nullable: false },
      { name: 'scoped_value', type: 'integer', nullable: false },
    ],
  },
  blocked_users: {
    name: 'blocked_users',
    columns: [
      { name: 'id', type: 'integer', nullable: false },
      { name: 'email', type: 'varchar(255)', nullable: true },
      { name: 'shared_id', type: 'varchar(32)', nullable: false },
      { name: 'scoped_value', type: 'varchar(32)', nullable: true },
    ],
  },
} satisfies Record<string, TableSchema>

describe('implicit-cast', () => {
  test('flags string literal compared to numeric column', () => {
    const sql = "SELECT id FROM users WHERE id = '42'"
    const findings = implicitCastRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].schemaVerified).toBe(true)
    expect(findings[0].rewrite?.sql).toContain('id = 42')
    expect(sql.slice(findings[0].span.start, findings[0].span.end)).toBe(
      "id = '42'"
    )
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

  test('does not classify interval as numeric from an internal int substring', () => {
    expect(
      implicitCastRule.check(
        ctxFor("SELECT id FROM users WHERE interval_value = '1'", schema)
      )
    ).toHaveLength(0)
  })

  test('does not classify point as a supported numeric type', () => {
    expect(
      implicitCastRule.check(
        ctxFor("SELECT id FROM users WHERE point_value = '1'", schema)
      )
    ).toHaveLength(0)
  })

  test('does not classify a user-defined type by a numeric substring', () => {
    expect(
      implicitCastRule.check(
        ctxFor("SELECT id FROM users WHERE custom_value = '1'", schema)
      )
    ).toHaveLength(0)
  })

  test('rewrites the diagnosed RHS literal instead of an earlier identical literal', () => {
    const findings = implicitCastRule.check(
      ctxFor(
        "SELECT '42' AS marker, id FROM users WHERE id = '42'",
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].rewrite?.sql).toBe(
      "SELECT '42' AS marker, id FROM users WHERE id = 42"
    )
  })

  test('omits a rewrite when identical comparisons cannot be targeted unambiguously', () => {
    const findings = implicitCastRule.check(
      ctxFor(
        "SELECT id FROM users WHERE id = '42' OR id = '42'",
        schema
      )
    )

    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.rewrite === undefined)).toBe(true)
  })

  test('resolves a qualified column through its table alias', () => {
    const findings = implicitCastRule.check(
      ctxFor(
        'SELECT u.id FROM users u JOIN blocked_users b ON b.id = u.id WHERE b.shared_id = 12345',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('shared_id')
    expect(findings[0].message).toContain('varchar(32)')
  })

  test('skips an ambiguous unqualified column across joined tables', () => {
    expect(
      implicitCastRule.check(
        ctxFor(
          "SELECT u.id FROM users u JOIN blocked_users b ON b.id = u.id WHERE shared_id = '42'",
          schema
        )
      )
    ).toHaveLength(0)
  })
})

describe('not-in-nullable', () => {
  test('flags an explicit NULL value in the NOT IN list', () => {
    const sql = 'SELECT id FROM users WHERE id NOT IN (1, NULL, 2)'
    const findings = notInNullableRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('NULL')
    expect(findings[0].schemaVerified).toBe(true)
    expect(sql.slice(findings[0].span.start, findings[0].span.end)).toBe(
      'NOT IN'
    )
  })

  test('flags a subquery whose projected column is nullable in its own alias scope', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.scoped_value FROM blocked_users b)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('IS NOT NULL')
    expect(findings[0].message).toContain('NOT EXISTS')
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('flags another RHS column known nullable from schema', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (1, nullable_number)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('right-hand')
  })

  test('flags a null-propagating RHS expression over a nullable column', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (1, nullable_number + 1)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('right-hand')
  })

  test('does not flag a non-null literal list', () => {
    expect(
      notInNullableRule.check(
        ctxFor('SELECT id FROM users WHERE id NOT IN (1, 2)', schema)
      )
    ).toHaveLength(0)
  })

  test('does not flag a non-null subquery projection', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT id FROM blocked_users)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('does not confuse a nullable left-hand column with the RHS NULL hazard', () => {
    expect(
      notInNullableRule.check(
        ctxFor("SELECT id FROM users WHERE email NOT IN ('a', 'b')", schema)
      )
    ).toHaveLength(0)
  })

  test('resolves a qualified nullable RHS column through its table alias', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u JOIN blocked_users b ON b.id = u.id WHERE u.id NOT IN (1, b.email)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('b.email')
  })

  test('skips an ambiguous unqualified RHS column across joined tables', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT u.id FROM users u JOIN blocked_users b ON b.id = u.id WHERE u.id NOT IN (1, email)',
          schema
        )
      )
    ).toHaveLength(0)
  })
})
