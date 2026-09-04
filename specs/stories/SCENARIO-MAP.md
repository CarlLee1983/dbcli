# Pages Scenario Map

This is a planning inventory, not an approval or completion record. A Story
receives a `task.md` only after approval and dispatch; this map does not create
one or mark any Story approved or complete.

`Product delta` means repository evidence identifies a concrete missing outcome.
`Baseline conformance` means the capability already exists and the Story
formalizes its published scenario contract: execution verifies acceptance first
and changes code only where a criterion fails.

| Pages scenario | Story | Classification | Relationship |
| --- | --- | --- | --- |
| [Plan a safe data backfill](../../docs/guides/en/safe-backfill.html) | DBCLI-005 | Baseline conformance | Safe data-correction workflow. |
| [Deliver a shareable data dashboard](../../docs/guides/en/agent-dashboard.html) | DBCLI-006 | Product delta | Add safe standalone dashboard provenance. |
| [Find ORM-to-database schema drift](../../docs/guides/en/orm-schema-drift.html) | DBCLI-007 | Baseline conformance | Pre-deploy schema comparison. |
| [Assess a schema change offline](../../docs/guides/en/offline-impact-assessment.html) | DBCLI-008 | Baseline conformance | Offline change-review evidence and Pages parity. |
| [Verify an approved write and retain provenance](../../docs/guides/en/verification-evidence.html) | DBCLI-009 | Baseline conformance | Post-write receipt provenance. |
| [Prepare an evidence pack for review](../../docs/guides/en/evidence-packs.html) | DBCLI-010 | Baseline conformance | Review handoff from existing evidence. |
| [Protect governed business terms with contracts](../../docs/guides/en/semantic-contracts.html) | DBCLI-011 | Baseline conformance | Offline governed semantic contracts. |
| [Use database evidence to find a slow API](../../docs/guides/en/slow-endpoint.html) | DBCLI-012 | Product delta | Add the missing schema step to the named plan-only workflow. |
| [When should vibe coding use dbcli?](../../docs/guides/en/why-dbcli.html) | not a Story | Guide only | Product/tool-choice guidance has no bounded product delta. |

The `DBCLI-PLAT-*` line is absent from this table on purpose, and will stay
absent. This map inventories Pages scenarios — published guides a reader
follows — and the Agent Platform Stories have no reader of that kind: their
consumers are external Skills reading a contract. Giving them a row would mean
inventing a scenario to be mapped to, which is the failure this map exists to
avoid. They are ordered by `specs/handoff.md` instead.

## Suggested Execution Order

There are no hard dependencies among these Story executions. The narrative
sequence DBCLI-005 → DBCLI-009 → DBCLI-010 demonstrates preflight/result,
optional receipt, and evidence-pack handoff, but each capability accepts its own
documented inputs and must be verifiable independently.

DBCLI-006 and DBCLI-012 are the known product deltas and can run first in either
order. DBCLI-007 and DBCLI-011 may provide richer evidence when DBCLI-008 is
verified, but missing optional evidence remains a coverage gap rather than a
dependency failure. The remaining baseline-conformance Stories may run in any
order.
