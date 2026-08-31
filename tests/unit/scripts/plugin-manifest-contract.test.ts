/**
 * The manifest drift guard has to fail on drift.
 *
 * A check that only ever runs against a correct tree proves nothing — the
 * previous state of this repo was five manifests two majors behind with a fully
 * green build. Each test here copies the repo's manifest surface into a
 * scratch tree, breaks exactly one thing, and asserts the script goes red.
 */

import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '../../..')
const SCRIPT = 'scripts/check-plugin-manifests.ts'

const MANIFESTS = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  'gemini-extension.json',
  'plugins/dbcli-agent/.codex-plugin/plugin.json',
]

/** Everything the script reads, and nothing else. */
const COPIED = [
  ...MANIFESTS,
  'package.json',
  'SECURITY.md',
  'AGENTS.md',
  '.agents/plugins/marketplace.json',
  'skills/dbcli/SKILL.md',
  'plugins/dbcli-agent/skills/dbcli/SKILL.md',
  'docs/assets/dbcli-intro/cursor-marketplace.png',
  SCRIPT,
] as const

const created: string[] = []

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbcli-manifest-contract-'))
  created.push(dir)
  for (const path of COPIED) {
    mkdirSync(join(dir, dirname(path)), { recursive: true })
    cpSync(join(ROOT, path), join(dir, path))
  }
  return dir
}

function runCheck(dir: string, ...args: string[]): { code: number; output: string } {
  const result = spawnSync('bun', ['run', join(dir, SCRIPT), ...args], {
    cwd: dir,
    encoding: 'utf8',
  })
  return { code: result.status ?? 0, output: `${result.stdout}${result.stderr}` }
}

function patchJson(dir: string, path: string, mutate: (value: Record<string, unknown>) => void) {
  const value = JSON.parse(readFileSync(join(dir, path), 'utf8')) as Record<string, unknown>
  mutate(value)
  writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * A version, and a major, that the repository is guaranteed not to be on.
 * Writing today's numbers in as the "drifted" value is how these two tests
 * silently stopped testing anything the moment the package reached them.
 */
const PACKAGE_MAJOR = Number(
  (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
  ).version.split('.')[0]
)
/** Same major, so SECURITY.md stays valid and only the manifest check can fire. */
const OTHER_VERSION = `${PACKAGE_MAJOR}.999.0`
const OTHER_MAJOR = PACKAGE_MAJOR + 1

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('plugin manifest drift guard', () => {
  test('passes against the repository as it stands', () => {
    expect(runCheck(scratchRepo()).code).toBe(0)
  })

  test.each(MANIFESTS.map((manifest) => [manifest] as const))(
    'fails when %s falls behind package.json',
    (manifest) => {
      const dir = scratchRepo()
      patchJson(dir, manifest, (value) => {
        value.version = '1.51.2'
      })
      const { code, output } = runCheck(dir)
      expect(code).toBe(1)
      expect(output).toContain(manifest)
      expect(output).toContain('1.51.2')
    }
  )

  test('fails when package.json moves and the manifests do not', () => {
    const dir = scratchRepo()
    patchJson(dir, 'package.json', (value) => {
      value.version = OTHER_VERSION
    })
    const { code, output } = runCheck(dir)
    expect(code).toBe(1)
    expect(output).toContain(OTHER_VERSION)
    expect(output).toContain(MANIFESTS[0])
  })

  test('--write realigns the versions and the check then passes', () => {
    const dir = scratchRepo()
    for (const manifest of MANIFESTS) {
      patchJson(dir, manifest, (value) => {
        value.version = '0.0.1'
      })
    }
    expect(runCheck(dir).code).toBe(1)
    // SECURITY.md is untouched here, so --write still exits 1; the versions it
    // can fix must be fixed regardless.
    runCheck(dir, '--write')
    expect(runCheck(dir).code).toBe(0)
  })

  test('fails when a manifest is renamed away from the plugin name', () => {
    const dir = scratchRepo()
    patchJson(dir, '.codex-plugin/plugin.json', (value) => {
      value.name = 'dbcli-agent-renamed'
    })
    expect(runCheck(dir).output).toContain('expected "dbcli-agent"')
  })

  test('fails when a manifest points at a skills directory that is not there', () => {
    const dir = scratchRepo()
    patchJson(dir, '.cursor-plugin/plugin.json', (value) => {
      value.skills = './skills-that-moved/'
    })
    expect(runCheck(dir).output).toContain('does not exist')
  })

  test('fails when a declared entry file is missing', () => {
    const dir = scratchRepo()
    rmSync(join(dir, 'AGENTS.md'))
    expect(runCheck(dir).output).toContain('contextFileName')
  })

  test('fails when the portable plugin copy diverges from the root copy', () => {
    const dir = scratchRepo()
    patchJson(dir, 'plugins/dbcli-agent/.codex-plugin/plugin.json', (value) => {
      value.description = 'Something else entirely'
    })
    const { code, output } = runCheck(dir)
    expect(code).toBe(1)
    expect(output).toContain('differs from .codex-plugin/plugin.json')
  })

  test('fails when SECURITY.md supports a major the package has left behind', () => {
    const dir = scratchRepo()
    const current = readFileSync(join(dir, 'SECURITY.md'), 'utf8')
    const supported = new RegExp(`\\| \\*\\*${PACKAGE_MAJOR}\\.x\\*\\* \\| :white_check_mark:`)
    expect(current).toMatch(supported)
    const security = current.replace(supported, `| **${OTHER_MAJOR}.x** | :white_check_mark:`)
    writeFileSync(join(dir, 'SECURITY.md'), security)
    const { code, output } = runCheck(dir)
    expect(code).toBe(1)
    expect(output).toContain('SECURITY.md')
  })
})
