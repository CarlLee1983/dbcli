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
  // Search up to 6 levels for package.json
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json')
    if (Bun.file(pkgPath).size > 0) {
      cached = dir
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Robust fallback:
  // If we are in 'dist/cli.mjs', root is '..'
  // If we are in 'src/utils/package-root.ts', root is '../../'
  if (HERE.endsWith('dist')) {
    cached = path.resolve(HERE, '..')
  } else {
    cached = path.resolve(HERE, '..', '..')
  }
  return cached
}

export function packageAssetPath(...segments: string[]): string {
  return path.join(findPackageRoot(), 'assets', ...segments)
}

/** Test-only — clears the cached package root */
export function _resetPackageRootCache(): void {
  cached = null
}
