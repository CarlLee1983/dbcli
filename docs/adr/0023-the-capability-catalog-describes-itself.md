---
status: accepted
date: 2026-09-04
---

# The capability catalog describes itself

DBCLI-PLAT-011 extended the catalog to cover every public command. That raised a
question the extension could not answer by rule: does `capabilities` itself get
an entry?

The argument against is real. A Skill that runs `dbcli capabilities check
--require capability.check` and is told `available` has learned nothing — the
command answering the question is the proof. The entry can only ever be
`available` at the moment anyone reads it, so as a *runtime* signal it is a
constant, and a constant in a table of variables invites a reader to wonder what
it is for.

## Decision

**`capability.discover` and `capability.check` are in the catalog**, mapping to
`dbcli capabilities` and `dbcli capabilities check`.

The objection above is about one mode of use, and the catalog has two.

Read live, the entries are indeed constant. Read *pinned* — which is the mode
the contract was built for, and the reason `schemaVersion` is independent of the
npm version — they are not. A Skill ships with a catalog it validated against,
and later meets a dbcli it did not choose. `--require capability.check` against
an older build that has no such command exits `1` with reason
`unknown-capability`, which is exactly the signal the Skill needs and exactly
what it would not get if the ids had never existed.

The same holds for Task Pack `safety.requires` (DBCLI-PLAT-008). A pack that
preflights capabilities depends on preflighting existing; naming that dependency
is what a requirement list is for, and a dependency that cannot be named is one
nobody can see.

There is a third reason, weaker but not nothing. "Every public command is
described" is a rule a reader can check. "Every public command except the one
doing the describing" is a rule with an exception, and an exception nobody
wrote down gets re-litigated.

## What this does not decide

It does not make the catalog self-validating. `capability.discover` being
`available` says the same thing every other entry says: the configured engine,
agent mode and permission would not refuse it. It is not a statement about the
catalog's contents being correct, and no entry in a catalog can be.

It also does not add a capability for every future subcommand of
`capabilities`. The rule is unchanged — a capability names an atomic ability and
maps to a path that really exists.

## Consequences

`capabilities` and `capabilities check` appear in `ENGINE_CAPABILITIES` as
`not-applicable` for all six engines, which is what they are: neither opens a
connection and neither behaves differently per engine. The existing contract
test that asserts every catalogued path exists in the live Commander tree now
covers the catalog's own two paths, so removing or renaming them breaks a test
rather than a consumer.

**Falsified if:** `capability.discover` or `capability.check` is absent from
`DECLARATIONS` in `src/core/capabilities/registry.ts`, or either names a command
path that `src/program.ts` does not register.
