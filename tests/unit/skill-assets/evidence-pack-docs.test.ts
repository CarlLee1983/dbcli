import { describe, expect, test } from 'bun:test'
import { collapseCjkWraps, docKeySection, readDocSource, stripMarkup } from './doc-section'

/**
 * A pack is an index of references and externally supplied claims. It is not a
 * verdict, it copies no source evidence, and a legacy pack is never quietly
 * upgraded. Every published surface has to say so.
 *
 * Matching is scoped to the `evidence-packs` topic marker, which both the
 * Markdown and the HTML carry, so an unrelated section cannot satisfy a claim.
 */
async function evidencePackSection(path: string): Promise<string> {
  const section = docKeySection(await readDocSource(path), 'evidence-packs')
  expect(section).not.toBeNull()

  return collapseCjkWraps(
    stripMarkup(section ?? '')
      // Emphasis and code markers vanish without leaving a space behind, so
      // `**not**` between CJK characters does not split the sentence.
      .replace(/[`*]/g, '')
  )
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const en = [
  'they are not dbcli verification verdicts',
  'does not copy sql, targets, audit metadata, verification summaries, or credentials',
  'source-expired',
  'there is no migration',
  'never treated as current-valid',
  'without rereading',
] as const

const zhTW = [
  '不是 dbcli 的驗證裁決',
  '不會把 sql、target、audit metadata、verification summary 或憑證複製進包內',
  'source-expired',
  '沒有 migration',
  '永遠不會被當成 current-valid',
  '不重讀原始參照',
] as const

const surfaces = [
  ['docs/user/en/index.md', en],
  ['docs/user/en/index.html', en],
  ['docs/user/zh-TW/index.md', zhTW],
  ['docs/user/zh-TW/index.html', zhTW],
] as const

describe('evidence pack documentation contract', () => {
  test.each(surfaces)('%s describes a pack as an index, not a verdict', async (path, claims) => {
    const section = await evidencePackSection(path)
    for (const claim of claims) {
      expect(section).toContain(claim)
    }
  })
})
