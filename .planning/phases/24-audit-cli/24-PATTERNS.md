# Phase 24: `dbcli audit` CLI - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** 6 new + 4 modified = 10
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/audit/reader.ts` | service (functional module) | file-I/O / read-only scan | `src/core/audit/logger.ts` (writer counterpart) + `src/core/recovery/last-envelope.ts` (read-only envelope reader) | role-match |
| `src/commands/audit.ts` | controller (commander subtree) | request-response | `src/commands/queries.ts` | exact (subtree container) |
| `src/commands/audit.ts` (`tail`/`show`/`health` subcmd action) | controller | request-response | `src/commands/inspect.ts` (cleanest `--format`/`--brief`/`--for-agent` pattern) | exact |
| `src/commands/audit.ts` (`clear` subcmd action) | controller (destructive) | request-response | `src/utils/prompts.ts` `confirm()` + `src/commands/queries-delete.ts` (force-skip prompt pattern); no exact non-TTY-rejection precedent | role-match (compose two analogs) |
| `tests/unit/core/audit/reader.test.ts` | test (unit) | n/a | `tests/unit/core/audit/logger.test.ts` (sibling unit harness with tmpdir + makeLogger helper) | exact |
| `tests/integration/audit-cli.test.ts` | test (integration, commander surface) | n/a | `tests/integration/inspect.test.ts` + `tests/integration/recovery.test.ts` (spawn `bun run cli.ts` with `sanitizeEnv`) | exact |
| `tests/integration/audit-envelope.test.ts` | test (contract) | n/a | `tests/integration/audit-contract.test.ts` (Phase 22 — sibling style; **DO NOT modify**, write parallel file) | exact |
| `src/cli.ts` (modified) | config | n/a | `src/cli.ts:328-329` (`addCommand(recoveryCommand)` neighbor) | exact |
| `src/adapters/capabilities.ts` (modified) | config (registry) | n/a | `src/adapters/capabilities.ts` (`SQL_BASE` block + `ENGINE_INDEPENDENT` block) | exact |
| `resources/lang/{en,zh-TW}/messages.json` (modified) | i18n (locale) | n/a | `resources/lang/en/messages.json` `queries.*` section (sibling with subcommand-style `*_description` keys) | exact |

---

## Pattern Assignments

### `src/core/audit/reader.ts` (new — functional read-only module)

**Primary analog:** `src/core/audit/logger.ts` (sibling writer; reader mirrors path resolution but inverts read↔write)
**Secondary analog:** `src/core/recovery/last-envelope.ts` (existing read-only file scanner with tolerant parse)

**Imports pattern** — copy from `src/core/audit/logger.ts:18-25`:
```typescript
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AuditLockManager } from './lock'
import type { SessionIdService } from './session-id'
import { rotate, shouldRotate } from './rotation'
import type { AuditEntry } from './types'
```
**Reader's adaptation:** drop `appendFile` / `randomUUID` / lock / rotation / session-id imports — reader is read-only and lockless (G decision); keep `readFile` + `stat` + `join`, add `readdir` for `discoverConnections`. Keep `import type { AuditEntry } from './types'` — reader returns `AuditEntry[]`.

**Path resolution pattern** — copy from `src/core/audit/logger.ts:92-94`:
```typescript
this.auditDir = join(opts.storagePath, '.dbcli', 'audit')
this.auditFilePath = join(this.auditDir, `${opts.connectionName}.jsonl`)
this.previousFilePath = `${this.auditFilePath}.1`
```
**Reader's adaptation:** functional version — accept `auditFilePath` directly (caller resolves via `resolveConfigStoragePath` → `join(storage, '.dbcli/audit', `${conn}.jsonl`)`). `discoverConnections(auditDir)` reads `auditDir` and groups by basename minus `.jsonl[.1]` (D-44).

**Counter-resync (truncated last line tolerance)** — adapt `src/core/audit/logger.ts:223-234`:
```typescript
private async syncCountersFromDisk(): Promise<void> {
  try {
    const s = await stat(this.auditFilePath)
    this.currentSizeBytes = s.size
    const raw = await readFile(this.auditFilePath, 'utf8')
    this.currentEntryCount = raw.split('\n').filter(Boolean).length
  } catch {
    // File doesn't exist yet — counters stay at 0.
  }
}
```
**Reader's adaptation:** `readEntries(filePath)` does `readFile + split('\n').filter(Boolean)` per logger pattern, then `JSON.parse` each line in a try/catch. On the **last** line failure → stderr warn `[dbcli audit] skipping truncated last line in <file>` (D-08 + specifics §"Reader truncation tolerance") and skip. On a **middle** line failure → exit 1 with message pointing at `dbcli audit clear`.

**Functional API surface (G decision draft):**
```typescript
interface ReadOptions { include_rotated?: boolean }
function readEntries(auditFilePath: string, opts?: ReadOptions): Promise<AuditEntry[]>
function discoverConnections(auditDir: string): Promise<{ connection: string; files: string[] }[]>
function tailEntries(entries: AuditEntry[], n: number): AuditEntry[]
function mergeByTimestamp(byConn: Map<string, AuditEntry[]>): Array<{ connection: string; entry: AuditEntry }>
```

**What to copy:** the **path layout convention** (`<storagePath>/.dbcli/audit/<conn>.jsonl[.1]`) and the **read-then-split-then-filter-then-parse-line-by-line** pattern. Do **not** copy lock manager, rotation, session-id, or `writeChain` — reader is stateless and lockless (G decision: "reader 必須是 read-only、不持 lock；reader 容忍最後一行未完整 JSON → 跳過並 warn").

---

### `src/commands/audit.ts` — subtree container (D-31)

**Analog:** `src/commands/queries.ts:448-587` (commander sub-tree pattern)

**Subtree container declaration** — copy from `src/commands/queries.ts:448`:
```typescript
export const queriesCommand = new Command('queries').description(t('queries.description'))

queriesCommand
  .command('list')
  .description(t('queries.list_description'))
  .option('--format <type>', 'Output format: table, json, csv', 'table')
  // ...
  .action(async (options) => {
    await queriesList(options)
  })

queriesCommand
  .command('show <name>')
  .description(t('queries.show_description'))
  .option('--format <type>', 'Output format: table, json, csv', 'table')
  .action(async (name, options) => {
    await queriesShow(name, options)
  })
```

**What to copy:** the **`new Command('audit').description(t('audit.description'))` + chained `.command('tail|show|clear|health')` pattern**, with each subcommand getting its own `.description(t('audit.<sub>.description'))` and `.action(handler)`. Keep all 4 subcommands in this single file (mirror queries.ts which inlines `list`/`show`/`new`/`edit`/`check`/`search`/`suggest` and dynamic-imports the larger ones); for Phase 24, plan can either inline all 4 actions or extract `auditTail`/`auditShow`/`auditClear`/`auditHealth` functions in the same file (queries.ts uses inlined small + dynamic-import bigger; choose by code volume).

**Important:** D-31 says `dbcli audit --help` must show all 4 subcommands and **not** pollute `dbcli --help`. The `new Command('audit')` container achieves exactly this when registered via `program.addCommand(auditCommand)` in `src/cli.ts` (per `src/cli.ts:336` `program.addCommand(queriesCommand)`).

---

### `src/commands/audit.ts` — `tail` / `show` / `health` action (read commands)

**Analog:** `src/commands/inspect.ts` (cleanest `--format` + `--brief` + `--for-agent` + `validateFormat` pattern)
**Secondary analog:** `src/commands/report.ts:60-106` (same shape, includes `metadata` in audit write — but Phase 24 must NOT call `writeAuditEntry`, see Critical Adaptation below)

**Imports pattern** — copy from `src/commands/inspect.ts:1-7`:
```typescript
import { Command } from 'commander'
import { t } from '@/i18n/message-loader'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { collectInspect, renderJson, renderMarkdown } from '@/core/inspect'
import { configModule } from '@/core/config'
import { writeAuditEntry } from '@/core/audit/integration-helper'
```
**Phase 24 adaptation:** **DROP** `import { writeAuditEntry }` — F decision: `dbcli audit *` is metadata-only; subcommands must NOT call `writeAuditEntry`. Keep `t`, `resolveConfigPath`, `validateFormat`, `configModule`. **ADD** `import { readEntries, discoverConnections, tailEntries, mergeByTimestamp } from '@/core/audit/reader'`, `import { getAuditLogger } from '@/core/audit/integration-helper'` (for `health` only — to call `getHealth()`), and `import { resolveConfigStoragePath } from '@/core/config-binding'` (for audit dir resolution).

**Format constant + flag declaration** — copy from `src/commands/inspect.ts:9-17`:
```typescript
const ALLOWED_FORMATS = ['json', 'markdown'] as const

export const inspectCommand = new Command()
  .name('inspect')
  .description(t('inspect.description'))
  .option('--format <format>', 'Output format: json (default) or markdown', 'json')
  .option('--brief', 'Trim samples / intents / commands for compact output', false)
  .option('--for-agent', 'Shortcut for --format json --brief', false)
```
**Phase 24 adaptation:** D-32 — `ALLOWED_FORMATS = ['table', 'json'] as const` (table is default for read commands, mirroring `list.ts` not `inspect.ts`). Default in `--format` description string changes to `'Output format: table (default) or json', 'table'`.

**`--for-agent` shortcut + brief gating** — copy from `src/commands/inspect.ts:34-40`:
```typescript
.action(async (options: Record<string, unknown>, command: Command) => {
  let config: any
  try {
    const forAgent = options.forAgent === true
    const format = forAgent ? 'json' : (options.format as string)
    const brief = forAgent || options.brief === true
    validateFormat(format, ALLOWED_FORMATS, 'inspect')
    const configPath = resolveConfigPath(command, options as { config?: string })
    config = await configModule.read(configPath)
```
**What to copy verbatim:** the `forAgent → format='json' && brief=true` collapse and `validateFormat` call. Phase 24 specifics §"--for-agent 與 --brief 互動" require allowing `--for-agent --no-brief` to override → use commander's `.option('--no-brief', ...)` negate flag, then compute `brief = options.brief !== false && (forAgent || options.brief === true)`.

**Audit-write call sites at success/error** — `src/commands/inspect.ts:62-75`:
```typescript
if (config) {
  await writeAuditEntry(config, 'inspect', options, {
    success: true,
    target: '*',
  })
}
// ... in catch:
if (config) {
  await writeAuditEntry(config, 'inspect', options, {
    success: false,
    target: '*',
    error: err,
  })
}
```
**Critical Phase 24 adaptation:** **DELETE these blocks entirely.** F decision (24-CONTEXT.md line 81): "**`dbcli audit *` 本身定為 metadata-only**：**不**在這四個子指令呼叫 `writeAuditEntry`". Planner must explicitly verify `src/commands/audit.ts` contains zero `writeAuditEntry` references; this prevents audit-on-audit recursion and `clear` self-contradiction.

**Health-specific source** — Phase 24 `audit health` is a thin renderer over `AuditLogger.getHealth()` (logger.ts:193-221). Pattern:
```typescript
const logger = await getAuditLogger(config, configPath)
const health = logger.getHealth()  // returns AuditHealthReport (logger.ts:48-63)
// brief: drop {lock, lastError, sessionId, rotation}, keep {enabled, lastWrite, rotationUsage} (D-33)
// table render: render fields per 24-CONTEXT.md §"audit health 草案輸出"
```

---

### `src/commands/audit.ts` — `clear` action (destructive)

**Primary analog:** `src/commands/queries-delete.ts:27-33` (`--force` skip pattern with `confirm()`)
**Secondary analog:** `src/utils/prompts.ts:124-139` (the `confirm()` implementation; reads `process.stdin.isTTY` already)

**Force-skip + confirm pattern** — copy from `src/commands/queries-delete.ts:27-33`:
```typescript
if (!options.force) {
  const ok = await confirm({
    message: `Delete ${localVariants.length} local file(s) for ${name}?`,
    default: false,
  })
  if (!ok) return
}
for (const v of localVariants) {
  await rm(v.query.file, { force: true })
  console.log(`deleted ${v.query.file}`)
}
```
**Phase 24 adaptations:**
1. **Use `--yes` not `--force`** (D-46 explicit: "Use --yes to clear without prompt").
2. **Non-TTY rejection (no existing exact analog)** — D-46 mandates: when `!process.stdin.isTTY && !options.yes` → stderr `Cannot prompt for confirmation in non-interactive session. Use --yes to clear without prompt.` + `process.exit(1)`. Compose from `src/utils/prompts.ts:55-59` style:
   ```typescript
   if (!options.yes) {
     if (!process.stdin.isTTY) {
       console.error(t('audit.clear.requires_tty_or_yes'))
       process.exit(1)
     }
     // show D-45 prompt to stderr, then read 'y'/'yes' (case-insensitive) only
   }
   ```
3. **Prompt body** (D-45) — print to **stderr** (not stdout — avoids polluting any pipe consumer):
   ```
   About to clear audit log for connection '<conn>':
     .dbcli/audit/<conn>.jsonl       — N entries, X.X MB
     .dbcli/audit/<conn>.jsonl.1     — M entries, Y.Y MB    (if exists)
   Continue? [y/N]
   ```
   Use `readEntries(...)` (length) + `stat(...)` (size) for the entry/size summary. Default = N (Enter alone → no-op).
4. **Default-N confirm.** Use raw stdin read (`readLineFromStdin` style from `src/utils/prompts.ts:13-44`) **not** `confirm()` from `@inquirer/prompts` — Phase 24 needs literal `y` / `yes` (case-insensitive); `confirm()` returns boolean and accepts shorter inputs. Compose locally with `process.stdin` per `src/utils/prompts.ts:127-128`:
   ```typescript
   const answer = await readLineFromStdin('Continue? [y/N] ')
   const proceed = ['y', 'yes'].includes(answer.toLowerCase())
   ```
5. **Unlink scope** (D-47) — use `rm(file, { force: true })` per queries-delete.ts:35; remove **both** `<conn>.jsonl` and `<conn>.jsonl.1` plus any leftover `.lock` file. Do NOT support `--all` (D-47 — destructive op cross-connection risk).
6. **Summary line** (D-49) → **stderr** (consistent with `audit clear`'s prompt-on-stderr policy):
   ```typescript
   process.stderr.write(t_vars('audit.clear.summary', { count: cleared, conn }) + '\n')
   ```
7. **No audit entry written for clear itself** (F decision + D-49). Confirm: zero `writeAuditEntry` import.

**What to copy:** the `if (!options.force) { confirm(); ... } rm(file, { force: true })` skeleton from queries-delete.ts; the `process.stdin.isTTY` guard pattern from prompts.ts:55-59; the `readLineFromStdin` raw-stdin reader pattern from prompts.ts:13-44.

---

### `src/cli.ts` (modified — register subtree)

**Analog:** `src/cli.ts:325-336` (the `addCommand(...)` block)

**Single-line addition** — insert after line 328 `program.addCommand(recoveryCommand)`:
```typescript
program.addCommand(recoveryCommand)
program.addCommand(recoverCommand)
// ... after these:
program.addCommand(auditCommand)  // <-- NEW (Phase 24)
```
And add to the imports block at top (after line 25 `import { recoveryCommand } from './commands/recovery'`):
```typescript
import { auditCommand } from './commands/audit'
```

**What to copy:** verbatim the `addCommand(...)` line; place near `recoveryCommand` for thematic adjacency (audit + recovery are paired forensics surfaces). No commander hooks, no preAction/postAction wiring needed — `auditCommand` is self-contained.

---

### `src/adapters/capabilities.ts` (modified — 4 new capability rows)

**Analog:** `src/adapters/capabilities.ts:51-103` (CommandCapabilityKey enum + ENGINE_INDEPENDENT block)

**Capability key enum** — extend `src/adapters/capabilities.ts:13-42`:
```typescript
export type CommandCapabilityKey =
  | 'init'
  | 'use'
  // ... existing keys ...
  | 'recover'
  | 'skill'
```
**Phase 24 addition:** append 4 new keys before the closing union:
```typescript
  | 'auditTail'
  | 'auditShow'
  | 'auditClear'
  | 'auditHealth'
```
Also extend `COMMAND_CAPABILITY_KEYS` array (lines 51-80) with the same 4 strings in the same order.

**Capability row shape** — copy from `src/adapters/capabilities.ts:90-103`:
```typescript
const ENGINE_INDEPENDENT = {
  completion: cap('not-applicable', 'none', 'Shell completion is engine-independent.'),
  upgrade: cap('not-applicable', 'local-write', 'Package update checks are engine-independent.'),
  recover: cap(
    'not-applicable',
    'dry-run',
    'Recovery operates on saved envelopes and gated command steps.'
  ),
  skill: cap(
    'not-applicable',
    'local-write',
    'Skill and task-pack generation are engine-independent.'
  ),
}
```
**Phase 24 addition** (per F decision):
```typescript
const ENGINE_INDEPENDENT = {
  completion: ...,
  upgrade: ...,
  recover: ...,
  skill: ...,
  auditTail: cap('supported', 'readonly', 'Reads audit JSONL; never writes to engines.'),
  auditShow: cap('supported', 'readonly', 'Looks up a single audit entry by id or recovery_ref.'),
  auditHealth: cap('supported', 'readonly', 'Renders AuditLogger.getHealth() snapshot.'),
  auditClear: cap('supported', 'local-write', 'Removes <conn>.jsonl + .jsonl.1 from disk.'),
}
```
**Tier mapping reasoning:**
- `audit tail/show/health` → `'readonly'` (read-only, F decision).
- `audit clear` → `'local-write'` (destructive on disk, but only on dbcli's own files — analogous to `recover` (dry-run) / `skill` (local-write) classification; it does NOT touch the database, so should NOT be `db-write`. F decision says "destructive" colloquially but the SideEffectTier enum at `src/adapters/capabilities.ts:5-11` has no `'destructive'`; closest is `'local-write'`).

**What to copy:** the `cap(status, tier, note)` factory call pattern (line 82-88) and the placement inside `ENGINE_INDEPENDENT` (lines 90-103). All 4 audit capabilities are engine-independent: they operate on `.dbcli/audit/`, not on any DB engine. Do NOT add per-engine variations (no need to override in `mongodb`/`redis`/`elasticsearch` blocks).

---

### `resources/lang/{en,zh-TW}/messages.json` (modified — `audit.*` keys)

**Analog:** `resources/lang/en/messages.json:95-120` (`queries.*` block — sibling subcommand-rich i18n group)

**Block shape** — copy structure from `resources/lang/en/messages.json:95-120`:
```json
"queries": {
  "description": "Manage saved query snippets",
  "list_description": "List saved snippets",
  "show_description": "Show a snippet (frontmatter + SQL)",
  "new_description": "Create a new snippet file",
  ...
  "no_snippets": "No snippets found. Create one with: dbcli queries new @<name>",
  ...
}
```

**Phase 24 addition** (place adjacent to `queries` for alphabetical clustering — `audit` comes before `errors` and `queries`; insert after the existing `recovery` block, near top):
```json
"audit": {
  "description": "Inspect, look up, clear, or check the health of the audit log",
  "tail": {
    "description": "Show recent audit entries (default: last 10 from current connection)"
  },
  "show": {
    "description": "Look up a single audit entry by id (UUID prefix >=4) or --recovery-ref"
  },
  "clear": {
    "description": "Delete audit log files (.jsonl + .jsonl.1) for the current connection",
    "prompt_header": "About to clear audit log for connection '{conn}':",
    "prompt_continue": "Continue? [y/N]",
    "requires_tty_or_yes": "Cannot prompt for confirmation in non-interactive session. Use --yes to clear without prompt.",
    "summary_cleared": "Cleared {count} entries from '{conn}'.",
    "summary_nothing": "Nothing to clear.",
    "summary_failed": "Failed to clear: {message}."
  },
  "health": {
    "description": "Show AuditLogger health snapshot (size, entries, lock state, last write)"
  },
  "disabled_hint": "Audit is disabled (audit.enabled = false in .dbcli). Use 'dbcli audit health' for details.",
  "no_entries": "No audit entries.",
  "show_no_match": "No audit entry matches '{prefix}'.",
  "show_ambiguous": "Ambiguous prefix '{prefix}': matches {count} entries. Please use a longer prefix.",
  "show_prefix_too_short": "Prefix must be at least 4 characters.",
  "show_recovery_no_match": "No audit entry has recovery_ref '{ref}'.",
  "show_mutex_violation": "Provide either <id> argument or --recovery-ref, not both.",
  "n_capped_warning": "--n value {requested} exceeds max {max}; capped to {max}."
}
```

**Parity rule** (project-level, see CLAUDE.md "Multi-language Parity"): every key added to `en/messages.json` MUST be added to `zh-TW/messages.json` with Traditional Chinese (Taiwan usage) text. Examples:
- `audit.disabled_hint` (en): "Audit is disabled (audit.enabled = false in .dbcli). Use 'dbcli audit health' for details."
- `audit.disabled_hint` (zh-TW): "Audit 已停用（.dbcli 中 audit.enabled = false）。執行 `dbcli audit health` 查看詳情。"

**What to copy:** the `*_description` key naming convention from queries.* (used by commander `.description(t('audit.<sub>.description'))`); use `t_vars` for any message containing `{conn}`/`{count}`/`{prefix}` placeholders (per `src/i18n/message-loader.ts:111-112`).

**i18n loader call site** — verbatim from `src/commands/inspect.ts:13`:
```typescript
.description(t('inspect.description'))
```
Phase 24: `.description(t('audit.description'))`, `.description(t('audit.tail.description'))`, etc.

---

### `tests/unit/core/audit/reader.test.ts` (new)

**Analog:** `tests/unit/core/audit/logger.test.ts` (sibling unit test in same directory with `mkdtemp` + `tmpdir` fixture)

**Test harness imports** — copy from `tests/unit/core/audit/logger.test.ts:19-27`:
```typescript
import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AuditLogger } from '@/core/audit/logger'
// ...
```
**Phase 24 adaptation:** `import { readEntries, discoverConnections, tailEntries, mergeByTimestamp } from '@/core/audit/reader'` instead of AuditLogger. Keep `mkdtemp`/`writeFile`/`rm` for fixture management — H decision §"Unit": reader (含 truncated last line tolerance), merge sort with tie-break, prefix matcher (含 ambiguous / too-short / no-match), recovery-ref matcher, clear 的 file unlink.

**Fixture pattern** — adapt from `tests/integration/audit-contract.test.ts:16-24`:
```typescript
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'dbcli-audit-reader-'))
  auditDir = join(workDir, '.dbcli', 'audit')
  auditFile = join(auditDir, 'default.jsonl')
})
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})
```

**Truncated-last-line test** (specifics §"Reader truncation tolerance") — write a fixture file ending with an incomplete JSON line, assert `readEntries` returns `n-1` entries plus stderr contains `[dbcli audit] skipping truncated last line`.

**What to copy:** the `mkdtemp`/`workDir`/`auditDir`/`auditFile` fixture pattern, `beforeEach`/`afterEach` symmetry, and the `expect(...).toBe(...)` assertions style.

---

### `tests/integration/audit-cli.test.ts` (new — commander surface)

**Analog:** `tests/integration/inspect.test.ts:1-36` (CLI spawn pattern via `bun run src/cli.ts`)
**Secondary analog:** `tests/integration/recovery.test.ts:18-45` (sanitizeEnv to strip `DBCLI_*` env)

**spawn helper + sanitizeEnv** — copy verbatim from `tests/integration/recovery.test.ts:18-45`:
```typescript
function sanitizeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (/^DBCLI_/i.test(k)) continue
    if (k === 'DATABASE_URL') continue
    out[k] = v
  }
  out.NODE_ENV = 'test'
  out.DBCLI_NO_UPDATE_CHECK = '1'
  return out
}

function run(args: string[], cwd = FIXTURE): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const child = spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b) => (stdout += b.toString()))
    child.stderr.on('data', (b) => (stderr += b.toString()))
    child.on('close', (code) => res({ stdout, stderr, code: code ?? 0 }))
  })
}
```

**Test cases to cover** (H decision §"Integration"):
- `audit tail` happy path -> exit 0, table output, last 10 entries
- `audit tail --format json --n 5` -> JSON flat array (D-40)
- `audit tail --all --for-agent` -> JSON envelope array `[{connection, entry}, ...]` (D-39)
- `audit show <full-uuid>` happy path
- `audit show <prefix->=4>` happy path
- `audit show <prefix-3>` -> exit 1 with `Prefix must be at least 4 characters.`
- `audit show <ambiguous-prefix>` -> exit 1 with `Ambiguous prefix...`
- `audit show <no-match>` -> exit 1 with `No audit entry matches...`
- `audit show --recovery-ref <id>` happy path
- `audit show <id> --recovery-ref <id>` -> exit 1 with `Provide either ...`
- `audit clear --yes` -> success, files removed
- `audit clear` (no `--yes`, no TTY since spawn) -> exit 1 with `Cannot prompt for confirmation in non-interactive session.` (D-46)
- `audit health` happy path -> table with all expected fields
- `audit tail` when `audit.enabled = false` -> exit 0 with `Audit is disabled (...)` to stderr (E decision)

**What to copy:** the `spawn('bun', ['run', CLI, ...args], { cwd, env: sanitizeEnv() })` skeleton, the `expect(code).toBe(0)` + `JSON.parse(stdout)` shape assertions from `tests/integration/inspect.test.ts:42-54`, and the `beforeAll` fixture-copy pattern from inspect.test.ts:26-36 (since Phase 24 needs pre-seeded `.jsonl` fixtures).

---

### `tests/integration/audit-envelope.test.ts` (new — contract test for envelope shape)

**Analog:** `tests/integration/audit-contract.test.ts` (Phase 22 — sibling contract test)

**Critical constraint** (24-CONTEXT.md line 137): "**`tests/integration/audit-contract.test.ts` — entry shape 已鎖；Phase 24 在 envelope wrapper 上另寫獨立測試，不改既有 contract test 的 entry 期望.**"

**Imports + harness** — copy from `tests/integration/audit-contract.test.ts:1-24`:
```typescript
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// ... fixture setup with mkdtemp
```

**Envelope assertion** — Phase 24 specific: drive `dbcli audit tail --all --format json` over a fixture with 2+ connections; assert each item has `{connection: string, entry: AuditEntry}` shape and `entry` itself still satisfies the Phase 22 contract (full required key set).

**Tie-break test** (D-42): write entries to two connections with identical `ts`; assert dictionary-sorted connection name wins.

**What to copy:** the contract-test file structure (mkdtemp fixture + JSON.parse output + `toHaveProperty` cascade); do **not** import or modify `audit-contract.test.ts` itself.

---

## Shared Patterns

### Storage path resolution (all reader code paths + clear)

**Source:** `src/core/audit/integration-helper.ts:22-30` (`getAuditLogger` connection-name derivation)
**Apply to:** `src/commands/audit.ts` (every subcommand needs current connection name) AND `src/core/audit/reader.ts:discoverConnections`

```typescript
const storagePath = await resolveConfigStoragePath(configPath)
const connName =
  (config as { effectiveConnectionName?: string }).effectiveConnectionName ||
  getGlobalConnectionName() ||
  'default'
```

**What to copy:** the **3-tier fallback chain** (`effectiveConnectionName` -> `getGlobalConnectionName()` -> literal `'default'`), aligned with D-14 ("V1 / 未命名 config 的 audit 檔名為 `default.jsonl`"). The audit dir itself is `join(storagePath, '.dbcli', 'audit')` per `src/core/audit/logger.ts:92`. **Reader's `discoverConnections(auditDir)` does not need this chain** — it scans the directory and derives connection names from file basenames per D-44.

### Format validation (read commands)

**Source:** `src/utils/validation.ts:241-250`
**Apply to:** `audit tail`, `audit show`, `audit health` (NOT `audit clear` — D-32 "audit clear 不暴露 --format")

```typescript
export function validateFormat(value: string, allowedFormats: readonly string[], commandName: string): void {
  if (!allowedFormats.includes(value)) {
    const allowed = allowedFormats.join(', ')
    throw new Error(`Invalid format "${value}" for ${commandName}. Allowed: ${allowed}`)
  }
}
```
Use `validateFormat(format, ['table', 'json'], 'audit tail')` (etc.). Subcommand name in error message helps agent diagnose the wrong invocation surface.

### `--for-agent` shortcut + `--no-brief` override

**Source:** `src/commands/inspect.ts:37-39` (compute `forAgent -> format='json' && brief=true`)
**Apply to:** all 3 read commands

```typescript
const forAgent = options.forAgent === true
const format = forAgent ? 'json' : (options.format as string)
const brief = forAgent || options.brief === true
```
**Phase 24 nuance** (specifics §"--for-agent 與 --brief 互動"): allow `--no-brief` override. Use commander `.option('--no-brief', '...', undefined)` and compute `brief = options.brief === false ? false : (forAgent || options.brief === true)`.

### stderr vs stdout split

**Source:** `src/commands/list.ts:113` (machine-consumable `console.log` to stdout) + `src/commands/list.ts:88` (human hint to `console.log` for the `t('list.no_tables')` empty case — but `inspect.ts:81` / `recovery.ts:106` use `console.error` for errors)
**Apply to:** `audit *` consistently

| Output | Stream | Example |
|--------|--------|---------|
| Machine-consumable JSON / table | stdout (`console.log`) | `audit tail --format json` payload |
| Human prompts (`audit clear` confirm) | stderr (`process.stderr.write` or `console.error`) | D-45 prompt body |
| Error messages, exit-1 reasons | stderr (`console.error`) | `audit show 5f3` ambiguous error |
| `audit.enabled = false` notice | stderr (`console.error`) | E decision disabled hint |
| Empty table case (`No audit entries.`) | stderr (`console.error`) | E decision: `table 印 No audit entries.（stderr）` |
| Empty JSON case (`[]`) | stdout (`console.log('[]')`) | E decision: `JSON []` |
| `audit clear` summary line | stderr (`process.stderr.write`) | D-49 |

### Audit-write call sites — **MUST NOT exist** in `src/commands/audit.ts`

**Source of negative pattern:** F decision in 24-CONTEXT.md line 81
**Apply to:** entire `src/commands/audit.ts` file
Planner verification (after writing): `grep -n "writeAuditEntry\|getAuditLogger" src/commands/audit.ts` — should return only the **single** import of `getAuditLogger` for `audit health`'s `getHealth()` call. Zero `writeAuditEntry` references.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Non-TTY rejection in destructive commands | guard | request-response | No existing dbcli command rejects destructive ops on non-TTY without `--yes`. `init` (`init.ts:730`), `shell` (`shell.ts:149,164`), `insert` (`insert.ts:57`) only **detect** TTY; none **reject** with exit 1. **Compose** `process.stdin.isTTY` (per `src/utils/prompts.ts:55-59,81,126`) + `console.error(...)` + `process.exit(1)` from scratch. The pattern is small enough that no analog is required. |
| `--n` cap-and-warn | validation | request-response | No existing command implements numeric upper bound with stderr warn (closest is `q.ts` query size guard which **errors** rather than warns). Implement from L decision: `if (n > 10000) { console.error(t_vars('audit.n_capped_warning', {requested: n, max: 10000})); n = 10000; }`. |

---

## Metadata

**Analog search scope:**
- `src/commands/` (37 commander handler files)
- `src/core/audit/` (6 existing audit modules)
- `src/core/recovery/` (envelope reader pattern reference)
- `src/utils/{prompts,validation,config-path}.ts`
- `src/i18n/message-loader.ts` + `resources/lang/{en,zh-TW}/messages.json`
- `tests/unit/core/audit/` + `tests/integration/audit-{contract,engines}.test.ts`
- `tests/integration/{inspect,recovery,recover-*,guide}.test.ts` (CLI-surface analogs)

**Files scanned:** 14 source files + 4 test files
**Pattern extraction date:** 2026-05-15

---

## PATTERN MAPPING COMPLETE
