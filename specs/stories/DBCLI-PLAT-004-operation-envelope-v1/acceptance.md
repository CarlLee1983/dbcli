# Acceptance Criteria

## Happy Path

* [ ] `dbcli --agent-output capabilities check --require schema.read` emits one
      compact v1 Operation Envelope plus one newline on stdout, nothing on
      stderr, and exits `0` when available —
      `tests/integration/capabilities-command.test.ts`
* [ ] The success envelope contains all ten fixed keys, operation
      `capabilities.check`, status `succeeded`, safe context, strict
      `{ required, results }` data, empty evidence, null recovery, and null error
      — same file
* [ ] `parseOperationEnvelope(unknown)`, its types, and the independent schema
      version are exported through `@carllee1983/dbcli/core` —
      `tests/unit/core-public.test.ts`
* [ ] Root help documents `--agent-output` and states that PLAT-004 supports only
      `capabilities check` — `tests/integration/lazy-entry-path.test.ts`

## Business Rules

* [ ] The strict parser rejects an unknown top-level field, an unknown nested
      field, and every schema version except literal `1` —
      `tests/unit/core/operation-envelope.test.ts`
* [ ] The parser enforces `ok === (status === "succeeded")`, success/error
      nullability, and the completed-negative-result data rule — same file
* [ ] Operation ids match
      `^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$`; error and warning codes match
      `^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$`; evidence, context, and
      capability-result values satisfy their strict shapes and established
      vocabularies — same file
* [ ] Required/results/warnings caps are 128, evidence is capped at 16, identifier
      fields at 160 characters, messages at 2,000 characters, and the serialized
      envelope at 65,536 UTF-8 bytes — same file
* [ ] An envelope at every exact boundary passes, while the next character,
      element, or byte fails closed without partial output — same file
* [ ] Identical envelope inputs emit byte-identical compact JSON, stable
      top-level field order, and exactly one trailing newline — same file
* [ ] A non-null recovery value passes the existing strict Recovery Envelope
      parser, obeys the enclosing 2,000-character free-text bound, and exactly
      matches the top-level error code and message — same file
* [ ] Evidence references accept only `receipt`, `audit`, and
      `verification-artifact`; ids match
      `^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$`, optional digests match
      `^sha256:[a-f0-9]{64}$`, and paths or embedded bodies are rejected — same
      file
* [ ] Error and warning codes are bounded uppercase snake-case identifiers and
      their documented meanings remain locale-independent English — same file

## Failure Cases

* [ ] Requirements unmet emits a failed envelope with bounded result data,
      `CAPABILITY_REQUIREMENTS_UNMET`, empty stderr, and exit `1` —
      `tests/integration/capabilities-command.test.ts`
* [ ] Missing, empty, and empty-element `--require` each emit
      `INVALID_CAPABILITY_REQUIREMENTS`, `data: null`, empty stderr, and exit `2`
      — same file
* [ ] Duplicate requirements are de-duplicated in first-seen order and mapped to
      `DUPLICATE_CAPABILITY_REQUIREMENT` without changing the result exit code —
      same file
* [ ] Missing context, unresolvable context, and active agent-mode restrictions
      map to their three stable warning codes without leaking the underlying
      config error — same file
* [ ] `--agent-output` placed after the subcommand, or combined with explicitly
      supplied `--format` or `--for-agent`, emits
      `INVALID_AGENT_OUTPUT_OPTIONS`, no prose, empty stderr, and exit `2` — same
      file
* [ ] An unsupported ordinary command, `shell`, `es-shell`, `proxy`, `--help`,
      `--version`, and no command are rejected before action with
      `UNSUPPORTED_AGENT_OUTPUT_OPERATION`, empty stderr, and exit `2` —
      `tests/integration/lazy-entry-path.test.ts`
* [ ] Commander missing/malformed `--require` maps to
      `INVALID_CAPABILITY_REQUIREMENTS`; other Commander option failures map to
      `INVALID_AGENT_OUTPUT_OPTIONS`; all emit one envelope, empty stderr, and
      exit `2` — `tests/integration/lazy-entry-path.test.ts`
* [ ] Command-tree load and unexpected action failures after opt-in each emit one
      `AGENT_OUTPUT_INTERNAL_ERROR` envelope with
      `Agent output failed safely.`, no raw error, empty stderr, and exit `1` —
      `tests/integration/lazy-entry-path.test.ts`
* [ ] Field-level input overflow emits its input error and exit `2`; an otherwise
      valid result whose compact JSON plus newline exceeds 65,536 bytes is
      replaced by one `AGENT_OUTPUT_LIMIT_EXCEEDED` envelope and exit `1` —
      `tests/unit/core/operation-envelope.test.ts`

## Regression Requirements

* [ ] Before product source changes, exact success and requirements-unmet stdout,
      stderr, and exit fixtures are captured from baseline commit `4aa8c183`; the
      changed CLI must match those checked-in bytes, and repeated post-change runs
      must also match one another —
      `tests/integration/capabilities-command.test.ts`
* [ ] Existing `--format json`, text, Markdown, `--for-agent`, standalone
      `--version`, unknown-option, and locale behavior remain unchanged when not
      opted in; root help changes only by the documented `--agent-output` entry —
      `tests/integration/lazy-entry-path.test.ts` and
      `tests/integration/capabilities-command.test.ts`
* [ ] Both envelope result paths remain offline and make no database connection
      or filesystem mutation — `tests/contract/capability-contract.test.ts` and
      `tests/integration/capabilities-command.test.ts`
* [ ] English and Traditional Chinese user Markdown/HTML, root help,
      `assets/SKILL.md`, `assets/reference.md`, and every generated Skill mirror
      describe the same option, support boundary, fields, and exit codes — docs
      parity and Skill parity checks in `make verify`
* [ ] Core no-stdout, CLI contract, package exports, lazy loading, plugin sync,
      documentation, and ForgeFlow gates pass — `make verify`
* [ ] The complete repository verification gate passes — `make verify`

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `context.password` | `PLAT004_PASSWORD_SENTINEL` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `context.connectionString` | `postgresql://plat004:PLAT004_SECRET@db.internal:5432/prod` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `data.rows` | `[{"ssn":"PLAT004_ROW_SENTINEL"}]` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `data.sql` | `SELECT * FROM users WHERE email='plat004@example.com'` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `context.configPath` | `/Users/plat004/private/config.json` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `unexpectedError.message` | `driver body: PLAT004_RAW_ERROR_SENTINEL` | redact | `none` | `tests/integration/lazy-entry-path.test.ts` |

## Verification Notes

Run the focused contract and CLI checks first:

```sh
bun test tests/unit/core/operation-envelope.test.ts tests/unit/core-public.test.ts tests/integration/capabilities-command.test.ts tests/integration/lazy-entry-path.test.ts
```

Then run `make verify` from the repository root. The six security fixtures are
required exact cases, not examples; no payload may appear in stdout, stderr, a
saved file, or a diagnostic artifact. Run CLI integration tests without a PTY so
their stdout/stderr contract matches a real agent pipe.
