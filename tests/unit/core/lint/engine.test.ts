import { describe, expect, test } from 'bun:test'
import type { TableSchema } from '@/adapters/types'
import { buildSchemaContext } from '@/core/lint/context'
import { ALL_RULES, lintSql } from '@/core/lint/engine'

const schemaTables: Record<string, TableSchema> = {
  users: {
    name: 'users',
    columns: [{ name: 'id', type: 'integer', nullable: false }],
  },
}
const schema = buildSchemaContext(schemaTables)

describe('lintSql', () => {
  test('registry holds all 9 rules', () => {
    expect(ALL_RULES.map((rule) => rule.name).sort()).toEqual([
      'distinct-groupby-abuse',
      'implicit-cast',
      'missing-limit-offset',
      'non-sargable-where',
      'not-in-nullable',
      'or-to-union',
      'select-star',
      'subquery-to-join',
      'unanchored-like',
    ])
  })

  test('reports findings across rules', () => {
    const report = lintSql("SELECT * FROM users WHERE LOWER(name) = 'x'", {
      system: 'postgresql',
    })
    const rules = report.findings.map((finding) => finding.rule)

    expect(rules).toContain('select-star')
    expect(rules).toContain('non-sargable-where')
    expect(report.parseError).toBeUndefined()
  })

  test('skips implicit-cast without a schema cache', () => {
    const report = lintSql("SELECT id FROM users WHERE id = '1'", {
      system: 'postgresql',
    })

    expect(report.findings.map((finding) => finding.rule)).not.toContain('implicit-cast')
    expect(report.skippedRules.find((skipped) => skipped.rule === 'implicit-cast')?.reason).toBe(
      'blocked: schema cache unavailable (run dbcli schema)'
    )
  })

  test('skips not-in-nullable without a schema cache', () => {
    const report = lintSql('SELECT id FROM users WHERE id NOT IN (1, NULL)', {
      system: 'postgresql',
    })

    expect(report.findings.map((finding) => finding.rule)).not.toContain('not-in-nullable')
    expect(report.skippedRules.find((skipped) => skipped.rule === 'not-in-nullable')?.reason).toBe(
      'blocked: schema cache unavailable (run dbcli schema)'
    )
  })

  test('runs schema rules when cache is provided', () => {
    const report = lintSql("SELECT id FROM users WHERE id = '1'", {
      system: 'postgresql',
      schema,
    })

    expect(report.findings.map((finding) => finding.rule)).toContain('implicit-cast')
    expect(report.skippedRules.map((skipped) => skipped.rule)).not.toContain('implicit-cast')
  })

  test('runs not-in-nullable when cache is provided', () => {
    const report = lintSql('SELECT id FROM users WHERE id NOT IN (1, NULL)', {
      system: 'postgresql',
      schema,
    })

    expect(report.findings.map((finding) => finding.rule)).toContain('not-in-nullable')
    expect(report.skippedRules.map((skipped) => skipped.rule)).not.toContain('not-in-nullable')
  })

  test('--no-schema explicitly blocks implicit-cast', () => {
    const report = lintSql("SELECT id FROM users WHERE id = '1'", {
      system: 'postgresql',
      schema,
      noSchema: true,
    })

    expect(report.findings.map((finding) => finding.rule)).not.toContain('implicit-cast')
    expect(report.skippedRules.find((skipped) => skipped.rule === 'implicit-cast')?.reason).toBe(
      'blocked: --no-schema'
    )
  })

  test('--no-schema explicitly blocks not-in-nullable', () => {
    const report = lintSql('SELECT id FROM users WHERE id NOT IN (1, NULL)', {
      system: 'postgresql',
      schema,
      noSchema: true,
    })

    expect(report.findings.map((finding) => finding.rule)).not.toContain('not-in-nullable')
    expect(report.skippedRules.find((skipped) => skipped.rule === 'not-in-nullable')?.reason).toBe(
      'blocked: --no-schema'
    )
  })

  test('minSeverity filters lower-severity findings', () => {
    const report = lintSql('SELECT * FROM users OFFSET 1000', {
      system: 'postgresql',
      minSeverity: 'warn',
    })
    const rules = report.findings.map((finding) => finding.rule)

    expect(rules).toContain('select-star')
    expect(rules).not.toContain('missing-limit-offset')
  })

  test('parse failure yields parseError and blocks every rule', () => {
    const report = lintSql('SELEC oops', { system: 'postgresql' })

    expect(report.parseError).toContain('SQL parse failed')
    expect(report.findings).toHaveLength(0)
    expect(report.skippedRules).toEqual(
      ALL_RULES.map((rule) => ({ rule: rule.name, reason: 'blocked: parse failed' }))
    )
  })

  test('relatedCommands embed the SQL', () => {
    const report = lintSql('SELECT id FROM users', { system: 'postgresql' })

    expect(report.relatedCommands).toEqual([
      'dbcli guide missing-index-for "SELECT id FROM users"',
      'dbcli explain --analyze "SELECT id FROM users"',
    ])
  })

  test('relatedCommands shell-escape SQL before embedding it', () => {
    const sql = 'SELECT \'$HOME\' AS "value" /* `whoami` \\\\ */'
    const report = lintSql(sql, { system: 'postgresql' })

    expect(report.relatedCommands).toEqual([
      'dbcli guide missing-index-for "SELECT \'\\$HOME\' AS \\"value\\" /* \\`whoami\\` \\\\\\\\ */"',
      'dbcli explain --analyze "SELECT \'\\$HOME\' AS \\"value\\" /* \\`whoami\\` \\\\\\\\ */"',
    ])
  })

  test('preserves an optional query label', () => {
    const report = lintSql('SELECT id FROM users', { system: 'postgresql' }, 'saved:active-users')

    expect(report.label).toBe('saved:active-users')
  })
})
