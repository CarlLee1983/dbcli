/**
 * Content contract: the zh-TW skill must not drift from the English one.
 *
 * The structural signals (heading levels, fence counts, table rows) miss the way
 * drift actually happened: a dropped paragraph, a dropped bullet, a table cell
 * translated with the flag or field name removed. Those keep the shape intact.
 *
 * The cases below are the six real drifts found in the 2026-08-07 audit, reduced
 * to their minimal shape. Each one must be reported.
 */

import { describe, expect, test } from 'bun:test'
import { compareSkillDocs } from '../../../scripts/lib/skill-parity'

const doc = (body: string) => `# Title\n\n${body}\n`

describe('compareSkillDocs', () => {
  test('reports nothing when the docs carry the same code tokens and list items', () => {
    const en = doc('- Use `--dry-run` before a write.\n- `$out` needs `data-admin`.')
    const zh = doc('- 寫入前先用 `--dry-run`。\n- `$out` 需要 `data-admin`。')

    expect(compareSkillDocs(en, zh)).toEqual([])
  })

  test('detects a dropped paragraph whose only invariant content is backticked', () => {
    const en = doc('Tiers judge intent: `$out` / `$merge` need `data-admin`.')
    const zh = doc('權限層判斷意圖。')

    const problems = compareSkillDocs(en, zh)
    expect(problems.join('\n')).toContain('$out')
  })

  test('detects a flag that survives in one language only', () => {
    const en = doc('| `query` | `--slow-ms <n>` sets the hint threshold. |')
    const zh = doc('| `query` | 設定提示門檻。 |')

    expect(compareSkillDocs(en, zh).join('\n')).toContain('--slow-ms')
  })

  test('detects a dropped bullet even when the token also appears elsewhere', () => {
    const en = doc('- `uri` wins silently.\n- Percent-encode the password.')
    const zh = doc('- 密碼要 percent-encode。')

    expect(compareSkillDocs(en, zh).join('\n')).toContain('list item')
  })

  test('detects a field name translated away inside a table cell', () => {
    const en = doc('| `inspect` | Snapshot with `suggestedCommands`. |')
    const zh = doc('| `inspect` | 唯讀快照，含建議指令。 |')

    expect(compareSkillDocs(en, zh).join('\n')).toContain('suggestedCommands')
  })

  test('counts occurrences, not mere presence', () => {
    const en = doc('Run `--verify` first, then `--verify` again.')
    const zh = doc('先跑 `--verify`。')

    expect(compareSkillDocs(en, zh).join('\n')).toContain('--verify')
  })

  test('ignores fenced code blocks, which are shared verbatim', () => {
    const en = doc('```bash\ndbcli query --slow-ms 250\n```')
    const zh = doc('```bash\ndbcli query --slow-ms 250\n```')

    expect(compareSkillDocs(en, zh)).toEqual([])
  })

  test('the shipped skill docs are aligned', async () => {
    const [en, zh] = await Promise.all([
      Bun.file('assets/SKILL.md').text(),
      Bun.file('assets/SKILL.zh-TW.md').text(),
    ])

    expect(compareSkillDocs(en, zh)).toEqual([])
  })
})
