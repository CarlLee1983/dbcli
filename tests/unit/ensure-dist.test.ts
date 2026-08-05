import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import {
  BUILD_INPUTS,
  BUILD_OUTPUTS,
  BUILD_STAMP,
  buildFailure,
  isDistFresh,
} from '../helpers/ensure-dist'

// The freshness predicate is what lets CI skip a duplicate `bun run build` inside
// test hooks, so its failure mode has to be "rebuild anyway", never "silently test
// a stale artifact". The fixtures below spell out paths literally rather than
// deriving them from BUILD_INPUTS/BUILD_OUTPUTS — a fixture built from the lists
// under test cannot fail when the lists are the thing that is wrong.

const ROOT = resolve(import.meta.dir, '..', '..')

const BUILD_STARTED_S = 1_700_000_001
const BEFORE_BUILD_S = 1_700_000_000
const AFTER_BUILD_S = 1_700_000_002

const SOURCE_FILES = [
  'src/cli.ts',
  'src/deep/nested/mod.ts',
  'scripts/build.ts',
  'tsconfig.json',
  'package.json',
  'bun.lock',
  'bunfig.toml',
]

const ARTIFACTS = [
  'dist/cli.mjs',
  'dist/core.mjs',
  'dist/core.d.ts',
  'dist/agent-core.mjs',
  'dist/agent-core.d.ts',
  'dist/ui-style.css',
  'assets/ui-template.html',
]

function write(path: string, content: string, epochSeconds: number): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  utimesSync(path, epochSeconds, epochSeconds)
}

/**
 * Directory mtimes count as inputs — adding or deleting a source file moves them
 * and nothing else — so a fixture that leaves them at "now" reads as stale for the
 * wrong reason. Age them to match the files they hold.
 */
function ageDirectories(dir: string, epochSeconds: number): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) ageDirectories(join(dir, entry.name), epochSeconds)
  }
  utimesSync(dir, epochSeconds, epochSeconds)
}

describe('isDistFresh', () => {
  let root = ''

  function writeStamp(overrides: Record<string, unknown> = {}): void {
    const outputs: Record<string, string> = {}
    for (const rel of ARTIFACTS) {
      outputs[rel] = Bun.hash(readFileSync(join(root, rel))).toString(16)
    }
    writeFileSync(
      join(root, BUILD_STAMP),
      JSON.stringify({
        startedAt: BUILD_STARTED_S * 1000,
        bunVersion: Bun.version,
        outputs,
        ...overrides,
      })
    )
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dbcli-ensure-dist-'))
    for (const rel of [...SOURCE_FILES, ...ARTIFACTS]) {
      write(join(root, rel), `content of ${rel}`, BEFORE_BUILD_S)
    }
    writeStamp()
    ageDirectories(root, BEFORE_BUILD_S)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('a completed build newer than every input is fresh', () => {
    expect(isDistFresh(root)).toBe(true)
  })

  for (const rel of SOURCE_FILES) {
    test(`editing ${rel} after the build makes dist stale`, () => {
      write(join(root, rel), 'edited', AFTER_BUILD_S)
      expect(isDistFresh(root)).toBe(false)
    })
  }

  for (const rel of ARTIFACTS) {
    test(`a build that never wrote ${rel} is stale`, () => {
      rmSync(join(root, rel))
      expect(isDistFresh(root)).toBe(false)
    })
  }

  for (const rel of ARTIFACTS) {
    test(`${rel} rewritten behind the build's back is stale`, () => {
      // A git checkout, stash pop, or rebase restores a tracked artifact with an
      // mtime of "now" — later than the stamp — so only content can catch it.
      write(join(root, rel), 'restored from another revision', AFTER_BUILD_S)
      expect(isDistFresh(root)).toBe(false)
    })
  }

  test('an artifact truncated in place is stale', () => {
    write(join(root, 'dist/cli.mjs'), '', BEFORE_BUILD_S)
    expect(isDistFresh(root)).toBe(false)
  })

  test('a stamp that never recorded a required artifact is stale', () => {
    const outputs: Record<string, string> = {}
    for (const rel of ARTIFACTS.slice(1)) {
      outputs[rel] = Bun.hash(readFileSync(join(root, rel))).toString(16)
    }
    writeStamp({ outputs })
    expect(isDistFresh(root)).toBe(false)
  })

  test('a build made by a different Bun is stale', () => {
    // A toolchain upgrade changes bundler output with no input file changing.
    writeStamp({ bunVersion: '0.0.0-not-this-one' })
    expect(isDistFresh(root)).toBe(false)
  })

  test('no stamp at all is stale — a build that died halfway leaves none', () => {
    rmSync(join(root, BUILD_STAMP))
    expect(isDistFresh(root)).toBe(false)
  })

  for (const [label, body] of [
    ['unparseable', 'not-json'],
    ['missing startedAt', JSON.stringify({ bunVersion: Bun.version, outputs: {} })],
    ['missing bunVersion', JSON.stringify({ startedAt: 1, outputs: {} })],
    ['missing outputs', JSON.stringify({ startedAt: 1, bunVersion: Bun.version })],
  ] as const) {
    test(`a stamp that is ${label} is stale rather than throwing`, () => {
      writeFileSync(join(root, BUILD_STAMP), body)
      expect(isDistFresh(root)).toBe(false)
    })
  }

  test('an input touched in the same instant the build started is stale', () => {
    // A tie cannot be ordered on a coarse-mtime filesystem, so it must not read fresh.
    write(join(root, 'src/cli.ts'), 'content of src/cli.ts', BUILD_STARTED_S)
    expect(isDistFresh(root)).toBe(false)
  })

  test('a vanished input is stale rather than silently fresh', () => {
    rmSync(join(root, 'tsconfig.json'))
    expect(isDistFresh(root)).toBe(false)
  })
})

describe('buildFailure', () => {
  // The shapes below are what Bun actually returns; the timeout one was observed
  // with spawnSync('sleep', ['5'], { timeout: 300 }) — signal AND error together.
  const TIMED_OUT = {
    status: null,
    signal: 'SIGTERM',
    error: Object.assign(new Error('spawnSync bun ETIMEDOUT'), { code: 'ETIMEDOUT' }),
    stdout: 'Bundled 473 modules\nProcessing src/core/public.ts',
    stderr: '',
  }

  test('a timeout is reported as a kill, keeping the build log', () => {
    const error = buildFailure(TIMED_OUT, 180_000)
    expect(error?.message).toContain('killed by SIGTERM after 180000ms')
    // Losing this is what made the original CI failure hard to read.
    expect(error?.message).toContain('Processing src/core/public.ts')
    expect(error?.message).not.toContain('could not run')
    expect(error?.cause).toBe(TIMED_OUT.error)
  })

  test('a missing bun binary is reported as unrunnable', () => {
    const cause = Object.assign(new Error('spawnSync bun ENOENT'), { code: 'ENOENT' })
    const error = buildFailure({
      status: null,
      signal: null,
      error: cause,
      stdout: null,
      stderr: null,
    })
    expect(error?.message).toContain('could not run bun run build')
    expect(error?.message).not.toContain('null')
    expect(error?.cause).toBe(cause)
  })

  test('a non-zero exit carries the build output', () => {
    const error = buildFailure({ status: 1, signal: null, stdout: 'out', stderr: 'boom' })
    expect(error?.message).toContain('bun run build failed')
    expect(error?.message).toContain('boom')
  })

  test('a clean exit is not a failure', () => {
    expect(buildFailure({ status: 0, signal: null, stdout: '', stderr: '' })).toBeNull()
  })
})

describe('BUILD_INPUTS / BUILD_OUTPUTS cover what scripts/build.ts actually touches', () => {
  // The lists are hand-maintained; this reads the build script and fails when a
  // path it reads or writes is not accounted for. Without it, adding an output to
  // the build silently widens the window in which a stale dist reads as fresh.
  //
  // Known limit: coverage cannot tell a read from a write, so a build step that
  // wrote *under* `src/` would pass as "covered" by the input entry.
  const declared: string[] = [...BUILD_INPUTS, ...BUILD_OUTPUTS, BUILD_STAMP]

  function isCovered(path: string): boolean {
    return declared.some((entry) => path === entry || path.startsWith(`${entry}/`))
  }

  /** Path-shaped tokens, from code only — a path named in a comment proves nothing. */
  function repoPathsIn(source: string): string[] {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    const tokens = code.split(/[\s'"`(),;{}[\]]+/)
    const paths = tokens
      .map((token) => token.replace(/^\.\//, ''))
      .filter((token) => /^[\w.-]+(\/[\w.-]+)+$/.test(token))
    return [...new Set(paths)]
  }

  test('every repo path in scripts/build.ts is covered', () => {
    const paths = repoPathsIn(readFileSync(join(ROOT, 'scripts', 'build.ts'), 'utf8'))

    expect(paths.length).toBeGreaterThan(5)
    expect(paths.filter((p) => !isCovered(p))).toEqual([])
  })

  test('the scraper is not silently matching nothing', () => {
    // Guards the regex itself: a shape it cannot see is a build output it cannot guard.
    expect(repoPathsIn(`await Bun.write('resources/x.json', y)`)).toEqual(['resources/x.json'])
    expect(repoPathsIn(`await $\`cp a b/c.txt\``)).toEqual(['b/c.txt'])
    expect(repoPathsIn(`// writes lib/ignored.mjs`)).toEqual([])
  })

  test('tsconfig.json is declared, since dts-bundle-generator is driven by it', () => {
    const source = readFileSync(join(ROOT, 'scripts', 'build.ts'), 'utf8')
    expect(source).toContain('tsconfig.json')
    expect(isCovered('tsconfig.json')).toBe(true)
  })

  test('the build script scraped above is the one `bun run build` executes', () => {
    // Coverage means nothing if `build` starts chaining a second script.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.scripts.build).toBe('bun run scripts/build.ts')
  })

  test('the declared outputs all exist in a built tree', () => {
    // Guards against a typo in BUILD_OUTPUTS, which would make dist permanently
    // stale. Only meaningful once something has built; skipped on a bare checkout.
    if (Bun.file(join(ROOT, 'dist', 'cli.mjs')).size === 0) return
    for (const rel of BUILD_OUTPUTS) {
      expect(Bun.file(join(ROOT, rel)).size).toBeGreaterThan(0)
    }
  })
})
