# Acceptance Criteria

## Happy Path

* [ ] `dbcli --agent-output capabilities` emits one compact v1 Operation Envelope plus one newline on stdout, nothing on stderr, and exits `0` — `tests/integration/capabilities-command.test.ts`
* [ ] The success envelope contains all ten fixed keys, operation `capabilities.list`, status `succeeded`, ok `true`, context `null`, strict `CapabilityCatalog` data, empty warnings, empty evidence, null recovery, and null error — same file
* [ ] `data` in `capabilities.list` strictly validates against `CapabilityCatalogSchema` and includes all catalogued capabilities — `tests/unit/core/operation-envelope.test.ts`
* [ ] `parseOperationEnvelope(unknown)`, its updated types, and the independent schema version are exported through `@carllee1983/dbcli/core` — `tests/unit/core-public.test.ts`
* [ ] Root help documents `--agent-output` and accurately reflects support for `capabilities` and `capabilities check` — `tests/integration/lazy-entry-path.test.ts`

## Business Rules

* [ ] The strict parser accepts both `capabilities.check` and `capabilities.list` operations and rejects any other operation — `tests/unit/core/operation-envelope.test.ts`
* [ ] The parser validates `data` against `CapabilityCatalogSchema` when `operation === 'capabilities.list'` and `capabilitiesCheckDataSchema` when `operation === 'capabilities.check'` — same file
* [ ] The parser enforces `ok === (status === "succeeded")`, success/error nullability, and that successful `capabilities.list` requires non-null data and null error — same file
* [ ] Serialized size of `capabilities.list` envelope is bounded below 65,536 UTF-8 bytes — same file
* [ ] Identical envelope inputs emit byte-identical compact JSON, stable top-level field order, and exactly one trailing newline — same file
* [ ] Subcommand JSON support is accurately reflected across the capability catalog, allowing callers to inspect per-subcommand JSON capabilities without ambiguity — `tests/contract/capability-contract.test.ts`

## Failure Cases

* [ ] `--agent-output` placed after `capabilities` (`dbcli capabilities --agent-output`) emits `INVALID_AGENT_OUTPUT_OPTIONS`, empty stderr, and exit `2` — `tests/integration/capabilities-command.test.ts`
* [ ] Combining `--agent-output capabilities` with explicit `--format` or `--for-agent` emits `INVALID_AGENT_OUTPUT_OPTIONS`, empty stderr, and exit `2` — `tests/integration/capabilities-command.test.ts`
* [ ] An unsupported command, `shell`, `es-shell`, `proxy`, `--help`, `--version`, or no command combined with `--agent-output` emits `UNSUPPORTED_AGENT_OUTPUT_OPERATION`, empty stderr, and exit `2` — `tests/integration/lazy-entry-path.test.ts`
* [ ] Unexpected command-tree load or action failures emit `AGENT_OUTPUT_INTERNAL_ERROR` with `Agent output failed safely.`, empty stderr, and exit `1` — `tests/integration/lazy-entry-path.test.ts`
* [ ] An otherwise valid result whose serialized output exceeds 65,536 bytes is replaced by one `AGENT_OUTPUT_LIMIT_EXCEEDED` envelope and exit `1` — `tests/unit/core/operation-envelope.test.ts`

## Regression Requirements

* [ ] Existing `--format json`, `--format markdown`, and text output for `capabilities` remain byte-identical when `--agent-output` is absent — `tests/integration/capabilities-command.test.ts`
* [ ] Existing `capabilities check` Operation Envelope v1 behavior is completely preserved — `tests/integration/capabilities-command.test.ts`
* [ ] Discovery operations remain strictly offline and make no database connection or filesystem mutation — `tests/contract/capability-contract.test.ts`
* [ ] English and Traditional Chinese user Markdown/HTML, root help, `assets/SKILL.md`, `assets/reference.md`, and all skill mirrors describe the updated option and operations — `make verify`
* [ ] Complete verification gate passes without failures — `make verify`

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `data.capabilities[].command` | `PLAT005_EXEC_CMD` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `context.password` | `PLAT005_PASSWORD_SENTINEL` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `context.connectionString` | `postgresql://plat005:PLAT005_SECRET@db.internal:5432/prod` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `data.rows` | `[{"ssn":"PLAT005_ROW_SENTINEL"}]` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `data.sql` | `SELECT * FROM users WHERE email='plat005@example.com'` | reject | `none` | `tests/unit/core/operation-envelope.test.ts` |
| `unexpectedError.message` | `driver body: PLAT005_RAW_ERROR_SENTINEL` | redact | `none` | `tests/integration/lazy-entry-path.test.ts` |

## Verification Notes

Run focused unit, contract, and CLI integration tests first:

```sh
bun test tests/unit/core/operation-envelope.test.ts tests/unit/core-public.test.ts tests/contract/capability-contract.test.ts tests/integration/capabilities-command.test.ts tests/integration/lazy-entry-path.test.ts
```

Then run `make verify` from the repository root. Ensure all 6 security fixture scenarios pass and no credentials or unhandled errors leak.
