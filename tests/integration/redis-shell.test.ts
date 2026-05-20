/**
 * Redis interactive shell smoke test (v1.21.0). Spawns the CLI `shell` command
 * against a Docker Redis container in non-TTY (batch) mode, feeds a command plus
 * `.exit`, and asserts a clean exit with the Redis welcome banner on stderr.
 *
 * Skips automatically when Redis is unreachable.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDbReachable } from './helpers'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function runShell(
  workDir: string,
  stdin: string
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, '--config', workDir, 'shell'], {
      cwd: workDir,
      env: sanitizeEnv(),
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

describe('Redis shell smoke [v1.21.0]', () => {
  let workDir: string
  let skip = false

  beforeAll(async () => {
    skip = !(await isDbReachable(
      process.env.REDIS_HOST || 'localhost',
      Number(process.env.REDIS_PORT || 6379)
    ))
    if (skip) console.log('⏭ Redis not reachable — skipping shell smoke test')
  })

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'dbcli-test-redis-shell-'))
    const cfg = {
      connection: {
        system: 'redis',
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        user: '',
        password: process.env.REDIS_PASSWORD || '',
        database: process.env.REDIS_DB || '0',
      },
      permission: 'read-write',
      metadata: { createdAt: '2026-05-19T00:00:00.000Z', version: '1.0' },
    }
    await writeFile(join(workDir, 'config.json'), JSON.stringify(cfg), 'utf8')
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  test('GET on a missing key then .exit returns exit 0 and prints the Redis banner', async () => {
    if (skip) return
    const r = await runShell(workDir, 'GET nonexistent\n.exit\n')
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('Redis shell')
  })
})
