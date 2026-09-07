import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

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

const verifyRecipe = async (): Promise<string[]> => {
  const makefile = await readRoot('Makefile')
  const lines = makefile.split('\n')
  const start = lines.findIndex((line) => line.startsWith('verify:'))
  expect(start).toBeGreaterThanOrEqual(0)

  const recipe: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break
    const step = line.slice(1).trim()
    if (step.length > 0 && !step.startsWith('#')) recipe.push(step)
  }
  return recipe
}

describe('make verify runs from a clean checkout', () => {
  test('installs the pinned dependency set before any step that consumes it', async () => {
    const recipe = await verifyRecipe()

    expect(recipe[0]).toBe('bun install --frozen-lockfile')
  })

  test('keeps every step it had before, in the same order', async () => {
    const recipe = await verifyRecipe()

    expect(recipe.slice(1)).toEqual([...REQUIRED_STEPS])
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
    const ignore = await readRoot('.gitignore')

    expect(ignore.split('\n').map((line) => line.trim())).toContain('.forgepilot/')
  })
})
