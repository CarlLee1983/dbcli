# Verification Contract

**Date:** 2026-06-18
**Status:** Contract for implementation
**Baseline:** dbcli v1.33.0

## Purpose

Verification is the evidence layer for agent database work. It answers whether
a required check proved the intended state, contradicted it, could not decide,
or could not run.

## Statuses

| Status | Meaning |
| --- | --- |
| `verified` | Required verification evidence matched. |
| `not_verified` | Verification ran and evidence contradicted the expected state. |
| `indeterminate` | Verification ran but evidence was insufficient or ambiguous. |
| `blocked` | Verification could not run because of permission, missing config/schema, unsupported engine, placeholder, unsafe command, or another gate. |

## Compatibility

Existing recovery `verifyStatus` values remain unchanged:

| Recovery `verifyStatus` | Contract status |
| --- | --- |
| `passed` | `verified` |
| `failed` | `not_verified` |
| `indeterminate` with executed verifier | `indeterminate` |
| `indeterminate` with `skipped:*` verifier result | `blocked` |

## Artifact Schema

Artifacts use schema version `1`. This milestone defines the schema but does not
write artifacts to disk.

```json
{
  "schemaVersion": 1,
  "id": "ver_...",
  "createdAt": "2026-06-18T00:00:00.000Z",
  "status": "verified",
  "subject": {
    "kind": "backfill",
    "name": "safe-backfill-verify",
    "command": "dbcli assert \"SELECT count(*) FROM orders WHERE status IS NULL\" --expect \"rows == 0\""
  },
  "summary": "Read-back assertion passed.",
  "evidence": [
    {
      "kind": "assert",
      "command": "dbcli assert \"SELECT count(*) FROM orders WHERE status IS NULL\" --expect \"rows == 0\"",
      "exitCode": 0,
      "auditRef": "optional-audit-id"
    }
  ]
}
```

## Future Storage Path

When artifact writing is implemented, write bounded JSON evidence under:

```text
.dbcli/verification/verification-<YYYYMMDD-HHMMSS>-<short-id>.json
```

## Relationship To Existing Commands

- `assert`: primary read-back invariant evidence.
- `snapshot`: baseline and drift evidence.
- `recover --apply`: existing verifier source; keeps `verifyStatus` but can expose contract status internally.
- task packs: plan verification commands and later reference produced artifacts.
- audit: evidence references may include `auditRef` but artifacts are not replacements for audit logs.

## First Implementation Target

The first workflow to consume this contract should be `safe-backfill-verify`.
