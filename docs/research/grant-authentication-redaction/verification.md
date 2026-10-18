# G3 acceptance evidence

Scope: approved `specs/stories/grant-authentication-redaction.md`, including GATE-002.
Implementation checkpoint: no new dependency, configuration switch, output envelope or database migration.
Final canonical verification and candidate identity are recorded by ForgePilot; this document records reproducible acceptance observations before that immutable snapshot.

| Criterion | Command / inspected boundary | Observed result |
| --- | --- | --- |
| AC-01 | `bun test tests/unit/adapters/grant-redaction.test.ts tests/unit/adapters/grant-query.test.ts tests/unit/adapters/grant-adapter.test.ts` | Combined 73 pass, 0 fail, 166 assertions. Known auth payloads disappear; account, role and privilege information remains. |
| AC-02 | Same unit suite, unknown/malformed/ambiguous/non-string and mixed-result cases | Whole-cell omission marker; safe neighboring cells and row shape retained; no raw fallback. |
| AC-03 | Same unit suite; `bun test tests/integration/grant-authentication-redaction.test.ts` | Both adapter modes; executable comments, version boundaries, configured-flavor mismatch, FOR and semicolon forms covered. Real MariaDB configured as mysql safely handles both adjacent six-digit comment forms through the existing admin route. Unknown ambiguous versions refuse before execution. |
| AC-04 | Unit adapter/query cases; full canonical suite | Non-grant result identity retained; pure grants and role text preserved. Unknown-version definite non-grant statements retain behavior. Existing guards are unchanged. |
| AC-05 | Integration command above | 21 pass, 0 fail, 1222 assertions. Sixteen permission × agent × blacklist combinations exercise query JSON/CSV/table, export JSON/CSV/HTML, REPL JSON/CSV/table, readable redaction/omission markers and saved-query rejection. |
| AC-06 | Integration real Compose fixtures | MySQL grant privileges remain readable; MariaDB authentication payloads exist in raw driver data held only in memory and are absent from CLI/file output. Blacklist preflight runs; schema is inapplicable to SHOW GRANTS. Fixtures are isolated and cleaned. |
| AC-07 | Integration artifact/error assertions; inspect shared MySQLAdapter.execute return boundary and receipt calls | Audit/history/export artifacts and output contain no synthetic or real auth payloads. Existing executing assert receipt failure is safe; successful plan receipt is explicitly nonexecuting. No grant-result logging path added. |
| AC-08 | `bun run docs:check`; four docs/user locale/format files and CHANGELOG | Both languages and Markdown/HTML explain scope, markers, fallback, no bypass, ambiguity refusal and non-replayability. Documentation parity passes (25 topics per locale). |
| AC-09 | `COMPOSE_PROJECT_NAME=dbcli forgepilot verify grant-authentication-redaction --snapshot`; independent security delta review | Canonical outcome is in ForgePilot evidence. Two P1 review findings (actual flavor and adjacent MariaDB version digits) repaired and regression-tested; final review and gate totals are recorded in the completion report. |

Additional observed checks: `bun run typecheck`, `bun run typecheck:tests`, focused ESLint/Prettier and `git diff --check` pass. Broader adapter/REPL/schema-protection checkpoint passed 834 tests before the final six regression additions; the canonical run validates the integrated checkpoint.

## Blocked or limited observations

`assert SHOW GRANTS --expect ... --evidence-receipt` has an existing receipt-schema defect: expanded checks are rejected by a pass-bits-only validator. The assertion itself succeeds, then reports a generic receipt error and writes no receipt. Tests preserve that observation rather than weakening it. An assert without a criterion is unsupported; query/export have no receipt option. The successful receipt case is `plan`, which does not execute grants. This Story does not repair or claim a successful executing receipt API.

Existing query-only policy rejects MariaDB-specific native comment syntax when configured as mysql. The real compatibility regression uses the already supported admin path; no policy was loosened.

## Residual risks and review boundary

Actual database observations cover the local Compose versions; synthetic fixtures cover other documented grammar forms. Unknown or ambiguous grant formats lose the whole cell by design. The protection does not scan arbitrary SELECT results, SHOW CREATE USER, input SQL, or previously saved files. Rollback restores the former disclosure risk. Human Review remains required after ForgePilot PASS; G4, commits, push and PR publication are outside this checkpoint.

Comment grammar references: [MariaDB comment syntax](https://mariadb.com/docs/server/reference/sql-statements/comment-syntax), [MySQL 8.4 comments](https://dev.mysql.com/doc/refman/8.4/en/comments.html). Real safe SELECT probes showed short three-digit executable comments fail with syntax error on both engines; MariaDB accepts adjacent six-digit version comments. No raw authentication material was retained in evidence.
