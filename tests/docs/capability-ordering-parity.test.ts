/**
 * Every surface describing `--require` ordering says the same thing.
 *
 * DBCLI-PLAT-001 shipped with four surfaces and two answers. Its `story.md` R5
 * said output is "independent of `--require` argument order" and its
 * `acceptance.md` ticked "byte-identical across calls and independent of input
 * order"; the design record said neither, and the implementation preserves
 * first-seen input order in `required` and `results` — which its own unit test
 * asserts. So the contract promised a property the code deliberately does not
 * have, and the only reason nobody noticed is that no test read the prose.
 *
 * The two properties are separable and both are wanted: identical input gives
 * byte-identical output, and argument order changes no verdict. Neither implies
 * that reordering the arguments leaves the bytes alone, and sorting `results`
 * to make it true would cost a caller the correspondence between the list it
 * sent and the list it got back.
 *
 * This test is the thing that was missing. It pins the phrase on every surface
 * and refuses the withdrawn claim anywhere, so the next divergence is a failing
 * test rather than a sentence.
 */

import { describe, test, expect } from 'bun:test'
import { checkCapabilities, type CapabilityCheckContext } from '@/core/capabilities'

/** The canonical statement, per language. A surface must carry its own. */
const MARKER = {
  en: 'first-seen input order',
  'zh-TW': '首次出現的輸入順序',
} as const

/**
 * The withdrawn claim, in the forms it was written in.
 *
 * Deliberately narrow. These documents legitimately say "independent of
 * locale", "independent of `--config`" and "independent of the connection
 * timeout"; a pattern matching any "independent of" would report all of them
 * and be switched off within a week.
 */
const WITHDRAWN = [
  /independent of\s+(?:the\s+)?(?:`?--require`?\s+)?(?:argument|input)\s+order/i,
  /不受[^。]{0,30}順序影響/,
  /與[^。]{0,20}順序無關/,
] as const

const SURFACES: ReadonlyArray<{ file: string; language: keyof typeof MARKER }> = [
  { file: 'specs/stories/DBCLI-PLAT-001-capability-contract/story.md', language: 'en' },
  { file: 'specs/stories/DBCLI-PLAT-001-capability-contract/acceptance.md', language: 'en' },
  { file: 'docs/specs/2026-09-04-agent-integration-contract-v1.md', language: 'en' },
  { file: 'assets/reference.md', language: 'en' },
  { file: 'docs/user/en/index.md', language: 'en' },
  { file: 'docs/user/en/index.html', language: 'en' },
  { file: 'docs/user/zh-TW/index.md', language: 'zh-TW' },
  { file: 'docs/user/zh-TW/index.html', language: 'zh-TW' },
]

/**
 * `specs/stories/DBCLI-PLAT-013-agent-platform-closeout/` is deliberately not a
 * surface. Its Superseded Behavior section quotes the withdrawn wording, which
 * is the record of what changed and why; a check that cannot tell a declaration
 * from a quotation of one would have to be answered by deleting the record.
 */
const read = (file: string) => Bun.file(new URL(`../../${file}`, import.meta.url)).text()

describe('the --require ordering contract is stated once', () => {
  for (const { file, language } of SURFACES) {
    test(`${file} states the first-seen ordering rule`, async () => {
      expect(await read(file)).toContain(MARKER[language])
    })

    test(`${file} does not claim output is independent of argument order`, async () => {
      const source = await read(file)
      for (const claim of WITHDRAWN) expect(source).not.toMatch(claim)
    })
  }
})

describe('the stated contract is the implemented one', () => {
  const context: CapabilityCheckContext = {
    engine: 'postgresql',
    permission: 'query-only',
    connectionName: null,
    agentMode: false,
  }

  test('identical input is byte-identical output', () => {
    const once = checkCapabilities(['schema.read', 'data.delete'], context)
    const again = checkCapabilities(['schema.read', 'data.delete'], context)
    expect(JSON.stringify(once)).toBe(JSON.stringify(again))
  })

  test('reordering the arguments reorders the answer, and only that', () => {
    const forward = checkCapabilities(['schema.read', 'data.delete'], context)
    const reverse = checkCapabilities(['data.delete', 'schema.read'], context)

    // The property the withdrawn claim asserted, shown false on purpose: this
    // is what the documentation must not promise.
    expect(JSON.stringify(forward)).not.toBe(JSON.stringify(reverse))

    expect(forward.required).toEqual(['schema.read', 'data.delete'])
    expect(reverse.required).toEqual(['data.delete', 'schema.read'])
    expect(forward.results.map((result) => result.id)).toEqual([...forward.required])
    expect(reverse.results.map((result) => result.id)).toEqual([...reverse.required])

    // And the properties that do hold.
    expect(forward.ok).toBe(reverse.ok)
    const verdicts = (report: typeof forward) =>
      Object.fromEntries(report.results.map((result) => [result.id, result.reason]))
    expect(verdicts(forward)).toEqual(verdicts(reverse))
  })
})
