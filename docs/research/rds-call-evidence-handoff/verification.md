# G4 acceptance evidence

Approved Story: [RDS CALL evidence handoff](../../../specs/stories/rds-call-evidence-handoff.md).
Baseline: approved G3 snapshot `b1d95c2f9888135e6b58d04741c80d58e1b94fc3`.
This delivery documents the existing refusal and human evidence handoff; it adds no RDS execution capability.

## Acceptance observations

| Criterion | Reproducible inspection / command | Observation |
| --- | --- | --- |
| AC-01 | Inspect the RDS CALL subsection in docs/user/en/index.md, en/index.html, zh-TW/index.md, zh-TW/index.html; run `bun run docs:check` | Four surfaces distinguish the refused command from an indeterminate DBA observation; no inference of missing procedure, native denial, zero retention, or unhealthy backups. Final parity result recorded in completion evidence. |
| AC-02 | Inspect the handoff template on the same four surfaces | Target/deployment/version, requested observation, policy refusal, source/time, sanitized result and missing evidence recorded. Operator acts only within existing authorization; no admin escalation or automatic AWS/native fallback. |
| AC-03 | Inspect metric definitions and primary-source links on all four surfaces | `binlog retention hours` is distinct from `BackupRetentionPeriod` (automated snapshot retention days). No equivalence or healthy/unhealthy conclusion is inferred from absent evidence. |
| AC-04 | Inspect original evidence.json O041–O044 and report Q024/Q025; inspect sql-analysis.ts:277–310 and permission-guard.ts:411–477 | Four original observations: exit 1, empty stdout, query-only policy refusal; both engines with default limit and --no-limit. CALL maps to UNKNOWN and remains refused below admin. Product source, tests, and original research remain byte-identical to the G3 snapshot. |
| AC-05 | `COMPOSE_PROJECT_NAME=dbcli forgepilot verify rds-call-evidence-handoff --snapshot` | Canonical make verify result and exact candidate are recorded in ForgePilot and the final completion report. Independent review must have no unresolved material findings before handoff. |

Original evidence is preserved at `docs/research/dba-system-view-probes/evidence.json` (O041–O044, lines 2317–2347) and `docs/research/dba-system-view-probes.md` (lines 106–117). These are prior local observations, not a new RDS test or successful CALL. No database access is needed to inspect them.

The shared guard source establishes the current policy; the doc update does not change the existing CLI/receipt statuses or error text. `indeterminate` in the handoff is an assessment of missing DBA evidence, not a new command result field.

## Skipped or blocked checks

No new behavior tests are needed for this documentation-only change. Real RDS execution is deliberately outside the approved acceptance contract; no RDS credentials, AWS calls, native client execution or resource changes are requested or performed. Canonical gates still run against the complete snapshot.

## Residual risks

The RDS observation remains unavailable through query-only CALL. Authorized operators must supply separately sourced evidence; an incomplete handoff remains indeterminate. Neither local refusal nor documentation establishes procedure existence, native privileges, read-only transaction compatibility or procedure result handling on RDS. A future allowlist or API integration requires its own approved contract and real platform evidence.

G2/G3 and unrelated work are preserved. No new dependency, runtime boundary, migration, CLI schema or receipt schema. Rollback is removal of the new documentation; execution policy remains unchanged. Git commits, push, PR and issue writes are not part of this checkpoint.
