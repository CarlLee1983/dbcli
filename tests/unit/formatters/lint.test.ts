import { describe, expect, test } from 'bun:test'
import type { LintReport } from '@/core/lint/types'
import { formatLint } from '@/formatters/lint'

const report: LintReport = {
  sql: 'SELECT * FROM users',
  label: 'inline',
  dialect: 'postgresql',
  findings: [
    {
      rule: 'select-star',
      severity: 'warn',
      message: 'SELECT * fetches every column.',
      span: { start: 0, end: 8 },
      rewrite: { sql: 'SELECT id FROM users', confidence: 'high' },
      verifyCommand: 'dbcli explain --analyze "SELECT id FROM users"',
      schemaVerified: true,
    },
  ],
  skippedRules: [
    {
      rule: 'implicit-cast',
      reason: 'blocked: schema cache unavailable (run dbcli schema)',
    },
  ],
  relatedCommands: ['dbcli explain --analyze "SELECT * FROM users"'],
}

describe('formatLint', () => {
  test('json round-trips every structured report field', () => {
    expect(JSON.parse(formatLint([report], 'json'))).toEqual([report])
  })

  test('text renders findings, source metadata, rewrites, skipped rules, and related commands', () => {
    const out = formatLint([report], 'text')

    expect(out).toContain('Label: inline')
    expect(out).toContain('SQL: SELECT * FROM users')
    expect(out).toContain('[warn] select-star (schema-verified)')
    expect(out).toContain('Span: 0..8')
    expect(out).toContain('SELECT * fetches every column.')
    expect(out).toContain('Rewrite (high): SELECT id FROM users')
    expect(out).toContain('Verify: dbcli explain --analyze')
    expect(out).toContain(
      'Skipped: implicit-cast — blocked: schema cache unavailable (run dbcli schema)'
    )
    expect(out).toContain('Related:\n  dbcli explain --analyze "SELECT * FROM users"')
  })

  test('text reports a clean query', () => {
    const clean: LintReport = {
      ...report,
      findings: [],
      skippedRules: [],
      relatedCommands: [],
    }

    expect(formatLint([clean], 'text')).toContain('No findings.')
  })

  test('text keeps parse errors together with blocked rules and related commands', () => {
    const parseFailure: LintReport = {
      ...report,
      findings: [],
      parseError: 'Unexpected token near "FROM"',
    }
    const out = formatLint([parseFailure], 'text')

    expect(out).toContain('Parse error: Unexpected token near "FROM"')
    expect(out).toContain('Skipped: implicit-cast — blocked:')
    expect(out).toContain('Related:')
  })

  test('markdown renders all finding metadata and report-level sections', () => {
    const out = formatLint([report], 'markdown')

    expect(out).toContain('### inline')
    expect(out).toContain('| Severity | Rule | Message | Span | Schema verified |')
    expect(out).toContain('| warn | select-star |')
    expect(out).toContain('| 0..8 | yes |')
    expect(out).toContain('**Rewrite** (select-star, high):')
    expect(out).toContain('**Verify:**')
    expect(out).toContain('**Skipped rules:**')
    expect(out).toContain('blocked: schema cache unavailable')
    expect(out).toContain('**Related commands:**')
  })

  test('markdown keeps parse errors together with skipped rules and related commands', () => {
    const parseFailure: LintReport = {
      ...report,
      findings: [],
      parseError: 'Expected | got `value`',
    }
    const out = formatLint([parseFailure], 'markdown')

    expect(out).toContain('**Parse error:** Expected \\| got \\`value\\`')
    expect(out).toContain('**Skipped rules:**')
    expect(out).toContain('**Related commands:**')
  })

  test('markdown escapes headings and table cells and uses a safe dynamic code fence', () => {
    const hostile: LintReport = {
      ...report,
      label: 'batch #1\ninjected heading',
      sql: 'SELECT `value`\nFROM users',
      findings: [
        {
          ...report.findings[0]!,
          rule: 'rule|name',
          message: 'first | second\n<script>alert(1)</script>',
          rewrite: {
            sql: 'SELECT value\n```sql\nDROP TABLE users;\n```',
            confidence: 'low',
          },
        },
      ],
    }
    const out = formatLint([hostile], 'markdown')

    expect(out).toContain('### batch \\#1<br>injected heading')
    expect(out).toContain('rule\\|name')
    expect(out).toContain('first \\| second<br>&lt;script&gt;alert\\(1\\)&lt;/script&gt;')
    expect(out).toContain('````sql\nSELECT value\n```sql\nDROP TABLE users;\n```\n````')
    expect(out.match(/^### /gm)).toHaveLength(1)
  })

  test('empty batches have deterministic human-readable output', () => {
    expect(formatLint([], 'text')).toBe('No queries.')
    expect(formatLint([], 'markdown')).toBe('No queries.')
    expect(formatLint([], 'json')).toBe('[]')
  })
})
