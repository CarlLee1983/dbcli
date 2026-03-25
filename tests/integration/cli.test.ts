import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'

describe('CLI smoke tests', () => {
  it('should display help with --help', async () => {
    const result = await execCommand(['--help'])
    expect(result.stdout).toContain('Database CLI for AI agents')
    expect(result.code).toBe(0)
  })

  it('should display version with --version', async () => {
    const result = await execCommand(['--version'])
    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
    expect(result.code).toBe(0)
  })
})

function execCommand(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', 'dev', ...args])
    let stdout = ''
    proc.stdout.on('data', (data) => {
      stdout += data
    })
    proc.on('close', (code) => {
      resolve({ stdout, code: code || 0 })
    })
  })
}
