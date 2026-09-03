# Acceptance Criteria

## Happy Path

* [ ] Given a valid design and exactly one valid local baseline, `impact assess`
  writes the requested JSON or Markdown report with normalized changes,
  deterministically ordered findings and recommendations, summary, and coverage.
* [ ] The report identifies known semantic, contract, saved-query-name,
  verification-metadata, data-access, and safe workload references when those
  reviewed inputs are available.

## Business Rules

* [ ] The command accepts exactly one cache or ORM baseline and rejects absent
  or combined baseline selection before producing a report.
* [ ] The report is always `declared` or `partial`; missing, invalid, stale,
  unreadable, redacted, dynamic, and normalization-partial evidence is visible
  as a `partial` coverage gap, never silently treated as no impact.
* [ ] Explicit workload events are projected redaction-first to safe recent
  table metadata; output contains no SQL, literals, errors, sessions, paths, or
  protected identifiers.
* [ ] `--fail-on error|warn|never` changes only the post-write exit status;
  advisory workload gaps alone do not make `--fail-on warn` fail.
* [ ] Recommendations are read-only verification suggestions and neither run a
  command nor authorize a migration or other write.

## Failure Cases

* [ ] Missing, conflicting, invalid, unsupported, or unreadable required design,
  baseline, or output target returns bounded actionable failure without database
  connection, SQL execution, cache refresh, proxy startup, or source-file
  parsing.
* [ ] Missing, malformed, stale, unreadable, or redacted optional workload
  events remain advisory `partial` coverage gaps and do not prevent report
  creation or alone trigger `--fail-on warn`.
* [ ] A protected subject is omitted/redacted and produces the applicable
  coverage gap without leaking the protected identifier.

## Regression Requirements

* [ ] Existing design, ORM-drift, semantic-contract, workload, blacklist, and
  report-format behavior remains green.
* [ ] Focused tests cover baseline exclusivity, deterministic ordering,
  incomplete coverage, workload advisory exit behavior, protected-subject
  handling, and the offline/no-query boundary.
* [ ] `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` describe impact
  assessment consistently as offline and incomplete-by-design.
* [ ] `docs/guides/en/offline-impact-assessment.html` and
  `docs/guides/offline-impact-assessment.html` describe the same optional events
  and reviewed data-access evidence without changing the aligned user contract.
* [ ] `make verify` passes.

## Verification Notes

Use fixtures containing canary SQL, paths, and protected names; assert their
absence from reports and errors. Run focused impact tests first, then `make
verify` from the repository root.
