import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function runHelp(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], {
      env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return runHelp(args)
}

/** `--help` must exit 0 with a clean stderr; anything else signals CLI-surface drift. */
function expectCleanHelp({ stderr, code }: { stderr: string; code: number }) {
  expect(code).toBe(0)
  expect(stderr).toBe('')
}

describe('verify --help surface', () => {
  test('verify --help lists all built-in scenarios', async () => {
    const result = await runHelp(['verify', '--help'])
    expectCleanHelp(result)
    expect(result.stdout).toContain('safe-backfill')
    expect(result.stdout).toContain('migration')
    expect(result.stdout).toContain('rollback')
    expect(result.stdout).toContain('constraint')
  })

  test('verify safe-backfill --help keeps its option surface', async () => {
    const result = await runHelp(['verify', 'safe-backfill', '--help'])
    expectCleanHelp(result)
    const { stdout } = result
    for (const flag of [
      '--table',
      '--query',
      '--verify-query',
      '--expect',
      '--after-write',
      '--format',
      '--subject-name',
      '--summary',
      '--evidence-receipt',
    ]) {
      expect(stdout).toContain(flag)
    }
  })

  test('verify migration --help keeps its option surface', async () => {
    const result = await runHelp(['verify', 'migration', '--help'])
    expectCleanHelp(result)
    const { stdout } = result
    for (const flag of [
      '--table',
      '--ddl',
      '--verify-query',
      '--expect',
      '--after-write',
      '--format',
      '--subject-name',
      '--summary',
      '--evidence-receipt',
    ]) {
      expect(stdout).toContain(flag)
    }
  })

  test('verify rollback --help exposes --kind and --statement', async () => {
    const result = await runHelp(['verify', 'rollback', '--help'])
    expectCleanHelp(result)
    const { stdout } = result
    for (const flag of [
      '--kind',
      '--table',
      '--statement',
      '--verify-query',
      '--expect',
      '--after-write',
      '--format',
      '--subject-name',
      '--summary',
      '--evidence-receipt',
    ]) {
      expect(stdout).toContain(flag)
    }
  })

  test('verify constraint --help exposes its option surface', async () => {
    const result = await runHelp(['verify', 'constraint', '--help'])
    expectCleanHelp(result)
    const { stdout } = result
    for (const flag of [
      '--table',
      '--check',
      '--column',
      '--references',
      '--violation-query',
      '--allow-preexisting',
      '--baseline',
      '--after-write',
      '--format',
      '--subject-name',
      '--summary',
      '--evidence-receipt',
    ]) {
      expect(stdout).toContain(flag)
    }
  })

  test('preflight rejects an evidence receipt before any database configuration is read', async () => {
    const result = await runCommand([
      'verify', 'safe-backfill', '--table', 'orders', '--query', 'UPDATE orders SET status = 1 WHERE id = 1',
      '--verify-query', 'SELECT count(*) FROM orders', '--expect', 'value == 0',
      '--evidence-receipt', 'evidence/receipt.json',
    ])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Evidence receipt unsupported: receipts require --after-write')
  })
})
