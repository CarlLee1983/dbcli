# Retro improvement acceptance checkpoint

Approved Story: [receipt and agent workflow](../../../specs/stories/retro-receipt-and-agent-workflow.md).
Baseline: G4 snapshot `8f2ab9a8149067bed96b3d0256107ef6fdd83ce6`.

## Acceptance observations

| AC | Command / inspection | Observed result |
| --- | --- | --- |
| AC-01 | `bun test tests/integration/assert-verification-artifact.test.ts -t 'passing assertion writes a parseable receipt'` before/after the fix | Red: expected exit 0, received 1. Green: 1 pass, 8 assertions. Actual CLI writes parseable receipt with correct counts and no SQL/result sentinel. |
| AC-02 | `bun test tests/integration/assert-verification-artifact.test.ts tests/integration/grant-authentication-redaction.test.ts tests/unit/core/evidence-receipt` | 62 pass, 0 fail, 1481 assertions. Failing assertion still writes failed receipt; --no-fail controls assertion exit only. Genuine outside-workspace write failures remain safe. Strict builder rejects rich check objects. |
| AC-03 | Same focused run, grant integration cases | Executing assertions now write successful parseable receipts; query/export/shell/audit/receipt retain synthetic and real authentication absence assertions. Original G3 failure evidence remains unchanged as historical evidence. |
| AC-04 | Independent fresh read-only reviewer loads global/repo AGENTS and frontend reference | Correctly derives snapshot without commit authorization, preservation of dirty worktree, exact-candidate make verify, approved Story only and pending Human Review. Frontend examples remain accessible; one Graft navigation table replaces duplicate lists. |
| AC-05 | `bun test tests/unit/scripts/verification-progress.test.ts`; use observer against this run's canonical log | Fixture and actual-run outcomes are recorded in final completion report. Observer emits only bounded step numbers, durations, exit codes and attestation status, not raw log content. EOF is not success. |
| AC-06 | `bun run docs:check`; `COMPOSE_PROJECT_NAME=dbcli forgepilot verify retro-receipt-and-agent-workflow --snapshot` | English/zh-TW Markdown/HTML parity passes. Canonical outcome, snapshot, review and test totals are recorded in ForgePilot and final completion report. |

## Boundaries and calibration

The command-to-receipt boundary projects `{pass, checks: [{pass}]}`. The existing builder remains strict and receipt schema is unchanged. Architect inspected both production buildEvidenceReceipt callers: verify uses its separate operation branch and supplies no rich verdict, so no sibling fix is needed.

The primary control surfaces are the existing integration tests, repo AGENTS/navigation references, and a read-only operator script. No global Codex configuration, hooks, skills or model settings changed; no global calibration ledger entry or restart claim applies. Subsequent configuration inspection reads only needed fields rather than whole configuration dumps.

## Skipped or blocked checks

No extra CI or dependencies. No behavior tests invented for documentation. Canonical verification and independent full-delta review remain required; final evidence records their result. No database or cloud credentials were requested, and no external writes, commit, push or PR were performed.

## Residual risks and rollback

The progress observer is not an authority: final command status and ForgePilot evidence determine verification. It can be bypassed by reading the original log. Documentation links target local files and existing skills; a changed agent installation may require updating a pointer. Reverting the receipt projection restores the known receipt failure; already-written receipts require no migration. Historical G2–G4 evidence is preserved, but new source changes need this new candidate verification rather than borrowing those approvals.
