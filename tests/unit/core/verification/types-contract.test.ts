import { describe, expect, test } from 'bun:test'
import {
  VERIFICATION_ARTIFACT_SCHEMA_VERSION,
  type VerificationArtifact,
} from '@/core/verification'

describe('verification artifact contract', () => {
  test('constructs the v1 artifact shape', () => {
    const artifact: VerificationArtifact = {
      schemaVersion: VERIFICATION_ARTIFACT_SCHEMA_VERSION,
      id: 'ver_test_123',
      createdAt: '2026-06-18T00:00:00.000Z',
      status: 'verified',
      subject: {
        kind: 'backfill',
        name: 'safe-backfill-verify',
      },
      summary: 'Read-back assertion passed.',
      evidence: [
        {
          kind: 'assert',
          command: 'dbcli assert "SELECT count(*) FROM orders" --expect "rows > 0"',
          exitCode: 0,
          auditRef: 'audit_123',
        },
      ],
    }

    expect(artifact.schemaVersion).toBe(1)
    expect(artifact.status).toBe('verified')
    expect(artifact.evidence[0]?.kind).toBe('assert')
  })
})
