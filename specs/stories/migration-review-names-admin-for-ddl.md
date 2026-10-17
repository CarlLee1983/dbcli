# migration-review says running DDL needs admin, not data-admin

## Goal

An agent that reads the `migration-review` Task Pack asks the user for the
permission the runtime will actually accept. Today its Agent Notes
(`assets/tasks/migration-review.md:40-41`) say "Requires data-admin permission
to actually run DDL". On `main` at `54c13360` the permission ladder
(`src/core/permission-guard.ts:364-383`) gives data-admin only DELETE and
REPLACE beyond read-write; DDL is in no tier, so its minimum is `admin`, and
the DDL executor refuses anything but `admin`
(`src/core/ddl-executor.ts:41-49`). Every other document agrees with the
runtime (`assets/SKILL.md:610`, `README.md:1187`, `README.zh-TW.md:1073`,
`docs/user/en/index.md:37`); `migration-review` is the only one that does not.

After this Story, `migration-review`'s Agent Notes separate two things:
read-only planning and review, which this pack does and which needs no
elevated permission beyond what the pack already requires; and actually running
the DDL, which happens out of band and requires `admin`. The pack still does
not grant or run DDL.

A test, written in the style of `tests/unit/agent-tasks/pack-migration-review.test.ts`
and driven through `dbcli skill tasks show migration-review` (where Agent Notes
reach the agent), asserts that the notes name `admin` as the permission for
running DDL and do not name `data-admin` for it. The test fails on `main` at
`54c13360` and passes after the fix.

## Out of Scope

- The permission ladder, `minimumPermissionFor`, the DDL executor, and any
  other `src/**` change.
- New runtime tests for DDL under data-admin; `tests/unit/core/ddl-executor.test.ts:93`
  and `tests/unit/core/permission-guard-required-tier.test.ts` already cover it.
- Other Task Packs, `assets/SKILL.md`, `assets/reference.md`, README, and
  `docs/user/`, which already state the correct tier.
- The flag contract test from the `safe-backfill` Story.
- Releasing: version numbers, tags, `CHANGELOG.md`, push, merge.

## Acceptance Criteria

1. The new test, run against `main` at `54c13360`, fails on the `data-admin`
   statement.
2. After the change, `dbcli skill tasks show migration-review` shows notes
   that distinguish read-only planning／review from running DDL and state that
   running DDL requires `admin`; the new test passes.
3. `src/core/permission-guard.ts` and `src/core/ddl-executor.ts` are unchanged
   (`git diff main...HEAD -- src/` is empty).
4. Existing tests pass unchanged.
5. `make verify` passes.
