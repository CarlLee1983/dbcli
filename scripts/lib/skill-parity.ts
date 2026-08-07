// Parity signals for the bilingual skill docs.
//
// `assets/SKILL.md` (English) is the sync source for every install target; the
// zh-TW translation must carry the same technical content. Heading TEXT and prose
// differ by language, so parity is measured on language-invariant signals only:
//
//   - the sequence of heading levels (missing / added / reordered sections)
//   - per-section fenced-code-block and table-row counts (a dropped example or row)
//   - per-section list-item counts (a dropped bullet inside an intact section)
//   - per-section counts of every code-ish backticked token (a flag, command, or
//     field name that was translated away, kept in one language only, or lost one
//     of several occurrences)
//
// The token signal is what catches real drift: a translator writing 「建議指令」
// where the English says `suggestedCommands` leaves every structural count intact
// but costs the agent the actual field name.
//
// Fenced code blocks are excluded — they are shared verbatim between languages, so
// comparing them would only re-report differences the fence count already covers.

/** A word worth comparing: a flag, command, path, field, or operator. */
const CODE_TOKEN = /^--?[a-z][a-z0-9-]*$|^[$@]?[A-Za-z_$][A-Za-z0-9_.:$/-]*$/

export interface SkillSection {
  level: number
  title: string
  fences: number
  rows: number
  items: number
  tokens: Map<string, number>
}

const newSection = (level: number, title: string): SkillSection => ({
  level,
  title,
  fences: 0,
  rows: 0,
  items: 0,
  tokens: new Map(),
})

const current = (sections: SkillSection[]): SkillSection => sections[sections.length - 1]!

export function parseSections(source: string): SkillSection[] {
  // Index 0 is the implicit pre-heading preamble.
  const sections: SkillSection[] = [newSection(0, '<preamble>')]
  let inFence = false

  for (const line of source.split('\n')) {
    if (/^```/.test(line)) {
      if (inFence) {
        inFence = false
      } else {
        inFence = true
        current(sections).fences += 1
      }
      continue
    }
    if (inFence) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      sections.push(newSection(heading[1]!.length, heading[2]!.trim()))
      continue
    }

    const section = current(sections)
    if (/^\s*\|.*\|\s*$/.test(line)) section.rows += 1
    if (/^\s*([-*]\s|\d+\.\s)/.test(line)) section.items += 1

    for (const match of line.matchAll(/`([^`]+)`/g)) {
      // A span can hold a whole command (`dbcli q @name --dry-run`) or a flag with
      // a placeholder (`--slow-ms <n>`), so compare the words inside it, not the
      // span as a whole — placeholders and prose words fall out on their own.
      for (const word of match[1]!.split(/\s+/)) {
        const token = word.trim()
        if (!token || !CODE_TOKEN.test(token)) continue
        section.tokens.set(token, (section.tokens.get(token) ?? 0) + 1)
      }
    }
  }

  return sections
}

export function compareSkillDocs(enSource: string, zhSource: string): string[] {
  const en = parseSections(enSource)
  const zh = parseSections(zhSource)
  const problems: string[] = []

  if (en.length !== zh.length) {
    problems.push(`Section count diverges: en has ${en.length}, zh-TW has ${zh.length}.`)
  }

  for (let i = 0; i < Math.max(en.length, zh.length); i += 1) {
    const a = en[i]
    const b = zh[i]
    // A missing section on either side is already reported by the count check.
    if (!a || !b) continue

    const where = `section #${i} (en="${a.title}" zh="${b.title}")`

    if (a.level !== b.level) {
      // Levels diverging means the sections no longer line up; comparing their
      // contents would produce noise on every later section.
      problems.push(`${where}: heading level ${a.level} (en) vs ${b.level} (zh-TW).`)
      continue
    }
    if (a.fences !== b.fences) {
      problems.push(`${where}: ${a.fences} code block(s) in en vs ${b.fences} in zh-TW.`)
    }
    if (a.rows !== b.rows) {
      problems.push(`${where}: ${a.rows} table row(s) in en vs ${b.rows} in zh-TW.`)
    }
    if (a.items !== b.items) {
      problems.push(`${where}: ${a.items} list item(s) in en vs ${b.items} in zh-TW.`)
    }

    for (const token of new Set([...a.tokens.keys(), ...b.tokens.keys()])) {
      const inEn = a.tokens.get(token) ?? 0
      const inZh = b.tokens.get(token) ?? 0
      if (inEn !== inZh) {
        problems.push(`${where}: \`${token}\` appears ${inEn}× in en vs ${inZh}× in zh-TW.`)
      }
    }
  }

  return problems
}
