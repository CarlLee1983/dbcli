/**
 * Locate the dbcli package root (directory containing package.json).
 *
 * Works in both runtime modes:
 * - dev mode: `bun run src/cli.ts` — walks up from a `src/**` source file
 * - packaged mode: `dist/cli.mjs` (npm-installed) — walks up from `dist/`
 *
 * Hardcoded `../../../` resolves break when the bundled layout
 * (`<install>/dist/cli.mjs`) differs from the dev tree depth.
 */

import * as path from 'node:path'

let cached: string | null = null

const HERE = import.meta.dir

export function findPackageRoot(): string {
  if (cached) return cached
  let dir = HERE
  for (let i = 0; i < 6; i++) {
    if (Bun.file(path.join(dir, 'package.json')).size > 0) {
      cached = dir
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  cached = path.resolve(HERE, '..', '..')
  return cached
}

export function packageAssetPath(...segments: string[]): string {
  return path.join(findPackageRoot(), 'assets', ...segments)
}

/** Test-only — clears the cached package root */
export function _resetPackageRootCache(): void {
  cached = null
}
