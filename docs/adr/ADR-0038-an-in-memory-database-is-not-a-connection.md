# An in-memory database is not a connection

* Status: accepted
* Date: 2026-09-10

`bun:sqlite` accepts `:memory:` wherever it accepts a path, and so do the URI
forms `file::memory:` and any path carrying `mode=memory`. Adding SQLite to
dbcli therefore means deciding whether those are valid connection targets, and
the cheap answer is yes — they cost nothing to allow and they make tests
convenient.

A connection in dbcli is not a transport. It is the identity everything else
hangs off. `CONTEXT.md` defines a **Data subject** as connection-scoped
precisely so a table name cannot collide across connections; the blacklist is
stored per configuration and matched against tables reached through a
connection; the audit log records which connection an operation ran against;
the schema cache under `.dbcli/schemas/` is keyed by it and is defined as
*derived* data, re-readable at any time from the database the configuration
already points at.

An in-memory database satisfies none of that. It is created empty at open and
destroyed at close, so every dbcli invocation addresses a different database
under one name. The schema cache would describe something that no longer
exists; the blacklist would protect tables nobody can reach; the audit trail
would record operations against a subject that cannot be inspected afterwards.
The name would be stable and the thing behind it would not.

It also quietly reopens a boundary decided elsewhere. A SQLite connection's
file path may come only from the configuration, so that the connection identity
the blacklist, audit and permission layers hang off is one a human established.
`:memory:` is a path that refers to no file and can never be the same database
twice, which is the same property that rule exists to deny.

## Decision

**A SQLite connection configuration rejects `:memory:`, `file::memory:`, and any
path whose URI parameters request `mode=memory`.** The refusal is in the
configuration schema, at parse time, not in the adapter — an unusable identity
should not survive long enough to be connected with.

Tests use temporary files in a test-owned directory and delete them afterwards.
That is slower than an in-memory database by an amount nobody will measure, and
it means the integration tests exercise the same code path the product has,
including the open modes that ADR-0037 turns on.

## Consequences

This decision is cheap to reverse, which is the reason to record it rather than
a reason not to. Nothing in the code will explain why a supported driver
feature is refused, and the shape of the omission — one obviously-valid value
missing from a validator — is exactly the shape a later reader repairs without
asking. `~/.claude/rules/decision-records.md` names that case: where the cheap
reversal is itself the failure, the record is what makes the reversal
deliberate.

The convenience the refusal costs is real. A contributor wanting a throwaway
database writes a temporary file instead, and the test helper that does so is
part of the first SQLite Story rather than something each test invents.

**Falsified if:** dbcli grows an explicit ephemeral-connection concept — a
declared kind of connection for which the schema cache, blacklist scoping and
audit subject are documented as not applying — in `src/utils/validation.ts` and
`src/core/config.ts`. An in-memory database would then have an identity model
that fits it, and this refusal would be denying a supported case rather than an
incoherent one.
