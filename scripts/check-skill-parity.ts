// Structural parity check for the bilingual skill docs.
//
// `assets/SKILL.md` (English) is the sync source for every install target; the
// zh-TW translation must mirror its *structure* so technical content can't silently
// drift in one language only (the kind of gap that slips past prose review).
//
// Heading TEXT differs by language, so we compare language-invariant signals:
//   - the sequence of heading levels (catches missing / added / reordered sections)
//   - per-section fenced-code-block count (catches a dropped command example)
//   - per-section table-row count (catches a dropped command / workflow row)
//
// NOT covered: prose-only paragraphs and cell-internal wording. Those still need
// human translation review — this guards the cheap, deterministic structure.

const files = {
  en: 'assets/SKILL.md',
  'zh-TW': 'assets/SKILL.zh-TW.md',
} as const

type Section = { level: number; title: string; fences: number; rows: number }

function parseSections(source: string): Section[] {
  // Index 0 is the implicit pre-heading preamble.
  const sections: Section[] = [{ level: 0, title: '<preamble>', fences: 0, rows: 0 }]
  let inFence = false

  for (const line of source.split('\n')) {
    if (/^```/.test(line)) {
      if (inFence) {
        inFence = false
      } else {
        inFence = true
        sections[sections.length - 1]!.fences += 1
      }
      continue
    }
    if (inFence) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      sections.push({ level: heading[1]!.length, title: heading[2]!.trim(), fences: 0, rows: 0 })
      continue
    }

    if (/^\s*\|.*\|\s*$/.test(line)) sections[sections.length - 1]!.rows += 1
  }

  return sections
}

async function readFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`Missing skill file: ${path}`)
  return file.text()
}

const [enSrc, zhSrc] = await Promise.all([readFile(files.en), readFile(files['zh-TW'])])
const en = parseSections(enSrc)
const zh = parseSections(zhSrc)

const problems: string[] = []

if (en.length !== zh.length) {
  problems.push(
    `Section count diverges: ${files.en} has ${en.length}, ${files['zh-TW']} has ${zh.length}.`
  )
}

const max = Math.max(en.length, zh.length)
for (let i = 0; i < max; i += 1) {
  const a = en[i]
  const b = zh[i]
  const where = `section #${i} (en="${a?.title ?? '<missing>'}" zh="${b?.title ?? '<missing>'}")`

  // A missing section on either side is already reported by the count check above.
  if (!a || !b) continue

  if (a.level !== b.level) {
    problems.push(`${where}: heading level ${a.level} (en) vs ${b.level} (zh-TW).`)
    continue
  }
  if (a.fences !== b.fences) {
    problems.push(`${where}: ${a.fences} code block(s) in en vs ${b.fences} in zh-TW.`)
  }
  if (a.rows !== b.rows) {
    problems.push(`${where}: ${a.rows} table row(s) in en vs ${b.rows} in zh-TW.`)
  }
}

if (problems.length > 0) {
  console.error('✗ SKILL en/zh-TW parity check failed:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`✓ SKILL en/zh-TW structurally aligned: ${en.length} sections`)
