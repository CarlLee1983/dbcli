# Command Completion Source of Truth Design Specification

**Date:** 2026-06-22
**Status:** Implemented (2026-06-22) — retained as a design record
**Baseline:** Current `dbcli completion` and `dbcli shell` autocomplete implementation

> **Verification note (2026-06-22):** All goals and acceptance criteria below are
> implemented. The shared metadata model lives in
> `src/core/completion/command-tree.ts`; `src/commands/completion.ts` generates
> bash/zsh/fish from it; the REPL seeds command names from the same tree via
> `src/core/repl/command-registry.ts` (seeded in `src/commands/shell.ts`).
> Covered by `tests/unit/commands/completion.test.ts` and
> `tests/core/repl/completer.test.ts`. Remaining follow-up: the REPL command
> registry is still a module-level singleton seeded at shell startup (acceptable
> interim of §9 option 2); migrating to an explicit snapshot passed into
> `createCompleter()` / `isKnownCommand()` (§9 option 1) is deferred backlog.

## 1. Purpose

Make command completion trustworthy across installed shell completion scripts and
the interactive `dbcli shell` REPL.

The current implementation can generate bash, zsh, and fish completion scripts,
and the REPL can complete SQL keywords, table names, Redis commands, and a
small set of dbcli commands. The gap is that command metadata is split across
multiple hand-maintained surfaces. As the CLI has grown, completion behavior has
drifted from the actual command tree.

This spec defines the next development step: introduce one command metadata
source that can drive installed shell completions and REPL command completion,
with explicit support for nested subcommands.

## 2. Current Evidence

- `src/commands/completion.ts` generates bash, zsh, and fish scripts from
  Commander metadata.
- `extractCommands()` in `src/commands/completion.ts` only reads first-level
  commands and direct options.
- `src/core/repl/types.ts` defines a static `DBCLI_COMMANDS` list for REPL
  completion and command dispatch.
- `src/core/repl/completer.ts` reads `DBCLI_COMMANDS` to complete command names.
- `src/core/repl/command-dispatcher.ts` uses `DBCLI_COMMANDS` to decide whether
  a shell input is a known dbcli command.
- `src/cli.ts` registers more top-level commands than `DBCLI_COMMANDS` contains,
  including `q`, `queries`, `inspect`, `report`, `guide`, `audit`, `verify`,
  `verification`, `proxy`, `assert`, `snapshot`, and `use`.
- Generated shell completion output currently leaves subcommand-heavy groups
  such as `queries`, `migrate`, `audit`, `verify`, and `verification` with empty
  option completions.
- Targeted tests pass today, but they mostly assert that completion output
  contains expected headers and simple command names; they do not lock nested
  command behavior or metadata parity.

## 3. Problem Statement

Completion is advertised as a user-facing productivity feature, but it does not
faithfully represent dbcli's current command surface.

That creates four practical issues:

1. Top-level and REPL command suggestions can omit valid commands.
2. Nested command groups appear in completion but do not complete useful child
   commands or leaf options.
3. Future command additions can silently miss completion support.
4. Installed shell startup can run `dbcli completion <shell>` and inherit normal
   CLI post-action update reminders, causing avoidable startup noise.

## 4. Goals

1. Use one command metadata model for installed shell completion generation and
   REPL command completion/dispatch.
2. Support nested command completion for at least two levels of subcommands,
   with no hard-coded depth limit in the metadata model.
3. Preserve existing SQL/table/column/meta/Redis completion behavior in
   `dbcli shell`.
4. Make generated bash, zsh, and fish completions useful for subcommand-heavy
   groups.
5. Prevent completion generation from emitting update or skill reminder noise
   during shell startup.
6. Add regression tests that fail when CLI registration and completion metadata
   drift apart.
7. Keep the change dependency-free and Bun-native.

## 5. Non-Goals

- Do not add dynamic database object completion to installed shell scripts.
- Do not execute database queries from installed shell completion scripts.
- Do not add a background daemon or persistent completion cache.
- Do not replace Commander.
- Do not redesign SQL keyword, column, table, MongoDB, Redis, or Elasticsearch
  REPL completion semantics beyond preserving current behavior.
- Do not make completion scripts parse every shell quoting edge case perfectly in
  this milestone.
- Do not change command behavior outside completion and REPL command
  recognition.
- Do not update user documentation in this spec-only step; documentation updates
  belong to the implementation task when command behavior changes.

## 6. Selected Approach

Introduce a small command metadata module that converts a Commander command tree
into a serializable `CompletionCommandNode` tree.

The shell completion command uses this tree to generate bash, zsh, and fish
scripts. The REPL uses the same tree, or a derived top-level command list, for
command completion and known-command dispatch.

The command tree remains built from Commander registration. This avoids creating
a second manual registry that can drift from the actual CLI. The metadata module
is read-only: it inspects `Command` instances and returns plain objects that are
easy to test.

## 7. Command Metadata Contract

Add a new module:

```text
src/core/completion/command-tree.ts
```

It owns the shared data shape:

```ts
export interface CompletionOption {
  readonly long?: string
  readonly short?: string
  readonly requiredValue: boolean
  readonly optionalValue: boolean
  readonly description: string
}

export interface CompletionCommandNode {
  readonly name: string
  readonly description: string
  readonly options: readonly CompletionOption[]
  readonly children: readonly CompletionCommandNode[]
}
```

The module should expose:

```ts
export function buildCompletionTree(program: Command): CompletionCommandNode
export function listTopLevelCommandNames(root: CompletionCommandNode): string[]
export function findCommandPath(
  root: CompletionCommandNode,
  path: readonly string[]
): CompletionCommandNode | undefined
```

Rules:

- Include the root program as the root node.
- Include every registered child command recursively.
- Include both long and short flags when present.
- Preserve option value shape using Commander option metadata where available.
- Exclude Commander help from the model unless it is explicitly registered as a
  normal option by the command.
- Keep command names and option strings uncolored and unlocalized.
- Do not include hidden implementation details such as action handlers.

## 8. Installed Shell Completion Behavior

### 8.1 Bash

Generated bash completion must:

- Complete root-level commands and global options after `dbcli `.
- Complete child subcommands after a command group, for example:
  `dbcli queries <TAB>` suggests `list`, `show`, `new`, `edit`, `check`,
  `delete`, `rename`, `copy`, `import`, `export`, `search`, and `suggest`.
- Complete leaf options for nested paths, for example:
  `dbcli queries list --<TAB>` suggests `--format`, `--tag`, `--engine`, and
  `--source`.
- Complete `dbcli migrate add-column --<TAB>` with `--nullable`, `--default`,
  and `--unique`.
- Complete `dbcli verify safe-backfill --<TAB>` with `--after-write`,
  `--format`, `--subject-name`, and `--summary`.
- Fall back to root global options only when the active path cannot be matched.

### 8.2 Zsh

Generated zsh completion must provide the same command-path and leaf-option
coverage as bash. It can use `_arguments` and nested state handlers, but the
generated script must be derived from the same `CompletionCommandNode` model.

### 8.3 Fish

Generated fish completion must provide:

- Root command completions through `complete -c dbcli -n '__fish_use_subcommand'`.
- Subcommand completions scoped to the parent path.
- Leaf options scoped to the matched command path.

Fish output does not need to support descriptions richer than the command or
option description already available in the metadata model.

## 9. REPL Behavior

`dbcli shell` must keep its current non-command completion behavior:

- SQL keyword completion.
- Table completion after SQL table-position keywords.
- Column completion in column-position SQL contexts.
- Meta command completion for `.help`, `.quit`, `.exit`, `.clear`, `.format`,
  `.history`, `.timing`, and `.no-limit`.
- Redis command and key completion in Redis mode.

Command-name completion and known-command dispatch must stop depending on the
stale hand-written `DBCLI_COMMANDS` constant.

The implementation may choose one of two acceptable shapes:

1. Preferred: pass a `CompletionCommandNode` or command-name array into
   `createCompleter()` and `isKnownCommand()` from the CLI registration layer.
2. Acceptable interim: generate `DBCLI_COMMANDS` from a shared command metadata
   module and add a parity test proving it contains every intended REPL-visible
   top-level command.

REPL command dispatch must keep blocking `shell` from recursive shell launches.
If other top-level commands are unsafe or nonsensical inside the REPL, they must
be excluded by an explicit denylist with tests and comments explaining why.

## 10. Completion Install Behavior

For bash and zsh, the installed rc block should remain marker-managed:

```sh
# >>> dbcli completion >>>
eval "$(DBCLI_NO_UPDATE_CHECK=1 dbcli completion zsh)"
# <<< dbcli completion <<<
```

The exact environment form can vary by shell if necessary, but installed
completion generation must avoid update checks and skill update reminders during
shell startup.

`dbcli completion <shell>` itself should also be quiet on stderr in normal
success cases. Unsupported shells must continue to fail closed with a non-zero
exit code and a clear error message.

Fish installation should continue writing a completion file to:

```text
~/.config/fish/completions/dbcli.fish
```

## 11. Testing Requirements

### 11.1 Unit Tests

Add or expand tests under:

```text
tests/unit/commands/completion.test.ts
tests/core/repl/completer.test.ts
```

Coverage must include:

- `buildCompletionTree()` returns nested children for `queries`, `migrate`,
  `verify`, `verification`, `audit`, and `blacklist`.
- Top-level command names derived from the tree include all registered commands
  expected by the CLI.
- Bash output contains non-empty nested completion branches for:
  - `queries list`
  - `migrate add-column`
  - `verify safe-backfill`
  - `blacklist table add`
- Zsh output contains equivalent nested branches.
- Fish output contains scoped nested subcommand and option completions.
- REPL command completion includes newly registered commands such as `q`,
  `queries`, `inspect`, `verify`, `proxy`, and `snapshot`.
- REPL known-command dispatch recognizes the same command set except explicit
  denylisted commands such as `shell`.

### 11.2 Install Tests

Add temp-home tests that do not touch the developer's real shell files:

- Installing bash completion writes exactly one marker block to `$HOME/.bashrc`.
- Installing zsh completion writes exactly one marker block to `$HOME/.zshrc`.
- Re-running install replaces the existing marker block rather than duplicating
  it.
- Installing fish creates `$HOME/.config/fish/completions/dbcli.fish`.
- Unsupported shells exit non-zero and do not write files.

### 11.3 CLI Smoke Tests

Run:

```bash
DBCLI_NO_UPDATE_CHECK=1 NODE_ENV=test bun run src/cli.ts completion bash
DBCLI_NO_UPDATE_CHECK=1 NODE_ENV=test bun run src/cli.ts completion zsh
DBCLI_NO_UPDATE_CHECK=1 NODE_ENV=test bun run src/cli.ts completion fish
```

Expected:

- Exit code `0`.
- Generated output contains nested completion support.
- Stderr is empty.

Run targeted tests:

```bash
bun test tests/unit/commands/completion.test.ts tests/core/repl/completer.test.ts tests/commands/shell.test.ts
```

Expected:

- All tests pass.

## 12. Documentation Requirements

Because this implementation changes command behavior, update user documentation
after implementation:

```text
docs/user/en/index.md
docs/user/en/index.html
docs/user/zh-TW/index.md
docs/user/zh-TW/index.html
README.md
README.zh-TW.md
```

Documentation should state:

- Supported installed shells remain bash, zsh, and fish.
- Installed completion now covers nested dbcli subcommands.
- `dbcli shell` command completion follows the current command surface.
- `dbcli completion --install` is marker-managed and safe to re-run.

## 13. Acceptance Criteria

The milestone is complete when all of the following are true:

1. Installed bash, zsh, and fish completion scripts are generated from the same
   recursive command metadata model.
2. Generated scripts no longer leave `queries`, `migrate`, `audit`, `verify`,
   `verification`, or `blacklist` as empty first-level cases when those groups
   have child commands.
3. REPL command completion suggests the current top-level command surface,
   excluding only documented denylisted commands.
4. REPL known-command dispatch recognizes the same command set used by command
   completion.
5. Completion generation emits no normal-case stderr noise.
6. `--install` is covered by temp-home tests for bash, zsh, fish, replacement,
   and unsupported shells.
7. User docs are updated in English and Traditional Chinese, Markdown and HTML.
8. Targeted tests pass with Bun.

## 14. Risks and Mitigations

### Risk: Shell scripts become too complex

Recursive command trees can generate larger shell scripts. Keep generation
simple and deterministic, and prefer plain arrays/case statements over clever
runtime parsing.

### Risk: Commander metadata differs across versions

Use public Commander APIs where possible. If internal fields are unavoidable for
option value shape, isolate that logic in `command-tree.ts` and cover it with
unit tests.

### Risk: REPL dispatch accidentally enables unsafe commands

Keep an explicit REPL denylist. Start with `shell`, then add only commands with
documented reasons if they are proven unsafe or nonsensical in REPL context.

### Risk: Installed rc block runs slow code

Set `DBCLI_NO_UPDATE_CHECK=1` in installed bash/zsh blocks and skip update/skill
reminder post-actions for the `completion` command itself.

## 15. Implementation Order

1. Add failing tests for nested shell completion and REPL command parity.
2. Add `src/core/completion/command-tree.ts`.
3. Refactor `src/commands/completion.ts` to consume `CompletionCommandNode`.
4. Refactor REPL command completion/dispatch to consume shared metadata or a
   generated command-name list.
5. Add temp-home install tests.
6. Suppress completion command update/reminder noise.
7. Update user documentation in all required formats and languages.
8. Run targeted tests and CLI smoke checks.

## 16. Open Decisions

### Decision: exact zsh nested state generation shape

Any implementation is acceptable if it is deterministic, generated from the
shared tree, and passes the nested command acceptance tests. Prefer readability
over compactness.

### Decision: REPL command availability

The default should be inclusive: if a top-level CLI command is registered, the
REPL should complete and dispatch it unless an explicit denylist entry says
otherwise.

## 17. Follow-Up Work

Redis shell key completion can still block startup on large keyspaces because
`runShell()` populates Redis key names before showing the prompt. That is a
separate performance milestone. This completion metadata milestone should not
take on lazy Redis key discovery unless it naturally falls out of a small,
well-tested change.
