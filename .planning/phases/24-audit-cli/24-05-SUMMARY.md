---
phase: 24-audit-cli
plan: 05
status: complete
completed: 2026-05-15
---

# Plan 24-05 Summary — `audit clear` + Envelope Contract

## Objective

Close out Phase 24:
1. Replace the `audit clear` placeholder with a full destructive flow (D-45 prompt, D-46 non-TTY guard, D-47 scope, D-48 session-id preservation, D-49 summary, F decision).
2. Lock the `tail --all` envelope wire format (D-39) with a contract test that lives **separate** from the Phase 22 entry-shape contract.

After this plan ships, all 4 `audit` subcommands have full implementations and CLI-01..06 are landed.

## What Was Built

### `audit clear` — control flow

| Path | Trigger | Behavior |
|---|---|---|
| Skip prompt | `--yes` flag | Delete `.jsonl + .jsonl.1 + .lock` immediately; print `summary_cleared` |
| TTY confirm | TTY attached, no `--yes` | Print D-45 prompt to **stderr** (header + per-file `entries / size`); read stdin; only `'y'` or `'yes'` (case-insensitive) proceeds |
| Non-TTY reject | no TTY, no `--yes` | exit 1 with `requires_tty_or_yes` (D-46 — agents in CI / pipes can't accidentally clear) |
| No-op | both files missing | exit 0 with `summary_nothing` |
| Decline | TTY confirm with anything other than y/yes | exit 0 with `summary_nothing` |
| Failure | rm throws | exit 1 with `summary_failed` (D-49) |

Constants:
- Prompt is sent to **stderr** (so stdout pipes stay clean for downstream tools)
- Accepted answers: trim().toLowerCase() ∈ {`'y'`, `'yes'`} — the project-wide `confirm()` helper accepts shorter inputs and uses inquirer-in-TTY; D-45 demands strict literal match, hence the inline `readLineFromStdinWithStderrPrompt`
- `--all` is **not registered** (D-47 — destructive cross-connection ops would be too easy to fire by accident)
- Audit-disabled fixtures still execute (clearing existing history is a valid op when `audit.enabled = false`)

### D-45 prompt — example output

```
About to clear audit log for connection 'default':
  /tmp/work/.dbcli/audit/default.jsonl       — 5 entries, 1.2 KB
  /tmp/work/.dbcli/audit/default.jsonl.1     — 3 entries, 712 B
Continue? [y/N]
```

### `audit clear` constraints (T-24-01, T-24-07, T-24-11, T-24-12 mitigations)

- No `writeAuditEntry` — no audit-on-audit loop (F decision; `clear` would write a "clear" entry that contradicts the file being deleted)
- No `logger.write()` call — same reason
- No `--all` flag — destructive scope must be one connection at a time
- No touch on `.dbcli/last-session-id` — session id is "cross-invocation identity," orthogonal to history (D-48); same session continues writing after `clear`
- Removes `.jsonl` + `.jsonl.1` + `.lock` (with `force: true` so missing files are silently ignored)

### `tests/integration/audit-clear.test.ts` (7 tests)

| # | Test | Path |
|---|---|---|
| 1 | `--yes` deletes both `.jsonl + .jsonl.1` | happy |
| 2 | empty audit dir prints `Nothing to clear` | no-op |
| 3 | non-TTY rejection | D-46 |
| 4 | `--yes` works on `audit.enabled = false` | E exception |
| 5 | `--yes` removes leftover `.lock` file | D-47 cleanup |
| 6 | clear does NOT write a new audit entry | F decision (acceptance test) |
| 7 | clear does NOT touch `.dbcli/last-session-id` | D-48 |

The interactive prompt itself (TTY input parser) is exercised by acceptance grep on the action source (`toLowerCase() === 'y'` and `=== 'yes'`) since spawn has no controlling TTY. Phase 26 docs/SKILL will record manual verification steps.

### `tests/integration/audit-envelope.test.ts` (5 tests, **separate from** `audit-contract.test.ts`)

Phase 22's `audit-contract.test.ts` locks the on-disk entry shape — the 9 required keys.
Phase 24's envelope is a CLI-only wrapper: `[{ connection, entry: <AuditEntry> }, ...]`.
Two contracts, two responsibilities, two files.

| # | Test | Locks |
|---|---|---|
| 1 | envelope element has `{connection: string, entry: <AuditEntry with all 9 required keys>}` | D-39 wire format |
| 2 | tie-break: same `ts` → connection lex ascending | D-42 |
| 3 | on-disk `.jsonl` lines never contain `connection` or `entry` keys | D-39 CLI-only invariant |
| 4 | single-connection tail (no `--all`) is flat array, not envelope | D-40 |
| 5 | meta-guard: Phase 22 `audit-contract.test.ts` does not contain `'envelope'` | cross-contract isolation |

Test 3 is the key invariant guard — it spawns `audit tail --all --format json`, then opens the underlying `.jsonl` files and parses each line, asserting no envelope wrapper leaked back to disk. If a future refactor accidentally writes `{connection, entry}` instead of `AuditEntry`, this test catches it.

Test 2 sets up the secondary connection with `i+3` timestamps that overlap the primary connection's mid-range, so a tie pair is guaranteed in the merged output. The assertion uses `localeCompare` — same comparator the source uses (`mergeByTimestamp`).

## Phase 24 Verification Roll-Up

| Gate | Result |
|---|---|
| All 4 `audit` placeholders removed | `audit show / clear / health` no longer print "not yet implemented" |
| F decision integral | `grep -E "writeAuditEntry\|logger\.write" src/commands/audit.ts` → 0 matches |
| `getAuditLogger` import scope | imported once (top of file), invoked only inside `health` action |
| Phase 22 `audit-contract.test.ts` untouched | meta-guard test 5 passes |
| `bun run typecheck` | PASS |
| `bun run lint --max-warnings=0` | PASS |
| `bun test` 4 audit CLI files | 49 pass / 0 fail / 366 expect() |
| `bun run release:check` | **PASS** (audit / prettier / typecheck / lint / 2390 tests / build / dist smoke) |

## Phase 24 REQ Coverage

| REQ | Plan(s) | Surface |
|---|---|---|
| CLI-01 (tail current connection, --n, time order) | 24-03 | `audit tail` |
| CLI-02 (tail --all merge) | 24-03 + 24-05 envelope | `audit tail --all` + envelope contract |
| CLI-03 (show by UUID, ≥4 prefix, --recovery-ref, --all) | 24-04 | `audit show` |
| CLI-04 (clear interactive + --yes + scope) | 24-05 | `audit clear` |
| CLI-05 (health writer status / lock / rotation cap / disabled marker) | 24-04 | `audit health` |
| CLI-06 (--format table\|json + --brief + --for-agent envelope/flat) | 24-03 + 24-04 + 24-05 | consistent across 4 subcommands |

## Self-Check: PASSED

All 12 `must_haves.truths` verified. F decision held end-to-end. D-39 envelope is CLI-only — guarded by test 3. D-42 tie-break exercised by real fixture data, not synthetic mocks of the comparator.

## Deviations

- After implementation, `prettier --check` flagged 8 files for formatting (Phase 24 added long lines / minor style drift across reader, audit.ts, capabilities.ts, and 5 test files). Fixed with `prettier --write` and committed separately as `style: [24] prettier --write across Phase 24 audit files`. No behavior change; re-run of `release:check` is fully green.

## Hand-Off to v1.20.0 Milestone Continuation

- **Phase 25 (recovery envelope ⇄ audit_ref)**: needs `audit show --recovery-ref <id>` (now landed) plus a writer-side `audit_ref` field added to recovery envelopes. The `--recovery-ref` query path is ready; phase 25 just needs to populate the reverse field.
- **Phase 26 (docs / SKILL / feature-matrix / release gate)**: needs the `audit` commander surface in its final shape (now stable) so docs/SKILL.md sections, `docs/feature-matrix.md` audit row, and CHANGELOG entry can quote actual flag sets and behaviors verbatim.

## Commits

- `8989445 feat: [24-05] audit clear + envelope contract test`
- `277b82a style: [24] prettier --write across Phase 24 audit files`
