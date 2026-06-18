// Cross-surface parity check for the supported install-platform roster.
//
// `SUPPORTED_PLATFORMS` (src/commands/skill.ts) is the single source of truth for
// which `dbcli skill --install <platform>` targets exist. The same list is
// re-typed by hand in several user-facing surfaces (README, SKILL.md, the zh-TW
// translation, reference.md, and the CLI option description). They drift silently
// — e.g. `codex`/`windsurf` shipped in code but were missing from SKILL.md.
//
// This guards the cheap, deterministic part: every surface that enumerates the
// install platforms must list EXACTLY the canonical set — no missing, no extra.
// It does not police prose mentions, only the explicit enumerations below.

import { SUPPORTED_PLATFORMS } from '../src/commands/skill'

const canonical = new Set<string>(SUPPORTED_PLATFORMS)

type Check = {
  file: string
  label: string
  /** Pull the enumerated platform tokens out of a surface; null = anchor not found. */
  extract: (src: string) => string[] | null
}

/** Tokens that look like platforms but aren't real targets, stripped before compare. */
const NOISE = new Set(['platform'])

function clean(tokens: string[]): string[] {
  return tokens
    .map((t) => t.replace(/[\\`]/g, '').trim().toLowerCase())
    .filter((t) => t.length > 0 && !NOISE.has(t))
}

/** The `--install <a\|b\|c>` pipe enumeration used in the SKILL tables. */
function pipeList(src: string): string[] | null {
  const m = /--install <(claude[^>]*)>/.exec(src)
  if (!m) return null
  return clean(m[1]!.split('|'))
}

const checks: Check[] = [
  { file: 'assets/SKILL.md', label: 'SKILL --install pipe list', extract: pipeList },
  { file: 'assets/SKILL.zh-TW.md', label: 'SKILL.zh-TW --install pipe list', extract: pipeList },
  {
    file: 'README.md',
    label: 'README skill --install usage block',
    extract: (src) => {
      const matches = [...src.matchAll(/skill --install (\w+)/g)].map((m) => m[1]!)
      return matches.length > 0 ? clean(matches) : null
    },
  },
  {
    file: 'assets/reference.md',
    label: 'reference.md --install option enumeration',
    extract: (src) => {
      // `- \`--install <platform>\` — \`claude\` | \`gemini\` | ... .`
      const line = src.split('\n').find((l) => /`--install <platform>`/.test(l))
      if (!line) return null
      const after = line.split('—')[1] ?? line
      const tokens = [...after.matchAll(/`([\w-]+)`/g)].map((m) => m[1]!)
      return tokens.length > 0 ? clean(tokens) : null
    },
  },
  {
    file: 'src/commands/skill.ts',
    label: 'CLI --install option description',
    extract: (src) => {
      // .option('--install <platform>', 'Install to platform directory (claude, gemini, ...)')
      const m = /Install to platform directory \(([^)]+)\)/.exec(src)
      if (!m) return null
      return clean(m[1]!.split(','))
    },
  },
]

async function readFile(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`Missing file: ${path}`)
  return file.text()
}

const problems: string[] = []

for (const check of checks) {
  const src = await readFile(check.file)
  const found = check.extract(src)
  if (found === null) {
    problems.push(`${check.file}: could not locate the ${check.label} (anchor changed?).`)
    continue
  }
  const foundSet = new Set(found)
  const missing = [...canonical].filter((p) => !foundSet.has(p))
  const extra = [...foundSet].filter((p) => !canonical.has(p))
  if (missing.length > 0) {
    problems.push(`${check.file} (${check.label}): missing platform(s): ${missing.join(', ')}.`)
  }
  if (extra.length > 0) {
    problems.push(`${check.file} (${check.label}): unknown platform(s): ${extra.join(', ')}.`)
  }
}

if (problems.length > 0) {
  console.error('✗ Platform roster parity check failed:')
  for (const p of problems) console.error(`  - ${p}`)
  console.error(`  Source of truth: SUPPORTED_PLATFORMS = [${[...canonical].join(', ')}]`)
  process.exit(1)
}

console.log(
  `✓ Platform roster aligned across ${checks.length} surfaces: ${[...canonical].join(', ')}`
)
