import { describe, expect, test } from 'bun:test'
import {
  PLAN_ACCEPTANCE_EXEMPTIONS,
  collectPlanAcceptanceViolations,
  findCitedTestPaths,
  findPlanAcceptanceViolations,
} from '../../scripts/check-plan-acceptance'

const section = (...criteria: string[]): string =>
  [
    '## TCK-01 — A ticket',
    '',
    '**Acceptance criteria:**',
    '',
    ...criteria,
    '',
    '**Verification:** `bun test`',
  ].join('\n')

describe('plan acceptance annotation gate', () => {
  test.each([
    ['covered by', '1. It works. — covered by: `tests/unit/thing.test.ts` (`works`).'],
    ['unverified', '1. It works. — unverified: nothing asserts the failure path.'],
    ['known deviation', '1. It works. — known deviation: unreachable, see index.ts:12.'],
  ])('accepts a criterion annotated with %s', (_label, criterion) => {
    expect(findPlanAcceptanceViolations(section(criterion), 'plan.md')).toEqual([])
  })

  test('rejects a criterion with no annotation', () => {
    expect(findPlanAcceptanceViolations(section('1. It works.'), 'plan.md')).toEqual([
      'plan.md: TCK-01 criterion 1 carries no — covered by: / — unverified: / — known deviation: annotation',
    ])
  })

  // The annotation is prose inside a wrapped Markdown list, so the marker is
  // routinely split across a line break. A line-oriented gate would report
  // every wrapped annotation as missing, which is the failure mode that would
  // get this gate switched off within a week.
  test('accepts an annotation whose marker wraps across lines', () => {
    const criterion = [
      '1. It works and the sentence runs long enough to wrap. —',
      '   covered by: `tests/unit/thing.test.ts`.',
    ].join('\n')
    expect(findPlanAcceptanceViolations(section(criterion), 'plan.md')).toEqual([])
  })

  test('rejects an annotation with no text after the marker', () => {
    expect(findPlanAcceptanceViolations(section('1. It works. — unverified:'), 'plan.md')).toEqual([
      'plan.md: TCK-01 criterion 1 has an empty — unverified: annotation',
    ])
  })

  test('reports each unannotated criterion separately', () => {
    const source = section(
      '1. First thing.',
      '2. Second thing. — unverified: no test.',
      '3. Third thing.'
    )
    expect(findPlanAcceptanceViolations(source, 'plan.md')).toEqual([
      'plan.md: TCK-01 criterion 1 carries no — covered by: / — unverified: / — known deviation: annotation',
      'plan.md: TCK-01 criterion 3 carries no — covered by: / — unverified: / — known deviation: annotation',
    ])
  })

  // Without this rule the gate is escapable by reformatting: prose acceptance
  // criteria yield no numbered items and would pass while asserting nothing.
  test('rejects an acceptance section written as prose instead of numbered criteria', () => {
    const source = [
      '## TCK-01 — A ticket',
      '',
      '**Acceptance criteria:** It works offline.',
      '',
      '---',
    ].join('\n')
    expect(findPlanAcceptanceViolations(source, 'plan.md')).toEqual([
      'plan.md: TCK-01 states acceptance criteria without a numbered list',
    ])
  })

  test('reads criteria per ticket rather than per file', () => {
    const source = [
      section('1. First. — unverified: no test.'),
      '',
      '---',
      '',
      section('1. Second.'),
    ].join('\n')
    expect(findPlanAcceptanceViolations(source, 'plan.md')).toHaveLength(1)
  })

  test('stops reading criteria at the next bold field', () => {
    const source = [
      '## TCK-01 — A ticket',
      '',
      '**Acceptance criteria:**',
      '',
      '1. It works. — unverified: no test.',
      '',
      '**Verification:** Focused tests, then the release gate.',
      '',
      '1. Not a criterion.',
    ].join('\n')
    expect(findPlanAcceptanceViolations(source, 'plan.md')).toEqual([])
  })

  test('collects every cited test path, including several in one annotation', () => {
    const source = section(
      '1. It works. — covered by: `tests/unit/a.test.ts` and `tests/integration/b.test.ts`.',
      '2. It also works. — unverified: partly `tests/unit/c.test.ts`.'
    )
    expect(findCitedTestPaths(source)).toEqual([
      'tests/integration/b.test.ts',
      'tests/unit/a.test.ts',
      'tests/unit/c.test.ts',
    ])
  })

  test('the exemption list only shrinks: every entry still needs the exemption', async () => {
    const stale: string[] = []
    for (const name of PLAN_ACCEPTANCE_EXEMPTIONS) {
      const source = await Bun.file(new URL(`../../docs/plans/${name}`, import.meta.url)).text()
      if (findPlanAcceptanceViolations(source, name).length === 0) stale.push(name)
    }
    expect(stale).toEqual([])
  })

  test('docs/plans has no violations outside the exemption list', async () => {
    expect(await collectPlanAcceptanceViolations()).toEqual([])
  })
})
