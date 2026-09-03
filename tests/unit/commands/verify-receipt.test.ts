import { describe, expect, spyOn, test } from 'bun:test'
import { lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AdapterFactory } from '@/adapters'
import type { RuntimeDbcliConfig } from '@/core/config'
import type { VerificationArtifact, VerificationStatus } from '@/core/verification'
import { writeVerifyEvidenceReceipt } from '@/commands/verify-receipt'
import { makeTestConfig } from '../../helpers/test-config'

const config: RuntimeDbcliConfig = makeTestConfig({
  connection: { user: 'postgres', database: 'dbcli' },
})

function artifact(status: VerificationStatus): VerificationArtifact {
  return {
    schemaVersion: 1,
    id: `ver_${status}`,
    createdAt: '2026-08-08T00:00:00.000Z',
    status,
    subject: { kind: 'table', name: 'private_orders', command: 'verify constraint' },
    summary: 'Verification result.',
    evidence: [{ kind: 'manual' }],
  }
}

function argv(scenario: string): string[] {
  return [
    '/opt/homebrew/bin/bun',
    'run',
    '/private/workspace/src/cli.ts',
    'verify',
    scenario,
    '--table',
    'private_orders',
    '--query',
    "UPDATE private_orders SET token = 'secret'",
    '--verify-query',
    'SELECT count(*) FROM private_orders',
    '--expect',
    'value == 0',
    '--after-write',
  ]
}

describe('verify evidence receipt lifecycle boundary', () => {
  test('writes a receipt for every built-in scenario and preserves all status distinctions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-verify-receipt-'))
    try {
      const cases: Array<[string, VerificationStatus]> = [
        ['safe-backfill', 'verified'],
        ['migration', 'not_verified'],
        ['rollback', 'indeterminate'],
        ['constraint', 'blocked'],
      ]
      const receipts: Array<{ status: VerificationStatus; receipt: Record<string, unknown> }> = []
      for (const [scenario, status] of cases) {
        const result = await writeVerifyEvidenceReceipt({
          workspaceRoot: root,
          scenarioName: scenario,
          config,
          artifact: artifact(status),
          artifactPath: join(root, '.dbcli', 'verification', `${scenario}.json`),
          outputPath: `evidence/${scenario}.json`,
          argv: argv(scenario),
        })
        expect('path' in result).toBe(true)
        if (!('path' in result)) continue
        const receipt = JSON.parse(await readFile(result.path, 'utf8'))
        expect(receipt).toMatchObject({
          operation: 'verify',
          outcome: status === 'verified' ? 'succeeded' : 'failed',
          observation: { kind: 'verify-outcome' },
        })
        expect(JSON.stringify(receipt)).not.toContain('private_orders')
        expect(JSON.stringify(receipt)).not.toContain('secret')
        receipts.push({ status, receipt })
      }
      // Asserted through the typed field rather than a cast: the previous
      // version reached into `observation` as `{ fingerprint: string }`, so a
      // change to the shape left it comparing four undefined values.
      expect(receipts.map(({ receipt }) => receipt.observation)).toEqual([
        { kind: 'verify-outcome', status: 'verified' },
        { kind: 'verify-outcome', status: 'not_verified' },
        { kind: 'verify-outcome', status: 'indeterminate' },
        { kind: 'verify-outcome', status: 'blocked' },
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('keeps every seeded canary out of the receipt and out of its bounded failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-verify-receipt-'))
    try {
      // Realistic argv for this command surface, carrying one canary of every
      // kind the Story forbids in a receipt.
      const seeded = [
        '/opt/homebrew/bin/bun',
        'run',
        '/Users/operator/secrets/workspace/src/cli.ts',
        'verify',
        'safe-backfill',
        '--table',
        'user_tokens',
        '--query',
        "UPDATE user_tokens SET secret = 'hunter2' WHERE id = 4711",
        '--verify-query',
        'SELECT count(*)::int AS n FROM user_tokens WHERE secret IS NULL',
        '--expect',
        'value == 0',
        '--after-write',
        '--evidence-receipt',
        '/Users/operator/secrets/workspace/evidence/canary.json',
      ]
      // `user_tokens` is the load-bearing one: drop --table from the redaction
      // list and the canonical command still passes SAFE_TEXT and the banned-word
      // guard (\btoken\b does not match across the underscore), so it would land
      // in the receipt. The rest are backstops — most regressions make
      // canonicalization throw before a body is ever written.
      const canaries = ['/Users/operator', 'hunter2', 'user_tokens', '4711', 'UPDATE', 'SELECT']

      const written = await writeVerifyEvidenceReceipt({
        workspaceRoot: root,
        scenarioName: 'safe-backfill',
        config,
        artifact: artifact('verified'),
        artifactPath: join(root, '.dbcli', 'verification', 'safe-backfill.json'),
        outputPath: 'evidence/canary.json',
        argv: seeded,
      })

      expect('path' in written).toBe(true)
      if (!('path' in written)) return
      const body = await readFile(written.path, 'utf8')
      for (const canary of canaries) {
        expect(body).not.toContain(canary)
      }

      // The failure path is a fixed string, so the same canaries — including
      // the traversal target — cannot ride out on it either.
      const refused = await writeVerifyEvidenceReceipt({
        workspaceRoot: root,
        scenarioName: 'safe-backfill',
        config,
        artifact: artifact('verified'),
        artifactPath: join(root, '.dbcli', 'verification', 'safe-backfill.json'),
        outputPath: '../../escape/user_tokens.json',
        argv: seeded,
      })

      expect(refused).toEqual({ error: 'Failed to write evidence receipt' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('writes a receipt without constructing a database adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-verify-receipt-'))
    // Every construction entry point, not just the SQL one: the context builder
    // reads a semantic file, and that is the step most likely to reach for a
    // connection if it ever changed.
    const spies = (
      [
        'createSqlAdapter',
        'createAdapter',
        'createAdapterWithoutRules',
        'createMongoDBAdapter',
        'createRedisAdapter',
        'createElasticsearchAdapter',
      ] as const
    ).map((method) => spyOn(AdapterFactory, method))
    try {
      // Seed the semantic file so loadSemanticContext actually runs.
      await Bun.write(
        join(root, 'dbcli.semantic.json'),
        JSON.stringify({ version: 1, models: [], metrics: [] })
      )
      const result = await writeVerifyEvidenceReceipt({
        workspaceRoot: root,
        scenarioName: 'safe-backfill',
        config,
        artifact: artifact('verified'),
        artifactPath: join(root, '.dbcli', 'verification', 'safe-backfill.json'),
        outputPath: 'evidence/offline.json',
        argv: argv('safe-backfill'),
      })

      expect('path' in result).toBe(true)
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('fails safely for receipt collisions and symlink traversal after the artifact is authoritative', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-verify-receipt-'))
    const outside = await mkdtemp(join(tmpdir(), 'dbcli-verify-receipt-outside-'))
    try {
      const input = {
        workspaceRoot: root,
        scenarioName: 'constraint',
        config,
        artifact: artifact('verified'),
        artifactPath: join(root, '.dbcli', 'verification', 'constraint.json'),
        outputPath: 'evidence/receipt.json',
        argv: argv('constraint'),
      }
      expect(await writeVerifyEvidenceReceipt(input)).toMatchObject({ path: expect.any(String) })
      await expect(writeVerifyEvidenceReceipt(input)).resolves.toEqual({
        error: 'Failed to write evidence receipt',
      })
      await symlink(outside, join(root, 'linked'))
      await expect(
        writeVerifyEvidenceReceipt({ ...input, outputPath: 'linked/escape.json' })
      ).resolves.toEqual({ error: 'Failed to write evidence receipt' })
      await expect(lstat(join(outside, 'escape.json'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('records an artifact-write failure separately and rejects ambiguous audit provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dbcli-verify-receipt-'))
    try {
      const failedArtifact = await writeVerifyEvidenceReceipt({
        workspaceRoot: root,
        scenarioName: 'safe-backfill',
        config,
        artifact: artifact('verified'),
        outputPath: 'evidence/no-artifact.json',
        argv: argv('safe-backfill'),
      })
      expect('path' in failedArtifact).toBe(true)
      if ('path' in failedArtifact) {
        expect(JSON.parse(await readFile(failedArtifact.path, 'utf8'))).toMatchObject({
          outcome: 'failed',
          provenance: { verificationArtifactRef: null },
        })
      }
      const ambiguous = artifact('verified')
      ambiguous.evidence = [
        { kind: 'manual', auditRef: 'audit-one' },
        { kind: 'manual', auditRef: 'audit-two' },
      ]
      await expect(
        writeVerifyEvidenceReceipt({
          workspaceRoot: root,
          scenarioName: 'constraint',
          config,
          artifact: ambiguous,
          outputPath: 'evidence/ambiguous.json',
          argv: argv('constraint'),
        })
      ).resolves.toEqual({
        error: 'Evidence receipt unsupported for built-in verify scenario constraint',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
