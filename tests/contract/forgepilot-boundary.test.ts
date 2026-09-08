import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'

const ROOT = join(import.meta.dir, '..', '..')

const readRoot = (relative: string): Promise<string> => readFile(join(ROOT, relative), 'utf8')

/**
 * The steps `make verify` ran before ForgePilot was introduced, in order.
 *
 * This is a roster, not a derivation: a check that recomputed the list from the
 * Makefile it is protecting would pass for any Makefile. Adding a step means
 * adding it here deliberately; removing one has to be argued for, which is the
 * whole point — `make verify` is the repository's verification contract, and a
 * control plane that runs it in a clean checkout must not become a reason to
 * make it say less.
 *
 * DBCLI-017 moved these steps inside a subshell so that a failing run is
 * recorded as well as a passing one. That is the argued-for change the comment
 * above demands: the roster below is unchanged, every step is still blocking,
 * and what the recipe gained is the ability to say that it stopped.
 */
const REQUIRED_STEPS = [
  'bun run services:check',
  'bun run audit',
  'bun run format:check',
  'bun run agent-core:check',
  'bun run core-stdout:check',
  'bun run typecheck',
  'bun run typecheck:tests',
  'bun run lint',
  'SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test',
  'bun run build',
  'bun run build:determinism',
  'bun run dev -- --help',
  'bun run dev -- --version',
  './dist/cli.mjs --help',
  './dist/cli.mjs --version',
  'bun run test:perf',
  'bun run platform:check',
  'bun run plugin:check',
  'bun run manifest:check',
  'bun run docs:check',
  'bun run contract:check',
  'bun run plan:check',
  'bun run forgeflow:check',
] as const

/**
 * The verification steps, read out of the `verify` recipe's subshell.
 *
 * The steps are joined by `&&`, which is what keeps every one of them blocking:
 * a step that failed cannot be followed by the next. Reading them from between
 * the subshell's parentheses means this check still fails if a step is removed,
 * reordered, or quietly made non-fatal with `;` or `|| true`.
 */
const verifyRecipe = async (): Promise<string[]> => {
  const makefile = await readRoot('Makefile')
  const lines = makefile.split('\n')
  const start = lines.findIndex((line) => line.startsWith('verify:'))
  expect(start).toBeGreaterThanOrEqual(0)

  const recipe: string[] = []
  let inSubshell = false

  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break
    const text = line.slice(1).replace(/\\$/, '').trim()

    if (!inSubshell) {
      if (text.endsWith('(')) inSubshell = true
      continue
    }
    if (text.startsWith(');')) break

    const step = text.replace(/\s*&&$/, '')
    expect(step).not.toMatch(/\|\|\s*true|^-|;\s*$/)
    if (step.length > 0 && !step.startsWith('#')) recipe.push(step)
  }

  return recipe
}

describe('make verify runs from a clean checkout', () => {
  test('installs the pinned dependency set before any step that consumes it', async () => {
    const recipe = await verifyRecipe()

    expect(recipe[0]).toBe('bun install --frozen-lockfile')
  })

  test('records the run whether it passed or failed', async () => {
    // The attestation is the reason the steps moved into a subshell. Written
    // only on the passing path it would describe the case nobody needs evidence
    // for, and the recipe must still exit with the status it captured.
    const makefile = await readRoot('Makefile')

    expect(makefile).toContain('scripts/write-attestation.ts begin')
    expect(makefile).toContain('scripts/write-attestation.ts finish $$status')
    expect(makefile).toContain('exit $$status')
  })

  test('neither attestation phase can decide the verdict', async () => {
    // A record of the run must never stand between a developer and their
    // verification result. `begin` was briefly a blocking recipe line: with an
    // unwritable output directory it failed the whole target before a single
    // step ran, which is the attestation deciding the outcome — the one thing
    // the Story forbids outright.
    const makefile = await readRoot('Makefile')

    expect(makefile).toMatch(/write-attestation\.ts begin\) \|\| run=''/)
    expect(makefile).toMatch(/write-attestation\.ts finish \$\$status \$\$run \|\| true/)
  })

  test('keeps every step it had before, in the same order', async () => {
    const recipe = await verifyRecipe()

    expect(recipe.slice(1)).toEqual([...REQUIRED_STEPS])
  })

  test('keeps its operational output out of version control', async () => {
    const ignored = await $`git check-ignore .verification/attestation.json`
      .cwd(ROOT)
      .nothrow()
      .quiet()

    expect(ignored.exitCode).toBe(0)
  })
})

describe('the verification attestation is repository tooling, not product', () => {
  test('no shipped source reaches into the writer', async () => {
    // The attestation records this repository's engineering process. A product
    // file importing it would put a process concern behind a published schema
    // version, which is the reason it is not an evidence receipt. ADR-0026.
    const sources = await readdir(join(ROOT, 'src'), { recursive: true, withFileTypes: true })

    const offenders: string[] = []
    for (const entry of sources) {
      if (!entry.isFile()) continue
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(entry.name)) continue
      const path = join(entry.parentPath, entry.name)
      const source = await readFile(path, 'utf8')
      if (/verification-attestation|write-attestation/.test(source)) {
        offenders.push(path.slice(ROOT.length + 1))
      }
    }

    expect(offenders).toEqual([])
  })

  test('the published package does not carry it', async () => {
    const manifest = JSON.parse(await readRoot('package.json')) as { files?: string[] }
    const published = manifest.files ?? []

    // One `scripts/` entry is published on purpose: the postinstall Bun check.
    expect(published.filter((entry) => entry.startsWith('scripts/'))).toEqual([
      'scripts/postinstall-check-bun.mjs',
    ])
    expect(published.filter((entry) => entry.includes('.verification'))).toEqual([])
  })
})

describe('ForgePilot is an operator tool, not a dependency', () => {
  test('is absent from the package manifest', async () => {
    const manifest = JSON.parse(await readRoot('package.json')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }

    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]

    expect(declared.filter((name) => name.toLowerCase().includes('forgepilot'))).toEqual([])
  })

  test('is never referenced by shipped source', async () => {
    const sources = await readdir(join(ROOT, 'src'), { recursive: true, withFileTypes: true })

    const offenders: string[] = []
    for (const entry of sources) {
      if (!entry.isFile()) continue
      if (!/\.(ts|tsx|mts|cts|js|mjs|cjs|json)$/.test(entry.name)) continue
      const path = join(entry.parentPath, entry.name)
      if ((await readFile(path, 'utf8')).toLowerCase().includes('forgepilot')) {
        offenders.push(path.slice(ROOT.length + 1))
      }
    }

    expect(offenders).toEqual([])
  })

  test('keeps its operational state out of version control', async () => {
    // Ask Git, not `.gitignore`. The line being present is not the property that
    // matters — any later negation pattern overrides it — and the acceptance
    // criterion names `git check-ignore` for that reason. Exit 0 means ignored.
    const checked = await $`git check-ignore .forgepilot/state.json`.cwd(ROOT).nothrow().quiet()

    expect(checked.exitCode).toBe(0)
  })
})
