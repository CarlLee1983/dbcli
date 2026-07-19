import { describe, expect, test } from 'bun:test'
import type { DriftReport } from '@/core/orm-drift/compare'
import { formatDrift } from '@/formatters/orm-drift'

const report: DriftReport = {
  ormSource: 'prisma',
  entries: [
    {
      category: 'missing_in_db',
      severity: 'error',
      table: 'public.users',
      object: 'age',
      detail:
        "column 'age' (integer) defined in prisma but absent in the database — queries will fail",
      proposedCommands: [
        '# dry-run by default; review via migration-review before --execute',
        'dbcli migrate add-column public.users age integer --nullable',
      ],
    },
  ],
  unparsed: [
    {
      location: 'Widget.status',
      reason: "blocked: unsupported field type 'WidgetStatus' (enum/composite/unknown)",
    },
  ],
  summary: { errors: 1, warns: 0, infos: 0, unmanaged: 0 },
}

describe('formatDrift', () => {
  test('json is a lossless pretty-printed report', () => {
    const output = formatDrift(report, 'json')

    expect(JSON.parse(output)).toEqual(report)
    expect(output).toBe(JSON.stringify(report, null, 2))
  })

  test('table shows entries, proposals, unparsed items, and summary', () => {
    const output = formatDrift(report, 'table')

    expect(output).toContain('[error] missing_in_db public.users.age')
    expect(output).toContain('dbcli migrate add-column public.users age integer --nullable')
    expect(output).toContain('Unparsed: Widget.status')
    expect(output).toContain('Summary: 1 error(s), 0 warn(s), 0 info(s), 0 unmanaged')
  })

  test('table preserves the qualified table display supplied by DriftEntry', () => {
    const output = formatDrift(
      {
        ...report,
        entries: [{ ...report.entries[0]!, table: '"Tenant"."Users"', object: 'email' }],
      },
      'table'
    )

    expect(output).toContain('[error] missing_in_db "Tenant"."Users".email')
  })

  test('markdown renders entries and proposals', () => {
    const output = formatDrift(report, 'markdown')

    expect(output).toContain('| Severity | Category | Object | Detail |')
    expect(output).toContain('| error | missing_in_db | public.users.age |')
    expect(output).toContain('**Proposal for `public.users.age`:**')
    expect(output).toContain('```bash')
  })

  test('markdown escapes pipes and newlines in every table cell', () => {
    const output = formatDrift(
      {
        ...report,
        entries: [
          {
            ...report.entries[0]!,
            table: 'tenant|east.users\narchive',
            object: 'display|name\nlegacy',
            detail: 'first | second\nthird',
          },
        ],
      },
      'markdown'
    )

    expect(output).toContain(
      '| error | missing_in_db | tenant\\|east.users<br>archive.display\\|name<br>legacy | first \\| second<br>third |'
    )
    expect(output.match(/^\| error \|/gm)).toHaveLength(1)
  })

  test('clean human-readable reports say no drift', () => {
    const clean: DriftReport = {
      ...report,
      entries: [],
      unparsed: [],
      summary: { errors: 0, warns: 0, infos: 0, unmanaged: 0 },
    }

    expect(formatDrift(clean, 'table')).toContain('No drift detected')
    expect(formatDrift(clean, 'markdown')).toContain('No drift detected')
  })
})
