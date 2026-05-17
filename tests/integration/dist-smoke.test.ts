/**
 * dist/packaged smoke tests
 *
 * Regression guard for v1.10.0: the bundled `dist/cli.mjs` must locate
 * `assets/SKILL.md`, `assets/reference.md`, `assets/snippets/`, and
 * `assets/tasks/` when invoked from outside the dev tree (the npm-install
 * scenario). We exercise the bundle from an OS tmpdir to mimic that.
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const DIST = join(ROOT, 'dist', 'cli.mjs')

function run(args: string[], cwd: string) {
  return spawnSync('bun', [DIST, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: cwd, NO_COLOR: '1' },
  })
}

describe('dist/packaged binary — runs from outside the dev tree', () => {
  let workdir = ''

  beforeAll(() => {
    // Rebuild dist so we test the current source, not a stale artifact.
    const build = spawnSync('bun', ['run', 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    if (build.status !== 0) {
      throw new Error(`bun run build failed:\n${build.stdout}\n${build.stderr}`)
    }
    workdir = mkdtempSync(join(tmpdir(), 'dbcli-dist-smoke-'))
    mkdirSync(workdir, { recursive: true })
  })

  test('--version succeeds (sanity)', () => {
    const r = run(['--version'], workdir)
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/\d+\.\d+\.\d+/)
  })

  test('skill --output writes packaged SKILL.md', () => {
    const out = join(workdir, 'SKILL.md')
    const r = run(['skill', '--output', out], workdir)
    expect(r.status).toBe(0)
    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/^---/) // frontmatter
    expect(text).toMatch(/name: dbcli/)
  })

  test('skill --output --lang zh-TW writes packaged ZH SKILL', () => {
    const out = join(workdir, 'SKILL.zh-TW.md')
    const r = run(['skill', '--output', out, '--lang', 'zh-TW'], workdir)
    expect(r.status).toBe(0)
    const text = readFileSync(out, 'utf8')
    expect(text).toMatch(/^---/) // YAML frontmatter delimiter
    expect(text).toMatch(/name: dbcli/) // same frontmatter contract as EN
    expect(text).toMatch(/Audit Log 使用|稽核日誌|繁體中文/) // ZH content marker
  })

  test('queries list --format json finds builtin snippets via packaged assets', () => {
    const r = run(['queries', 'list', '--format', 'json'], workdir)
    expect(r.status).toBe(0)
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBeGreaterThan(0)
    const sources = new Set(arr.flatMap((x: { sources?: string[] }) => x.sources ?? []))
    expect(sources.has('builtin')).toBe(true)
  })

  test('skill tasks list --format json finds builtin agent tasks via packaged assets', () => {
    const r = run(['skill', 'tasks', 'list', '--format', 'json'], workdir)
    expect(r.status).toBe(0)
    const arr = JSON.parse(r.stdout)
    expect(Array.isArray(arr)).toBe(true)
    const sources = new Set(arr.map((t: { source: string }) => t.source))
    expect(sources.has('builtin')).toBe(true)
  })
})
