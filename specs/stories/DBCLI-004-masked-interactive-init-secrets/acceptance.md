# Acceptance Criteria

## Happy Path

* [ ] Table-driven interactive init tests for PostgreSQL, MySQL, MariaDB, Redis,
  and Elasticsearch enter a canary password through the shared masked prompt,
  complete successfully, and prove the canary never appears in stdout or
  stderr.
* [ ] An interactive MongoDB field init test enters a canary password through the
  masked prompt, completes successfully, and proves the canary never appears in
  stdout or stderr.
* [ ] An interactive MongoDB URI init test pastes a URI containing a canary
  password, completes successfully, and proves the canary and full URI never
  appear in stdout or stderr.

## Business Rules

* [ ] PostgreSQL, MySQL, MariaDB, Redis, Elasticsearch, and MongoDB password
  collection, plus MongoDB URI value collection, call the existing masked
  secret prompt rather than the plain text prompt.
* [ ] Hosts, ports, usernames, database names, and environment-variable names
  remain visible text prompts.
* [ ] Successful init produces the same connection configuration as before this
  Story for equivalent input; only terminal echo behavior changes.
* [ ] Prompt and error output never contains the entered canary secret.
* [ ] A failed init connection test whose seeded driver error contains the
  canary password or full MongoDB URI emits a bounded redacted error; neither
  value appears in stdout, stderr, hints, or nested error text.
* [ ] Interactive MongoDB init with an explicit `--password` or `--uri` retains
  that value, does not invoke a prompt for the same secret, and never prints it
  as a prompt default.

## Failure Cases

* [ ] When the rich masked prompt cannot be loaded, init fails before writing a
  configuration and never invokes a plaintext fallback for the secret. Its
  bounded error recommends only inputs supported by the active mode and does
  not reproduce the raw import error or recommend unsupported `--stdin`.
* [ ] Cancelling the masked prompt propagates cancellation, does not invoke a
  plaintext fallback, and does not write a partial connection.
* [ ] When non-TTY execution would otherwise prompt implicitly for a password,
  init fails before reading plaintext or writing configuration; existing
  explicit flags, parsed `.env`/process environment credentials, and environment
  references still work.
* [ ] In a TTY, `--no-interactive` never invokes a secret prompt. With missing
  required input it returns the existing validation error and writes no
  incomplete configuration.

## Regression Requirements

* [ ] Existing `--password`, `--uri`, `--use-env-refs`, and no-authentication
  MongoDB flows retain their current configuration semantics.
* [ ] Existing SQL, MongoDB, Redis, and Elasticsearch init tests remain green.
* [ ] Existing `dbcli password` masked-input behavior remains unchanged.
* [ ] `docs/user/en/index.md`, `docs/user/en/index.html`,
  `docs/user/zh-TW/index.md`, and `docs/user/zh-TW/index.html` describe masked
  interactive credential entry consistently without claiming encryption at
  rest.
* [ ] `make verify` passes.

## Verification Notes

Use canary credentials and assert their absence from both output streams. Mock
the prompt boundary for focused routing and failure tests, and verify that the
existing masked primitive is invoked with no plaintext fallback. Do not add a
PTY dependency solely for this Story. Never print the canary in an assertion
message.

## Security Fixture Matrix

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| Interactive `password` prompt for PostgreSQL, MySQL, MariaDB, Redis, and Elasticsearch init | `Sup3r-Canary-Pw` | redact | `stdout`, `stderr` | `tests/unit/commands/init-masked-secrets.test.ts::${system} routes the password through the masked prompt and never echoes it` |
| Interactive `password` prompt config write for PostgreSQL, MySQL, MariaDB, Redis, and Elasticsearch init | `Sup3r-Canary-Pw` | preserve | `.dbcli/connections.json#connection.password` | `tests/unit/commands/init-masked-secrets.test.ts::${system} routes the password through the masked prompt and never echoes it` |
| Interactive `Password` prompt for MongoDB field-based init | `Sup3r-Canary-Pw` | redact | `stdout` | `tests/unit/commands/init-masked-secrets.test.ts::MongoDB field mode masks the password` |
| Interactive `連線字串` prompt for MongoDB URI-based init | `mongodb://app:Sup3r-Canary-Pw@db.example.com:27017/shop` | redact | `stdout` | `tests/unit/commands/init-masked-secrets.test.ts::MongoDB URI mode masks the pasted connection string` |
| Interactive `連線字串` prompt config write for MongoDB URI-based init | `mongodb://app:Sup3r-Canary-Pw@db.example.com:27017/shop` | preserve | `.dbcli/connections.json#connection.uri` | `tests/unit/commands/init-masked-secrets.test.ts::MongoDB URI mode masks the pasted connection string` |
| Explicit `--password` flag value | `Sup3r-Canary-Pw` | preserve | `.dbcli/connections.json#connection.password` and stdout absence | `tests/unit/commands/init-masked-secrets.test.ts::--password is kept and never re-asked` |
| Explicit `--uri` flag value for MongoDB | `mongodb://app:Sup3r-Canary-Pw@db.example.com:27017/shop` | preserve | `.dbcli/connections.json#connection.uri` | `tests/unit/commands/init-masked-secrets.test.ts::MongoDB --uri skips the setup-mode and URI prompts` |
| `--use-env-refs` password field | `DB_PASSWORD` | preserve | `.dbcli/connections.json#connection.password` as `{ $env: 'DB_PASSWORD' }` | `tests/unit/commands/init-masked-secrets.test.ts::env-ref mode asks for variable names in the clear and never a value` |
| `redactSecretsForDisplay` on a SQL driver connection-test error quoting the password | `password authentication failed: Sup3r-Canary-Pw` | redact | `stdout`, `stderr` showing `<redacted>` | `tests/unit/commands/init-masked-secrets.test.ts::a SQL driver error quoting the password is redacted` |
| `redactSecretsForDisplay` on a MongoDB driver connection-test error reproducing the full URI | `connect ECONNREFUSED for mongodb://app:Sup3r-Canary-Pw@db.example.com:27017/shop` | redact | `stdout`, `stderr` | `tests/unit/commands/init-masked-secrets.test.ts::a MongoDB driver error reproducing the URI is redacted` |
| `secret()` prompt call attempted on a non-TTY `process.stdin` | `Sup3r-Canary-Pw` typed answer never reached by the mocked failing prompt | reject | stdout, stderr, `.dbcli/connections.json` (not written) | `tests/unit/commands/init-masked-secrets.test.ts::a non-TTY run stops before writing rather than reading plaintext` |
| `maskedInputUnavailableError` guidance and underlying loader error | `bundler stripped @inquirer/prompts` | omit | `stdout` | `tests/unit/commands/init-masked-secrets.test.ts::an unavailable masked prompt names a supported input and not --stdin` |
| `secret()` prompt rejection on cancellation | `User force closed the prompt` | preserve | `stdout` showing cancellation, `.dbcli/connections.json` (not written) | `tests/unit/commands/init-masked-secrets.test.ts::cancelling the masked prompt propagates and writes nothing` |
| `redactSecretsForDisplay` embedded MongoDB URI credential | `mongodb://app:hunter2@db:27017/shop` | redact | function return value (`hunter2` absent) | `tests/unit/utils/masked-secret-input.test.ts::still applies the shared credential patterns` |
| `redactSecretsForDisplay` caller-collected literal secret | `Sup3rSecretCanary` | redact | function return value containing `<redacted>` | `tests/unit/utils/masked-secret-input.test.ts::removes a literal secret the caller collected` |
| `maskedInputUnavailableError` raw loader error text | `ENOENT Sup3rSecretCanary` | omit | `error.message` | `tests/unit/utils/masked-secret-input.test.ts::never reproduces a raw loader error` |
