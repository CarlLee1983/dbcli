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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BUILD_HOOK_TIMEOUT_MS, ensureDistBuilt } from '../helpers/ensure-dist'

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
  let failingMongoConfig = ''

  beforeAll(() => {
    // Test the current source, not a stale artifact — rebuilds only when dist is stale.
    ensureDistBuilt(ROOT)
    workdir = mkdtempSync(join(tmpdir(), 'dbcli-dist-smoke-'))
    mkdirSync(workdir, { recursive: true })
    failingMongoConfig = join(workdir, 'failing-mongo.json')
    writeFileSync(
      failingMongoConfig,
      JSON.stringify({
        connection: {
          system: 'mongodb',
          // A syntactically invalid host rejects inside MongoClient.connect()
          // immediately, keeping this production-boundary regression deterministic.
          uri: 'mongodb://[invalid/test',
          database: 'test',
        },
        permission: 'query-only',
        schema: {},
        metadata: { version: '1.0' },
        blacklist: { tables: [], columns: {} },
        audit: { enabled: false },
      })
    )
  }, BUILD_HOOK_TIMEOUT_MS)

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

  for (const [name, args] of [
    ['list', ['list']],
    ['schema', ['schema', 'users']],
    ['query', ['query', '{}', '--collection', 'users']],
  ] as const) {
    test(`${name} MongoDB rejection has bounded normal stderr and exit 1`, () => {
      const r = run(['--config', failingMongoConfig, ...args], workdir)
      const firstLine = r.stderr.split('\n').find((line) => line.trim() !== '') ?? ''

      expect(r.status).toBe(1)
      expect(firstLine).toMatch(/connect|invalid|parse|address|MongoDB/i)
      expect(firstLine).not.toMatch(/^\s*\d+\s*\|/)
      expect(r.stderr).not.toMatch(/^\s*\d+\s*\|/m)
      expect(r.stderr).not.toMatch(/\n\s+at\s+/)
      expect(r.stderr).not.toMatch(/\\u[0-9a-f]{4}/i)
      expect(r.stderr.split(firstLine)).toHaveLength(2)
    })
  }

  test('verbose MongoDB rejection includes a stack', () => {
    const r = run(['-v', '--config', failingMongoConfig, 'list'], workdir)

    expect(r.status).toBe(1)
    expect(r.stderr).toContain('Stack:')
    expect(r.stderr).toMatch(/\n\s+at\s+/)
  })

  test('query --recovery emits one envelope and no duplicate stderr', () => {
    const r = run(
      ['--config', failingMongoConfig, 'query', '{}', '--collection', 'users', '--recovery'],
      workdir
    )

    expect(r.status).toBe(1)
    expect(r.stderr).toBe('')
    const envelope = JSON.parse(r.stdout)
    expect(envelope.error).toBeDefined()
    expect(r.stdout.trim()).toMatch(/^\{[\s\S]*\}$/)
  })

  test('missing query file has bounded packaged stderr', () => {
    const path = join(workdir, 'missing-query.sql')
    const r = run(['query', '-f', path], workdir)
    const firstLine = r.stderr.split('\n').find((line) => line.trim() !== '') ?? ''

    expect(r.status).toBe(1)
    expect(firstLine).toContain(path)
    expect(r.stdout).toBe('')
    expect(r.stderr).not.toMatch(/^\s*\d+\s*\|/m)
    expect(r.stderr).not.toMatch(/\n\s+at\s+/)
  })
})
