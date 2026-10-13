# Require an explicit name when creating a connection

## Goal

Follow up on [issue #212](https://github.com/CarlLee1983/dbcli/issues/212) and
merged [PR #215](https://github.com/CarlLee1983/dbcli/pull/215). The user explicitly
requested in the current session that adding a connection must ask for its name,
instead of silently naming it `default` when no name is supplied.

The baseline is `main` at `17f84171`. `init` currently falls back to the connection
name `default` for v2 initialization; unqualified project initialization can also
take the legacy v1 creation path. New connections must be explicitly named in
both cases and use the existing named-v2 initialization path. The connection name
is `--conn-name`; `--name` continues to mean the database name.

## Out of Scope

- Changing selection precedence, production safeguards, configuration mutation
  approval, integrity checks, permissions, or credential storage.
- Changing the persisted-default policy: the first explicitly named connection
  remains the default of a new registry; adding to an existing registry preserves
  its current default or intentionally absent default.
- Removing support for reading existing v1 configurations or changing the
  established named v1-to-v2 import behavior.
- Changing explicit overwrite confirmation or `--force` semantics for an existing
  connection name, or forbidding the explicitly supplied name `default`.
- New credential migration, dependency upgrades, releases, merges, deployments,
  or access to private databases and credentials.

## Acceptance Criteria

1. Before any connection test or configuration write, every creation/addition
   through `init` obtains a nonblank connection name. With a TTY and interactive
   mode enabled, omission of `--conn-name` actively prompts without a suggested
   `default`; empty or whitespace-only responses explain the requirement and
   re-prompt. Cancelling or ending the prompt cannot write a configuration.
2. Without a TTY, with `--no-interactive`, or in the existing automatically
   noninteractive env-reference mode, missing or blank `--conn-name` fails with
   actionable guidance and no database access or configuration/credential writes.
   Supplying `--name` alone does not satisfy this requirement.
3. An explicit nonblank `--conn-name` skips the name prompt. The explicit name
   `default` remains valid. Database `--name`, engine-specific flags and remaining
   prompts retain their existing meanings. `--remove` and `--rename` do not ask
   for a new connection name.
4. Both plain `init` and explicit `--config` paths create named v2 configurations
   rather than taking a nameless legacy creation fallback. Existing v1 readers
   and named v1-to-v2 imports remain supported; existing registry entries and
   default/no-default state are preserved when a new name is added.
5. Existing overwrite protection still applies to an explicitly chosen duplicate
   name: noninteractive operation without `--force` refuses without writes;
   declining interactive confirmation leaves files untouched; explicit `--force`
   keeps its established overwrite behavior and preserves unrelated connections.
6. Regression tests cover interactive re-prompt/cancellation, noninteractive
   refusal, explicit names, flag distinctions, default state and collision
   behavior. Observe the real CLI under a TTY as well as deterministic automated
   fixtures. Update both user-documentation languages and Markdown/HTML formats,
   the shipped skill/reference surfaces and `CHANGELOG.md` under `Unreleased`.
7. `make verify` passes on the final committed revision. Report each criterion's
   observed evidence, skipped or blocked checks and residual risks. Keep the new
   pull request in draft and leave human review and merging to the user.
