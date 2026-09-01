---
status: accepted
date: 2026-08-31
---

# One blacklist rule, one matcher — MongoDB's four comparers become one

## Context

`docs/specs/2026-08-30-cross-engine-blacklist-gaps.md` items 3–6 describe four
MongoDB blacklist gaps. Measured on 2026-08-31 against MongoDB 7.0.31 in a
local container, collection `probe.users` holding
`{_id:1, name:"a", password:"p1", user:{password:"np1"}}`:

| configuration | request | result |
| --- | --- | --- |
| `columns: {users:["password"]}` | `$rename`, `$unset`, `$set`, `$inc`, `$mul`, `$push`, `$addToSet`, `$setOnInsert`, `$currentDate`, `$bit`, `$max`, `$min`, `$pop`, `$pull` (14 operators) | blocked |
| `columns: {users:["user.password"]}` | `insert --data '{"user":{"password":"x"}}'` | **written** |
| `columns: {users:["user.*"]}` | `update --set '{"$set":{"user.password":"yyy"}}'` | **written** |
| `tables: ["secrets*"]` | `query --collection secrets_2026` | **read in full** |
| `columns: {users:["pass*"]}` | `query --collection users` | **`p1` returned, plus "Some fields may have been redacted"** |

Item 3 as written does not hold. It predicted that `$rename` and eleven other
operators bypass the write check because `update.ts:250-266` collects
`writtenFields` from `$set`/`$unset` only — that collection is still narrow, but
every one of the fourteen operators is refused, by the *request-side* check
ADR-0015 introduced. The gap is real and unreachable: two layers disagree and
the outer one happens to be the strict one. What survives from item 3 is the
assertion in `dml-plan.ts` that "field rename does not exfiltrate data", which is
false — after `$rename` the value sits under a name the mask does not know.

The other three rows are the same defect seen from three angles. One rule set is
consulted by four comparers, and no two agree:

| comparer | file | understands |
| --- | --- | --- |
| request side | `mongo/request-fields.ts:72` `reachesProtectedField` | contiguous dotted components, literal |
| read mask | `mongo/path-matcher.ts` `matchAny` | `foo.*` tail wildcard |
| write side | `blacklist-validator.ts:193` `checkColumnBlacklistOnWrite` | dotted ancestors, literal |
| collection name | `blacklist-manager.ts:151` `isTableBlacklisted` | `Set.has`, literal |

So `user.*` protects a read and permits a write; `pass*` protects nothing
anywhere while the CLI still prints the redaction notice; and `secrets*` names a
collection no comparer can match. `insert.ts:174/256` compounds it by passing
`Object.keys(data)` — top-level keys — where the read side walks whole paths.

## Decision 1: a rule segment is a glob, and `foo.*` keeps its tail meaning

`compilePatterns` accepts `*`, `?` and character classes **inside** a segment,
matched through `globMatches` in `src/utils/glob.ts` (Decision 5) — the same
comparison Redis keys and Elasticsearch index expressions use. `pass*` matches
`password`.

The one special form is preserved: a final segment that is exactly `*` still
means "this path or anything beneath it", so `user.*` matches `user` itself as
well as `user.password`. Read as a plain per-segment glob it would match only
`user.<one segment>` and would stop protecting the parent — a silent narrowing
of rules already deployed.

The alternative was to leave `pass*` illegal and only make the rejection loud
(Decision 3). It was rejected because the same array is already a glob in
`tables` after Decision 4, in Redis key patterns, and in Elasticsearch index
expressions. An operator who writes `secrets*` under `tables` and `pass*` under
`columns` in one file is entitled to one answer.

## Decision 2: all four comparers call the same matcher

`reachesProtectedField`, `checkColumnBlacklistOnWrite` and the read mask compile
the rules once and match through `path-matcher.ts`. `insert.ts` passes the
flattened document paths that `flattenInsertPaths` already computes for the risk
planner instead of `Object.keys(data)`, and `update.ts` collects written fields
from every operator rather than from `$set`/`$unset`.

The narrow write-side collection is fixed even though the request-side check
already refuses those operators. A control reachable only because a second
control is strict is not a control — the same reasoning ADR-0015 recorded, and
the reason item 3 measured as "blocked" while the code underneath was wrong.

## Decision 3: a rule the matcher cannot compile refuses the request

`compilePatterns` returning a non-empty `rejected` list stops the operation with
an error naming the entry and the reason. Previously `field-masker.ts:49-50` saw
`patterns.length === 0`, returned the document untouched, and the CLI printed
"Some fields may have been redacted" over unredacted values — the notice is
evidence of protection to the operator, and it was wrong.

Refusing rather than warning follows ADR-0018 Decision 2: a blacklist that loads
with a dead rule is indistinguishable, to the operator, from one that works.
Under Decision 1 the entries that remain uncompilable are genuinely malformed —
an empty path segment (`a..b`), an empty string, a non-string — not the
plausible ones. `a.*.b`, rejected before, now compiles as a segment glob.

## Decision 4: `blacklist.tables` is a glob for every engine, not just Redis

`isTableBlacklisted` matches through `globMatches` rather than `Set.has`. This
is deliberately not confined to the MongoDB call path: the same key in one
config file would otherwise be a glob for Redis, a glob for Elasticsearch, a
glob for MongoDB and a literal for SQL.

The cost is that SQL behaviour changes for configs containing a `*`. The change
only ever refuses more — a name matched literally still matches its own
pattern — so nothing that was protected becomes unprotected, and the direction
is the one ADR-0014, ADR-0015 and ADR-0018 all chose. A table literally named
`report*` can no longer be excluded from its own rule; escaping it as
`report\*` matches it literally, as the glob syntax already supports for Redis.

## Decision 5: the glob comparison is linear, and `globToRegex` stops being the matcher

`globMatches` in `src/utils/glob.ts` decides a glob without a regex engine: the
pattern is split into `*`-free runs of fixed-width tokens, and each run is found
by scanning forward once. Every blacklist comparison — Redis keys, Elasticsearch
index expressions, and under the decisions above the column rules and table names
of every engine — calls it instead of `globToRegex(...).test(...)`.

This was found while measuring this branch, and it predates it. `globToRegex`
compiles each `*` to `.*`, and several of those against a name that does *not*
match backtrack catastrophically: `'a' + '*'.repeat(50) + 'b'` tested against a
300-character string had not returned after three minutes (measured 2026-08-31).
The same case answers in 0.23 ms now. A config does not have to be hostile to
reach it — `*_*_*_*` is an ordinary thing to write — and the reachable inputs
include Redis key names, which come from the database rather than from the
operator.

The decisions above are what made this urgent rather than latent: before them
the pattern reached only Redis keys and ES index expressions, and after them it
decides every column rule and every table name. Widening the blast radius of a
denial-of-service in the guard is not something to leave for a later branch, so
it is fixed here even though the defect is older than this ADR.

A name that is *not* a pattern has to be escaped before it is spliced into one.
`maskMongoRowsForCollections` re-anchors a joined collection's rules under the
`$lookup`'s `as` name, and that name is chosen by the request: `as: "\\x"` made
the rule compile to `^x$` while the document carried `\x`, so the joined
`password` came back in plaintext. `escapeGlob` in `src/utils/glob.ts` is the
fix, and the shape is worth naming — every literal spliced into a pattern is
this bug waiting to happen, and `\` is the one metacharacter that does not
accidentally match itself.

`globToRegex` stays for callers that genuinely need a `RegExp` object, and the
two are held to the same answers by exhaustive comparison over a small alphabet
rather than by a sampled list — a drift between them would be a silent hole.
That comparison earned its place immediately: it caught a real bug in the first
implementation, where an escaped character after a `*` did not clear the
trailing-wildcard flag, so `*\a` matched `ab`.

## Consequences

Configurations that were accepted and dead now either work or refuse. A
`columns` entry with a wildcard inside a segment starts protecting data it never
protected, which can newly refuse writes and newly redact reads that an existing
deployment relies on — stated in the changelog as a breaking change. A `tables`
entry containing `*` starts blocking on SQL connections where it previously
blocked nothing.

The `mongo_rename_operator` warning stops asserting that `$rename` does not
exfiltrate data and says what it does: the value survives under a name the read
mask does not know.

A wildcard-heavy blacklist stops being a way to hang the guard. That was already
true of Redis and Elasticsearch configs before this branch; it is fixed here
rather than left, because these decisions put every engine's rules on that path.

**The title overstates one dimension.** *(Closed by ADR-0020 on 2026-09-01:
there is one fold rule now, applied over the whole path by every matcher. The
paragraph below is left as written, because the table under it is the
measurement that record was built from.)* Case folding is still three rules, not
one: the write side lower-cases a whole path, the SQL and Elasticsearch read
side folds the first segment only (ADR-0018 Decision 1), and the MongoDB read
mask and request side do not fold at all. That asymmetry predates this record —
ADR-0018 chose it deliberately, because a segment after the first is a nested
object key where case is significant — and glob rules inherit it rather than
introduce it. Measured consequences, both silent:

| configuration | field in the data | write | read |
| --- | --- | --- | --- |
| `columns: {users: ["profile.ss*"]}` | `profile.SS_num` | refused | **returned** |
| `columns: {users: ["PASS*"]}` | `password` (MongoDB) | refused | **returned** |

Wildcards make nested rules far easier to write, so this trap will be reached
more often than it was. Folding it into `path-matcher` alongside the pattern
syntax is the obvious next step and is deliberately not taken here: it would
change what ADR-0018 decided, which is a decision of its own and not a
consequence of this one.

**Falsified if:** `compilePatterns` in `src/core/mongo/path-matcher.ts` compiles
a segment without `globMatches` from `src/utils/glob.ts`, or drops the tail
meaning of a final `*`; or `reachesProtectedField` in
`src/core/mongo/request-fields.ts` or `checkColumnBlacklistOnWrite` in
`src/core/blacklist-validator.ts` compares a rule without that matcher; or
`src/commands/insert.ts` passes top-level keys rather than flattened paths, or
`src/commands/update.ts` collects written fields from a subset of the update
operators; or a non-empty `rejected` list from `compilePatterns` fails to stop
the operation; or `isTableBlacklisted` in `src/core/blacklist-manager.ts`
compares a collection name with a literal `Set.has` alone; or any blacklist
comparison calls `globToRegex(...).test(...)` where `globMatches` from
`src/utils/glob.ts` would answer, or the two stop being held to identical
answers by the exhaustive comparison in `tests/unit/utils/glob.test.ts`; or
`maskMongoRowsForCollections` in `src/core/mongo/field-masker.ts` splices a
`$lookup` prefix into a rule without `escapeGlob`; or the wildcard loop in
`filterColumnsForTables` stops walking ancestors while the literal loop does; or
any `compilePatterns` caller drops its `rejected` list; or
`isValidTableNameForSystem` in `src/commands/blacklist.ts` refuses a glob for an
engine whose matcher accepts one.

**The case-folding limitation above is falsified if:** `maskMongoRows` in
`src/core/mongo/field-masker.ts` or `globRulesOf` in
`src/core/mongo/request-fields.ts` starts folding rule case, or the two
`compileGlobRules` call sites in `src/core/blacklist-validator.ts` pass the same
`fold` — any of which means the three folding rules have become fewer, and this
record's account of them is out of date.
