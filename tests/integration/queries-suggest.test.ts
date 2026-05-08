import { describe, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const FIXTURE = resolve(import.meta.dir, '../fixtures/saved-queries/discovery')
const CLI = resolve(import.meta.dir, '../../src/cli.ts')

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd: FIXTURE })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}

describe('queries suggest (CLI)', () => {
  test('missing intent → exit 2', async () => {
    const { code, stderr } = await run(['queries', 'suggest'])
    expect(code).toBe(2)
    expect(stderr).toMatch(/intent/i)
  })

  test('invalid intent → exit 2', async () => {
    const { code, stderr } = await run(['queries', 'suggest', 'Perf'])
    expect(code).toBe(2)
    expect(stderr).toMatch(/Invalid intent/i)
  })

  test('prefix match returns json with matching snippets', async () => {
    const { stdout, code } = await run([
      'queries',
      'suggest',
      'perf',
      '--engine',
      'all',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const arr = JSON.parse(stdout)
    expect(arr.every((h: { intent: string }) => h.intent.startsWith('perf'))).toBe(true)
  })

  test('no match → exit 0 with hint', async () => {
    const { stdout, code } = await run([
      'queries',
      'suggest',
      'nonexistent.intent',
      '--engine',
      'all',
    ])
    expect(code).toBe(0)
    expect(stdout).toMatch(/No snippets/i)
  })
})
