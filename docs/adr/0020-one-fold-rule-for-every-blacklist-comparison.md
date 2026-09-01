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

## Decision 4: the fold is context-free, so folding a string and folding its characters agree

`foldCase` in `src/utils/case-fold.ts` is the fold, and `foldFieldPath` calls
it. It lower-cases and then maps `ς` onto `σ`.

Decision 1 said one function, and there were two: `foldFieldPath` folded a whole
string while `globMatches` folded one character at a time, and
`String.prototype.toLowerCase` does not answer those the same way.
`Final_Sigma` is the one context-sensitive rule in Unicode's default case
conversion — `Σ` preceded by a letter and not followed by one folds to `ς`,
anywhere else to `σ` — and a single character has no context. Measured
2026-09-01: rule `ΑΣ*` against the field `ΑΣ_num` the read path had already
folded returned `false`. The rule names the field and does not protect it.

The rule that folds a name must not read the characters around it, or the two
sides can only agree by accident. Collapsing `ς` onto `σ` is what makes it
context-free; verified by comparing whole-string against per-character folding
for every code point in the BMP in five surrounding contexts — 0 divergences,
and the fold is idempotent, so folding an already-folded name is safe.

The fold must also be **length-preserving**, which is a second constraint and
not a restatement of the first. `globMatches` compares against a subject it has
folded as a whole, and every `?` and every `*`-free run is a fixed-width window;
a character that folds to two code units can never line up with one. `toLowerCase`
has exactly one such character, `İ` (U+0130 → `i` + U+0307), so `foldCase` maps
it to `i` instead — which is also the case relation Turkish gives it. The first
attempt at this record folded `İ` the way `toLowerCase` does and emitted one
literal token per code unit, which lines up a pattern's literal against the text
but leaves `?` still consuming one unit: adversarial review found that rule
`secret?` stopped blocking the table `secretİ`, on `isTableBlacklisted`, which
refuses a query rather than filtering a display. Verified over U+0000–U+2FFFF:
with `İ` mapped, no code point changes length under `foldCase`.

And the two sides must fold at the same **granularity**, which is a third
constraint that length-preservation does not imply. `parseGlobUncached` reads
the pattern by code unit, so an astral character reached the token as half a
surrogate pair, and `foldCase` on half a pair is the identity — while the
subject, folded as a whole string, really did case-map the code point. Before
this branch both sides were equally unfolded and agreed by accident; folding one
of them exposed the gap. A second adversarial review found that rule `𐐀` no
longer matched the field `𐐀` — a literal rule failing to match the name it *is*
— across every cased astral script, Adlam among them, and that `maskMongoRows`
sends every column rule through this matcher, so plain literal MongoDB rules
were affected too. The parser now advances by code point, and a token still
holds one code unit, because `runMatchesAt` indexes the subject by code unit.

A character class compares against the name **as written**, not the folded one.
Its case-insensitivity comes from the regex's own `i` flag, which is Decision 2:
the pattern's text is never rewritten. Folding the subject first buys nothing in
the BMP and replaces an astral character's low surrogate, so `[𐐀]` stopped
matching `𐐀`.

All of it is asserted as tests over the whole range in
`tests/unit/core/contiguous-section-matcher.test.ts`, because these are claims
about every code point rather than about the handful a reviewer thinks of. Two
limitations are unchanged from before this record and stay: `?` consumes one
code unit, so it never matched a whole astral character, and a character class
is compiled without the `u` flag, so an astral range is a set of code units
rather than of code points.

**Mapping `İ` to `i` loses a comparison, and the loss is forced rather than
chosen.** A literal rule `İ` reached the field spelled `i` + U+0307 on `main`,
because `toLowerCase` sent both to that sequence; it no longer does, in either
direction. Measured against a `main` worktree on 2026-09-01:

| rule | field | main | as landed |
| --- | --- | --- | --- |
| `İ` | `i` + U+0307 | protected | **returned** |
| `i` + U+0307 | `İ` | protected | **returned** |
| `İ` | `i`, `I` | returned | protected |
| `İ` | `İ` | protected | protected |

There is no third option. Length-preservation says `foldCase(x).length` equals
`x.length`; `İ` is one code unit and `i` + U+0307 is two, so no length-preserving
fold can map them to one string. The alternative is the `?` misalignment above,
which was fail-open on `isTableBlacklisted` for *every* rule using `?` rather
than for one character pair, so the trade resolves the way the rest of this
record resolves. The blacklist performs no Unicode normalisation anywhere — two
spellings of a name are two names — and this is that existing boundary reaching
one character further, not a new policy; a deployment that needs both spellings
writes both rules.

`globMatches` was not the path that lost it: a glob rule `İ*` matched `İd` on
`main` and matches it now. This is the literal set, where `foldFieldPath` is the
only comparison.

**The table path was the second fold, and Decision 1's "one function" was not
literally true until now.** `BlacklistManager` folded table names with a bare
`.toLowerCase()` while columns went through `foldFieldPath`, so inside
`isTableBlacklisted` alone the exact-set half and the `wildcardTables` half
folded differently — one rule got two answers for `Σ` and for `İ`, decided by
whether it carried a metacharacter. Both halves are now `foldFieldPath`. This
propagates the `İ` cost above to table and collection names, which is the point:
a path that keeps the old answer only because it never got the new fold is an
accident, not a protection.

**A class and a literal now answer `İ` differently.** `globMatches('İ', 'i')` is
true and `globMatches('[İ]', 'i')` is false, because a class takes its
case-insensitivity from the regex `i` flag rather than from `foldCase` —
Decision 2, which forbids rewriting a pattern's text. Neither fails to protect
the name it writes, so this is not fail-open, but it is a second answer inside
one matcher and is recorded rather than hidden.

The remaining cost is one more over-refusal in the direction this record already
chose: a document holding a field ending `ς` and one ending `σ`, or one named
`İd` and one named `id`, has both redacted by a rule naming either.

An earlier draft of this section closed with "nothing that was protected stops
being protected." That sentence was written three times and was false all three:
once with the `?` regression live, once with the astral one, and once with the
`İ`/`i` + U+0307 loss above, which it was standing in front of. It is gone
rather than qualified. The range scans that replace it are tests, and the one
`runMatchesAt` actually depends on — length-preservation over *arbitrary
strings*, not over single code points — is asserted as such, because a
per-code-point property does not compose for free through a fold that runs a
`replaceAll` and a context-sensitive `toLowerCase` in sequence.

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

**The contiguous-section scan was O(depth³), and depth is not a configuration
choice.** `namesProtectedField`, `redactFields` and MongoDB's
`findProtectedFieldReference` each enumerated every start with every end and
built a string per candidate. A literal rule has a fixed number of dotted
components, so most of those candidates could never match; the scan now takes
one window per rule width per start, and callers hand it the segment array they
already walked instead of joining and re-splitting. The three of them share
`reachesProtectedSegments` and one memoised rule compilation in
`src/core/mongo/path-matcher.ts` — which also removes the second copy of the
literal/pattern split, where `findProtectedFieldReference` was putting an entry
carrying a metacharacter into both halves, the shape the falsification condition
below names for the Elasticsearch shell.

Measured 2026-09-01 against a `main` worktree on this machine, same round,
median of five:

| shape | main | as landed |
| --- | --- | --- |
| `redactFields`, 1000 hits x 20 fields | 79ms | 25ms |
| `redactFields`, 5000 hits x 20 fields | 387ms | 119ms |
| `namesProtectedField`, depth 5, 10000x | 34ms | 14ms |
| `namesProtectedField`, depth 40, 10000x | 6175ms | 103ms |
| `findProtectedFieldReference`, depth 40, 10000x | 6206ms | 90ms |

8x the depth cost 182x before and costs 7.4x now. A response's nesting depth is
chosen by the cluster, not by the config, so this was a cost the request side
could push.

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
or `foldFieldPath` or `globMatches` folds by any means other than `foldCase` in
`src/utils/case-fold.ts`; or `foldCase` stops being context-free or idempotent —
folding a string and folding its characters separately must give one answer; or
`foldCase` stops preserving code-unit length over arbitrary strings, which is
what lets `runMatchesAt` in `src/utils/glob.ts` index the folded and the
unfolded subject with one offset; or `parseGlobUncached` in `src/utils/glob.ts`
advances the pattern by code unit rather than by code point, or a literal token
it emits holds more than one code unit; or `runMatchesAt` folds a character of
the subject rather than comparing against a subject `globMatches` already
folded, or compares a character class against the folded subject rather than the
name as written; or `parseGlob`'s memo key stops distinguishing both modes by a
prefix; or `BlacklistManager` in `src/core/blacklist-manager.ts` folds a table
name, a column-map key, or a table-qualification check by any means other than
`foldFieldPath`; or
`reachesProtectedSegments` in `src/core/mongo/path-matcher.ts` stops answering
for all three of `namesProtectedField`, `redactFields` and
`findProtectedFieldReference`, or any of them rebuilds the rule split rather
than taking it from `contiguousRulesFor`;
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
