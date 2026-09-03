import { describe, expect, test } from 'bun:test'

/**
 * The impact assessment is incomplete by design, and that is the claim a
 * reviewer most needs before treating a report as evidence. Markdown carried it
 * while the polished HTML did not, so every surface is pinned here rather than
 * only the two that happened to be written first.
 *
 * Claims are matched against tag-free, whitespace-collapsed text so one list
 * covers a language's Markdown and HTML without encoding either's line breaks.
 */
async function impactSection(path: string): Promise<string> {
  // Windows checks out CRLF, so line endings are not part of what these
  // claims assert. Normalize before any `\n`-shaped matching below.
  const raw = (await Bun.file(path).text()).replace(/\r\n/g, '\n')
  // Scope to the impact topic: some claims recur elsewhere in these documents,
  // and a whole-file match would let an unrelated section satisfy them.
  const start = raw.indexOf('dbcli impact assess')
  expect(start).toBeGreaterThanOrEqual(0)
  const end = raw.indexOf('safe-backfill-verify', start)
  expect(end).toBeGreaterThan(start)

  return raw
    .slice(start, end)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[`\s]+/g, ' ')
}

const claims = {
  en: [
    'Choose exactly one baseline',
    'dbcli.data-access.json',
    'never reads or parses those source files',
    'redaction-first projection',
    'cannot by itself make --fail-on warn fail',
    'v1 never reports complete coverage',
    'changes only the exit code',
    'protected identifiers',
  ],
  'zh-TW': [
    '必須剛好選一種 baseline',
    'dbcli.data-access.json',
    '絕不讀取或解析那些 source file',
    'redaction-first 投影',
    '不會使 --fail-on warn 失敗',
    'v1 永不回報 complete',
    '只在報告寫出後改變 exit code',
    '受保護識別字',
  ],
} as const

const surfaces = [
  ['docs/user/en/index.md', claims.en],
  ['docs/user/en/index.html', claims.en],
  ['docs/user/zh-TW/index.md', claims['zh-TW']],
  ['docs/user/zh-TW/index.html', claims['zh-TW']],
] as const

describe('impact assessment documentation contract', () => {
  test.each(surfaces)(
    '%s describes the assessment as offline and incomplete by design',
    async (path, expected) => {
      const text = await impactSection(path)
      for (const claim of expected) {
        expect(text).toContain(claim)
      }
    }
  )
})
