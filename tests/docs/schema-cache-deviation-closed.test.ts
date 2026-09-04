/**
 * The PLAT-001 known overstatement is closed everywhere it was written down.
 *
 * `dbcli schema` used to persist its cache through a guarded whole-config
 * writer, so `capabilities check` said `schema.read` was available under
 * `DBCLI_AGENT_MODE=1` while the command exited 1 there. The contradiction was
 * disclosed rather than hidden — in the reference, the design record, the ADR,
 * the plan's acceptance criteria and the Story's acceptance file — which was
 * the right call at the time and leaves five places that now say something
 * false unless every one of them is revisited.
 *
 * They are not all revisited the same way, and that is the point of this file.
 * User-facing reference states what is true now, so the sentence goes. Design
 * records and Story acceptance are records of decisions taken at a point in
 * time; deleting the deviation from those would rewrite what was actually
 * accepted, so they keep their reasoning and gain a closing note. The check
 * below encodes exactly that split, so a later reader cannot conclude the
 * removal was inconsistent or the retention was an oversight.
 */

import { describe, test, expect } from 'bun:test'

/** Surfaces that must no longer state the deviation at all. */
const MUST_NOT_CLAIM = [
  'assets/reference.md',
  'skills/dbcli/reference.md',
  'plugins/dbcli-agent/skills/dbcli/reference.md',
  '.cursor/skills/dbcli/reference.md',
  '.github/skills/dbcli/reference.md',
  '.windsurf/skills/dbcli/reference.md',
  'docs/user/en/index.md',
  'docs/user/en/index.html',
  'docs/user/zh-TW/index.md',
  'docs/user/zh-TW/index.html',
]

/** Records that keep the deviation and must say it is closed. */
const MUST_RECORD_CLOSURE = [
  'docs/specs/2026-09-04-agent-integration-contract-v1.md',
  'docs/adr/0022-the-capability-catalog-is-derived-from-the-engine-matrix.md',
  'specs/stories/DBCLI-PLAT-001-capability-contract/acceptance.md',
]

/**
 * The claim itself: that the schema cache write is refused under agent mode.
 *
 * Deliberately narrow, and narrowed once already. A first attempt matched
 * "schema … cache … refused/blocked" loosely and fired on `blocked: schema
 * cache` — the impact command's reason code for an unavailable layered cache,
 * which has nothing to do with agent mode and appears in three of these files.
 * A gate that reports unrelated text is a gate someone deletes, so what is
 * matched is the sentence as it was actually written, plus the general shape
 * anchored on the flag that made the claim true.
 */
const WITHDRAWN = [
  /One known overstatement/,
  /persists its result into `config\.json`/,
  /DBCLI_AGENT_MODE=1[^.]{0,140}(schema[^.]{0,40})?(persistence|cache write)[^.]{0,60}refused/i,
] as const

const read = (file: string) => Bun.file(new URL(`../../${file}`, import.meta.url)).text()

describe('the deviation is gone from every surface that states current behaviour', () => {
  for (const file of MUST_NOT_CLAIM) {
    test(`${file} no longer says the schema cache write is refused`, async () => {
      const source = await read(file)
      for (const claim of WITHDRAWN) expect(source).not.toMatch(claim)
    })
  }
})

describe('the records keep the deviation and mark it closed', () => {
  for (const file of MUST_RECORD_CLOSURE) {
    test(`${file} records that DBCLI-PLAT-012 closed it`, async () => {
      const source = await read(file)
      // Still explains what the deviation was — the reasoning is why the
      // decision was defensible, and it outlives the deviation.
      expect(source).toMatch(/schema/i)
      expect(source).toContain('DBCLI-PLAT-012')
      expect(source).toMatch(/closed by DBCLI-PLAT-012/i)
    })
  }
})

describe('the plan states what proves the criterion now', () => {
  test('criterion 16 cites a test instead of admitting a deviation', async () => {
    const plan = await read('docs/plans/2026-09-04-agent-integration-contract-v1.md')
    const criterion = plan.split('\n').find((line) => line.startsWith('16. '))
    expect(criterion).toBeDefined()
    expect(criterion).not.toContain('known deviation:')
    expect(criterion).toContain('covered by:')
    expect(criterion).toContain('tests/integration/schema-cache-agent-mode.test.ts')
  })
})
