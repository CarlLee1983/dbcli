import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  buildEvidenceReceipt,
  canonicalizeEvidenceReceiptCommand,
  parseEvidenceReceipt,
  writeEvidenceReceipt,
} from '@/core/evidence-receipt'

const context = {
  engine: 'postgresql',
  connectionName: 'staging',
  environment: 'staging',
  schemaFingerprint: `sha256:${'a'.repeat(64)}`,
  semanticFingerprint: null,
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
    const receipt = buildEvidenceReceipt(
      {
        command: 'dbcli assert <sql> --expect <redacted>',
        context,
        auditRef: null,
        verificationArtifactRef: 'verification-20260808-000000-a1.json',
        verdict: { pass: false, checks: [{ pass: true }, { pass: false }] },
      },
      { now: () => new Date('2026-08-08T00:00:00.000Z'), idFactory: () => 'receipt-1' }
    )
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
    expect(receipts.map((receipt) => receipt.observation)).toEqual([
      { kind: 'verify-outcome', status: 'verified' },
      { kind: 'verify-outcome', status: 'not_verified' },
      { kind: 'verify-outcome', status: 'indeterminate' },
      { kind: 'verify-outcome', status: 'blocked' },
    ])
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
      const receipt = buildEvidenceReceipt({
        command: 'dbcli assert <sql>',
        context,
        verdict: { pass: true, checks: [{ pass: true }] },
      })
      const path = await writeEvidenceReceipt(workspace, 'evidence/assert.json', receipt)
      expect(path).toEndWith(`${sep}evidence${sep}assert.json`)
      await expect(
        writeEvidenceReceipt(workspace, 'evidence/assert.json', receipt)
      ).rejects.toThrow('already exists')
      await expect(writeEvidenceReceipt(workspace, '../escape.json', receipt)).rejects.toThrow(
        'stay inside'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  // observation.fingerprint was an unsalted SHA-256 over a value with eight
  // possible preimages for verify, and 2^(n+1) for an assert with n checks. It
  // hid nothing a dictionary could not recover in milliseconds, while its
  // determinism let two receipts be linked by their outcome. What it covered is
  // now stated plainly, which is strictly less than an attacker could already
  // read out of the hash.
  test('states the assert verdict as counts rather than a breakable digest', () => {
    const receipt = buildEvidenceReceipt({
      command: 'dbcli assert <sql>',
      context,
      verdict: { pass: false, checks: [{ pass: true }, { pass: false }, { pass: true }] },
    })
    expect(receipt.observation).toEqual({
      kind: 'assert-verdict',
      checksPassed: 2,
      checksTotal: 3,
    })
    expect(parseEvidenceReceipt(receipt)).toEqual(receipt)
  })

  test('does not reveal which check failed', () => {
    const first = buildEvidenceReceipt({
      command: 'dbcli assert <sql>',
      context,
      verdict: { pass: false, checks: [{ pass: false }, { pass: true }] },
    })
    const second = buildEvidenceReceipt({
      command: 'dbcli assert <sql>',
      context,
      verdict: { pass: false, checks: [{ pass: true }, { pass: false }] },
    })
    expect(second.observation).toEqual(first.observation)
  })

  test('carries no fingerprint field at all', () => {
    const receipt = buildEvidenceReceipt({
      command: 'dbcli assert <sql>',
      context,
      verdict: { pass: true, checks: [{ pass: true }] },
    })
    expect(receipt.observation).not.toHaveProperty('fingerprint')
    expect(JSON.stringify(receipt)).not.toContain('fingerprint')
  })

  test('rejects a receipt still carrying the removed fingerprint', () => {
    const receipt = buildEvidenceReceipt({
      command: 'dbcli assert <sql>',
      context,
      verdict: { pass: true, checks: [{ pass: true }] },
    })
    expect(() =>
      parseEvidenceReceipt({
        ...receipt,
        observation: { kind: 'assert-verdict', fingerprint: `sha256:${'a'.repeat(64)}` },
      })
    ).toThrow(/observation/)
  })

  test('still rejects a verdict whose checks carry more than a pass bit', () => {
    expect(() =>
      buildEvidenceReceipt({
        command: 'dbcli assert <sql>',
        context,
        verdict: { pass: true, checks: [{ pass: true, value: 42 }] },
      })
    ).toThrow(/pass bits/)
  })

  test('rejects a symlinked output ancestor that resolves outside the workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dbcli-receipt-workspace-'))
    const outside = await mkdtemp(join(tmpdir(), 'dbcli-receipt-outside-'))
    try {
      await symlink(outside, join(workspace, 'linked'))
      const receipt = buildEvidenceReceipt({
        command: 'dbcli assert <sql>',
        context,
        verdict: { pass: true, checks: [{ pass: true }] },
      })
      await expect(writeEvidenceReceipt(workspace, 'linked/escape.json', receipt)).rejects.toThrow(
        'resolves outside'
      )
    } finally {
      await rm(workspace, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
