---
status: accepted
date: 2026-08-31
---

# A blacklist rule the code cannot use says so, and column names fold

## Context

`docs/specs/2026-08-30-cross-engine-blacklist-gaps.md` items 7, 8 and 9 describe
three ways a SQL column rule can be configured, accepted, and then protect
nothing. Measured on 2026-08-31 against a local MariaDB with a table
`probe_users (id, Password, note)` holding `s3cret`:

| configuration | result |
| --- | --- |
| `["Password"]` | blocked |
| `["password"]` | **leaked** |
| `[" password "]` | **leaked** |
| `["\"password\""]` | **leaked** |
| table key `" probe_users "` | **leaked** |
| `["probe_users.Password"]` | **leaked** |
| table key `"test.probe_users"`, unqualified query | **leaked** |
| `["Password"]`, query `SELECT Password AS PASSWORD` | **leaked** |

Seven of eight. Every one of them is accepted by the config loader without a
word, so the operator's evidence that the rule works is that `dbcli` did not
complain.

The last row is the worst and is not a configuration mistake at all: the rule
names the column exactly as the schema does, and a `query-only` connection
still reads the value out by aliasing it. Masking compares the key a row comes
back under, and `AS PASSWORD` chooses that key — the same shape ADR-0015 closed
for MongoDB's `$project`, arriving here through case rather than through a
rename.

Item 8 is a separate asymmetry in the same pair of files:
`checkColumnBlacklistOnWrite` compares literally (`blacklisted.includes(f)`)
while `filterColumnsForTables` walks dotted ancestors, so under a rule
`profile` the path `profile.ssn` can be written and cannot be read.

## Decision 1: a column name's first segment folds, at comparison rather than at storage

The rule and the returned column name have their first dot-separated segment
lower-cased before comparison. That segment is the SQL identifier; it matches
what table names already do (`blacklist-manager.ts` stores them
`toLowerCase()`), and it closes the aliasing bypass, which no amount of
config-time validation can: `AS PASSWORD` is a correct rule defeated at query
time, not a rule written wrongly.

Two boundaries are deliberate. Folding happens where names are compared and not
when the rule is stored, and only the first segment folds: an entry's later
segments are nested object keys — `profile.SSN` inside a JSON column — which are
not SQL identifiers, and case is significant in them. Folding on the way in
would have quietly rewritten those.

The first attempt did fold at storage. Every unit test passed and all eight
configurations above leaked against a real MariaDB, because the masking path
still compared a returned name as written against a rule that had been
lower-cased — the same *two sides folding differently* this record exists to
remove, reintroduced by the repair. It is recorded here because the unit suite
could not see it.

The alternative — keep matching case-sensitive and refuse a rule at
`blacklist column add` time when its case disagrees with the schema cache — was
rejected because it cannot close the aliasing bypass at all: the rule there is
already correct. It also cannot run without a schema cache, which makes the
protection depend on whether an unrelated cache is warm.

The cost is real and accepted: PostgreSQL permits `"Password"` and `"password"`
as distinct columns of one table, and a rule for either now hides both. That is
an over-refusal, the direction ADR-0014 and ADR-0015 both chose, and the
inverse — a protected column readable because the request changed its case — is
the failure this record exists to remove.

The three comments describing column matching as case-sensitive are rewritten
rather than left to contradict the code.

## Decision 2: what can be normalised is normalised, and what cannot is refused at load

Surrounding whitespace and surrounding quotes (`"`, `` ` ``) are stripped from
table keys and column entries, as `es-index-target.ts` already does for
Elasticsearch index names. These have exactly one plausible reading.

A column entry whose first dot-separated segment equals the table key it sits
under — `{"probe_users": ["probe_users.Password"]}` — is a table-qualified name,
and the loader now fails with a message naming the entry and the form it wants.
It cannot be silently rewritten, because a dot in a column entry already has a
second, legitimate meaning: `profile.ssn` is a nested path, which is what item
8's ancestor walk exists for. Comparing the first segment against the key is
the one test that separates the two without guessing.

Refusing at load rather than warning is chosen because a blacklist that loads
with a dead rule is indistinguishable, to the operator, from one that works.

## Decision 3: a table's rules are found by the qualified name and by its last segment

A rule under `{"public.users": …}` did not apply to `SELECT * FROM users`, and a
rule under `{"users": …}` did not apply to `SELECT * FROM public.users`;
`extractTableReferences` keeps a qualified name whole, so each key matched only
the spelling it was written in. Lookup now tries the reference as given and then
its last segment.

This is a lookup change, not a parse-time guess: nothing decides which spelling
the operator meant, and both spellings of the same table resolve to the same
rules. It over-refuses only when two schemas hold same-named tables and only one
is meant to be protected, which is again the safe direction.

## Decision 4: the write side walks ancestors, as the read side does

`checkColumnBlacklistOnWrite` uses the same ancestor walk
`filterColumnsForTables` uses. A rule that hides `profile.ssn` from a read and
permits writing it protects nothing an attacker cares about, and the asymmetry
was an oversight rather than a decision — there is no reading of "blacklisted"
under which a field may be written but not read.

## Consequences

Configurations that were accepted and dead now either work or fail to load.
The failing ones are named in the error, and each is a rule that was protecting
nothing, so nothing that was protected becomes unprotected — but a deploy whose
config contains such an entry will stop starting until it is fixed. That is the
intended trade, and it is stated in the changelog as a breaking change.

Case folding changes what is refused, not merely what is reported: a query that
succeeded yesterday by aliasing a protected column now fails.

**Falsified if:** `isColumnBlacklisted` in `src/core/blacklist-manager.ts` or
`filterColumnsForTables` in `src/core/blacklist-validator.ts` compares a column
name's first segment without lower-casing both sides, or lower-cases a segment
after the first; or
`checkColumnBlacklistOnWrite` in `src/core/blacklist-validator.ts` compares
column names without the ancestor walk `filterColumnsForTables` uses; or the
loader accepts a column entry whose first dot segment equals its table key; or
table rule lookup stops trying the last segment of a qualified reference.
