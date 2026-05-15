---
phase: 24-audit-cli
plan: 03
status: complete
completed: 2026-05-15
---

# Plan 24-03 Summary — `dbcli audit` Commander + `tail`

## Objective

Establish the `auditCommand` subtree (wired into `src/cli.ts`) and ship the
first subcommand, `audit tail`, including the `--all` cross-connection merge
path. Build the commander surface and stdout/stderr/exit-code conventions on
which Wave 3 plans (24-04 show/health, 24-05 clear/envelope) will extend.

## What Was Built

### `src/commands/audit.ts` — commander subtree + tail

| Element | Status | Notes |
|---|---|---|
| `auditCommand` export | full | `new Command('audit').description(t('audit.description'))` |
| `audit tail` | full | reader-backed, both formats, --all envelope |
| `audit show [id]` | placeholder | description-only stub; Wave 3 24-04 |
| `audit clear` | placeholder | description-only stub; Wave 3 24-05 |
| `audit health` | placeholder | description-only stub; Wave 3 24-04 |

`audit --help` lists all 4 subcommands as soon as Wave 2 ships.

### `tail` flag set (final)

| Flag | Default | Behavior |
|---|---|---|
| `--n <number>` | 10 | cap at 10000 (L); 0/negative/non-integer → exit 1 |
| `--all` | false | merge across `discoverConnections(auditDir)` |
| `--format <fmt>` | `table` | `table` or `json` |
| `--brief` | false | trim entry to ts/command/target/success |
| `--no-brief` | — | explicit override of `--for-agent`'s implicit brief |
| `--for-agent` | false | shortcut for `--format json --brief` |

`--brief` vs `--no-brief` are disambiguated via `command.getOptionValueSource('brief')` — only when the source is not `'default'` does the explicit value win. This lets `--for-agent --no-brief` correctly produce full-shape entries.

### JSON wire formats

| Mode | Shape | Decision |
|---|---|---|
| `audit tail --format json` | flat `AuditEntry[]` | D-40 |
| `audit tail --all --format json` | envelope `[{connection, entry}, ...]` | D-39 |

Sort: primary `entry.ts` ascending (latest last per D-5); tie-break on identical `ts` by connection name ascending (D-42).

### Empty / disabled handling

| Scenario | stderr | stdout | exit |
|---|---|---|---|
| `audit.enabled = false` | `audit.disabled_hint` (E) | empty | 0 |
| no entries, table | `'No audit entries.'` | empty | 0 |
| no entries, json | empty | `'[]'` | 0 |
| `--n <= 0` or non-integer | `audit.n_must_be_positive` | empty | 1 |
| `--n > 10000` | `audit.n_capped_warning` (capped to 10000) | full result | 0 |

### `src/cli.ts` wiring

Two additive lines:
- `import { auditCommand } from './commands/audit'` after `recoverCommand` import
- `program.addCommand(auditCommand)` after `program.addCommand(recoverCommand)`

`dbcli audit` becomes a top-level subtree alongside `recovery`, `inspect`, etc.

### `tests/integration/audit-tail.test.ts` (13 tests)

Spawn-based: real CLI, real reader, real i18n strings. No mocks.

Test setup writes a minimal valid `DbcliConfig` at `$work/config.json` and passes `--config $work` to the CLI so `resolveConfigStoragePath` returns the workspace root and `auditDir` resolves to `$work/.dbcli/audit/` (mirrors the convention in `tests/integration/audit-engines.test.ts` line 47 where `configPath: workDir`).

Covered behaviors:
- Happy table tail (latest last)
- Cross-rotation merge (`--n 15` spans `.jsonl.1 + .jsonl`)
- Flat array shape (D-40)
- Envelope shape with `--all` (D-39)
- Connection-name tie-break at identical `ts` (D-42)
- `--for-agent` brief mode + `--for-agent --no-brief` override
- Disabled config gate (E)
- Empty audit (both formats)
- `--n` cap warning (L) + non-positive rejection
- `audit --help` lists all 4 subcommands

## Wave 3 Hand-Off

The placeholders are intentionally narrow:

```ts
auditCommand
  .command('show [id]')
  .description(t('audit.show.description'))
  .action(async () => { console.error('audit show: not yet implemented (Wave 3)'); process.exit(1) })
```

24-04 / 24-05 will `Edit` the `.action(...)` body (and may add `.option(...)` chained calls) without touching the surrounding `.command(...).description(...)` skeleton. The container shape stays stable so `audit --help` output never regresses mid-execution.

**F decision constraint** (T-24-07 mitigation): Wave 3 plans MUST NOT introduce `import { writeAuditEntry }` into `src/commands/audit.ts`. Plan 24-04 may introduce `import { getAuditLogger }` *only inside the health subcommand path* — never inside `show`, `tail`, or `clear`. Acceptance greps in 24-04 / 24-05 will enforce.

## Key Files

- **Created:** `src/commands/audit.ts` (~257 lines)
- **Modified:** `src/cli.ts` (+2 lines, additive)
- **Created:** `tests/integration/audit-tail.test.ts` (13 tests)

## Verification

| Check | Result |
|---|---|
| `bun run typecheck` | PASS |
| `bun run lint --max-warnings=0` | PASS |
| `bun test tests/integration/audit-tail.test.ts` | 13 pass / 0 fail / 48 expect() |
| `bun run src/cli.ts audit --help` | shows 4 subcommands |
| Acceptance grep: `auditCommand` export | found |
| Acceptance grep: 4 `.command()` blocks | 4 |
| Acceptance grep: 6 documented flags | 6 |
| Acceptance grep: i18n `t('audit.*')` uses | 9 |
| Acceptance grep: zero `import.*writeAuditEntry` | 0 matches |
| Acceptance grep: zero `import.*getAuditLogger` | 0 matches |

## Self-Check: PASSED

All 14 `must_haves.truths` validated by 13 integration tests + greps. F decision enforced by acceptance criteria.

## Deviations

- **Path resolution convention**: tests pass `--config $work` (workspace root) rather than relying on a v3 binding pointer at `$work/.dbcli/config.json`. This mirrors the existing pattern in `tests/integration/audit-engines.test.ts` and avoids needing to read the `tests/fixtures/inspect/v1-postgres/.dbcli/config.json` content during plan execution. Production behavior unchanged: when dbcli `init` writes a v3 binding pointer, `resolveConfigStoragePath` returns the bound storage root.

## Commit

`3bebd67 feat: [24-03] dbcli audit commander + tail subcommand`
