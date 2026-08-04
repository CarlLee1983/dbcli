# verify migration Identifier Contract

**Date:** 2026-06-20
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.35.0 plus local `verify migration` MVP

## 1. Purpose

Make the `dbcli verify migration` table-target contract explicit and testable.

The migration verifier now blocks DDL unless the extracted `ALTER TABLE` target
matches `--table`. That is the right safety rule, but the target extractor uses
a deliberately small identifier grammar. User-facing docs currently say the MVP
accepts `ALTER TABLE` only, without stating which table identifier forms are
accepted or rejected.

This follow-up should remove that ambiguity before agents rely on the migration
scenario for more varied SQL.

## 2. Current Evidence

- `src/core/verify/migration.ts:23` defines `extractAlterTableTarget()`.
- `src/core/verify/migration.ts:25` extracts targets with a regex that accepts
  optional quoting around `[\w]+` segments and up to three qualified parts.
- `src/core/verify/migration.ts:31` uses `ddlTargetMatchesTable()` to compare
  the extracted target with `--table`.
- `src/commands/verify.ts:196` to `src/commands/verify.ts:215` runs the DDL
  guard: classify as single-statement `ALTER TABLE`, require query-risk
  analyzer classification as DDL, then require target/table match.
- `tests/unit/core/verify/migration.test.ts:36` covers simple, schema-qualified,
  `IF EXISTS`, `ONLY`, and one quoted mixed-case target.
- `docs/user/en/index.md:303`, `docs/user/zh-TW/index.md:280`, and
  `assets/reference.md:1214` document only that the MVP accepts `ALTER TABLE`.

## 3. Problem Statement

The product contract is narrower than the documentation implies.

Examples that may surprise users or agents:

- `ALTER TABLE "user accounts" ADD COLUMN x int`
- `ALTER TABLE "tenant-1".users ADD COLUMN x int`
- `ALTER TABLE public."Users" ADD COLUMN x int`
- `ALTER TABLE \`tenant-data\`.\`orders\` ADD COLUMN x int`

Some of these may be valid SQL for a supported engine, but the current matcher
does not define whether they are supported. If a valid migration is rejected,
that is safe but confusing. If a table name is partially extracted, that could
make the block reason misleading. The implementation should fail closed, but the
contract must be clear enough that rejected cases are expected behavior.

## 4. Goals

1. Define the accepted identifier grammar for `verify migration --table` and
   the `ALTER TABLE` target in `--ddl`.
2. Make unsupported identifier forms fail closed with bounded, actionable
   reasons.
3. Add regression tests for accepted and rejected identifier forms.
4. Update English and Traditional Chinese user docs, HTML mirrors, reference
   docs, and skill text if the documented contract changes.
5. Preserve the core safety invariant: `verify migration` never executes DDL.
6. Preserve existing simple-table behavior and schema-aware target matching.

## 5. Non-Goals

- Do not broaden the MVP beyond single-statement `ALTER TABLE`.
- Do not execute DDL or add an execution option.
- Do not change `VerificationArtifact` schema v1.
- Do not introduce generic SQL migration parsing for all DDL kinds.
- Do not add dependency packages unless a parser already available in the repo
  cannot satisfy the contract.
- Do not make task packs executable.
- Do not change `verify safe-backfill` behavior.

## 6. Decision Options

### Option A - Document the Current Simple Identifier Grammar

Contract:

- Accepted target forms:
  - `table`
  - `schema.table`
  - `catalog.schema.table`
  - each segment may be unquoted, double-quoted, backtick-quoted, or
    bracket-quoted;
  - segment contents are limited to ASCII word characters: `[A-Za-z0-9_]`.
- Rejected target forms:
  - whitespace inside identifiers;
  - hyphens, dots inside quoted identifiers, non-ASCII characters, or escaped
    quote characters inside identifier segments;
  - more than three qualified parts;
  - any DDL target that cannot be fully extracted.

Pros:

- Smallest implementation.
- Keeps the matcher easy to audit.
- Safe by default because unsupported forms remain blocked.

Cons:

- Rejects valid SQL identifiers for PostgreSQL/MySQL/MariaDB.
- Users with quoted names containing spaces or hyphens need a workaround outside
  `verify migration`.

### Option B - Broaden the Local Identifier Parser Without New Dependencies

Contract:

- Continue to support only single-statement `ALTER TABLE`.
- Parse the table target as a dotted sequence of identifier segments.
- Each segment may be:
  - unquoted identifier: `[A-Za-z_][A-Za-z0-9_]*`;
  - double-quoted identifier with doubled `""` escapes;
  - backtick-quoted identifier with doubled `` escapes;
  - bracket-quoted identifier where `]` is escaped as `]]`.
- Allow whitespace around dots.
- Keep at most three target parts.
- Normalize quoted and unquoted segments through the existing table reference
  comparison rules, after decoding quote escapes.

Pros:

- Handles common quoted identifiers without a full SQL parser.
- Makes failure reasons more precise.
- Avoids new dependencies.

Cons:

- More parser code to maintain.
- Still not a complete SQL grammar.

### Option C - Use Existing SQL Parser Facilities

Contract:

- Use an existing parser already in dependencies, if it can reliably extract
  `ALTER TABLE` targets for PostgreSQL, MySQL, and MariaDB.

Pros:

- Potentially better SQL coverage.
- Less hand-rolled parsing if the parser supports the needed DDL forms.

Cons:

- Parser support for DDL target extraction may vary by dialect.
- Higher implementation uncertainty.
- More expensive to validate across engines.

## 7. Selected Approach

Select Option B unless implementation discovery proves that the existing parser
already exposes a stable, dialect-aware `ALTER TABLE` target for all supported
SQL engines.

Rationale:

- The command is safety-sensitive and should fail closed.
- The MVP only needs the table target, not complete DDL semantics.
- A small tokenizer/parser can be tested exhaustively for the accepted target
  grammar.
- Broader valid identifier support avoids documenting an unnecessarily harsh
  user constraint.

## 8. CLI Contract

No new command or flag is introduced.

The existing command remains:

```bash
dbcli verify migration \
  --table <table> \
  --ddl "<ALTER TABLE ...>" \
  --verify-query "<SELECT assertion query>" \
  --expect "<assert expression>"
```

Target matching contract:

1. `--ddl` must be a single `ALTER TABLE` statement.
2. The `ALTER TABLE` target must be extracted completely.
3. The extracted target must match `--table`.
4. Matching is schema-aware:
   - `public.users` matches `public.users`;
   - `public.users` does not match `audit.users`;
   - `users` may match `public.users` only when one side omits the schema,
     preserving current behavior.
5. If extraction fails, the guard returns `blocked` and the reason says the
   target could not be parsed under the supported identifier contract.
6. If extraction succeeds but the target differs, the guard returns `blocked`
   and includes bounded target/table names.

## 9. Implementation Plan

1. Add unit tests first for current accepted cases and new edge cases.
2. Replace or wrap `extractAlterTableTarget()` with a small target parser in
   `src/core/verify/migration.ts`.
3. Keep `classifyMigrationDdl()` responsible only for single-statement and
   `ALTER TABLE` classification.
4. Keep `ddlTargetMatchesTable()` responsible for extracted-target comparison.
5. Make extraction failures distinguishable from mismatch failures so CLI
   reasons are more actionable.
6. Update docs and generated mirrors if the accepted grammar changes.
7. Run targeted tests, typecheck, lint, and parity checks.

## 10. Test Plan

Unit tests:

```bash
bun test tests/unit/core/verify/migration.test.ts
bun test tests/unit/core/verify/scenario.test.ts
```

Add cases for:

- accepted:
  - `ALTER TABLE users ADD COLUMN a int`
  - `ALTER TABLE public.users ADD COLUMN a int`
  - `ALTER TABLE IF EXISTS audit.users ADD COLUMN a int`
  - `ALTER TABLE ONLY "Users" ADD COLUMN a int`
  - `ALTER TABLE "user accounts" ADD COLUMN a int`
  - `ALTER TABLE "tenant-1"."orders" ADD COLUMN a int`
  - `ALTER TABLE \`tenant-data\`.\`orders\` ADD COLUMN a int`
  - `ALTER TABLE [tenant-data].[orders] ADD COLUMN a int`
- rejected:
  - target has more than three parts;
  - target has an unterminated quoted identifier;
  - target contains unsupported quote escape syntax;
  - `CREATE TABLE`, `DROP TABLE`, `CREATE INDEX`;
  - `ALTER TABLE users ADD a int; DROP TABLE users`.
- mismatch:
  - DDL target `public.users`, `--table audit.users`;
  - DDL target `"tenant-1"."orders"`, `--table "tenant-2"."orders"`.

Integration tests:

```bash
bun test tests/integration/verify-migration-command.test.ts
```

Add non-live or live-DB-gated cases only where they prove CLI output shape and
guard reasons. Do not require executing DDL.

Static and parity checks:

```bash
bun run typecheck
bun run lint
bun run docs:check
bun run skill:check
bun run platform:check
bun run plugin:check
```

## 11. Documentation Updates

If Option B is implemented, update:

- `docs/user/en/index.md`
- `docs/user/en/index.html`
- `docs/user/zh-TW/index.md`
- `docs/user/zh-TW/index.html`
- `assets/reference.md`
- `assets/SKILL.md`
- `assets/SKILL.zh-TW.md`
- platform/plugin mirrors if generated assets change

Required wording:

- `verify migration` still never executes DDL.
- MVP remains single-statement `ALTER TABLE` only.
- The `ALTER TABLE` target must match `--table`.
- Supported identifier forms are simple unquoted names and common quoted
  identifier segments.
- Unsupported or unparsable targets are blocked before after-write assertion.

## 12. Acceptance Criteria

- `extractAlterTableTarget()` fully extracts supported quoted and unquoted
  target forms.
- Unsupported target forms fail closed with bounded reasons.
- Existing simple and schema-qualified behavior remains unchanged.
- `verify migration` still never executes DDL in preflight or after-write.
- User docs and reference docs describe the identifier contract.
- English and Traditional Chinese docs stay in parity.
- `bun test tests/unit/core/verify/migration.test.ts` passes.
- `bun test tests/integration/verify-migration-command.test.ts` passes, with
  explicit note if live DB cases are skipped by environment.
- `bun run typecheck`, `bun run lint`, `docs:check`, `skill:check`,
  `platform:check`, and `plugin:check` pass.

## 13. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Parser accidentally accepts partial targets. | Parser must consume a complete target segment sequence and stop only at valid SQL whitespace after the target. |
| Broadened parser weakens table mismatch guard. | Add mismatch tests for quoted and schema-qualified targets. |
| Dialect differences create false expectations. | Document the supported identifier contract as dbcli's verifier contract, not a full SQL dialect promise. |
| Error reasons leak raw sensitive SQL literals. | Reasons may include bounded target/table names only, never full DDL. |
| Docs drift across mirrors. | Run all parity checks before completion. |

## 14. Stop Condition

Stop when the identifier contract is implemented, documented, and verified with
targeted tests plus parity checks. Do not proceed to a third verification
scenario until this contract is explicit.

## Completion evidence

- **Implemented:** Option B local identifier parser and table-target guard in
  `src/core/verify/migration.ts`, with CLI wiring in `src/commands/verify.ts`.
- **Verification:** migration unit and integration tests passed in the full
  repository run; typecheck, lint, docs, skill, platform, plugin, and CLI
  contract checks passed during this audit.
- **Known deviations:** the parser intentionally defines a bounded dbcli
  identifier contract rather than promising a complete SQL dialect parser.
