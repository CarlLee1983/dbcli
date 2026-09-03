import { describe, expect, test } from 'bun:test'

/**
 * A receipt is provenance, never approval, and it cannot exist before the
 * verification result is authoritative. Those are the claims a reader acts on,
 * so every published surface has to carry them.
 *
 * Matching is scoped to the receipt topic and each claim is a whole sentence
 * from that document: a bare keyword like "preflight" occurs dozens of times
 * across these files and would let an unrelated section satisfy the check.
 * Markdown and HTML word the same claim differently, hence one list per surface.
 */
async function receiptSection(path: string): Promise<string> {
  // Windows checks out CRLF, so line endings are not part of what these
  // claims assert. Normalize before any `\n`-shaped matching below.
  const raw = (await Bun.file(path).text()).replace(/\r\n/g, '\n')
  const text = raw
    // Tags go before entities, so `&lt;path&gt;` cannot decode into something
    // the tag pass then deletes. A claim must therefore not contain a
    // `<placeholder>`: Markdown writes those literally and this pass eats them.
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    // Strip emphasis and code markers without inserting a space: `**not**`
    // between CJK characters would otherwise leave one behind.
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    // Markdown wraps these tokens in backticks and HTML in <code>, so the two
    // documents differ only by spacing around this punctuation.
    .replace(/\s*([()/（），、；])\s*/g, '$1')
    .toLowerCase()

  const start = text.indexOf('--write-verification-artifact')
  expect(start).toBeGreaterThanOrEqual(0)
  // The next topic heading, in either language.
  const end = text.slice(start).search(/html (?:dashboards|儀表板)/)
  expect(end).toBeGreaterThan(0)
  return text.slice(start, start + end)
}

const zhTW = [
  '永不執行寫入或 ddl',
  '它只記錄 provenance，不代表核准執行',
  '預檢模式沒有已執行的結果文物，因此不支援 receipt',
  'receipt outcome（succeeded/failed）與情境 status',
  'task-pack 的 planned evidence 仍僅限計畫',
  'provenance 不是執行核准',
] as const

const surfaces = [
  {
    path: 'docs/user/en/index.md',
    claims: [
      'never executes writes/ddl',
      'it records provenance only and is not execution approval',
      'it is unavailable in preflight mode, which has no executed result artifact',
      'the receipt outcome(succeeded/failed)is separate from the scenario status',
      'task-pack planned evidence remains plan-only',
      'provenance is not execution approval',
    ],
  },
  {
    path: 'docs/user/en/index.html',
    claims: [
      'never executes writes/ddl',
      'it is provenance only, not execution approval',
      'preflight has no executed artifact and does not support a receipt',
      'receipt outcome(succeeded/failed)stays separate from scenario status',
      'task-pack planned evidence remains plan-only',
      'provenance is not execution approval',
    ],
  },
  { path: 'docs/user/zh-TW/index.md', claims: zhTW },
  { path: 'docs/user/zh-TW/index.html', claims: zhTW },
] as const

describe('verification receipt documentation contract', () => {
  test.each(surfaces.map((surface) => [surface.path, surface.claims] as const))(
    '%s states that a receipt is provenance, not approval',
    async (path, claims) => {
      const section = await receiptSection(path)
      for (const claim of claims) {
        expect(section).toContain(claim)
      }
      // The label counted the flags and went stale when a fourth was added.
      expect(section).not.toContain('trio')
      expect(section).not.toContain('三件組')
    }
  )

  test.each(['docs/user/en/index.md', 'docs/user/zh-TW/index.md'])(
    '%s keeps the receipt flag table contiguous',
    async (path) => {
      const raw = (await Bun.file(path).text()).replace(/\r\n/g, '\n')
      const header = raw.indexOf(
        '| :--- | :--- | :--- |',
        raw.indexOf('--write-verification-artifact')
      )
      expect(header).toBeGreaterThan(0)
      // A stray paragraph between rows silently splits this into two tables.
      const block = raw.slice(header, raw.indexOf('\n\n', header))
      for (const flag of [
        '--write-verification-artifact',
        '--evidence-receipt',
        '--verification-subject',
        '--verification-summary',
      ]) {
        expect(block).toContain(flag)
      }
      expect(block.split('\n').every((line) => line.startsWith('|'))).toBe(true)
    }
  )
})
