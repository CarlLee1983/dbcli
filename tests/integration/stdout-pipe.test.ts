import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')
const LARGE_DESCRIPTION = 'x'.repeat(400)

// The 500 snippets below are what pushes the CLI's output past the pipe buffer, so
// the count is load-bearing and must not shrink — but it makes every hook and the
// test itself filesystem-bound, and on windows-latest each write goes through
// Defender. Measured on that runner: ~1s for the whole file when healthy, but the
// beforeAll hook blew past Bun's 5s default on run 31019607734. The test body was
// 680ms on a healthy run, which leaves too little room for the same >5x spike, so it
// gets a budget too rather than being left one bad runner away from the same failure.
const SLOW_FS_TIMEOUT_MS = 60_000

let workspace: string
let consumerPath: string

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dbcli-stdout-pipe-'))
  const snippetsDir = join(workspace, '.dbcli-shared', 'queries')
  await mkdir(snippetsDir, { recursive: true })
  await Promise.all(
    Array.from({ length: 500 }, (_, index) =>
      Bun.write(
        join(snippetsDir, `large-output-${index}.sql`),
        [
          '-- ---',
          `-- name: Large output ${index}`,
          `-- description: ${LARGE_DESCRIPTION}`,
          '-- engine: postgres',
          '-- ---',
          `SELECT ${index};`,
        ].join('\n')
      )
    )
  )
  consumerPath = join(workspace, 'inspect-piped-json.ts')
  await Bun.write(
    consumerPath,
    [
      'const input = await Bun.stdin.text()',
      'let summary',
      'try {',
      '  const parsed = JSON.parse(input)',
      "  const snippet = parsed.find((item) => item.name === '@large-output-499')",
      "  const count = parsed.filter((item) => item.name.startsWith('@large-output-')).length",
      '  const bytes = new TextEncoder().encode(input).byteLength',
      '  summary = { valid: true, bytes, count, description: snippet?.description }',
      '} catch {',
      '  summary = { valid: false, bytes: new TextEncoder().encode(input).byteLength }',
      '}',
      'await Bun.write(Bun.stdout, JSON.stringify(summary))',
    ].join('\n')
  )
}, SLOW_FS_TIMEOUT_MS)

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
}, SLOW_FS_TIMEOUT_MS)

describe('CLI stdout piping', () => {
  test(
    'flushes JSON output larger than the pipe buffer before exiting',
    async () => {
      const pipeline =
        '"$DBCLI_TEST_BUN" run "$DBCLI_TEST_CLI" queries list --format json | "$DBCLI_TEST_BUN" "$DBCLI_TEST_CONSUMER"'
      const windowsPipelinePath = join(workspace, 'stdout-pipeline.cmd')
      if (process.platform === 'win32') {
        await Bun.write(
          windowsPipelinePath,
          '@echo off\r\n"%DBCLI_TEST_BUN%" run "%DBCLI_TEST_CLI%" queries list --format json | "%DBCLI_TEST_BUN%" "%DBCLI_TEST_CONSUMER%"\r\n'
        )
      }
      const child = Bun.spawn({
        cmd:
          process.platform === 'win32'
            ? ['cmd.exe', '/d', '/s', '/c', windowsPipelinePath]
            : ['/bin/sh', '-c', pipeline],
        cwd: workspace,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DBCLI_NO_UPDATE_CHECK: '1',
          DBCLI_TEST_BUN: process.execPath,
          DBCLI_TEST_CLI: CLI,
          DBCLI_TEST_CONSUMER: consumerPath,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])

      expect(stderr).toBe('')
      expect(code).toBe(0)
      const summary = JSON.parse(stdout) as {
        valid: boolean
        count?: number
        description?: string
        bytes?: number
      }
      expect(summary.valid).toBe(true)
      expect(summary.bytes).toBeGreaterThan(64 * 1024)
      expect(summary.count).toBe(500)
      expect(summary.description).toBe(LARGE_DESCRIPTION)
    },
    SLOW_FS_TIMEOUT_MS
  )
})
