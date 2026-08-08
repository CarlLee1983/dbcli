import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildEvidenceReceipt,
  canonicalizeEvidenceReceiptCommand,
  parseEvidenceReceipt,
  writeEvidenceReceipt,
} from '@/core/evidence-receipt'

const context = {
  engine: 'postgresql', connectionName: 'staging', environment: 'staging',
  schemaFingerprint: `sha256:${'a'.repeat(64)}`, semanticFingerprint: null,
}

describe('evidence receipt', () => {
  test('strips absolute Bun executable and source paths before validating redacted provenance', () => {
    expect(
      canonicalizeEvidenceReceiptCommand(
        '/opt/homebrew/bin/bun run /private/workspace/src/cli.ts verify safe-backfill --table <redacted>',
        'verify'
      )
    ).toBe('dbcli verify safe-backfill --table <redacted>')
  })

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

  test('keeps each verify status distinct from its coarse receipt outcome', () => {
    const receipts = ['verified', 'not_verified', 'indeterminate', 'blocked'].map((status) =>
      buildEvidenceReceipt({
        operation: 'verify',
        command: 'dbcli verify safe-backfill --after-write',
        context,
        verificationArtifactRef: 'verification-20260808-000000-a1.json',
        verificationStatus: status as 'verified' | 'not_verified' | 'indeterminate' | 'blocked',
        verificationArtifactPersisted: true,
      })
    )
    expect(receipts.map((receipt) => receipt.outcome)).toEqual([
      'succeeded',
      'failed',
      'failed',
      'failed',
    ])
    expect(new Set(receipts.map((receipt) => receipt.observation.fingerprint)).size).toBe(4)
    for (const receipt of receipts) {
      expect(receipt.operation).toBe('verify')
      expect(receipt.observation.kind).toBe('verify-outcome')
      expect(parseEvidenceReceipt(receipt)).toEqual(receipt)
    }
    const artifactWriteFailed = buildEvidenceReceipt({
      operation: 'verify',
      command: 'dbcli verify constraint --after-write',
      context,
      verificationArtifactRef: null,
      verificationStatus: 'verified',
      verificationArtifactPersisted: false,
    })
    expect(artifactWriteFailed.outcome).toBe('failed')
    expect(artifactWriteFailed.provenance.verificationArtifactRef).toBeNull()
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

  test('rejects a symlinked output ancestor that resolves outside the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dbcli-receipt-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'dbcli-receipt-outside-'))
    try {
      await symlink(outside, join(workspace, 'linked'))
      const receipt = buildEvidenceReceipt({ command: 'dbcli assert <sql>', context, verdict: { pass: true, checks: [{ pass: true }] } })
      await expect(writeEvidenceReceipt(workspace, 'linked/escape.json', receipt)).rejects.toThrow('resolves outside')
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
