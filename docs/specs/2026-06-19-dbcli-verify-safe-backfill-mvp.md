# dbcli verify safe-backfill MVP

**Date:** 2026-06-19
**Status:** Implemented — retained as a design record
**Baseline:** dbcli v1.35.0 plus local verification artifact hardening

## 1. Purpose

Introduce the first `dbcli verify` scenario as a narrow safe-backfill verifier.

The verification workflow now has enough foundation to support one executable
scenario:

- task packs can describe the intended safe-backfill verification sequence;
- `assert` can evaluate read-only outcome checks;
- verification artifacts can be written, read, summarized, pruned, and validated;
- compact skill guidance can route agents toward verification evidence.

The remaining gap is product shape. Agents can plan `safe-backfill-verify` and
can inspect result artifacts, but there is no single scenario command that
connects safety preflight, post-write read-back assertion, and durable evidence.

This MVP adds that connection without executing the backfill write itself.

## 2. Current Evidence

- `assets/tasks/safe-backfill-verify.md` defines the canonical workflow:
  `blacklist list`, `schema <table>`, `plan "<UPDATE ...>"`, and final
  `assert "<verify_query>" --expect "<expect>"`.
- `src/commands/skill-tasks.ts` can render the task-pack plan, but it does not
  execute or verify a scenario.
- `src/commands/assert.ts` can run read-only assertions and already supports
  writing verification artifacts through the existing artifact bridge.
- `src/commands/verification.ts` provides artifact inspection and lifecycle
  management under `dbcli verification`.
- `src/core/verification/*` defines the v1 artifact contract, writer, reader,
  summary, retention, status, and evidence helpers.
- Recent specs intentionally deferred `dbcli verify` until artifact write/read
  behavior was stable. That prerequisite is now met.

## 3. Problem Statement

Safe backfills remain too manual at the verification boundary.

The agent currently has to coordinate these steps from multiple surfaces:

1. generate a task-pack plan;
2. inspect blacklist and schema output;
3. review the write plan;
4. execute the write through the appropriate existing write command;
5. run the read-back assertion;
6. ensure the assertion produced a durable verification artifact;
7. summarize the artifact for handoff.

That is workable for careful agents, but it leaves room for three errors:

- confusing a planned verification step with executed result evidence;
- running the final assertion without artifact metadata;
- claiming completion from console output without a durable artifact id.

The MVP should make the safe path shorter and more explicit while preserving the
existing rule that dbcli does not automatically execute high-risk writes from a
verification scenario.

## 4. Goals

1. Add `dbcli verify safe-backfill` as the first scenario-specific verifier.
2. Provide a preflight mode that runs only read-only safety checks and renders
   the exact after-write command to run later.
3. Provide an after-write mode that reruns the guards, executes the read-back
   assertion, and writes a v1 `VerificationArtifact`.
4. Keep backfill write execution outside this command.
5. Reuse the existing task-pack shape, assertion evaluator, verification
   artifact builder, writer, reader, and summary conventions.
6. Make result status mapping deterministic: `verified`, `not_verified`,
   `blocked`, or `indeterminate`.
7. Keep JSON output machine-readable for agents and table output suitable for
   human handoff.
8. Update user docs and skill/reference guidance in English and Traditional
   Chinese.

## 5. Non-Goals

- Do not execute `UPDATE`, `DELETE`, migration SQL, or any other write.
- Do not add a generic multi-scenario runner beyond the `safe-backfill` MVP.
- Do not change the v1 `VerificationArtifact` schema.
- Do not add a new artifact status such as `planned`.
- Do not store raw result rows, credentials, host, port, connection strings, or
  unbounded stdout/stderr in verification artifacts.
- Do not merge `verify` and `verification`; `verify` runs scenarios, while
  `verification` inspects and manages local artifacts.
- Do not add audit writes beyond the audit behavior already produced by
  underlying commands such as `assert`.
- Do not make task packs executable by default.

## 6. Selected Approach

Add a dedicated `verify safe-backfill` command with two modes:

1. Default preflight mode.
2. Explicit after-write mode enabled by `--after-write`.

Preflight mode is the default because it is the safest interpretation of a
backfill scenario before any write has happened. It confirms the target table is
eligible for planning, confirms schema shape, analyzes the proposed `UPDATE`,
and prints the exact after-write command. It does not write a result artifact
because no result has been verified yet.

After-write mode is explicit because it creates result evidence. It repeats the
same guards, then runs the final read-back assertion and writes a verification
artifact for the actual outcome.

The command is scenario-specific in this milestone. Internally it should still
use small core functions so a later `dbcli verify <scenario>` registry can reuse
the patterns without rewriting the safe-backfill logic.

## 7. CLI Contract

Primary command:

```bash
dbcli verify safe-backfill \
  --table <table> \
  --query "<UPDATE statement>" \
  --verify-query "<SELECT assertion query>" \
  --expect "<assert expression>"
```

After-write command:

```bash
dbcli verify safe-backfill \
  --table <table> \
  --query "<UPDATE statement>" \
  --verify-query "<SELECT assertion query>" \
  --expect "<assert expression>" \
  --after-write
```

Supported options:

| Option | Required | Description |
| --- | --- | --- |
| `--table <table>` | yes | Target table name. The command must pass it to `schema <table> --format json`. |
| `--query <sql>` | yes | Proposed backfill `UPDATE` statement. The command plans/analyzes it but never executes it. |
| `--verify-query <sql>` | yes | Read-only `SELECT` used by the final assertion. |
| `--expect <expr>` | yes | Assertion expression passed to the existing assertion evaluator. |
| `--after-write` | no | Runs the result assertion and writes a verification artifact. |
| `--format <table|json>` | no | Output format, default `table`. |
| `--subject-name <name>` | no | Optional artifact subject name. Default is the table name. |
| `--summary <text>` | no | Optional artifact summary override for after-write mode. |

Rejected options for the MVP:

| Option | Reason |
| --- | --- |
| `--execute` | Ambiguous because the scenario intentionally never executes the backfill write. |
| `--write` | Too easy to confuse with write execution. |
| `--no-artifact` | Agents that do not want artifacts can call `assert` directly. The scenario command exists to produce evidence. |
| `--scenario <name>` | Premature before a second scenario exists. |

## 8. Mode Behavior

### Preflight Mode

Preflight mode runs only local or read-only checks:

1. Resolve and validate all required CLI options.
2. Run the same sensitive-data guard used by the task pack:
   `blacklist list`.
3. Confirm schema with `schema <table> --format json`.
4. Analyze the proposed write with `plan "<query>"`.
5. Confirm the verification query is read-only before including it in the
   generated after-write command.
6. Print the after-write command that the agent must run after executing the
   approved backfill write through existing write surfaces.

Preflight mode must not:

- execute the backfill write;
- execute the verification query;
- write a verification artifact;
- claim the backfill is verified.

Preflight table output should include:

- target table;
- preflight status: `ready` or `blocked`;
- guard results;
- planned update command;
- after-write command;
- reminder that write execution is external to this scenario.

Preflight JSON output should include:

```json
{
  "scenario": "safe-backfill",
  "mode": "preflight",
  "status": "ready",
  "table": "users",
  "guards": [
    { "name": "blacklist", "status": "passed" },
    { "name": "schema", "status": "passed" },
    { "name": "plan", "status": "passed" },
    { "name": "verify-query-readonly", "status": "passed" }
  ],
  "afterWriteCommand": "dbcli verify safe-backfill ... --after-write"
}
```

If a guard fails, `status` is `blocked`, and `guards` includes the bounded
reason. No artifact is written in preflight mode.

### After-Write Mode

After-write mode runs the result path:

1. Resolve and validate all required CLI options.
2. Run `blacklist list`.
3. Run `schema <table> --format json`.
4. Run `plan "<query>"`.
5. Confirm `verify-query` is read-only.
6. Run the equivalent of:

   ```bash
   dbcli assert "<verify_query>" \
     --expect "<expect>" \
     --write-verification-artifact \
     --verification-subject "backfill:<subject-name>"
   ```

7. Return the assertion verdict plus artifact metadata.

After-write mode table output should include:

- target table;
- result status;
- artifact id and path when written;
- assertion expression;
- bounded summary;
- next command: `dbcli verification show <artifact-id>`.

After-write JSON output should include:

```json
{
  "scenario": "safe-backfill",
  "mode": "after-write",
  "status": "verified",
  "table": "users",
  "artifact": {
    "id": "vfy_...",
    "path": ".dbcli/verification/...",
    "subject": { "kind": "backfill", "name": "users" }
  },
  "assertion": {
    "expect": "rows == 0",
    "passed": true
  }
}
```

## 9. Status Mapping

The scenario maps outcomes to verification statuses as follows:

| Outcome | Command exit | Artifact status | Notes |
| --- | --- | --- | --- |
| All guards pass and assertion passes | `0` | `verified` | The read-back query matched `--expect`. |
| All guards pass and assertion fails | non-zero | `not_verified` | The read-back query contradicted the expected outcome. |
| A required guard cannot run or fails before assertion | non-zero | `blocked` in after-write mode only | Examples: missing config, table unavailable, blacklisted target, non-read-only verify query. |
| Assertion runs but verdict cannot be trusted | non-zero | `indeterminate` | Examples: malformed assertion output or ambiguous evaluator result. |
| Preflight guards pass | `0` | no artifact | The write has not been verified. |
| Preflight guards fail | non-zero | no artifact | Preflight is planning support, not result evidence. |

In after-write mode, the command should attempt to write a bounded artifact for
`blocked`, `not_verified`, `indeterminate`, and `verified` outcomes. If artifact
writing itself fails, the command exits non-zero and reports both the scenario
status and the artifact write error.

## 10. Artifact Contract

After-write artifacts use the existing v1 schema.

Recommended fields:

```ts
{
  schemaVersion: 1,
  status: 'verified' | 'not_verified' | 'indeterminate' | 'blocked',
  subject: {
    kind: 'backfill',
    name: '<subject-name or table>',
    command: 'verify safe-backfill'
  },
  summary: '<bounded human-readable result>',
  evidence: [
    {
      kind: 'task-pack-plan',
      taskName: 'safe-backfill-verify',
      note: 'Preflight guards ran before read-back verification.'
    },
    {
      kind: 'assert',
      command: 'assert "<verify_query>" --expect "<expect>"',
      exitCode: 0
    }
  ]
}
```

Artifact evidence must stay bounded. It may include command labels, exit codes,
task name, recovery or audit references already exposed by underlying commands,
and short notes. It must not include raw rows, credentials, full connection
details, or unbounded command output.

## 11. Error Handling

The command must fail closed.

Input errors:

- Missing required options fail before any command execution.
- Empty `--table`, `--query`, `--verify-query`, or `--expect` values fail before
  any command execution.
- `--format` values outside `table` and `json` fail before any command
  execution.

Safety errors:

- If `--query` is not recognized as an `UPDATE`, the scenario is `blocked`.
- If `--verify-query` is not read-only, the scenario is `blocked`.
- If blacklist or schema checks fail, the scenario is `blocked`.
- If `plan "<query>"` rejects the write, the scenario is `blocked`.

Runtime errors:

- Assertion failure is `not_verified`, not a crash.
- Assertion engine errors that prevent a verdict are `indeterminate` unless a
  clearer `blocked` reason applies.
- Artifact writer errors are reported separately so agents do not confuse a
  successful assertion with persisted evidence.

## 12. Implementation Shape

Expected files:

| File | Responsibility |
| --- | --- |
| `src/commands/verify.ts` | Commander registration and output rendering for `verify safe-backfill`. |
| `src/cli.ts` | Register the new `verify` command namespace. |
| `src/core/verify/safe-backfill.ts` | Pure scenario orchestration, input normalization, guard result model, and status mapping. |
| `src/core/verify/index.ts` | Public exports for scenario core helpers. |
| `tests/unit/core/verify/safe-backfill.test.ts` | Unit coverage for mode selection, status mapping, and artifact input construction. |
| `tests/integration/verify-safe-backfill-command.test.ts` | CLI coverage for preflight, after-write success, assertion failure, blocked guards, JSON output, and artifact writing. |
| `docs/user/en/index.md` and `docs/user/zh-TW/index.md` | User-facing command guidance. |
| `docs/user/en/index.html` and `docs/user/zh-TW/index.html` | HTML parity for user docs. |
| `assets/reference.md` | Full command reference. |
| `assets/SKILL.md` and platform mirrors | Compact routing guidance for agents. |

The core scenario module should not import Commander. It should accept a typed
input object and injected runners for guards/assertion where practical, so unit
tests can validate mapping without touching a database.

## 13. Testing Strategy

Unit tests:

- preflight mode returns `ready` when all guards pass;
- preflight mode returns `blocked` and no artifact input when a guard fails;
- after-write mode maps assertion pass to `verified`;
- after-write mode maps assertion fail to `not_verified`;
- after-write mode maps unreadable guards to `blocked`;
- after-write mode maps ambiguous assertion errors to `indeterminate`;
- artifact subject defaults to `backfill:<table>`;
- `--subject-name` overrides the artifact subject name;
- evidence refs never include raw row data or connection details.

Integration tests:

- `verify safe-backfill` renders an after-write command and writes no artifact;
- `verify safe-backfill --format json` returns stable preflight JSON;
- `verify safe-backfill --after-write` writes a valid artifact on assertion
  success;
- assertion failure exits non-zero and writes a `not_verified` artifact;
- blocked preconditions in after-write mode write a `blocked` artifact;
- invalid `--format` fails before running guards;
- missing required arguments fail before running guards;
- `verification list --subject backfill:<table>` can find the written artifact.

Verification commands before release:

```bash
bun test tests/unit/core/verify/safe-backfill.test.ts
bun test tests/integration/verify-safe-backfill-command.test.ts
bun run docs:check
bun run skill:check
bun run platform:check
bun run release:check
```

## 14. Documentation Requirements

Documentation must clearly separate three concepts:

1. `tasks plan safe-backfill-verify` creates a plan.
2. `verify safe-backfill` runs the scenario preflight or after-write verifier.
3. `verification list|show|summary|prune` inspects and manages local artifacts.

English and Traditional Chinese docs must include:

- a preflight example;
- an after-write example;
- a warning that the command never executes the backfill write;
- how to inspect the resulting artifact;
- the difference between `blocked`, `not_verified`, and `indeterminate`.

Compact skill guidance should route agents as follows:

- use `tasks plan safe-backfill-verify` when the user needs a plan only;
- use `verify safe-backfill` before and after a real safe backfill when durable
  evidence is required;
- use `verification show <id>` to cite the final artifact.

## 15. Acceptance Criteria

- `dbcli verify safe-backfill` exists and defaults to preflight mode.
- Preflight mode performs no writes and writes no artifact.
- Preflight mode prints the exact after-write command.
- `dbcli verify safe-backfill --after-write` writes a v1 verification artifact.
- The command never executes the supplied backfill `UPDATE`.
- Status mapping follows this spec for `verified`, `not_verified`, `blocked`,
  and `indeterminate`.
- JSON output is stable and contains scenario, mode, status, table, guard, and
  artifact fields where applicable.
- Table output is concise and includes artifact id/path after write.
- User docs, HTML docs, skill assets, and platform mirrors stay in sync.
- Targeted tests, docs checks, skill checks, platform checks, and release checks
  pass before release.

## 16. ADR

Decision: add `dbcli verify safe-backfill` as a scenario-specific MVP with
default preflight mode and explicit `--after-write` result mode.

Drivers:

- The verification artifact loop is now stable enough to support a scenario
  command.
- Safe backfill is the first workflow with enough risk and a simple enough shape
  to justify scenario support.
- A default preflight mode prevents false result artifacts before the write has
  happened.
- Explicit `--after-write` makes durable evidence intentional and auditable.

Alternatives considered:

- Keep using only `assert --write-verification-artifact`.
  Rejected because agents still need to manually assemble the scenario and can
  omit required safety guards or artifact metadata.

- Add a generic `dbcli verify <scenario>` registry immediately.
  Rejected because one scenario is not enough evidence for a generalized runner.

- Make `verify safe-backfill` execute the write.
  Rejected because write execution requires separate confirmation, dry-run,
  permission, and recovery contracts that are outside the verification MVP.

Consequences:

- `verify` becomes the namespace for scenario execution.
- `verification` remains the namespace for local artifact inspection and
  lifecycle management.
- A future generic scenario registry can be added after at least one more
  scenario proves shared behavior.

Follow-ups:

- Consider `dbcli verify migration` only after migration-review has equivalent
  guard and result evidence requirements.
- Consider a shared scenario registry once two or more verify scenarios need the
  same runner structure.
- Consider optional audit correlation in a separate milestone without changing
  the v1 artifact schema.

## Lifecycle closeout

### Current implementation

`src/commands/verify.ts` and `src/core/verify/safe-backfill.ts` implement the
preflight and after-write scenario. The command validates the target and
verification query, never executes the backfill write, and emits bounded
artifact evidence when after-write verification runs. The companion
`verification list|show|summary|prune` commands manage local evidence.

### Completion evidence

- Implementation: `f32d896`, `d0a65cc`, `a3aeb80`, `347733a`, and the later
  scenario registry/constraint hardening commits.
- Verification: safe-backfill, scenario, artifact, command, and task-pack
  tests were included in the focused verification run; the aggregate passed
  111 tests.
- Documentation: both user-language docs, skill assets, and platform mirrors
  describe preflight, after-write, statuses, and the no-write guarantee.
- Repository gates: typecheck, lint, docs parity, skill parity, platform parity,
  and CLI contract checks passed during this audit.

### Known deviations

The implementation has grown from one MVP scenario to a registry with
additional migration, rollback, and constraint scenarios. This spec remains the
safe-backfill contract; cross-scenario publication is tracked by the separate
deferred evaluation spec.
