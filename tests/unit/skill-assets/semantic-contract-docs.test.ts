import { describe, expect, test } from 'bun:test'

/**
 * A contract is a reviewed local definition, not an executable rule and not a
 * database capability. Every published surface has to state the same offline
 * and read-only boundary, the same approval filtering, the same absent and
 * invalid behavior, and the same bounded-diagnostics guarantee.
 *
 * Matching is scoped to the `advanced-tools` topic marker, which both the
 * Markdown and the HTML carry, so an unrelated section cannot satisfy a claim.
 */
async function advancedToolsSection(path: string): Promise<string> {
  // Windows checks out CRLF, so line endings are not part of what these
  // claims assert. Normalize before any `\n`-shaped matching below.
  const raw = (await Bun.file(path).text()).replace(/\r\n/g, '\n')
  const marker = '<!-- doc-key: advanced-tools -->'
  const start = raw.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = raw.indexOf('<!-- doc-key:', start + marker.length)
  expect(end).toBeGreaterThan(start)

  return (
    raw
      .slice(start, end)
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      // Emphasis and code markers vanish without leaving a space behind, so
      // `**not**` between CJK characters does not split the sentence.
      .replace(/[`*]/g, '')
      // Markdown hard-wraps mid-sentence. A newline between two CJK characters
      // is that wrap and nothing else, so it disappears; every other newline
      // collapses to a space below, which is what a wrap between CJK and a
      // Latin word stood for.
      .replace(
        /([\u3000-\u303f\u3400-\u9fff\uff00-\uffef])\n\s*(?=[\u3000-\u303f\u3400-\u9fff\uff00-\uffef])/g,
        '$1'
      )
      // Only a newline is a wrap. Matching any whitespace after the collapse
      // above would also join two sentences across a full stop, letting a claim
      // span text the document never wrote as one statement.
      .replace(/([、。，；：！？])\n[ \t]*/g, '$1')
      .replace(/\s+/g, ' ')
      .toLowerCase()
  )
}

const en = [
  'these commands never connect or execute queries',
  'expose only valid approved contracts; draft and deprecated terms remain local review artifacts',
  'a missing contract file leaves ordinary semantic context unchanged, while an explicitly requested missing or invalid file fails closed',
  'a subject that is not one of the four canonical forms is invalid, while a well-formed subject that no longer exists is stale',
  'never a rejected key, value, or local path taken from the artifact or the local configuration',
  'it cannot contain sql, credentials, protected identifiers, or executable rules',
] as const

const zhTW = [
  '這些指令不會連線或執行查詢',
  '只會輸出有效且 approved 的契約；draft 與 deprecated 術語保留為本機審閱產物',
  '缺少契約檔不會改變一般 semantic context；但明確指定的缺檔或無效檔案會 fail closed',
  'subject 不屬於四種 canonical 形式時判為 invalid，形式正確但已不存在的 subject 才是 stale',
  '不會複述產物或本機設定中被拒絕的 key、值或路徑',
  '不得包含 sql、憑證、受保護識別字或可執行規則',
] as const

const surfaces = [
  ['docs/user/en/index.md', en],
  ['docs/user/en/index.html', en],
  ['docs/user/zh-TW/index.md', zhTW],
  ['docs/user/zh-TW/index.html', zhTW],
] as const

describe('semantic contract documentation contract', () => {
  test.each(surfaces)(
    '%s states the offline, approval, and bounded-diagnostics boundary',
    async (path, claims) => {
      const section = await advancedToolsSection(path)
      for (const claim of claims) {
        expect(section).toContain(claim)
      }
    }
  )
})
