import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEvidenceReceipt, parseEvidenceReceipt, writeEvidenceReceipt } from '@/core/evidence-receipt'

const context = {
  engine: 'postgresql', connectionName: 'staging', environment: 'staging',
  schemaFingerprint: `sha256:${'a'.repeat(64)}`, semanticFingerprint: null,
}

describe('evidence receipt', () => {
  test('contains only redacted assert provenance and pass bits', () => {
    const receipt = buildEvidenceReceipt({
      command: 'dbcli assert <sql> --expect <redacted>', context,
      auditRef: null, verificationArtifactRef: 'verification-20260808-000000-a1.json',
      verdict: { pass: false, checks: [{ pass: true }, { pass: false }] },
    }, { now: () => new Date('2026-08-08T00:00:00.000Z'), idFactory: () => 'receipt-1' })
    expect(receipt.outcome).toBe('failed')
    expect(JSON.stringify(receipt)).not.toContain('private')
    expect(parseEvidenceReceipt(receipt)).toEqual(receipt)
  })

  test('writes once to an explicit contained path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dbcli-receipt-'))
    try {
      const receipt = buildEvidenceReceipt({ command: 'dbcli assert <sql>', context, verdict: { pass: true, checks: [{ pass: true }] } })
      const path = await writeEvidenceReceipt(workspace, 'evidence/assert.json', receipt)
      expect(path).toEndWith('/evidence/assert.json')
      await expect(writeEvidenceReceipt(workspace, 'evidence/assert.json', receipt)).rejects.toThrow('already exists')
      await expect(writeEvidenceReceipt(workspace, '../escape.json', receipt)).rejects.toThrow('stay inside')
    } finally { await rm(workspace, { recursive: true, force: true }) }
  })
})
