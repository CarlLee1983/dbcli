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
