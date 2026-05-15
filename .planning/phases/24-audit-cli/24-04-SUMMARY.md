---
phase: 24-audit-cli
plan: 04
status: complete
completed: 2026-05-15
---

# Plan 24-04 Summary — `audit show` + `audit health`

## Objective

Replace the two `audit show` and `audit health` placeholders left by Wave 2,
landing CLI-03 (single-entry forensics: UUID, ≥4 prefix, recovery-ref) and
CLI-05 (writer health snapshot). CLI-06's `--format / --brief / --for-agent /
--no-brief` semantics are extended consistently to both new actions.

## What Was Built

### `audit show` — 4 query paths

| Path | Behavior |
|---|---|
| `audit show <full-uuid>` | exact id match in current connection (with rotated `.jsonl.1`) |
| `audit show <prefix-≥4>` | startsWith match: 0 → `show_no_match`; 1 → render; ≥2 → `show_ambiguous` |
| `audit show --recovery-ref <ref>` | exact `entry.recovery_ref` match (D-37); same 0/1/≥2 fan-out using `show_recovery_no_match` / `show_recovery_ambiguous` |
| `audit show <id-or-prefix> --all` | cross-connection scan via `discoverConnections`; output is envelope `{connection, entry}` (D-36) |

### Error paths (exit 1) — final i18n strings

| Trigger | i18n key |
|---|---|
| `<id>.length < 4` | `audit.show_prefix_too_short` |
| no entry matches `<prefix>` | `audit.show_no_match` |
| ≥2 entries match `<prefix>` | `audit.show_ambiguous` |
| no entry matches `--recovery-ref` | `audit.show_recovery_no_match` |
| ≥2 entries reference same `recovery_ref` | `audit.show_recovery_ambiguous` |
| `<id>` and `--recovery-ref` together (or neither) | `audit.show_mutex_violation` (D-38) |

### `show` flag set

| Flag | Default | Behavior |
|---|---|---|
| `--all` | false | cross-connection envelope |
| `--recovery-ref <ref>` | — | exact `recovery_ref` lookup |
| `--format <fmt>` | `table` | `table` (vertical key:value) or `json` |
| `--brief` | false | strip `metadata` + `redacted_query` (D-33 show variant) |
| `--no-brief` | — | explicit override, beats `--for-agent` |
| `--for-agent` | false | `--format json --brief` |

`--brief` vs `--no-brief` disambiguation uses `command.getOptionValueSource('brief')` (mirrors `tail`).

`renderEntryTable` accepts `Partial<AuditEntry>` and emits a row only when the field is present — so `--brief` table mode does NOT print `'Redacted query: undefined'` (W-05 guarded).

### `audit health` — thin renderer over `AuditLogger.getHealth()`

Table output (9 rows):

```
Enabled:        true
File:           /path/to/.dbcli/audit/default.jsonl
Size:           0 B / 10.0 MB (0%)
Entries:        0 / 1000 (0%)
Lock:           free
Last write:     —
Last error:     —
Session id:     —
Last rotation:  —
```

`--format json` returns the full `AuditHealthReport` shape from `src/core/audit/logger.ts:48-63`. `--brief` (D-33 health variant) keeps only `enabled / lastWrite / rotationUsage`.

**E exception:** `health` is the only `read` subcommand that does NOT short-circuit on `audit.enabled = false`. The whole point of `health` is to observe the enabled-state. With audit disabled, the snapshot still renders and `Enabled: false` is printed normally.

### `tests/integration/audit-show-health.test.ts` (18 tests)

| Group | # | Coverage |
|---|---|---|
| `show` | 12 | full uuid, ≥4 prefix happy, prefix-3 reject, ambiguous prefix, no-match, recovery-ref happy/no-match, `<id>`+`--recovery-ref` mutex, `--all` envelope, brief json (no metadata/redacted_query), brief table (no 'undefined'), disabled hint |
| `health` | 6 | 9-row table, full json shape, brief json (3 keys), `--for-agent` = brief json, `--for-agent --no-brief`, **disabled fixture still shows snapshot** (E exception) |

## D-33 Brief Variants — final mapping

| Subcommand | Brief variant |
|---|---|
| `tail` | `Pick<AuditEntry, 'ts' \| 'command' \| 'target' \| 'success'>` (24-03) |
| `show` | `Omit<AuditEntry, 'metadata' \| 'redacted_query'>` (this plan) |
| `health` | `Pick<AuditHealthReport, 'enabled' \| 'lastWrite' \| 'rotationUsage'>` (this plan) |

Brief is implemented at the **render layer**, never inside the reader (J decision). The reader always returns full `AuditEntry`; the action handler decides what to strip per the user's flags.

## Key Files

- **Modified:** `src/commands/audit.ts` (placeholder removal + ~190 lines for show/health helpers and actions)
- **Created:** `tests/integration/audit-show-health.test.ts` (18 tests)

## Verification

| Check | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint --max-warnings=0` | PASS |
| `bun test tests/integration/audit-show-health.test.ts` | 18 pass / 0 fail / 64 expect() |
| `bun test audit-tail + audit-show-health` | 31 pass / 0 fail / 112 expect() |
| Acceptance grep: show placeholder removed | gone |
| Acceptance grep: health placeholder removed | gone |
| Acceptance grep: `--recovery-ref` registered | found |
| Acceptance grep: `PREFIX_MIN = 4` | found |
| Acceptance grep: `getAuditLogger` import | found (single use point) |
| Acceptance grep: `AuditHealthReport` type import | found |
| Acceptance grep: zero `import.*writeAuditEntry` | 0 matches |
| Acceptance grep: zero `logger.write` calls | 0 matches |

## Self-Check: PASSED

All 14 `must_haves.truths` validated. F decision held: `getAuditLogger` is now imported but is only invoked at the `health` action site (read-only `.getHealth()`); no `writeAuditEntry` import or `logger.write()` call exists anywhere in `src/commands/audit.ts`.

## Deviations

None. The eslint config does not respect the `_prefix` ignore convention for destructured locals, so `briefifyShow` uses an inline `eslint-disable-next-line` for the unused `metadata` and `redacted_query` bindings — semantically identical to the plan spec, just complies with project lint rules.

## Wave 3 Hand-Off (Plan 24-05)

`audit clear` placeholder remains untouched — Wave 3 plan 24-05 will replace it. The auditCommand container shape is unchanged, so `audit --help` continues to list all 4 subcommands. F decision constraint stays: 24-05 MUST NOT introduce `writeAuditEntry` (the `clear` subcommand is the only one that physically removes data; auditing the auditor would create a self-contradiction loop).

## Commit

`16324c3 feat: [24-04] dbcli audit show + health subcommands`
