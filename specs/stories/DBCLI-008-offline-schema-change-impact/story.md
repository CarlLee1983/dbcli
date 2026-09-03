# Story: DBCLI-008 Offline Schema Change Impact

## Goal

Give a reviewer a deterministic, bounded offline report of known governed
dependencies affected by a proposed schema-design change, without presenting
the report as complete evidence that the change is safe.

## Context

Schema evolution needs a review artifact before an approved migration is run.
The impact assessment is intentionally declared and incomplete: it correlates
an explicit design delta with reviewed local metadata and reports every missing,
invalid, stale, unreadable, redacted, or dynamic source as visible coverage
gaps. It is neither a database inspection nor an execution authorization.

The repository already exposes this workflow. This baseline-conformance Story
formalizes the aligned user-documentation contract and requires the English and
Traditional Chinese Pages guides to converge where their details currently
differ. Execution changes code only where an acceptance criterion fails.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: yes

## Scope

### In Scope

* Assess a validated design against exactly one explicit local baseline: schema
  cache or supported ORM artifact.
* Correlate normalized changes with local semantic contracts, saved-query names,
  verification-artifact metadata, reviewed data-access metadata, and optional
  explicit workload-event metadata.
* Write a deterministic JSON or Markdown report with findings, recommended
  read-only verification, summary, and declared/partial coverage.
* Preserve protected-identifier redaction and make unavailable evidence visible.
* Add focused regression tests and aligned English and Traditional Chinese user
  documentation.

### Out of Scope

* Connecting to a database, refreshing a schema cache, starting a proxy, or
  reading rotated event logs.
* Executing SQL, reading saved-query bodies, parsing application source files,
  applying migrations, or approving a schema change.
* Claiming complete coverage, inferring unlisted dynamic access, or making a
  `--fail-on` exit code a safety verdict.

## Inputs

* One explicit design artifact and one explicit baseline selector.
* Optional local semantic, contract, saved-query-name, verification-metadata,
  reviewed data-access, and explicit workload-event inputs.
* Workspace-relative report output path, format, and `--fail-on` policy.

## Outputs

* A written offline impact report containing normalized changed subjects,
  deterministic findings, recommended verification, summary, and coverage gaps.
* An exit status controlled by the selected `--fail-on error|warn|never` policy
  only after the report is written.

## Rules

* R1: Exactly one baseline is required; cache and ORM baselines cannot be
  combined.
* R2: The command reads only declared local artifacts and safe metadata. It
  never connects, executes SQL, reads query bodies, or parses referenced
  application source files.
* R3: Workload input is optional and redaction-first: retain only recent safe
  table metadata, never SQL, literals, errors, sessions, or paths.
* R4: Missing, malformed, stale, unreadable, invalid, redacted, dynamic, or
  normalization-partial evidence produces visible `partial` coverage gaps.
  Version 1 never reports complete coverage.
* R5: Workload-only gaps are advisory and cannot alone make `--fail-on warn`
  fail. `--fail-on` affects exit status, not report content or authority.
* R6: Findings and recommendations sort deterministically and must not expose
  protected identifiers.
* R7: Recommendations identify possible read-only verification; they do not
  run verification or authorize a write.

## Expected Errors

* Missing, conflicting, invalid, unsupported, or unreadable explicit design or
  baseline input fails with bounded actionable output and no database access.
* An unsafe output path fails closed without writing a misleading report;
  optional evidence errors remain visible coverage gaps under R4.
* Protected subjects are omitted or redacted and recorded as coverage gaps,
  never printed as findings.

## Dependencies

* Existing design normalization, schema-cache/ORM readers, semantic-contract,
  saved-query, verification metadata, data-access, workload, blacklist, and
  report-formatting boundaries.

## Constraints

* The assessment remains offline, read-only, and incomplete-by-design.
* Do not add dependencies or copy source evidence into the report.
* Keep `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` aligned.
* Use `make verify` as the completion gate.

## Superseded Behavior

* `tests/unit/commands/impact.test.ts` — its baseline-exclusivity and
  report-shape assertions are the baseline; this Story's R1–R6 take
  precedence where a validated report field or exit status differs.
* `tests/unit/core/impact/impact.test.ts` — its correlation and coverage-gap
  assertions are the baseline; R4's `declared`/`partial` coverage rule takes
  precedence where reported coverage differs.
* `tests/unit/core/workload-impact/workload-impact.test.ts` — its
  redaction-first workload-projection assertions are the baseline; R3 takes
  precedence where retained workload metadata differs.
* `docs/guides/en/offline-impact-assessment.html` — its published offline,
  incomplete-by-design narrative is the baseline; this Story's Rules take
  precedence where a documented step or boundary differs.
* `docs/user/en/index.md` and `docs/user/zh-TW/index.md` — their existing
  `impact assess` usage descriptions are the baseline; this Story's Rules take
  precedence where documented behavior differs.
