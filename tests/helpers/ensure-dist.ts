/**
 * Rebuild `dist/` for tests that import the published artifacts — but only when
 * it is actually stale.
 *
 * `bun run build` costs ~15s on a fast laptop and has been measured past 60s on
 * a contended macOS CI runner, where it was killed mid dts-bundle-generator and
 * failed the run. CI already builds in its own step before `bun test`, so the
 * rebuild inside a test hook is pure duplication there.
 *
 * Freshness is decided against `dist/.build-stamp`, which `scripts/build.ts`
 * writes on success. Two independent checks have to agree:
 *
 * 1. Inputs are older than the moment the build *started* (not than the output
 *    mtimes). That ordering is what makes a source edited mid-build, a build
 *    killed halfway, and a coarse-granularity filesystem all read as stale.
 * 2. Every artifact still hashes to what the build produced. mtime cannot see a
 *    git checkout rewriting `assets/ui-template.html`, which is tracked — a
 *    restore sets mtime to "now" while changing the content.
 *
 * Known blind spots, all requiring an mtime-preserving mutation of an *input*:
 * `node_modules` edited without touching `bun.lock` (`bun link`, patch-package),
 * and archive extraction that restores timestamps (`tar -x`, `rsync -a`). The
 * build's own toolchain is covered by recording `Bun.version` in the stamp.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')

/** Headroom for the slowest observed CI build; the freshness check means we rarely pay it. */
export const BUILD_TIMEOUT_MS = 180_000

/**
 * Budget for a `beforeAll` that calls {@link ensureDistBuilt}. Deliberately larger
 * than {@link BUILD_TIMEOUT_MS}: if the two deadlines coincided, Bun's hook timeout
 * could fire first and the build's own diagnosis would never be printed.
 */
export const BUILD_HOOK_TIMEOUT_MS = BUILD_TIMEOUT_MS + 30_000

/** Written by `scripts/build.ts` only after every output lands. */
export const BUILD_STAMP = 'dist/.build-stamp'

/**
 * Everything the build reads. `package.json` is inlined into the bundle (version
 * string), `tsconfig.json` drives dts-bundle-generator, and `bun.lock` changes
 * whenever a bundled dependency does — none of them touch `src/`.
 */
export const BUILD_INPUTS = [
  'src',
  'scripts/build.ts',
  'tsconfig.json',
  'package.json',
  'bun.lock',
  'bunfig.toml',
] as const

/** Everything the build writes. All must exist, or the last build did not finish. */
export const BUILD_OUTPUTS = [
  'dist/cli.mjs',
  'dist/cli-runtime.mjs',
  'dist/core.mjs',
  'dist/core.d.ts',
  'dist/agent-core.mjs',
  'dist/agent-core.d.ts',
  'dist/ui-style.css',
  'assets/ui-template.html',
] as const

/** Must match how `scripts/build.ts` hashes each artifact. */
export function hashArtifact(path: string): string | null {
  try {
    return Bun.hash(readFileSync(path)).toString(16)
  } catch {
    return null
  }
}

function newestMtimeUnder(path: string): number {
  let stat
  try {
    stat = statSync(path)
  } catch {
    // A vanished input cannot prove freshness — force a rebuild.
    return Number.POSITIVE_INFINITY
  }
  if (!stat.isDirectory()) return stat.mtimeMs

  let newest = stat.mtimeMs
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    newest = Math.max(newest, newestMtimeUnder(join(path, entry.name)))
  }
  return newest
}

interface BuildStamp {
  startedAt: number
  bunVersion: string
  outputs: Record<string, string>
}

function readStamp(root: string): BuildStamp | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, BUILD_STAMP), 'utf8')) as BuildStamp
    if (!Number.isFinite(parsed?.startedAt)) return null
    if (typeof parsed?.bunVersion !== 'string') return null
    if (!parsed?.outputs || typeof parsed.outputs !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/** True when a completed build started after every input changed and its artifacts are intact. */
export function isDistFresh(root: string = ROOT): boolean {
  const stamp = readStamp(root)
  if (stamp === null) return false
  if (stamp.bunVersion !== Bun.version) return false

  // Every artifact the tests rely on must be one this build recorded...
  for (const rel of BUILD_OUTPUTS) {
    if (!(rel in stamp.outputs)) return false
  }
  // ...and must still hold the bytes it wrote.
  for (const [rel, hash] of Object.entries(stamp.outputs)) {
    if (hashArtifact(join(root, rel)) !== hash) return false
  }

  // Strict `>`: a tie means the edit and the build start share a timestamp, which
  // on a coarse-granularity filesystem cannot be ordered — rebuild rather than guess.
  return BUILD_INPUTS.every((rel) => stamp.startedAt > newestMtimeUnder(join(root, rel)))
}

interface BuildResult {
  status: number | null
  signal: NodeJS.Signals | string | null
  error?: Error
  stdout: string | null
  stderr: string | null
}

/**
 * Turn a finished `bun run build` into an error, or null when it succeeded.
 *
 * Branch order matters. On a timeout Bun sets `error` (ETIMEDOUT) *and* `signal`,
 * and the timeout is the exact failure this helper exists to explain — routing it
 * through the generic `error` branch would report it as "could not run bun" and
 * drop the build log that says how far the build got.
 */
export function buildFailure(build: BuildResult, timeoutMs = BUILD_TIMEOUT_MS): Error | null {
  const log = `\n${build.stdout ?? ''}\n${build.stderr ?? ''}`

  if (build.signal) {
    return new Error(
      `bun run build was killed by ${build.signal} after ${timeoutMs}ms:${log}`,
      build.error ? { cause: build.error } : undefined
    )
  }
  if (build.error) {
    return new Error(`could not run bun run build: ${build.error.message}`, { cause: build.error })
  }
  if (build.status !== 0) {
    return new Error(`bun run build failed:${log}`)
  }
  return null
}

/** Build `dist/` if stale. Throws with the build's own output when it fails. */
export function ensureDistBuilt(root: string = ROOT): void {
  if (isDistFresh(root)) return

  const failure = buildFailure(
    spawnSync('bun', ['run', 'build'], { cwd: root, encoding: 'utf8', timeout: BUILD_TIMEOUT_MS })
  )
  if (failure) throw failure
}
