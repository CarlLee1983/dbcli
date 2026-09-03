# ForgeFlow Handoff

DBCLI-010 is delivered as `6af7592f`; the worktree is clean.

DBCLI-002 through DBCLI-009 and DBCLI-012 were delivered earlier on this branch
(`ca123683`, `743688a3`, `49cbb6b8`, `bc8dd329`, `363436ff`, `41983853`,
`3278b6fd`, `0861bd41`, `e84f889b`), and
the ForgeFlow 0.3.0 migration landed as `ee3c9907`. DBCLI-001 was recorded as
delivered by an earlier handoff; that claim is carried forward here and has
still not been re-verified.

DBCLI-007 through DBCLI-010 were all executed as baseline-conformance Stories:
current behavior was verified against every acceptance item first, and code
changed only where a criterion failed.

For DBCLI-007 that was Rule R5 — a malformed artifact must fail closed with an
actionable error, but the two JSON-decoding input paths raised the raw
`JSON.parse` or Zod failure, naming neither the file nor the fields.
`src/core/orm-drift/artifact-json.ts` now bounds both.

For DBCLI-008 three criteria failed: a conflicting output target was flattened
into the generic message so the reason was invisible; the zh-TW Pages guide
lacked the optional `--events` workload evidence and reviewed data-access
metadata the English guide carries; and both `index.html` user docs omitted the
incomplete-by-design contract their Markdown counterparts state. `safeMessage`
in `src/commands/impact.ts` also moved from prefix matching to exact matching,
so a literal that later grows an interpolated suffix cannot silently leak.

For DBCLI-009 every receipt boundary already conformed; two things did not. In
`src/commands/assert.ts` a failed receipt write exited before the verdict was
printed, so a `--format json` caller received a stderr line instead of the
envelope and `--no-fail` was overridden — while the adjacent artifact branch
already carried the opposite rule in a comment. And in both Markdown user docs
a paragraph sat between rows of the receipt flag table, splitting it in two on
render; that paragraph was also missing from both HTML docs.

For DBCLI-010 the failure was again in failure output: `evidence compose
--receipt <missing>` printed a raw `ENOENT` carrying an absolute path, because
`safeMessage` passed through any Error message. It now allows only the two
validation error classes plus a bounded `ConfigError` line, the receipt lookup
raises a bounded not-found, and the shared `validateFormat` was replaced by a
bounded check — its message quotes the rejected value, which a caller can make
a path.

Every other criterion in all four Stories already conformed and is pinned by
characterization tests rather than rewritten. No Superseded Behavior artifact
had to be contradicted. `offline-impact-assessment` was added to `guideSlugs` in
`tests/docs/guides-pages.test.ts`, and `evidence-packs` during DBCLI-010. Only
`semantic-contracts` (DBCLI-011) and `verification-evidence` remain exempt from
those structural checks; the latter's two language versions were read during
DBCLI-009 and found already aligned.

Three doc-contract tests now share a similar text normalization
(`impact-docs`, `verification-receipt-docs`, `evidence-pack-docs`) but scope
their sections three different ways. They were deliberately not unified: doing
so would change assertion semantics in two Stories that are already delivered.

No Story is selected next. DBCLI-011 is the only remaining candidate; it is
baseline-conformance, with no ordering dependency
(see `specs/stories/SCENARIO-MAP.md`). Selection is pending a human decision and
must not be inferred from the order of that list. No known product delta remains.

`make verify` cannot reach PASS for a reason unrelated to any Story: `bun audit`
reports two pre-existing moderate advisories (`@humanfs/node` via eslint,
`mysql2`). `package.json` and `bun.lock` are untouched by this work. The other
22 steps of the gate were run individually and all passed, including
`SKIP_INTEGRATION_TESTS=false REQUIRE_INTEGRATION_SERVICES=true bun run test`
(6338 pass, 0 fail).

The branch is still unpushed and has no PR.

## Lifecycle

```yaml
workflow:
  current_story: none
  next_story: pending
  completed_stories:
    - DBCLI-001
    - DBCLI-002
    - DBCLI-003
    - DBCLI-004
    - DBCLI-005
    - DBCLI-006
    - DBCLI-007
    - DBCLI-008
    - DBCLI-009
    - DBCLI-010
    - DBCLI-012
  status: awaiting_selection

baseline:
  repository: CarlLee1983/dbcli
  branch: feat/forgeflow-stories-002-006
  commit: 6af7592fe1738bc8caa6cf89e4e5c5b7cdf66c69
  dirty_worktree: false
  story_owned_paths: []
  known_unrelated_paths: []

verification:
  last_command: make verify
  result: blocked_on_preexisting_bun_audit
```
