import { describe, expect, test } from 'bun:test'
import type { SqlDatabaseSystem, TableSchema } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { parseSingleStatement } from '@/core/lint/parse'
import { implicitCastRule } from '@/core/lint/rules/implicit-cast'
import { notInNullableRule } from '@/core/lint/rules/not-in-nullable'
import type { LintRuleContext } from '@/core/lint/types'

function ctxFor(
  sql: string,
  schema: Record<string, TableSchema>,
  system: SqlDatabaseSystem = 'postgresql'
): LintRuleContext {
  return {
    system,
    sql,
    ast: parseSingleStatement(sql, system),
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
      { name: 'order_id', type: 'varchar(32)', nullable: false },
      { name: 'maybe', type: 'integer', nullable: true },
      { name: 'other_maybe', type: 'integer', nullable: true },
      { name: 'medium_id', type: 'mediumint', nullable: false },
      { name: 'long_body', type: 'longtext', nullable: false },
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
  metrics: {
    name: 'metrics',
    columns: [
      { name: 'a', type: 'integer', nullable: true },
      { name: 'b', type: 'integer', nullable: true },
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

  for (const system of ['postgresql', 'mysql', 'mariadb'] as const) {
    test(`flags and safely rewrites a literal-left comparison for ${system}`, () => {
      const sql = "SELECT id FROM users WHERE '42' < id"
      const findings = implicitCastRule.check(ctxFor(sql, schema, system))

      expect(findings).toHaveLength(1)
      expect(findings[0].rewrite?.sql).toBe('SELECT id FROM users WHERE 42 < id')
      expect(findings[0].rewrite?.confidence).toBe('high')
      expect(findings[0].message).toContain("'id'")
      expect(sql.slice(findings[0].span.start, findings[0].span.end)).toBe(
        "'42' < id"
      )
    })
  }

  test('literal-left rewrite preserves the original comparison operator', () => {
    const findings = implicitCastRule.check(
      ctxFor("SELECT id FROM users WHERE '42' >= id", schema)
    )

    expect(findings[0].rewrite?.sql).toBe(
      'SELECT id FROM users WHERE 42 >= id'
    )
  })

  test('withholds literal-left rewrites when targeting is ambiguous', () => {
    const findings = implicitCastRule.check(
      ctxFor(
        "SELECT id FROM users WHERE '42' < id OR '42' < id",
        schema
      )
    )

    expect(findings).toHaveLength(2)
    expect(findings.every((finding) => finding.rewrite === undefined)).toBe(true)
  })

  test('withholds mixed-case column findings when the folded schema bucket collides', () => {
    const collision: TableSchema = {
      name: 'collision',
      columns: [
        { name: 'code', type: 'integer', nullable: false },
        { name: 'Code', type: 'text', nullable: true },
      ],
    }
    const findings = implicitCastRule.check(
      ctxFor(
        'SELECT id FROM collision WHERE Code = 123',
        { collision },
        'postgresql'
      )
    )

    expect(findings).toHaveLength(0)
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

  test('never rewrites a longer identifier when comments prevent exact target matching', () => {
    const sql =
      "SELECT id FROM users WHERE order_id = '42' AND id /* target */ = '42'"
    const findings = implicitCastRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("'id'")
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('never rewrites a matching JOIN comparison for a diagnosed WHERE node', () => {
    const sql =
      "SELECT u.id FROM users u JOIN users v ON u.id = '42' WHERE u.id /* target */ = '42'"
    const findings = implicitCastRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("'id'")
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('withholds rewrites when the WHERE contains a correlated subquery', () => {
    const sql =
      "SELECT u.id FROM users u WHERE u.id /* target */ = '42' AND EXISTS (SELECT 1 FROM blocked_users b WHERE u.id = '42')"
    const findings = implicitCastRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("'id'")
    expect(findings[0].rewrite).toBeUndefined()
    expect(findings[0].verifyCommand).toBeUndefined()
  })

  test('resolves a named table alias after a derived table without shifting scope', () => {
    const findings = implicitCastRule.check(
      ctxFor(
        "SELECT u.id FROM (SELECT 1 AS id) d JOIN users u ON u.id = d.id WHERE u.id = '42'",
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("'id'")
  })

  test('does not resolve a CTE-shadowed name through the physical schema cache', () => {
    expect(
      implicitCastRule.check(
        ctxFor(
          "WITH users AS (SELECT '1' AS id) SELECT id FROM users WHERE id = '1'",
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('does not resolve a derived relation through the physical schema cache', () => {
    expect(
      implicitCastRule.check(
        ctxFor(
          "SELECT id FROM (SELECT '1' AS id) users WHERE id = '1'",
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('does not resolve a PostgreSQL schema-qualified relation through an unqualified cache entry', () => {
    expect(
      implicitCastRule.check(
        ctxFor(
          "SELECT id FROM archive.users WHERE id = '1'",
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(0)
  })

  for (const system of ['mysql', 'mariadb'] as const) {
    test(`does not resolve a ${system} database-qualified relation through an unqualified cache entry`, () => {
      expect(
        implicitCastRule.check(
          ctxFor(
            "SELECT id FROM otherdb.users WHERE id = '1'",
            schema,
            system
          )
        )
      ).toHaveLength(0)
    })
  }

  test('does not recursively lint a nested predicate with the outer table scope', () => {
    expect(
      implicitCastRule.check(
        ctxFor(
          "SELECT id FROM users WHERE id IN (SELECT id FROM blocked_users WHERE shared_id = '42')",
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('recognizes mediumint as an exact numeric family', () => {
    expect(
      implicitCastRule.check(
        ctxFor("SELECT id FROM users WHERE medium_id = '42'", schema)
      )
    ).toHaveLength(1)
  })

  test('recognizes longtext as an exact textual family', () => {
    expect(
      implicitCastRule.check(
        ctxFor('SELECT id FROM users WHERE long_body = 42', schema)
      )
    ).toHaveLength(1)
  })
})

describe('not-in-nullable', () => {
  test('flags an explicit NULL value in the NOT IN list', () => {
    const sql = 'SELECT id FROM users WHERE id NOT IN (1, NULL, 2)'
    const findings = notInNullableRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('NULL')
    expect(findings[0].schemaVerified).toBe(false)
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
    expect(findings[0].schemaVerified).toBe(true)
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('suppresses a nullable projected column null-rejected through a table alias', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.email AS blocked_email FROM blocked_users b WHERE b.email IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('suppresses a nullable projection null-rejected inside an AND conjunction', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.email FROM blocked_users b WHERE b.id > 0 AND b.email IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('keeps a nullable projection finding when IS NOT NULL is under OR', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.email FROM blocked_users b WHERE b.email IS NOT NULL OR b.id > 0)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
  })

  test('keeps a compound nullable projection finding when only one input is null-rejected', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (SELECT a + b FROM metrics WHERE a IS NOT NULL)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
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

  for (const system of ['postgresql', 'mysql', 'mariadb'] as const) {
    test(`${system} flags CAST of a nullable value in the NOT IN list`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (1, CAST(nullable_number AS BIGINT))',
            schema,
            system
          )
        )
      ).toHaveLength(1)
    })

    test(`${system} flags CAST of a nullable subquery projection`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT CAST(u.nullable_number AS BIGINT) FROM users u)',
            schema,
            system
          )
        )
      ).toHaveLength(1)
    })
  }

  test('suppresses an exact CAST projection guarded directly in WHERE', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT CAST(u.nullable_number AS BIGINT) FROM users u WHERE CAST(u.nullable_number AS BIGINT) IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('keeps an exact CAST projection finding when its guard is under OR', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT CAST(u.nullable_number AS BIGINT) FROM users u WHERE CAST(u.nullable_number AS BIGINT) IS NOT NULL OR u.id > 0)',
          schema
        )
      )
    ).toHaveLength(1)
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

  test('flags a declared non-null column on the nullable side of a LEFT JOIN', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.id FROM users source LEFT JOIN blocked_users b ON b.id = source.id)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('b.id')
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('flags a declared non-null column on the nullable side of a RIGHT JOIN', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT source.id FROM users source RIGHT JOIN blocked_users b ON b.id = source.id)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('source.id')
  })

  test('flags a declared non-null column on either nullable side of a FULL JOIN', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.id FROM users source FULL JOIN blocked_users b ON b.id = source.id)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('b.id')
  })

  test('suppresses an outer-join null extension guarded directly with IS NOT NULL', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.id FROM users source LEFT JOIN blocked_users b ON b.id = source.id WHERE b.id IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('suppresses an outer-join null extension guarded under AND', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.id FROM users source LEFT JOIN blocked_users b ON b.id = source.id WHERE source.id > 0 AND b.id IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('keeps an outer-join null-extension finding when its guard is under OR', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT u.id FROM users u WHERE u.id NOT IN (SELECT b.id FROM users source LEFT JOIN blocked_users b ON b.id = source.id WHERE b.id IS NOT NULL OR source.id > 0)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
  })

  test('flags a CASE projection without ELSE as structurally nullable', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (SELECT CASE WHEN b.id > 0 THEN b.id END FROM blocked_users b)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('nullable expression')
    expect(findings[0].schemaVerified).toBe(false)
    expect(findings[0].rewrite).toBeUndefined()
  })

  test('does not flag a CASE projection with non-null branches and ELSE', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT CASE WHEN b.id > 0 THEN b.id ELSE 0 END FROM blocked_users b)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('suppresses an exact CASE projection guarded directly in WHERE', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT CASE WHEN b.id > 0 THEN b.id END FROM blocked_users b WHERE CASE WHEN b.id > 0 THEN b.id END IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('suppresses an exact CASE projection guarded under AND in WHERE', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT CASE WHEN b.id > 0 THEN b.id END FROM blocked_users b WHERE b.id > 0 AND CASE WHEN b.id > 0 THEN b.id END IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('keeps an exact CASE projection finding when its WHERE guard is under OR', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT CASE WHEN b.id > 0 THEN b.id END FROM blocked_users b WHERE CASE WHEN b.id > 0 THEN b.id END IS NOT NULL OR b.id > 0)',
          schema
        )
      )
    ).toHaveLength(1)
  })

  for (const aggregate of ['MIN', 'MAX', 'AVG', 'SUM'] as const) {
    test(`flags ${aggregate} as nullable on empty input`, () => {
      const findings = notInNullableRule.check(
        ctxFor(
          `SELECT id FROM users WHERE id NOT IN (SELECT ${aggregate}(b.id) FROM blocked_users b)`,
          schema
        )
      )

      expect(findings).toHaveLength(1)
      expect(findings[0].message).toContain(aggregate)
      expect(findings[0].schemaVerified).toBe(false)
      expect(findings[0].rewrite).toBeUndefined()
    })
  }

  test('PostgreSQL flags CORR as a known null-on-empty function aggregate', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (SELECT CORR(b.id, b.id) FROM blocked_users b)',
        schema,
        'postgresql'
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('CORR')
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('flags an unrecognized parser aggregate node conservatively', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (SELECT GROUP_CONCAT(b.id) FROM blocked_users b)',
        schema,
        'postgresql'
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('GROUP_CONCAT')
  })

  test('does not treat an arbitrary function AST node as an aggregate', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT LOWER(b.email) FROM blocked_users b)',
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(0)
  })

  test('does not flag COUNT because its result is non-null on empty input', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT COUNT(b.id) FROM blocked_users b)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('suppresses an exact SUM projection guarded directly in HAVING', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT SUM(b.id) FROM blocked_users b HAVING SUM(b.id) IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('suppresses an exact SUM projection guarded under AND in HAVING', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT SUM(b.id) FROM blocked_users b HAVING COUNT(*) > 0 AND SUM(b.id) IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('keeps an exact SUM projection finding when its HAVING guard is under OR', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT SUM(b.id) FROM blocked_users b HAVING SUM(b.id) IS NOT NULL OR COUNT(*) > 0)',
          schema
        )
      )
    ).toHaveLength(1)
  })

  test('PostgreSQL flags ARRAY_AGG because it is NULL on empty input', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT ARRAY_AGG(b.id) FROM blocked_users b)',
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(1)
  })

  test('PostgreSQL flags STRING_AGG because it is NULL on empty input', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          "SELECT id FROM users WHERE id NOT IN (SELECT STRING_AGG(b.email, ',') FROM blocked_users b)",
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(1)
  })

  test('PostgreSQL suppresses exact ARRAY_AGG guarded in HAVING', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT ARRAY_AGG(b.id) FROM blocked_users b HAVING ARRAY_AGG(b.id) IS NOT NULL)',
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(0)
  })

  test('PostgreSQL keeps ARRAY_AGG finding when HAVING guard is under OR', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT ARRAY_AGG(b.id) FROM blocked_users b HAVING ARRAY_AGG(b.id) IS NOT NULL OR COUNT(*) > 0)',
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(1)
  })

  test('PostgreSQL keeps COUNT non-null on empty input', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (SELECT COUNT(b.id) FROM blocked_users b)',
          schema,
          'postgresql'
        )
      )
    ).toHaveLength(0)
  })

  for (const system of ['mysql', 'mariadb'] as const) {
    test(`${system} flags GROUP_CONCAT because it is NULL on empty input`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT GROUP_CONCAT(b.id) FROM blocked_users b)',
            schema,
            system
          )
        )
      ).toHaveLength(1)
    })

    test(`${system} suppresses exact GROUP_CONCAT guarded in HAVING`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT GROUP_CONCAT(b.id) FROM blocked_users b HAVING GROUP_CONCAT(b.id) IS NOT NULL)',
            schema,
            system
          )
        )
      ).toHaveLength(0)
    })

    test(`${system} keeps GROUP_CONCAT finding when HAVING guard is under OR`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT GROUP_CONCAT(b.id) FROM blocked_users b HAVING GROUP_CONCAT(b.id) IS NOT NULL OR COUNT(*) > 0)',
            schema,
            system
          )
        )
      ).toHaveLength(1)
    })

    test(`${system} keeps COUNT non-null on empty input`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT COUNT(b.id) FROM blocked_users b)',
            schema,
            system
          )
        )
      ).toHaveLength(0)
    })

    for (const aggregate of ['BIT_AND', 'BIT_OR', 'BIT_XOR'] as const) {
      test(`${system} keeps neutral-value ${aggregate} non-null on empty input`, () => {
        expect(
          notInNullableRule.check(
            ctxFor(
              `SELECT id FROM users WHERE id NOT IN (SELECT ${aggregate}(b.id) FROM blocked_users b)`,
              schema,
              system
            )
          )
        ).toHaveLength(0)
      })
    }
  }

  test('marks CAST of a static NULL as not schema verified', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (CAST(NULL AS BIGINT))',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].schemaVerified).toBe(false)
  })

  test('marks CAST of a schema-nullable column as schema verified', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (CAST(nullable_number AS BIGINT))',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].schemaVerified).toBe(true)
  })

  for (const system of ['mysql', 'mariadb'] as const) {
    test(`recognizes structurally nullable CASE and SUM projections for ${system}`, () => {
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT CASE WHEN b.id > 0 THEN b.id END FROM blocked_users b)',
            schema,
            system
          )
        )
      ).toHaveLength(1)
      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM users WHERE id NOT IN (SELECT SUM(b.id) FROM blocked_users b)',
            schema,
            system
          )
        )
      ).toHaveLength(1)
    })
  }

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

  test('does not use nullable physical-table facts for a CTE projection with the same name', () => {
    const nullableUsers: TableSchema = {
      ...schema.users,
      columns: schema.users.columns.map((column) =>
        column.name === 'id' ? { ...column, nullable: true } : column
      ),
    }

    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM blocked_users WHERE id NOT IN (WITH users AS (SELECT 1 AS id) SELECT id FROM users)',
          { ...schema, users: nullableUsers }
        )
      )
    ).toHaveLength(0)
  })

  test('flags an unambiguous CTE output that statically projects NULL', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM blocked_users WHERE id NOT IN (WITH users AS (SELECT NULL AS id) SELECT id FROM users)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].schemaVerified).toBe(false)
    expect(findings[0].message).toContain('WHERE id IS NOT NULL')
    expect(findings[0].message).not.toContain('WHERE NULL IS NOT NULL')
  })

  test('does not flag an unambiguous CTE output that projects a non-null literal', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM blocked_users WHERE id NOT IN (WITH users AS (SELECT 1 AS id) SELECT id FROM users)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('flags an unambiguous derived-table output that statically projects NULL', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM blocked_users WHERE id NOT IN (SELECT d.id FROM (SELECT NULL AS id) d)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].schemaVerified).toBe(false)
    expect(findings[0].message).toContain('WHERE d.id IS NOT NULL')
    expect(findings[0].message).not.toContain('WHERE NULL IS NOT NULL')
  })

  test('does not flag an unambiguous derived-table output that projects a non-null literal', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM blocked_users WHERE id NOT IN (SELECT d.id FROM (SELECT 1 AS id) d)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('does not use nullable cache facts for a PostgreSQL schema-qualified NOT IN source', () => {
    const nullableUsers: TableSchema = {
      ...schema.users,
      columns: schema.users.columns.map((column) =>
        column.name === 'id' ? { ...column, nullable: true } : column
      ),
    }

    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM blocked_users WHERE id NOT IN (SELECT id FROM archive.users)',
          { ...schema, users: nullableUsers },
          'postgresql'
        )
      )
    ).toHaveLength(0)
  })

  for (const system of ['mysql', 'mariadb'] as const) {
    test(`does not use nullable cache facts for a ${system} database-qualified NOT IN source`, () => {
      const nullableUsers: TableSchema = {
        ...schema.users,
        columns: schema.users.columns.map((column) =>
          column.name === 'id' ? { ...column, nullable: true } : column
        ),
      }

      expect(
        notInNullableRule.check(
          ctxFor(
            'SELECT id FROM blocked_users WHERE id NOT IN (SELECT id FROM otherdb.users)',
            { ...schema, users: nullableUsers },
            system
          )
        )
      ).toHaveLength(0)
    })
  }

  test('does not flag IS NULL because it always returns a non-null boolean', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (1, maybe IS NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('does not flag IS NOT NULL because it always returns a non-null boolean', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (1, maybe IS NOT NULL)',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('does not flag dialect-supported IS DISTINCT FROM expressions', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id NOT IN (1, (maybe IS DISTINCT FROM other_maybe))',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('guards a nullable projected expression rather than only its first nullable leaf', () => {
    const findings = notInNullableRule.check(
      ctxFor(
        'SELECT id FROM users WHERE id NOT IN (SELECT a + b FROM metrics)',
        schema
      )
    )

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('projected expression itself')
    expect(findings[0].message).not.toContain('WHERE a IS NOT NULL')
  })

  test('does not recursively lint nested NOT IN with the outer table scope', () => {
    expect(
      notInNullableRule.check(
        ctxFor(
          'SELECT id FROM users WHERE id IN (SELECT id FROM blocked_users WHERE id NOT IN (1, nullable_number))',
          schema
        )
      )
    ).toHaveLength(0)
  })

  test('places the NOT IN span on the operator instead of marker text', () => {
    const sql =
      "SELECT id FROM users WHERE 'NOT IN marker' = 'x' OR id NOT IN (1, NULL)"
    const findings = notInNullableRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(1)
    expect(findings[0].span.start).toBe(sql.lastIndexOf('NOT IN'))
    expect(sql.slice(findings[0].span.start, findings[0].span.end)).toBe(
      'NOT IN'
    )
  })

  test('assigns successive spans to successive top-level NOT IN findings', () => {
    const sql =
      'SELECT id FROM users WHERE id NOT IN (1, NULL) OR id NOT IN (2, NULL)'
    const findings = notInNullableRule.check(ctxFor(sql, schema))

    expect(findings).toHaveLength(2)
    expect(findings.map((finding) => finding.span.start)).toEqual([
      sql.indexOf('NOT IN'),
      sql.lastIndexOf('NOT IN'),
    ])
    expect(
      findings.map((finding) =>
        sql.slice(finding.span.start, finding.span.end)
      )
    ).toEqual(['NOT IN', 'NOT IN'])
  })
})
