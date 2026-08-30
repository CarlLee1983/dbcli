---
status: accepted
date: 2026-08-30
---

# A control that lives at the call site is not a control, and a mask cannot outrun a rename

## Context

The Elasticsearch shell branch's ninth round asked one question — *does this
matcher normalise both of the things it compares?* — of the engines the branch
was not about. It found four CRITICALs in Redis and two in MongoDB, recorded in
`docs/specs/2026-08-30-redis-blacklist-gaps.md` and
`docs/specs/2026-08-30-cross-engine-blacklist-gaps.md`. This record covers the
six, and the two decisions they turn on.

Neither decision is new. Both are ADR-0014's, arrived at again in another
engine, which is the reason to write them down where they are not about
Elasticsearch: the next engine has the same two shapes.

## Decision 1: the adapter takes the configuration, because a caller cannot forget a parameter it does not have

Four of the six had the same mechanical cause. A protection was an optional
argument, or a step a command performed for itself, and some callers did it and
some did not:

- `redis.mask` was `createRedisAdapter`'s third parameter. Six of eight call
  sites passed the blacklist and not the mask, so `dbcli query
  "GET secret:api_key"` returned the plaintext the user documentation promises
  is `[REDACTED]`. `export` and `shell` did pass it — which is why the gap
  survived: anyone checking whether the feature worked would have found that it
  did.
- `RedisAdapter.insert/update/delete` called the client with no key check at
  all. The three commands behind them went through `BlacklistValidator`, which
  compares by literal equality and knows nothing about globs, so
  `blacklist table add 'secrets:*'` — the spelling the documentation teaches —
  protected reads and not writes.
- MongoDB's field rules were applied by the three commands that remembered to
  mask their rows.

So the factories take the configuration, and the adapters hold the rules. This
is not a tidier signature. It is the difference between an omission that must be
noticed and an omission that cannot be written: changing
`createRedisAdapter`'s signature produced eight compiler errors, each one a call
site that had been missing a protection.

**The limit, stated:** `tsconfig.json` includes only `src`, so the test tree is
not type-checked. One test file kept the old signature and was found by running
the suite, not by the compiler. The guarantee is real for production code and
not for tests.

## Decision 2: a response-side mask cannot hold against a request that chooses the response's shape

MongoDB's two CRITICALs were one defect. `blacklist.columns` was enforced by
masking the keys a document came back under — and an aggregation picks those
keys. `$project: {leak: "$password"}` returns the value under `leak`;
`$addFields` and `$set` do the same; `$group: {_id: "$password"}` returns it
under `_id`, which the masker exempts unconditionally so that document
references survive a masked read.

Chasing this on the response side does not converge. Following a value back to
its source would still leave `$group`, whose output key is always the exempt
one, and each new expression operator is a new way to name a field.

So a request that *names* a protected field is refused, and the mask stays for
what it is good at — the shape of an ordinary document. This is
`namesProtectedField` from ADR-0014 Decision 7, in the other engine, and
deliberately the same shape including the over-refusal: every string and every
non-operator key in the request is a candidate, so a *value* equal to a
protected field name is refused too. That direction withholds data.

## Decision 3: the enumeration command is filtered, the naming command is refused

`SCAN` had the two halves of one hole. Its `MATCH` glob was never checked —
`SCAN`'s key arity was `no-key`, and `MATCH` has no fixed argument position — so
`SCAN 0 MATCH secrets:*` listed protected keys at `query-only` while
`KEYS secrets:*` needed `admin` and was refused by pattern overlap. The
low-privilege path was the open one. And closing only `MATCH` would have closed
nothing: a bare `SCAN 0` returns the whole keyspace.

The two halves get different answers on purpose. A request that names protected
keys is **refused**, and says so — the operator asked for something they may not
have, and silence would send them to debug their pattern. A request that merely
enumerates is **filtered**, because refusing `SCAN` outright takes an ordinary
orientation command away from everyone who has configured a blacklist, and
`listCollections` has filtered its own scan this way since it was written. Only
the operator-typed command lacked it.

This is ADR-0014 Decision 4's trade with the opposite result, and the reason it
differs is worth keeping: there, the disclosure was accepted because filtering
`_cat/indices` rows would have made a response-shape dependency load-bearing.
Here the response shape is `[cursor, keys[]]` and stays that way.

## Decision 4: two tables that must agree are one table, or a test

Redis kept command permissions in `REDIS_COMMAND_PERMISSION` and key positions
in `REDIS_COMMAND_TABLE`, maintained separately, and `checkKeyArgs` returned
`{ ok: true }` when it had no entry. Thirty-two commands the permission map
allowed had no entry, so their keys were never checked: `LPOP secrets:list`
reads *and* destroys a blacklisted key at `read-write`.

Two changes, of different kinds. The lookup is now fail-closed, and it is
reachable only when a blacklist is configured — a user who protects nothing is
refused nothing, the same scoping ADR-0014 Decision 9 settled for the
Elasticsearch object-scoped checks. And the relationship the two tables must
have is now a test rather than a convention: everything the permission map
allows has a key-arity spec.

`RedisCommandSpec.permissionTier` was **removed**, not corrected. It was a
second copy of an authority that nothing enforced, it had drifted on five
commands — `KEYS` and `INFO` were `query-only` here and `admin` where it counted
— and its type could not spell `data-admin`, so `DEL` read as `read-write`. A
second copy of an authority is not a cross-check. It is a thing to be wrong.

## Consequences

Accepted costs, in the order an operator meets them:

- A Redis command dbcli has no key-arity spec for is refused when a blacklist is
  configured. The parity test keeps that set empty, and the refusal says which
  command it was.
- A MongoDB request naming a protected field is refused even when the field is
  named as a value rather than a field path.
- `SCAN` and `KEYS` replies lose the key names the blacklist protects. A caller
  paginating with the returned cursor is unaffected; the cursor is untouched.

**Falsified if:** `AdapterFactory.createRedisAdapter` or `createMongoDBAdapter`
in `src/adapters/factory.ts` grows a second entry point that takes a connection
without its rules; or `checkKeyArgs` in
`src/adapters/redis/blacklist-enforcer.ts` returns `ok` for a command with no
spec; or `RedisCommandSpec` in `src/adapters/redis/types.ts` regains a
permission tier; or `REDIS_COMMAND_TABLE` in
`src/adapters/redis/command-metadata.ts` stops holding a spec for every command
in `REDIS_COMMAND_PERMISSION`; or `SCAN`'s key arity there stops locating its
`MATCH` argument case-insensitively; or `filterReturnedKeyNames` in
`src/adapters/redis/returned-key-names.ts` stops being applied to both branches
of `RedisAdapter.execute`; or `RedisAdapter.insert`, `update` or `delete` in
`src/adapters/redis-adapter.ts` reaches the client without `assertKeyPermitted`;
or `findProtectedFieldReference` in `src/core/mongo/request-fields.ts` starts
matching by substring rather than by dotted component, or stops treating a
non-operator object key as a field name; or `MongoDBAdapter` in
`src/adapters/mongodb-adapter.ts` calls the driver on a path that has not run
`assertNoProtectedFieldNamed` beside `assertNoMongoServerSideScript`.
