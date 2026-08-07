// Parity gate for the bilingual skill docs.
//
// The comparison itself lives in ./lib/skill-parity.ts (unit-tested against the
// drift shapes this is meant to catch). This file is the CLI wrapper.

import { compareSkillDocs, parseSections } from './lib/skill-parity'

const files = {
  en: 'assets/SKILL.md',
  'zh-TW': 'assets/SKILL.zh-TW.md',
} as const

async function readFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`Missing skill file: ${path}`)
  return file.text()
}

const [enSrc, zhSrc] = await Promise.all([readFile(files.en), readFile(files['zh-TW'])])
const problems = compareSkillDocs(enSrc, zhSrc)

if (problems.length > 0) {
  console.error('✗ SKILL en/zh-TW parity check failed:')
  for (const problem of problems) console.error(`  - ${problem.replace(/\ben\b/, files.en)}`)
  console.error(
    '\n  Fix the translation rather than the check: a flag, command, or field name' +
      '\n  must read the same in both languages, and a dropped bullet is a dropped rule.'
  )
  process.exit(1)
}

const sections = parseSections(enSrc)
const tokens = new Set(sections.flatMap((section) => [...section.tokens.keys()]))
console.log(
  `✓ SKILL en/zh-TW aligned: ${sections.length} sections, ${tokens.size} code tokens matched per section` +
    ' (structure, list items, and token counts — prose still needs human review)'
)
