import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'

const ROOT = join(import.meta.dir, '..', '..')

const readRoot = (relative: string): Promise<string> => readFile(join(ROOT, relative), 'utf8')

const REQUIRED_STEPS = [
  'bun install --frozen-lockfile',
  'bun run services:check',
  'bun run audit',
  'bun run format:check',
  'bun run agent-core:check',
  'bun run core-stdout:check',
  'bun run typecheck',
  'bun run typecheck:tests',
  'bun run lint',
  'SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test',
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
] as const

describe('CI verification', () => {
  test('runs the required checks in order', async () => {
    const script = await readRoot('scripts/ci-check.sh')
    const steps = [...script.matchAll(/^ {2}'([^'\n]+)'/gm)].map((match) => match[1])
    expect(steps).toEqual([...REQUIRED_STEPS])
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

    // Naming the writer is fine — the CI script names
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
