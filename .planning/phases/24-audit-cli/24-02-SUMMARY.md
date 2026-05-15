---
phase: 24-audit-cli
plan: 02
status: complete
completed: 2026-05-15
---

# Plan 24-02 Summary — Capability Registry + i18n Block

## Objective

Pre-stage two cross-cutting registries so Wave 2/3 commander plans don't trail
edits into capabilities and i18n on every subcommand:

1. **Capability registry** — 4 new audit keys with correct tier mapping
2. **i18n** — full `audit.*` block in en + zh-TW (parallel key shape)

## What Was Built

### `src/adapters/capabilities.ts` (4 new keys)

| Key | Tier | Rationale |
|---|---|---|
| `auditTail` | `readonly` | Reads JSONL audit entries; never writes to engines |
| `auditShow` | `readonly` | Looks up a single audit entry by id prefix or recovery_ref |
| `auditHealth` | `readonly` | Renders `AuditLogger.getHealth()` snapshot |
| `auditClear` | `local-write` | Removes `<conn>.jsonl + .jsonl.1` from local disk; never touches DB (T-24-05 mitigation: explicit destructive marker so agents don't treat as readonly) |

Wiring (additive — no existing key altered):

- `CommandCapabilityKey` union: appended 4 string-literal members after `'skill'`
- `COMMAND_CAPABILITY_KEYS` array: appended 4 string entries after `'skill'`
- `ENGINE_INDEPENDENT` block: appended 4 `cap('supported', tier, note)` entries
- `satisfies Pick<EngineCapabilities, …>` clause: extended to include the 4 new names

Audit subcommands inherit into every engine via the existing
`...ENGINE_INDEPENDENT` spread inside `SQL_BASE` (line 138).
No per-engine override — audit subcommands are engine-independent by design.

### `resources/lang/{en,zh-TW}/messages.json` (parallel `audit` block)

Block inserted after `q` and before `queries` in both files.

**Top-level keys (15):**

| Key | Purpose |
|---|---|
| `description` | `dbcli audit --help` header |
| `tail.description` / `show.description` / `clear.description` / `health.description` | Subcommand descriptions for `--help` |
| `disabled_hint` | Shown when `audit.enabled = false` (E decision) |
| `no_entries` | Empty-tail message |
| `show_no_match` / `show_ambiguous` / `show_prefix_too_short` | `audit show <prefix>` error messages (D-35) |
| `show_recovery_no_match` / `show_recovery_ambiguous` | `audit show --recovery-ref <id>` error messages (D-37) |
| `show_mutex_violation` | `<id>` and `--recovery-ref` together rejected (D-38) |
| `n_capped_warning` / `n_must_be_positive` | `--n` argument guards |

**`clear.*` keys (8) — final wording for Wave 3 stderr assertions:**

| Key (en) | String (en) |
|---|---|
| `prompt_header` | `About to clear audit log for connection '{conn}':` |
| `prompt_file_line` | `  {file}       — {entries} entries, {size}` |
| `prompt_continue` | `Continue? [y/N] ` |
| `requires_tty_or_yes` | `Cannot prompt for confirmation in non-interactive session. Use --yes to clear without prompt.` |
| `summary_cleared` | `Cleared {count} entries from '{conn}'.` |
| `summary_nothing` | `Nothing to clear.` |
| `summary_failed` | `Failed to clear: {message}.` |
| `description` | `Delete audit log files (.jsonl + .jsonl.1) for the current connection` |

**`show_*` error message strings — final wording for Wave 3 ambiguous/no-match/mutex assertions (en):**

- `show_no_match`: `No audit entry matches '{prefix}'.`
- `show_ambiguous`: `Ambiguous prefix '{prefix}': matches {count} entries. Please use a longer prefix.`
- `show_prefix_too_short`: `Prefix must be at least 4 characters.`
- `show_recovery_no_match`: `No audit entry has recovery_ref '{ref}'.`
- `show_recovery_ambiguous`: `Multiple entries reference recovery_ref '{ref}': matches {count}. This should be rare; inspect file directly.`
- `show_mutex_violation`: `Provide either <id> argument or --recovery-ref, not both.`

zh-TW has the same key shape with Traditional Chinese (Taiwan) values; placeholders `{conn}/{count}/{file}/{prefix}/{ref}/{requested}/{max}/{message}/{size}/{entries}` match en exactly so the loader's substitution is locale-independent.

## Key Files

- **Modified:** `src/adapters/capabilities.ts` (+22 lines)
- **Modified:** `resources/lang/en/messages.json` (+33 lines, audit block)
- **Modified:** `resources/lang/zh-TW/messages.json` (+33 lines, audit block)

## Verification

| Check | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint --max-warnings=0` | PASS |
| `bun test capabilities + i18n` | 19 pass / 0 fail / 428 expect() |
| Two-locale audit/clear key parity (node script) | OK — 15 top-level + 8 clear keys, identical sets |
| Acceptance grep: 4 union members | 8 hits (4 in union + 4 in `satisfies Pick` — both required) |
| Acceptance grep: 4 array members | 4 |
| Acceptance grep: 4 ENGINE_INDEPENDENT entries | 4 |
| Acceptance grep: `auditClear` tier `'local-write'` | 1 |
| Acceptance grep: tail/show/health tier `'readonly'` count | 3 |

## Self-Check: PASSED

All `must_haves.truths` (4) verified — registry/array/union/satisfies all extended with 4 audit keys; both locales contain `audit.*` block; key sets aligned; tier mapping correct (T-24-05).

## Deviations

None. Acceptance grep on union member count returns 8 instead of 4 because the same regex matches both the `CommandCapabilityKey` union (4 hits) AND the `satisfies Pick<…>` clause (4 hits). Both locations correctly contain all 4 new keys; the count of 8 is expected once the satisfies clause is also extended to include them. Other acceptance criteria pass with exact counts.

## Hand-Off to Wave 2/3

- `t('audit.tail.description')` etc. resolve cleanly — no `[missing key]` fallbacks
- `getEngineCapability(engine, 'auditTail' | 'auditShow' | 'auditClear' | 'auditHealth')` returns the registered cap on every engine
- Wave 3 integration tests can assert exact stderr strings using the table above as the source of truth (en) — for zh-TW assertions, mirror via `t()` lookup, not hardcoded strings

## Commit

`8daf8f7 feat: [24-02] capability registry + i18n for audit subcommands`
