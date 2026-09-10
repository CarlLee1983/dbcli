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
 *
 * DBCLI-030 removed the grouping and gave each step a `step=` marker naming it.
 * The grouping never made the chain stop — `&&` does, and `make` stops at a
 * failing line, which is why the steps are one line — but it did discard the
 * variable holding the running step's name, so every FAIL attestation said only
 * that something failed. The roster below is again unchanged; what the recipe
 * gained is the ability to say *which* step stopped it. ADR-0033.
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
 * Everything the `verify` recipe says that is not a verification step.
 *
 * Pinned literally, because a roster that only reads the steps polices the
 * least interesting half of the recipe. A review of the first version found six
 * shapes that kept this check green while gutting the gate: a `-` prefix on the
 * line carrying the subshell (make ignores the error, `make verify` exits 0
 * with a failing step), `exit 0` in place of `exit $$status`, a step smuggled
 * onto the opening line or appended after the closing paren, and a second
 * `verify:` target further down that make would run instead. Each of them
 * changes one of these lines, so each of them now fails.
 */
const PROLOGUE = ["@run=$$(bun run scripts/write-attestation.ts begin) || run='';"] as const

const EPILOGUE = [
  'status=$$?;',
  'bun run scripts/write-attestation.ts finish $$status $$run "$$step" || true;',
  'exit $$status',
] as const

interface Recipe {
  readonly prologue: readonly string[]
  readonly steps: readonly string[]
  readonly epilogue: readonly string[]
}

/**
 * Read the `verify` recipe, split into its scaffolding and its steps.
 *
 * The steps are joined by `&&`, which is what keeps every one of them blocking:
 * a step that failed cannot be followed by the next. Nothing is discarded — a
 * line that is neither prologue, step, nor epilogue has nowhere to hide, which
 * is the property the earlier version lacked.
 */
const parseVerifyRecipe = (makefile: string): Recipe => {
  // Line endings are the checkout's, not the recipe's. A CRLF checkout makes
  // every literal comparison below compare against a trailing `\r`.
  const lines = makefile.replace(/\r\n/g, '\n').split('\n')

  // Make runs the *last* definition of a target; this check would otherwise
  // read the first and report on a recipe that never executes.
  expect(lines.filter((line) => line.startsWith('verify:'))).toHaveLength(1)

  // An `include` brings in definitions this file cannot see, and a later one
  // replaces the target outright — reproduced: make ran the included recipe and
  // exited 0 while all five scaffolding lines here still matched.
  expect(lines.filter((line) => /^[-\s]*include\s/.test(line))).toEqual([])

  // The target line itself, not just its prefix. `verify: sneak` runs `sneak`
  // before the recipe, and nothing below would look at it.
  expect(lines.filter((line) => line.startsWith('verify:'))[0]).toBe('verify:')

  const start = lines.findIndex((line) => line.startsWith('verify:'))
  const recipe: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break
    const text = line.slice(1).replace(/\\$/, '').trim()
    if (text.length > 0 && !text.startsWith('#')) recipe.push(text)
  }

  const opening = recipe.findIndex((line) => line.startsWith('step='))
  const closing = recipe.findIndex((line) => line.startsWith('status='))
  expect(opening).toBeGreaterThanOrEqual(0)
  expect(closing).toBeGreaterThan(opening)

  // Each step line is `step='<name>' && <command>`, and the two halves are
  // compared. A step whose marker names a different command would put the wrong
  // step in a FAIL attestation, which is worse than the field not existing: it
  // sends the reader to a step that ran fine.
  //
  // Every line but the last ends in `&&`, which is what keeps it blocking; the
  // last ends the chain with `;` so that `status=$?` runs whatever happened.
  // That one `;` is the only one allowed anywhere in the steps — chaining a
  // second command onto a step with `;` would run it unconditionally and hide
  // its status, which is the shape this roster exists to refuse.
  const stepLines = recipe.slice(opening, closing)
  const steps = stepLines.map((line, index) => {
    const last = index === stepLines.length - 1
    expect(line).not.toMatch(/\|\|\s*true|^-/)
    expect(line.endsWith(last ? ';' : '&&')).toBe(true)

    const body = line.replace(last ? /;$/ : /\s*&&$/, '').trim()
    expect(body).not.toContain(';')

    const marked = body.match(/^step='([^']*)' && (.+)$/)
    expect(marked, `step line is not marked: ${JSON.stringify(line)}`).not.toBeNull()
    expect(marked![1]).toBe(marked![2] as string)
    return marked![2] as string
  })

  return { prologue: recipe.slice(0, opening), steps, epilogue: recipe.slice(closing) }
}

const verifyRecipe = async (): Promise<Recipe> => parseVerifyRecipe(await readRoot('Makefile'))

describe('make verify runs from a clean checkout', () => {
  test('installs the pinned dependency set before any step that consumes it', async () => {
    const { steps } = await verifyRecipe()

    expect(steps[0]).toBe('bun install --frozen-lockfile')
  })

  test('records the run whether it passed or failed, and neither phase decides it', async () => {
    // The attestation is the reason the steps moved into a subshell: written
    // only on the passing path it would describe the case nobody needs evidence
    // for. And a record of a run must never stand between a developer and their
    // result — `begin` was briefly a blocking recipe line, so an unwritable
    // output directory failed the whole target before a single step ran.
    //
    // Both properties live in these five lines, compared literally. Asserting
    // `toContain` over the whole file was satisfied by a comment.
    const { prologue, epilogue } = await verifyRecipe()

    expect(prologue).toEqual([...PROLOGUE])
    expect(epilogue).toEqual([...EPILOGUE])
  })

  test('reads the same recipe however the checkout terminated its lines', async () => {
    // GitHub's windows runner checks out with core.autocrlf=true and this
    // repository pins no .gitattributes, so the Makefile arrives as CRLF. Every
    // comparison in the parser is literal, and `verify:\r` starts with
    // `verify:` without being equal to it: three tests here failed on
    // windows-latest and on no other runner. The recipe's contract is its
    // lines, never how a checkout chose to end them — asserted here because the
    // platform that breaks it is the one nobody runs locally.
    const makefile = await readRoot('Makefile')

    expect(parseVerifyRecipe(makefile.replace(/\r?\n/g, '\r\n'))).toEqual(
      parseVerifyRecipe(makefile)
    )
  })

  test('stays POSIX, because make runs /bin/sh and CI runs dash', async () => {
    // `set -o pipefail` is not POSIX. On ubuntu-latest — the only runner where
    // `make verify` runs — dash answers `set: Illegal option -o pipefail` and
    // aborts the recipe line before any step, which reads as a verification
    // failure. Verified against `ubuntu:24.04`, exit 2.
    const makefile = await readRoot('Makefile')
    const recipeText = makefile.slice(makefile.indexOf('verify:'))

    expect(recipeText).not.toContain('pipefail')
  })

  test('keeps every step it had before, in the same order', async () => {
    const { steps } = await verifyRecipe()

    expect(steps.slice(1)).toEqual([...REQUIRED_STEPS])
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

  test('no test can forge the artifact', async () => {
    // A test that spawned the writer left a hash-valid PASS attestation for
    // whatever HEAD was, produced by no verification at all — and `bun run test`
    // is step 10 of 24, with the CI upload running `if: always()`. A job killed
    // after step 10 would have published it. The environment read is a function
    // over an argument for exactly this reason: the property is testable
    // without anything running the writer.
    const suites = await readdir(join(ROOT, 'tests'), { recursive: true, withFileTypes: true })

    // Naming the writer is fine — this file pins the Makefile lines that call
    // it. Running it is not, so what is looked for is a spawn: the mention with
    // a process-starting call close enough above it to be the thing starting it.
    // Assembled rather than written out, because a check for its own text finds
    // itself: the previous version's regex literal was the only match.
    const writer = ['write', 'attestation'].join('-')
    const RUNS = new RegExp(
      `(?:spawnSync|spawn|execFileSync|execSync|exec)\\b[\\s\\S]{0,400}?${writer}`
    )

    const offenders: string[] = []
    for (const entry of suites) {
      if (!entry.isFile() || !/\.ts$/.test(entry.name)) continue
      const path = join(entry.parentPath, entry.name)
      // Comments are stripped first, or this file's own explanation of what it
      // looks for would be the thing it finds.
      const source = (await readFile(path, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      if (RUNS.test(source) || new RegExp(`\\$\`[^\`]*${writer}`).test(source)) {
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
