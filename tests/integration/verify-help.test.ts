import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function runHelp(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], {
      env: { ...process.env, DBCLI_NO_UPDATE_CHECK: '1' },
    })
    let stdout = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.on('close', (code) => res({ stdout, code: code ?? 0 }))
  })
}

describe('verify --help surface', () => {
  test('verify --help lists both built-in scenarios', async () => {
    const { stdout } = await runHelp(['verify', '--help'])
    expect(stdout).toContain('safe-backfill')
    expect(stdout).toContain('migration')
  })

  test('verify safe-backfill --help keeps its option surface', async () => {
    const { stdout } = await runHelp(['verify', 'safe-backfill', '--help'])
    for (const flag of [
      '--table',
      '--query',
      '--verify-query',
      '--expect',
      '--after-write',
      '--format',
      '--subject-name',
      '--summary',
    ]) {
      expect(stdout).toContain(flag)
    }
  })

  test('verify migration --help keeps its option surface', async () => {
    const { stdout } = await runHelp(['verify', 'migration', '--help'])
    for (const flag of [
      '--table',
      '--ddl',
      '--verify-query',
      '--expect',
      '--after-write',
      '--format',
      '--subject-name',
      '--summary',
    ]) {
      expect(stdout).toContain(flag)
    }
  })
})
