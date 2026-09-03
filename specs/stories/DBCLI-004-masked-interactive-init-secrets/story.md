# Story: DBCLI-004 Masked Interactive Init Secrets

## Goal

Prevent credentials entered during interactive `dbcli init` from appearing in
terminal scrollback, logs, recordings, or screen sharing while preserving the
existing connection setup behavior.

## Context

The MongoDB field-first connection specification records that its password
prompt uses `promptUser.text`, which echoes the value. The shared PostgreSQL,
MySQL, MariaDB, Redis, and Elasticsearch init path uses the same unsafe text
prompt, and MongoDB's full-URI prompt can carry an embedded password.

dbcli already has one masked `promptUser.secret` path used by the `password`
command. This Story reuses that existing primitive for credential-bearing init
inputs instead of adding another prompt implementation.

MongoDB driver errors may also reproduce the resolved connection URI. Masking
input is therefore incomplete unless init connection-test failures redact the
same credentials before writing an error to the terminal.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: yes
* Baseline conformance: no

## Scope

### In Scope

* Mask password values entered by the interactive PostgreSQL, MySQL, MariaDB,
  Redis, and Elasticsearch init flow.
* Mask password values entered by the interactive MongoDB field flow.
* Mask the interactive MongoDB full-URI input because it may contain
  credentials.
* Redact entered credentials from init connection-test errors and hints.
* Fail closed instead of falling back to echoed text when masked input is
  unavailable.
* Ensure `--no-interactive`, an explicit `--password`, and an explicit `--uri`
  suppress the matching secret prompt.
* Add focused regression tests and aligned English and Traditional Chinese user
  documentation.

### Out of Scope

* Encrypting credentials at rest or changing the configuration schema.
* Removing existing `--password`, `--uri`, environment-reference, or
  non-interactive inputs.
* Hiding non-secret values such as hosts, database names, usernames, or
  environment-variable names.
* MongoDB URI scheme validation, general prompt localization, unrelated
  prompt-order changes, or broader SQL/MongoDB interactive-mode unification.
* Changes to the existing `dbcli password` command.

## Inputs

* A password typed into an interactive SQL, MongoDB, Redis, or Elasticsearch
  field-based init flow.
* A credential-bearing MongoDB URI pasted into the interactive URI init flow.

## Outputs

* The entered value is passed to the existing init configuration flow without
  being echoed.
* Existing successful init output and stored connection semantics remain
  unchanged.

## Rules

* R1: Credential-bearing interactive init input must use the existing masked
  secret prompt, not the plain text prompt.
* R2: A typed or pasted secret must not be written to stdout or stderr, including
  prompt errors and cancellation handling.
* R3: If masked prompting cannot be provided, init must stop before writing
  configuration and must not retry through a plaintext fallback.
* R4: Cancellation must propagate without re-prompting in plaintext or writing a
  partial connection.
* R5: Environment-variable-name prompts remain ordinary visible text; only the
  secret value or credential-bearing URI is masked.
* R6: Non-TTY input must not trigger an implicit plaintext secret prompt. It
  fails before writing unless the value is supplied through an existing
  non-prompt source: an explicit flag, parsed `.env`/process environment
  credential, or environment-reference path.
* R7: `--no-interactive` must use Commander's effective `interactive === false`
  option and never invoke a secret prompt. Missing required input follows the
  existing validation path without writing an incomplete configuration.
* R8: An explicit `--password` or `--uri` bypasses the matching prompt and is
  retained unchanged as input; it must never become a visible prompt default.
* R9: Environment references, empty MongoDB credentials, connection testing,
  and configuration persistence retain their existing semantics.
* R10: Credential redaction must use a shared existing security boundary where
  one fits; do not add separate engine-specific string replacements.

## Expected Errors

* Masked prompt support is unavailable: return a bounded actionable error and do
  not write configuration. Guidance must name an input supported by the active
  init mode: `--password`, parsed environment credentials, or environment
  references for a password, and `--uri` for a MongoDB URI; it must not
  recommend unsupported `--stdin`.
* The user cancels masked input: preserve the cancellation and do not write
  configuration.
* A connection test fails with a driver message containing a credential or full
  URI: emit a bounded redacted error and do not reproduce the secret.
* Non-TTY execution reaches an implicit secret prompt: fail closed and identify
  an existing explicit input path without reading or echoing plaintext.
* `--no-interactive` lacks required input: do not prompt or write an incomplete
  connection; return the existing validation error.

## Dependencies

* Existing `promptUser.secret` implementation and `@inquirer/prompts` dependency.
* Existing SQL and MongoDB init flows and configuration writers.

## Constraints

* Do not add or upgrade dependencies.
* Do not print, log, snapshot, or include test canary secrets in failure output.
* Keep English and Traditional Chinese Markdown and HTML documentation aligned.
* Preserve existing CI checks and use `make verify` as the completion gate.

## Trust Boundary Fields

* Interactive password prompt for the shared PostgreSQL, MySQL, MariaDB, Redis, and Elasticsearch init flow, e.g. the label `password`.
* Interactive `Password` prompt for the MongoDB field-based init flow.
* Interactive `連線字串` (connection string) prompt for the MongoDB full-URI init flow, which may embed a credential.
* The explicit `--password` flag value.
* The explicit `--uri` flag value, which may embed a credential.
* Parsed `.env` and process environment credentials consumed as a non-prompt password source.
* Environment-reference names supplied through `--use-env-refs`, e.g. `DB_PASSWORD`, which remain visible text distinct from the referenced secret value.
* Driver connection-test error messages and hints that may reproduce the entered password or full MongoDB URI, redacted via `redactSecretsForDisplay`.
* The `maskedInputUnavailableError` guidance text and any underlying loader error it must not reproduce.
