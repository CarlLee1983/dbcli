# Release workflow retrospective improvements

Status: Approved and assigned by the human in this session on 2026-10-19.
Implementation and verification are authorized within the scope below.

## Goal

Reduce duplicated release work while preserving exact-candidate verification,
human intent, review, and publication authorization. Start from main
`0f751f92185db81abe485603744fcdc1231f68af` and use a separate worktree.

The 12.0.0 session ran overlapping local release and canonical checks, four CI
runs, and Release verification. Its one-node ForgePilot plan provided useful
uncommitted snapshot/review binding but no dependency scheduling. Its evidence
was split between a worktree, temporary files, and GitHub.

## Scope and sequence

1. Separate release-only checks from the canonical gate. Preserve `make verify`
   and its 22 blocking steps. Make standalone `release:check` run that gate once
   followed by `release:extras`. The ForgePilot path runs its canonical snapshot
   verification once, followed by extras against the identical candidate.
2. Run full CI for pull requests and pushes to main. For `v*.*.*` tag pushes,
   retain the six OS/Bun matrix jobs; omit CI jobs already covered by Release's
   exact-tag canonical verification. Keep Release itself unchanged.
3. Retain Warrant's intent, scope, acceptance, exact-candidate evidence and human
   review. Make ForgePilot required for uncommitted snapshot verification or
   work needing dependency scheduling/candidate-bound local handoff; a single
   committed PR may use its exact-revision CI and review evidence instead.
4. Shorten repository AGENTS.md by retaining policy/navigation and moving
   task-specific instructions into an appropriately linked development guide.
   Preserve Bun choices, database-operation safeguards and documentation parity.
5. Save a durable, sanitized 12.0.0 release-evidence index and document the same
   handoff location for subsequent releases. Reuse one approval decision when
   registering it in different tools; record distinct intent, review and publish
   authorizations separately.

## Out of Scope

- Product CLI/runtime changes, dependency updates, lockfile changes, version
  bumps, commits, pushes, PRs, deployment or publication.
- Deleting or modifying previous Stories, evidence, local ForgePilot state,
  unrelated work, remote settings, or installed tools.
- Reducing canonical gates, the three-OS/two-Bun matrix, exact-tag verification,
  release permissions, OIDC provenance or npm environment protection.
- Changing the inspect test's 200ms contract, deleting it, making it diagnostic
  only, or adding retries. A single outlier does not establish a replacement
  performance contract. Record this follow-up with the existing observations.
- Global AGENTS.md, hooks, rules and shared skill changes. Existing global rules
  already cover concise status reporting and avoiding repeated verification.
- Using a cached attestation to bypass verification of changed source or
  treating equal branch head metadata as proof of equal PR checkout content.

## Acceptance Criteria

1. `release:check` invokes canonical verification exactly once before extras.
   A failing canonical command prevents extras; a failing extra fails the
   wrapper. Regression tests exercise both failure boundaries and success.
2. Extras retain post-build dist smoke, the feature-matrix audit entry and the
   current package version's changelog heading. Missing built assets or required
   entries fails. Extras do not repeat general lint/type/test/audit/doc gates.
3. The existing canonical roster/order/failure/attestation contract remains
   unchanged. Contributor documentation gives two alternative local paths:
   standalone release:check, or ForgePilot snapshot verify plus release:extras.
   It requires matching source and built assets for extras and disallows using
   an old PASS after candidate changes.
4. Workflow contract tests cover this event table: PR and main push run full CI;
   release tag runs all six matrix jobs and Release runs canonical verification;
   a feature-branch push without a PR has no CI. Document that last tradeoff.
   Tag CI's integration/format/build-determinism/docs/audit jobs are omitted
   only where Release supplies those checks for the same tagged commit.
5. Release workflow contracts explicitly retain `make verify`, its dependency
   before publish, tag/version/main checks, environment approval, job ordering,
   minimal permissions and token-free trusted publishing. No automatic approval
   or publication dependency is introduced or removed.
6. The revised agent workflow names one authoritative completion/evidence
   record per selected path, preserves human review and exact candidate binding,
   and does not make a dirty/uncommitted workspace eligible for PR-only evidence.
   One human decision may be registered in multiple tools without asking again.
7. A fresh instruction read correctly distinguishes a committed single-PR task,
   an uncommitted candidate and a multi-node dependency task. Navigation targets
   exist and preserve the moved Bun/database/documentation requirements.
8. A tracked JSON release index for 12.0.0 links the approved snapshot/tree,
   release and merge commits, tag, PR, exact-commit verification runs, npm
   version/integrity/provenance and published-install observations. Every value
   is checked against existing source evidence; it contains no credentials,
   cookies or indispensable temporary filesystem links. Historical local
   observations are labelled as such, not presented as newly executed checks.
9. Relevant tests pass, followed by canonical `make verify` on the exact final
   candidate and release extras. Reuse that result without launching a second
   full release wrapper. Independent review covers workflow safety and the
   changed instruction boundary. Report skipped/blocked checks and residual
   risks. Current Warrant/ForgePilot requirements govern this implementation
   until the revised policy itself has been approved and verified.

## Allowed boundaries and rollback

Changes are limited to release scripts/package scripts, CI workflow contracts,
CONTRIBUTING.md, docs/feature-matrix.md, AGENTS.md, linked development guidance,
the release-evidence index, and this Story. Keep Makefile and release.yml
behavior unchanged. Reverting this diff restores the former workflow without
changing any published artifact or ForgePilot state.

ForgePilot's linked-worktree source repair is a separate Story in its owning
repository. The inspect timing follow-up must establish a defensible measurement
contract before proposing a separate change to its current blocking assertion.
