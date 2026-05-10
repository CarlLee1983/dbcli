import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadStepResultSummary,
  parseStepResultSummary,
} from '@/core/recovery/next-step-schema'

describe('parseStepResultSummary', () => {
  test('parses a minimal ok result', () => {
    const r = parseStepResultSummary({ status: 'ok' })
    expect(r.ok).toBe(true)
    expect(r.value!.status).toBe('ok')
  })

  test('parses full result with summaries', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      exitCode: 0,
      stdoutSummary: 'hello',
      stderrSummary: '',
    })
    expect(r.ok).toBe(true)
    expect(r.value!.exitCode).toBe(0)
  })

  test('rejects unknown status', () => {
    const r = parseStepResultSummary({ status: 'maybe' })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('status')
  })

  test('rejects unknown extra field (strict)', () => {
    const r = parseStepResultSummary({ status: 'ok', extra: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('extra')
  })

  test('rejects stdoutSummary over 4096 chars', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      stdoutSummary: 'x'.repeat(4097),
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('stdoutSummary')
  })

  test('accepts stdoutSummary at exactly 4096 chars', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      stdoutSummary: 'x'.repeat(4096),
    })
    expect(r.ok).toBe(true)
  })

  test('rejects stderrSummary over 4096 chars', () => {
    const r = parseStepResultSummary({
      status: 'ok',
      stderrSummary: 'y'.repeat(4097),
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('stderrSummary')
  })
})

describe('loadStepResultSummary', () => {
  test('parses inline JSON', async () => {
    const r = await loadStepResultSummary('{"status":"ok"}', process.cwd())
    expect(r.ok).toBe(true)
    expect(r.value!.status).toBe('ok')
  })

  test('rejects malformed inline JSON', async () => {
    const r = await loadStepResultSummary('not json', process.cwd())
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('JSON')
  })

  test('rejects schema-malformed inline JSON', async () => {
    const r = await loadStepResultSummary('{"status":"weird"}', process.cwd())
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('status')
  })

  test('reads @file relative to cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbcli-next-result-'))
    writeFileSync(join(dir, 'r.json'), JSON.stringify({ status: 'ok', exitCode: 0 }))
    const r = await loadStepResultSummary('@r.json', dir)
    expect(r.ok).toBe(true)
    expect(r.value!.exitCode).toBe(0)
  })

  test('rejects @file when file is unreadable', async () => {
    const r = await loadStepResultSummary('@/no/such/path/r.json', process.cwd())
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('not readable')
  })

  test('rejects @file when file exceeds 64 KB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbcli-next-result-big-'))
    writeFileSync(join(dir, 'big.json'), 'x'.repeat(65 * 1024))
    const r = await loadStepResultSummary('@big.json', dir)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('64')
  })

  test('rejects empty inline value', async () => {
    const r = await loadStepResultSummary('', process.cwd())
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('empty')
  })
})
