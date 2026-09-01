---
status: accepted
date: 2026-09-01
---

# Connection-only adapters say `WithoutRules`

## Context

ADR-0015 made the Redis and MongoDB factories take configuration, but the
system-neutral `AdapterFactory.createAdapter(connection)` still created either
adapter without rules. `dbcli q` and `dbcli report` used that path, and both
also derived no Redis blacklist targets. A saved `GET secrets:api_key` therefore
returned plaintext; the built-in Redis key-space diagnostic could persist
protected key names. `inspect` used the same construction path and was safe only
because it does not yet enumerate Redis objects.

Some connection-only adapters are legitimate. `init` tests a configuration
that has not been written yet, and credential rotation must test a replacement
password before persisting it. Making rules mandatory everywhere would force
those callers to fabricate a configuration or add an escape hatch.

## Decision

`AdapterFactory.createAdapter` takes a configuration and is the safe default.
Its Redis and MongoDB branches route through their rule-aware factories. The
only system-neutral connection-only entry point is named
`createAdapterWithoutRules`; probes use it explicitly, so `grep` finds every
exception without inferring intent from its caller.

`q`, `report`, `inspect`, and `schema` use the configured entry point. `q` and
the report diagnostic runner derive Redis keys from the existing
`REDIS_COMMAND_TABLE`; they do not introduce another key-position table.

Rejected alternatives:

- Patching only the known callers leaves the next generic caller looking safe.
- Banning connection-only construction cannot represent pre-persistence probes
  honestly and would recreate the same capability behind a less visible cast or
  fabricated config.

## Consequences

The factory API change is breaking and lands before 7.0.0. Connection probes
remain possible, but their lack of blacklist and mask rules is explicit in code
search. Redis saved queries and report evidence now refuse protected key reads
before execution; the configured adapter remains the second enforcement layer
for reply filtering and masking.

**Falsified if:** `AdapterFactory.createAdapter` in `src/adapters/factory.ts`
accepts a connection instead of a configuration; or another system-neutral
connection-only factory is added without `WithoutRules` in its name; or `q` in
`src/commands/q.ts`, `collectReport` in `src/core/report/collector.ts`,
`collectInspect` in `src/core/inspect/collector.ts`, or `schemaAction` in
`src/commands/schema.ts` constructs an adapter without the resolved blacklist;
or Redis targets in `q` or `runDiagnostic` stop coming from
`redisCommandTargets` in `src/adapters/redis/blacklist-enforcer.ts`.
