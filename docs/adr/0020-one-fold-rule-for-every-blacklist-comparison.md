---
status: accepted
date: 2026-09-01
---

# One fold rule for every blacklist comparison

## Context

ADR-0019 put every blacklist rule through one matcher and said in its own
Consequences that the title overstated one dimension: case folding was still
three rules. The write side lower-cased a whole path, the SQL and Elasticsearch
read side folded the first segment only (ADR-0018 Decision 1), and the MongoDB
read mask and request check did not fold at all.

Measured on 2026-09-01 by calling the four matchers directly, before any change
in this branch:

| rule | field | SQL read | MongoDB read | request | write |
| --- | --- | --- | --- | --- | --- |
| `Password` | `password` | masked | **returned** | **allowed** | refused |
| `password` | `PASSWORD` | masked | **returned** | **allowed** | refused |
| `PASS*` | `password` | masked | **returned** | **allowed** | refused |
| `profile.ssn` | `profile.SSN` | **returned** | **returned** | **allowed** | refused |
| `profile.ss*` | `profile.SS_num` | **returned** | **returned** | **allowed** | refused |
| `pass*` | `password` | masked | masked | refused | refused |

Every row but the last is a configuration whose write is refused and whose read
returns the same field. An operator who confirms a rule works by watching a
write bounce off it has confirmed nothing about the read.

The MongoDB half is the aliasing bypass ADR-0018 Decision 1 exists to close,
reached on a different engine: the request chooses the key the mask compares
against, so under a rule `Password` the check that stands between
`$project: {leak: "$password"}` and the plaintext compares two strings that
differ only in case, and permits it. No config-time validation can close it,
because the rule there is already correct.

## Decision 1: the whole path folds, at comparison, everywhere

A rule and the name it is compared against are folded over their entire dotted
path, by one function — `foldFieldPath` in `src/core/blacklist-fold.ts` — that
every literal comparison calls, and by `globMatches`'s `caseInsensitive` option
wherever the rule is a pattern. The SQL read mask, the MongoDB read mask, the
MongoDB request check, the write check, `isColumnBlacklisted`, the
Elasticsearch index expression check, and the Elasticsearch shell's request
check and response mask all answer the same question.

The ES shell was the fifth comparer and had to be brought in rather than
excused. `namesProtectedField` and `redactFields` compared byte for byte and
compiled no globs at all, so under `columns: {users: ["Password"]}` — or
`["pass*"]`, or `["profile.ssn"]` — `dbcli es` returned the plaintext that
`dbcli query --index` masked from the same configuration. They now call
`foldFieldPath` and the shared `compilePatterns` / `matchAny`, and a rule the
matcher cannot read is refused while the rules are collected, before the request
reaches the cluster, rather than on the first key of the response.

This supersedes ADR-0018 Decision 1 on how much of a path folds, and keeps the
rest of it: folding still happens where names are compared and never when a rule
is stored. That boundary is not a preference. ADR-0018 records that the first
repair attempt folded at storage, every unit test passed, and all eight
configurations still leaked against a real MariaDB — because the masking path
compared a returned name as written against a rule that had been lower-cased.
Two sides folding differently is the whole failure, which is why there is one
function rather than a convention.

ADR-0018 folded the first segment alone because a later segment is a nested
object key rather than a SQL identifier, and case is significant in one and not
the other. That reasoning is sound about the *data* and was wrong about the
*system*: the write side folded the whole path regardless, so the asymmetry
between the two sides was not a considered position but an accident, and it
resolved in the fail-open direction on every read.

The cost is stated and accepted, in the same direction ADR-0014, ADR-0015 and
ADR-0018 all chose. PostgreSQL permits `"Password"` and `"password"` as distinct
columns of one table and MongoDB permits `profile.SSN` and `profile.ssn` in one
document; a rule naming either now redacts both. An over-refusal is recoverable
by writing a more specific rule. The inverse — a protected field returned
because the request picked another case — is not recoverable at all, because
nothing reports it.

## Decision 2: a glob rule folds inside the matcher, not by rewriting its text

`globMatches` takes a `caseInsensitive` option that folds literal runs and
compiles character classes with `i`. The rule's text is never lower-cased.

Lower-casing pattern text is the storage-side fold wearing a different hat, and
it is lossy in a way a reader would not predict: `[A-z]` lower-cased becomes
`[a-z]`, which stands for a strictly smaller set — the six ASCII characters
between `Z` and `a` silently leave the class. A rule would quietly protect less
than it says. Folding at the comparison has no such case.

The two parse modes cannot share the memo `parseGlob` keeps, since they produce
different tokens; the cache key carries the mode.

## Decision 3: the nested descent folds too, and `--fields` does not

`hasFieldPath` and `omitFieldPaths` take the same option and the blacklist
masker passes it, so a dotted rule folds while descending into a nested record —
a PostgreSQL `jsonb` column, an Elasticsearch `_source` object. Without it
Decision 1 would have stopped at the top-level key: verified against PostgreSQL
16, a `jsonb` column holding `{"SS_num": "111-22"}` was returned in full under
the rules `profile.ss_num` and `PROFILE.SS_num`, and masked under
`profile.SS_num`.

`--fields` keeps exact matching. A blacklist rule is compared against a name the
request chose the case of; a `--fields` path is the operator naming keys of the
document in front of them, where two keys differing only in case are two fields
they may legitimately want to tell apart.

## Consequences

A rule spelled in a case that disagrees with the data starts protecting it,
which can newly redact reads and newly refuse writes that an existing deployment
relied on — a breaking change, stated as one in the changelog. Nothing that was
protected stops being protected: every change is in the refusing direction.

Verified end to end on 2026-09-01, MariaDB 11 and PostgreSQL 16 and MongoDB 7 in
local containers, `read-write` connections:

| configuration | request | result |
| --- | --- | --- |
| `columns: {users:["Password"]}` | `query '{}' --collection users` | `password` redacted |
| `columns: {users:["Password"]}` | `query '[{"$project":{"leak":"$password"}}]'` | refused, naming `password` |
| `columns: {users:["Password"]}` | `update --set '{"PASSWORD":"x"}'` | refused |
| `columns: {users:["profile.ssn"]}` | `query '{}' --collection users` | `profile.SSN` redacted |
| `columns: {users:["profile.ssn"]}` | `update --set '{"profile.SSN":"x"}'` | refused |
| `columns: {probe_json:["PROFILE.SS_num"]}` | `SELECT id, profile FROM probe_json` (jsonb) | column omitted |
| `columns: {users:["Password"]}` | `update --set '{"note":"ok"}'` | written, 1 row |

**Folding is not free, and two of the three costs needed structure rather than
acceptance.** Measured against `main` on this machine, in a worktree, with the
same containers running:

| shape | main | folded, naively | as landed |
| --- | --- | --- | --- |
| 1000 `isColumnBlacklisted` lookups | 0.27ms | 1.70ms | 0.28ms |
| nested probe, 2000 rows x 81 keys x 40 dotted misses | 44ms | 417-486ms | 68-75ms |
| `redactFields`, 1000 hits x 20 fields, literal rule | 35ms | 44ms | 44ms |
| `redactFields`, same, wildcard rule | (enforced nothing) | 89ms | 74ms |
| six existing masking benchmarks | — | — | at parity |

The lookup and the nested probe are both the same mistake: a fold recomputed
per comparison where the thing being folded does not change. Rules are folded
into a derived view cached per rule set, and a record's keys into an index
cached per record — both derived, both weakly keyed, neither replacing the
entries as the config wrote them, which is the boundary Decision 1 keeps. The
rule's segments are folded once at the entry to `hasFieldPath` rather than at
every level of every row.

The repository's masking benchmarks could not see the nested probe at all: they
run 1000 rows of 13 columns, two orders of magnitude below the shape where a
per-lookup key scan hurts, and the rules they use have heads that do not exist,
so `nestedHeads` rejects every one before a row is touched. A case whose rule
heads *are* real nested objects is added alongside them.

The wildcard `redactFields` row is not a like-for-like regression: on `main`
that path enforced no wildcard rule at all, so its 35ms bought nothing. 74ms is
what enforcing costs, after the response's trail is folded once per level rather
than per key.

**A gap this work found and did not close.** *(Closed on 2026-09-01, in the
branch that followed this one; the paragraph is left as written because it is
what the measurement said at the time.)* On the SQL and Elasticsearch read
path a dotted rule reaches a nested key only when it is literal: verified
against PostgreSQL 16, `profile.SS_num` masks and `profile.ss*` returns the
value, while `profile.*` masks the whole column. The MongoDB read mask handles
all three. That is one rule with two meanings again — ADR-0019's subject, not
this one's, and it needs the read path to enumerate nested paths rather than
top-level names, which is a change with its own cost. Recorded in
`docs/specs/2026-09-01-nested-glob-rules-on-the-sql-read-path.md`.

**Falsified if:** a blacklist comparison folds a name without `foldFieldPath`
from `src/core/blacklist-fold.ts` or `globMatches`'s `caseInsensitive` option;
or `foldFieldPath` folds anything less than the whole path; or
`BlacklistManager.loadBlacklist` in `src/core/blacklist-manager.ts` stores a
column entry folded rather than as written; or `matchAny` in
`src/core/mongo/path-matcher.ts` calls `globMatches` without that option; or
`filterColumnsForTables` or `checkColumnBlacklistOnWrite` in
`src/core/blacklist-validator.ts` compares a rule, an ancestor, or a nested head
without it; or `reachesProtectedField` in `src/core/mongo/request-fields.ts`
compares against a set of rules that were not folded; or `isColumnBlacklisted`
in `src/core/blacklist-manager.ts` folds the name asked about but not the rules;
or `hasFieldPath` / `omitFieldPaths` in `src/core/field-projection.ts` lose the
option, or `projectRows` starts passing it; or `namesProtectedField` /
`redactFields` / `collectProtectedFields` in `src/commands/es-shell-guards.ts`
compare without the fold or without the shared matcher, or stop refusing an
unreadable rule before the request is sent, or normalise an entry by any means
other than the config loader's `normalizeBlacklistEntry`, or put an entry
carrying a metacharacter into the literal set as well as the compiled one; or
`isColumnBlacklisted` answers only the literal rules; or `matchesIndexGlob` or
`indexExpressionReaches` in `src/utils/es-index-target.ts` folds by any other
means; or `wildcardTables` in `src/core/blacklist-manager.ts` is built from the
lower-cased `state.tables` rather than the entries as written; or any code
lower-cases a glob pattern's text before matching it.

The two derived caches are correct only while their keys are immutable. The
folded-rule view is keyed on a `Set` that `BlacklistManager` builds once and
never edits. `foldedKeyIndex` is keyed on the records a mask walks, which every
caller here replaces rather than edits — the Elasticsearch scroll reader builds
a fresh object per hit (`scroll-reader.ts:34`), and masking returns new rows. A
caller that starts mutating a row it has already had masked would be matched
against that row's former key names, in the fail-open direction.
