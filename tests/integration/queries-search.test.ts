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

describe('queries search (CLI)', () => {
  test('empty keywords → exit 2 with hint', async () => {
    const { code, stderr } = await run(['queries', 'search'])
    expect(code).toBe(2)
    expect(stderr).toMatch(/at least one keyword/i)
  })

  test('json format with keyword hit returns expected fields', async () => {
    const { stdout, code } = await run([
      'queries',
      'search',
      'slow',
      '--engine',
      'all',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    const arr = JSON.parse(stdout)
    expect(Array.isArray(arr)).toBe(true)
    expect(arr.length).toBeGreaterThan(0)
    const sample = arr[0]
    expect(sample).toHaveProperty('name')
    expect(sample).toHaveProperty('engine')
    expect(sample).toHaveProperty('source')
    expect(sample).toHaveProperty('score')
    expect(sample).toHaveProperty('intent')
    expect(sample).toHaveProperty('description')
    expect(sample).toHaveProperty('tags')
  })

  test('zero hits → exit 0 with hint (table format)', async () => {
    const { stdout, code } = await run([
      'queries',
      'search',
      'completelyunknownword',
      '--engine',
      'all',
    ])
    expect(code).toBe(0)
    expect(stdout).toMatch(/No snippets matched/i)
  })

  test('zero hits json → exit 0 with []', async () => {
    const { stdout, code } = await run([
      'queries',
      'search',
      'completelyunknownword',
      '--engine',
      'all',
      '--format',
      'json',
    ])
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual([])
  })
})
