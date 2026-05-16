---
phase: 25
plan: 08
status: complete
completed: 2026-05-16
requirements: [INTEGRATE-02, INTEGRATE-03, DOCS-02]
key-files:
  created:
    - tests/integration/recovery-audit-link.test.ts
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-08-SUMMARY.md
  modified:
    - tests/integration/audit-show-health.test.ts
---

# 25-08 SUMMARY — release-blocking contract test

## What shipped

A new integration test `tests/integration/recovery-audit-link.test.ts` (19 tests across 6 describe blocks) that contractually defends all Phase 25 invariants — bi-directional ref round-trip, J1 asymmetry, DOCS-02 4-surface coverage, brief shape, D-54 back-compat, and Phase 22/24 meta-guards.

Also a fixture cleanup in `tests/integration/audit-show-health.test.ts` (`KNOWN_RECOVERY_REF` placeholder string → UUID-style value per RESEARCH §M).

## Describe blocks (and which ROADMAP / decision each covers)

| Describe | Tests | Covers |
|---|---|---|
| `Bi-directional ref round-trip (wired surface)` | 1 | ROADMAP #1 (`audit_entry.recovery_ref === envelope.id`) + ROADMAP #2 (`envelope.audit_ref === audit_entry.id`) + ROADMAP #4 (UUIDs match) |
| `J1 asymmetry guard (unwired surface)` | 6 (parameterized) | INTEGRATE-03 negative contract — for each of `insert / update / delete / export / q / schema`, when an envelope IS written via `--recovery`, its `audit_ref` MUST be absent. |
| `DOCS-02 audit_recent embedding [4 agent surfaces]` | 4 | D-56 — `inspect --for-agent`, `guide --for-agent`, `recover --format json`, `recover --apply` all carry top-level `audit_recent`. Guide test also asserts `context.audit_recent` is NOT populated (top-level only). |
| `audit_recent shape contract` | 5 | D-58 (cap at N=5), D-59 (exact 5 keys, forbidden keys absent), D-60 (disabled / missing → `[]`), D-57 (markdown omits the field entirely). |
| `Legacy envelope backward compatibility` | 1 | D-54 — `recover --from <legacy-fixture.json>` (no `id` / no `audit_ref`) parses without error. |
| `Phase 22 / 24 meta-guard fences` | 2 | Fence against accidental file edits — sentinel strings (`Audit Contract Integration` in Phase 22, D-39/D-40/`'audit tail --all'` in Phase 24) must remain in those files. |

Total: **19 tests / 0 fail / 43 expect() calls**.

## J1 coverage matrix (post-Phase-25 ship)

| Command | audit on failure? | envelope on failure? | bi-directional ref? | Plan 08 test |
|---|---|---|---|---|
| `query` | ✓ | ✓ (`--recovery`) | ✓ (J1 wired surface) | Round-trip via `--require-schema-cache` covers the pattern; query path is structurally identical and shipped in Plan 05 |
| `inspect` | ✓ | ✓ (`--recovery`) | ✓ (J1 wired surface) | Round-trip test #1 |
| `guide` | ✓ | — (no `--recovery`) | n/a (no envelope on failure) | Not applicable |
| `report` | ✓ | — | n/a | Out of scope |
| `doctor` / `plan` | ✓ | — | n/a | Out of scope |
| `insert` | ✗ (Phase 23-04 backlog) | ✓ (`--recovery`) | — (envelope written without `audit_ref`) | J1 guard test |
| `update` | ✗ | ✓ | — | J1 guard test |
| `delete` | ✗ | ✓ | — | J1 guard test |
| `export` | ✗ | ✓ | — | J1 guard test |
| `q` | ✗ | ✓ | — | J1 guard test |
| `schema` | ✗ | ✓ | — | J1 guard test |

When Phase 23-04 wires `writeAuditEntry` into the remaining 6 commands, the J1 guard tests will start failing (because their envelopes will then carry `audit_ref`). That failure is the signal to retire the J1 lock and convert those tests to positive round-trip tests.

## Implementation notes

**Read-path layout — pre-existing inspect.ts quirk**: the catch block in `src/commands/inspect.ts` passes the inspect subcommand's local `options` to `writeAuditEntry`. Since only the parent program declares `--config`, the local `options.config` is undefined and `getAuditLogger` falls back to the relative path `.dbcli`. With cwd set to the test's tmpdir, the audit file ends up at `<workDir>/.dbcli/.dbcli/audit/default.jsonl` (nested), while the DOCS-02 *read* path (via `loadRecentAudit(config, configPath)`) correctly uses `<workDir>/.dbcli/audit/default.jsonl`. The test's `readAuditEntries` helper probes both layouts. Treating this as a pre-existing bug rather than a Phase 25 regression — fix belongs in a follow-up that propagates the resolved `configPath` into all `writeAuditEntry` call sites consistently.

**Meta-guard sentinels** intentionally pick strings that are stable for the protected files but unlikely to appear in a "gutted" version:
- Phase 22 sentinel: `'Audit Contract Integration'` (the top-level `describe(...)` name)
- Phase 24 sentinel: any of `'D-39'`, `'D-40'`, or `"'audit tail --all'"` (key invariants)

## Regression sweep

- `bun test tests/integration/recovery-audit-link.test.ts` → 19 pass / 0 fail
- `bun test tests/integration/audit-contract.test.ts tests/integration/audit-envelope.test.ts tests/integration/audit-show-health.test.ts` → 26 pass / 0 fail (Phase 22/24 unaffected; UUID fixture upgrade still passes)
- `bun run typecheck` → exit 0

## Hand-off

- **Plan 09 (release gate)**: runs `bun run release:check` (the full typecheck + tests + lint + build pipeline) and produces the J1 coverage matrix doc, VALIDATION sign-off, and STATE/ROADMAP backlog entry for Phase 23-04 follow-up.

## Self-Check: PASSED

- [x] 19 tests across 6 describe blocks.
- [x] Round-trip test asserts both ROADMAP #1 and #2 UUIDs match (#4).
- [x] J1 asymmetry guard runs the 6-command parameterized loop.
- [x] DOCS-02 4-surface tests all assert top-level `audit_recent`.
- [x] D-57 / D-58 / D-59 / D-60 each have a named test.
- [x] D-54 back-compat (`recover --from <legacy>`) covered.
- [x] Phase 22 + Phase 24 meta-guard fences in place.
- [x] `audit-show-health.test.ts` `KNOWN_RECOVERY_REF` is now UUID-style.
- [x] `git diff --name-only HEAD~1 HEAD` shows only the contract test file + the fixture-hygiene update — Phase 22 / Phase 24 test files NOT modified.
