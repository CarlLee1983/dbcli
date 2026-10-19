import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dir, '../../..')
const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(script: string) {
  const root = await mkdtemp(join(tmpdir(), 'release-check-'))
  directories.push(root)
  await mkdir(join(root, 'scripts'))
  await Bun.write(join(root, 'scripts', script), Bun.file(join(ROOT, 'scripts', script)))
  // Observe the shell's external command boundary without running nested full
  // suites. Functions preserve real Bash errexit and ordering semantics.
  await Bun.write(
    join(root, 'commands.sh'),
    `make() { printf 'make %s\\n' "$*" >> "$RELEASE_TRACE"; return "$MAKE_EXIT"; }
bun() {
  printf 'bun %s\\n' "$*" >> "$RELEASE_TRACE"
  if [ "$1" = '-p' ]; then printf '12.0.0\\n'; return 0; fi
  return "$BUN_EXIT"
}
`
  )
  const trace = join(root, 'trace.txt')
  await Bun.write(trace, '')
  return {
    root,
    trace,
    run(makeExit = 0, bunExit = 0) {
      return spawnSync('bash', [join(root, 'scripts', script).replaceAll('\\', '/')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          BASH_ENV: join(root, 'commands.sh').replaceAll('\\', '/'),
          RELEASE_TRACE: trace.replaceAll('\\', '/'),
          MAKE_EXIT: String(makeExit),
          BUN_EXIT: String(bunExit),
        },
      })
    },
  }
}

test.each([
  [0, 0, 0, 'make verify\nbun run release:extras\n'],
  [7, 0, 7, 'make verify\n'],
  [0, 9, 9, 'make verify\nbun run release:extras\n'],
] as const)(
  'canonical=%i, extras=%i exits %i without repeating gates',
  async (make, extras, code, trace) => {
    const f = await fixture('release-check.sh')
    const result = f.run(make, extras)
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(code)
    expect(await Bun.file(f.trace).text()).toBe(trace)
  }
)

const artifacts = [
  'dist/cli.mjs',
  'dist/cli-runtime.mjs',
  'dist/core.mjs',
  'dist/core.d.ts',
  'dist/agent-core.mjs',
  'dist/agent-core.d.ts',
  'dist/ui-style.css',
  'assets/ui-template.html',
]

async function extrasFixture() {
  const f = await fixture('release-extras.sh')
  for (const path of artifacts) await Bun.write(join(f.root, path), 'built artifact')
  await Bun.write(join(f.root, 'docs/feature-matrix.md'), '| `audit` | supported |\n')
  await Bun.write(join(f.root, 'CHANGELOG.md'), '## [12.0.0]\nRelease notes\n')
  return f
}

test('extras run packaged smoke and release presence checks without general gates', async () => {
  const f = await extrasFixture()
  expect(f.run().status).toBe(0)
  expect(await Bun.file(f.trace).text()).toBe(
    "bun test tests/integration/dist-smoke.test.ts\nbun -p require('./package.json').version\n"
  )
})

test('failed packaged smoke fails extras before any following check', async () => {
  const f = await extrasFixture()
  expect(f.run(0, 11).status).toBe(11)
  expect(await Bun.file(f.trace).text()).toBe('bun test tests/integration/dist-smoke.test.ts\n')
})

test.each(['dist/cli.mjs', 'dist/cli-runtime.mjs', 'dist/core.d.ts', 'assets/ui-template.html'])(
  'extras reject missing %s before smoke can rebuild it',
  async (artifact) => {
    const f = await extrasFixture()
    await rm(join(f.root, artifact))
    const result = f.run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`Missing release artifact: ${artifact}`)
    expect(await Bun.file(f.trace).text()).toBe('')
  }
)

test.each([
  ['docs/feature-matrix.md', '| `query` | supported |\n', "missing 'audit' row"],
  ['CHANGELOG.md', '## [11.0.0]\nOld release\n', "missing '## [12.0.0]' heading"],
] as const)('extras reject invalid %s', async (path, content, error) => {
  const f = await extrasFixture()
  await Bun.write(join(f.root, path), content)
  const result = f.run()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain(error)
})
