# safe-backfill suggests only flags that exist, and a contract test keeps every Task Pack honest

## Goal

An agent that follows the `safe-backfill` Task Pack runs a first write command
that the CLI accepts. Today the pack's Agent Notes
(`assets/tasks/safe-backfill.md:37-41`) say to preview with
`dbcli update ... --dry-run` "(or `dbcli query "<sql>" --dry-run`)" and then
"re-run with `--execute`". On `main` at `54c13360`, `query`
(`src/commands/inline-registrars.ts:30-59`) declares neither `--dry-run` nor
`--execute`, and `update` (`src/commands/inline-registrars.ts:167-176`) declares
`--dry-run` but not `--execute`. The sibling pack `safe-backfill-verify`
(`assets/tasks/safe-backfill-verify.md:56-59`) already states the correct
sequence: structured `update … --dry-run`, `query` does not dry-run arbitrary
writes, then re-run without `--dry-run` with the existing confirmation or force
flag, then read back.

After this Story, `safe-backfill`'s Agent Notes give the same operating
sequence as `safe-backfill-verify`: confirm scope with a read-only count,
preview with `update … --dry-run`, send raw SQL writes through `plan` rather
than a query dry-run, execute by re-running without `--dry-run` under the
existing confirmation／write gate, and read back afterwards.

A new contract test resolves every `dbcli …` command example in
`assets/tasks/*.md` (frontmatter step commands and Agent Notes) against the
real command tree — built the way `tests/contract/capability-catalog.test.ts`
builds it, so lazily registered subcommands are included — and asserts that
each long flag in the example is declared on the command it resolves to.
Placeholders (`<sql>`, `<table>`, `{{param}}`, `...`) are not checked. The
test fails on `main` at `54c13360` because of `query --dry-run`, and passes
after the fix.

## Out of Scope

- Adding `--dry-run` to `query` or `--execute` to `update`; any change to
  `src/**`.
- Flag checks for `assets/SKILL.md`, `assets/reference.md`, platform skill
  copies, README or `docs/user/` examples.
- Any other change to `safe-backfill-verify` or other packs, unless the new
  contract test exposes another undeclared flag in them; if it does, stop and
  report rather than widening this Story.
- Changes to scope confirmation, the write gate, confirmation flags, or
  read-back requirements.
- Releasing: version numbers, tags, `CHANGELOG.md`, push, merge.

## Acceptance Criteria

1. The new contract test, run against `main` at `54c13360`'s
   `assets/tasks/safe-backfill.md`, fails and names `query` and `--dry-run`.
2. After the change, the same test passes for every file in `assets/tasks/`.
3. `safe-backfill`'s Agent Notes no longer contain `query "<sql>" --dry-run` or
   `--execute`, and state the sequence in the Goal (scope count, `update …
   --dry-run`, raw SQL via `plan`, re-run without `--dry-run` under the existing
   confirmation, read-back).
4. Existing tests, including `tests/unit/agent-tasks/pack-safe-backfill-verify.test.ts`,
   pass unchanged.
5. `make verify` passes.
