# Elasticsearch shell enforces the permission tier

**Status:** ready-for-agent
**Date:** 2026-08-30
**Severity:** Critical — permission tier bypass in the current supported major (3.x)
**Target release:** 4.0.0, with a user advisory

## Problem Statement

An operator who configures a connection with `permission: query-only` believes that
credential cannot write. For every other path in dbcli that is true. For the
Elasticsearch shell it is not.

`dbcli shell` against an Elasticsearch connection reaches the cluster without ever
consulting the configured permission tier. The shell branch for SQL and Redis is gated;
the Elasticsearch branch forks away before the gate and issues the request verbatim. A
`query-only` connection can therefore delete every document in an index, drop the index,
or rewrite its mapping — operations the same connection is refused when it issues them
through `dbcli query`.

Three things make this worse than a missing check:

**It is scriptable.** The shell drives its read loop from piped stdin as readily as from a
terminal, so an agent can do this in one non-interactive command. dbcli's stated threat
model is AI agents operating a database on an operator's behalf; a one-line command that
turns a read-only credential into a destructive one is the exact failure the permission
model exists to prevent.

**Protection is inversely proportional to configuration.** The shell's object-scoped
checks — path normalization, refusal of unscoped non-metadata paths, index names in the
request body — are all nested inside a branch that only runs when a table blacklist is
configured. An operator with no blacklist, which is the default, loses those refusals
too, so the least-configured user is the least protected.

**Nothing is recorded.** The path writes no audit entry, so an operator who was affected
cannot establish afterwards what was done through it.

The omission is visible in the execution-path registry, where the Elasticsearch shell's
entry names only blacklist gates while every comparable entry names a permission gate.
Nobody noticed, because noticing required reading a prose sentence and spotting an
absent clause.

## Solution

The Elasticsearch shell classifies every request through the same Elasticsearch permission
classifier that `dbcli query` uses, and refuses anything the configured tier does not
allow — before the request reaches the adapter.

~~The shell's object-scoped checks run unconditionally, whether or not a blacklist is
configured.~~ **Corrected after implementation — see ADR-0014 Decision 9.** The tier
check runs unconditionally; the object-scoped checks below it are skipped when *neither*
`blacklist.tables` nor `blacklist.columns` is configured, because with no protected object
they have nothing to compare a request against and refusing would cost ordinary reads
(`_sql`, `_mget`, `_search/scroll`) while hiding no field.

Every request the shell executes writes an audit entry, so the path is reviewable like
every other write path.

From the operator's side, nothing about the shell's syntax or workflow changes. A
`query-only` connection keeps its reads and starts being refused its writes, with a
refusal message naming the tier required — the same experience `dbcli query` already
gives for the same request.

## User Stories

1. As an operator who set `permission: query-only`, I want the Elasticsearch shell to refuse a document-deleting request, so that my read-only credential is actually read-only.
2. As an operator, I want the Elasticsearch shell to refuse an index deletion unless my tier permits it, so that a mistyped path cannot destroy an index.
3. As an operator, I want the Elasticsearch shell to refuse a mapping or settings change unless my tier permits it, so that schema cannot drift through a shell session.
4. As an operator, I want the Elasticsearch shell to refuse a bulk request containing write actions unless my tier permits it, so that a batched write is not a way around a single-request refusal.
5. As an operator, I want the Elasticsearch shell to refuse a reindex request unless my tier permits it, so that copying documents into a new index is treated as the write it is.
6. As an operator, I want the Elasticsearch shell to refuse an alias mutation unless my tier permits it, so that repointing an alias is not classified as a read.
7. As an operator, I want the Elasticsearch shell to refuse a request whose shape the classifier does not recognise, so that an unfamiliar API cannot pass by being unclassifiable.
8. As an operator, I want the Elasticsearch shell to keep permitting ordinary searches at `query-only`, so that the fix does not take away the reason I use the shell.
9. As an operator, I want the Elasticsearch shell to keep permitting cluster and index metadata reads at `query-only`, so that inspection still works.
10. As an operator, I want a refusal to name the permission tier the request would need, so that I can decide whether to escalate deliberately rather than guess.
11. As an operator, I want a refusal to leave the cluster untouched, so that a refused request has no partial effect.
12. As an operator with `permission: admin`, I want destructive requests to still work, so that the fix does not remove a capability I deliberately configured.
13. As an operator with no blacklist configured, I want the shell's path-normalization refusal to run anyway, so that an encoded or traversing path cannot reach a resource by a route the checks did not see. *(Holds: the byte-identity refusal sits above the blacklist gate.)*
14. ~~As an operator with no blacklist configured, I want unscoped non-metadata paths refused anyway, so that a request that cannot be attributed to an index cannot be checked and is therefore not run.~~ **Not delivered for a blacklist-less connection — ADR-0014 Decision 9.** Holds as soon as any blacklist entry exists.
15. ~~As an operator with no blacklist configured, I want request-body index names checked anyway, so that the object a request touches is checked wherever it is named.~~ **Not delivered for a blacklist-less connection — ADR-0014 Decision 9.** Holds as soon as any blacklist entry exists.
16. As an operator, I want the blacklist behaviour I already rely on to be unchanged when I do have one configured, so that this change adds refusals and removes none.
17. As an operator reviewing an incident, I want every Elasticsearch shell request recorded in the audit log, so that I can establish what was run and when.
18. As an operator reviewing an incident, I want a refused Elasticsearch shell request recorded too, so that attempts are visible and not only successes.
19. As an operator, I want the audit entry to carry the same side-effect tier as the classifier assigned, so that filtering the audit log by tier reaches Elasticsearch shell activity.
20. As an AI agent operating under a `query-only` connection, I want my destructive shell request refused, so that I cannot exceed the authority my operator granted me.
21. As an AI agent, I want the refusal to arrive as a non-zero exit and a readable message, so that I can report the boundary to my operator instead of retrying blindly.
22. As an AI agent driving the shell through piped stdin, I want the same enforcement as an interactive user, so that the transport does not decide the policy.
23. As an operator authorizing dbcli in an agent host, I want `dbcli shell` to mean the same thing for Elasticsearch as for PostgreSQL, so that the allow rule I wrote expresses the gradient I intended.
24. As a security reviewer, I want the shell and the query path to share one Elasticsearch request classifier, so that a fix to classification reaches both without being applied twice.
25. As a security reviewer, I want the classifier's behaviour pinned for every request shape the shell can express, so that a shape the query path cannot produce is not left unverified.
26. As a security reviewer, I want an unrecognised request shape to fail closed, so that the default for the unknown is refusal rather than permission.
27. As a maintainer, I want the permission argument to reach the request runner from the shell's configuration reader, so that the enforcement cannot be correct in isolation and wrong in wiring.
28. As a maintainer, I want the execution-path registry entry for the Elasticsearch shell to name its permission gate, so that the record matches the code.
29. As a maintainer, I want a test that fails if the shell stops passing the configured tier through, so that a later refactor cannot silently restore the bypass.
30. As a maintainer, I want the fix expressed without adding a new way to classify a request, so that the count of classification sources does not grow.
31. As a user of a published 3.x release, I want an advisory telling me my Elasticsearch `query-only` connections were not read-only, so that I can assess exposure rather than discover it later.
32. As a user of a published 3.x release, I want a patch release I can upgrade to, so that acting on the advisory is possible.
33. As a reader of the changelog, I want the affected versions and the conditions stated plainly, so that I can tell whether I was exposed.
34. As an operator who does not use Elasticsearch, I want the release to change nothing for me, so that upgrading carries no risk I need to evaluate.

## Implementation Decisions

**Reuse the existing Elasticsearch permission classifier; do not write a new one.**
The Elasticsearch shell will call the same enforcement entry point the query path calls,
which wraps the existing request classifier. dbcli already contains ten distinct places
that decide what kind of statement or request something is, three of which exist because
an earlier one was wrong. Adding an eleventh inside the shell would be the same mistake.

**The shell has better inputs than the query path.** The query path synthesises a request
shape — it hard-codes a search against a named index and classifies that. The shell parses
a real method and path from operator input, so it can hand the classifier the actual
request. ~~No adaptation layer is needed.~~ **Corrected after implementation:** one thin
adaptation remains. `_bulk` is classified from its NDJSON body, which the shell has already
parsed, so `runEsRequest` re-serialises the body to text rather than teaching the
classifier a second input shape — the trade the sentence anticipated, made in the shell
rather than in the classifier.

**Enforcement happens inside the request runner, not in the read loop.** The shell's
request runner is already the single function through which every shell request passes,
and it already holds the blacklist checks. The permission tier becomes an additional
parameter to it. This keeps one place where a shell request is gated rather than two.

**The permission tier is read from configuration by the shell's entry point and passed
down.** The shell entry point already reads the configuration for connection and blacklist
settings; it will additionally read the configured permission and pass it through. This is
one line of plumbing and one argument, and it is deliberately covered by its own assertion
because enforcement that is correct in the runner and wrong in the wiring passes every
test of the runner.

**Verify fail-closed behaviour for the shapes the shell can express and the query path
cannot.** The classifier's default branch treats anything it cannot prove document-scoped
as destructive, which is the correct default. That default has been wrong before: a prior
fix was needed because alias, mapping and settings paths each matched their own read rule.
The query path can only produce searches, so the shell's reachable surface has never been
exercised against the classifier. Every shape below is pinned explicitly rather than
assumed covered by the default: delete-by-query, update-by-query, bulk, reindex, alias
mutation, mapping write, settings write, index deletion, and deletion or search across all
indices.

**The object-scoped checks become unconditional.** Path normalization, the routed-versus-
literal path mismatch refusal, the unscoped non-metadata path refusal, and the body index
name check currently execute only when a table blacklist is configured. They move outside
that condition. With no blacklist configured there are no blacklisted names to match, so
the name-matching checks become no-ops, but the structural refusals — a path that cannot be
attributed to an index, a path whose literal text disagrees with its routed form — still
apply. Blacklist behaviour for operators who do have one configured is unchanged.

**Audit entries are written for both executed and refused requests.** The request runner
receives an audit sink as a parameter, in the same shape as the adapter it already
receives, so that auditing is exercised by the same tests and through the same seam. The
side-effect tier recorded comes from the classifier's verdict on the request, not from the
command's capability table — recording by entry point is a known defect class that has
already produced audit rows filed under three different tiers for the same operation.

**The execution-path registry entry for the Elasticsearch shell is updated to name the
permission gate.** The entry currently names only blacklist gates. It is a prose field
today; restructuring it is separate work and out of scope here, but leaving it stale while
fixing the thing it failed to disclose would repeat the omission.

**Refusal is by the existing permission error type, with the existing message shape.**
The shell surfaces the message the same way it surfaces its blacklist refusals today. No
new error type, no new message format. ~~No new exit code.~~ **Overturned — see ADR-0014
Decision 10.** The Elasticsearch shell now exits `1` when any request in the session
failed; exiting `0` after a refusal made a refused piped script indistinguishable from a
successful one, which defeats US 21.

## Testing Decisions

**A good test here asserts what an operator observes: whether a request reached the
cluster, and what they were told if it did not.** It does not assert which internal
function was called or in what order. The request runner is already testable with a fake
adapter that records what it was asked to send, so "was this executed" is expressible as
"did the fake receive it", which is external behaviour at the seam.

**One primary seam: the Elasticsearch shell's request runner.** It is already exported and
already has an established unit test file using a fake adapter, with prior art for exactly
the assertions needed — a blacklisted index is refused and the fake records no call, a
search body gets its size cap injected, a non-search request passes through unchanged, and
a table of unscoped document paths is refused. The new assertions extend that table rather
than introducing a new pattern.

Testing through this seam covers the Elasticsearch request classifier transitively. That is
deliberate: the classifier has its own test file, but the classifier is a lower seam, and a
misclassification that the shell would act on must fail at the level the shell uses it. A
shape misclassified as a read will show up as the fake adapter receiving a request it
should not have.

**One thin wiring assertion at the shell dispatch seam.** The existing dispatch test
already builds a configuration file containing `permission: query-only` and asserts that an
Elasticsearch connection is routed to the Elasticsearch shell. It gains an assertion that
the configured permission reaches the request runner. Without this, enforcement could be
implemented correctly and wired incorrectly with every runner test still green — which is
the same shape as a known prior defect where a safety property was held by a module that
did not know it was holding it.

**Modules under test:** the Elasticsearch shell's request runner (primary), and the shell
dispatch path (wiring only). The Elasticsearch permission classifier is exercised through
the runner, not directly.

**Coverage required before this is considered done:** every request shape listed in the
implementation decisions, asserted at `query-only` and at a tier that permits it, so that
each test pins both a refusal and the corresponding permission rather than only the
refusal. Plus: ordinary search permitted at `query-only`, metadata read permitted at
`query-only`, each structural refusal firing with an empty blacklist, existing blacklist
behaviour unchanged when a blacklist is present, and an audit entry written on both the
executed and the refused path.

**Integration tests against a live Elasticsearch exist and will run in CI.** They cannot
run on the author's machine — Docker is unavailable there — so their result must come from
CI and must not be reported as locally verified.

**Adversarial review is part of the definition of done, not a courtesy.** The comparable
prior fix in this area required seven rounds, where rounds two through six each found a
defect in the fix produced by the round before. A single clean pass is not evidence of a
correct fix here.

## Out of Scope

**The other confirmed execution-path gaps.** Nine gaps across four policies were confirmed
reachable during the investigation that produced this spec — missing column-level blacklist
checks on write paths, missing audit entries on the health-check and migration paths,
missing row caps on several read paths, and a missing permission tier on the report path.
None is a permission escalation; they are integrity, audit-completeness and disclosure-volume
problems. They are deliberately excluded so the escalation fix ships small and reviewable.
They are the subject of a later slice, sequenced after the structured registry work.

**Restructuring the execution-path registry.** Replacing the registry's free-text gate
field with a structured, machine-checked policy set, and replacing its variable-name regex
with type-driven enumeration, is the agreed next slice. This spec only corrects the one
stale entry it touches.

**Unifying statement classification.** Collapsing the ten classification sources into a
single entry-point-independent source is the final slice of the programme. This spec reuses
one existing classifier rather than beginning that consolidation.

**The published library surface.** ~~The `core` entry point exports an adapter factory that
hands out an ungated executor. That is a real exposure and a separate decision, recorded
with a condition tied to when its intended consumer begins using it.~~ **Overturned — see
ADR-0014 Decision 5.** `AdapterFactory` was removed from `src/core/public.ts` inside this
branch: its adapters expose a public `request()`, which is precisely the ungated door this
spec exists to close, and closing it costs nothing only while the intended consumer
(`dbcli-gui`) does not yet exist.

**Routing the Elasticsearch shell through the shared shell engine.** Making the
Elasticsearch branch use the same engine as SQL and Redis would be structurally better and
is a much larger change; the engine is shaped for statement execution, not REST requests.

**The apparent PostgreSQL failure of the health-check command.** Unrelated to this defect,
and a functional bug rather than a security one.

## Further Notes

**Sequencing.** The evidence-format and manifest work currently uncommitted on the default
branch must be committed and opened as its own pull request before this work branches, so
that the security change is reviewable on its own diff.

**Release handling.** This ships as 4.0.0 with a changelog advisory, following the
precedent of the prior release that fixed six read-only bypasses and told every user
running dbcli against an AI agent to upgrade. The security policy was recently corrected to
state that only the current major is supported; leaving a known permission bypass in the
only supported line without an advisory would make that statement false.

**Discovery.** This was found by internal audit, not by a report. No production incident is
recorded, inferred from the absence of any across the commit history, all open and closed
issues, the changelog, the decision records and the plans. That absence is not evidence of
no exposure — the path writes no audit entry, so an affected operator would have nothing to
find.

**Relationship to existing decision records.** The decision that database access stays a
CLI surface rests in part on the claim that dbcli owns the whole surface and can therefore
enumerate every path reaching an adapter. This defect is a case where the enumeration
existed and the policy set behind it did not, which is a correction to that record's
evidence rather than to its decision. The correction belongs with the registry work, not
here. The decision that known defects are repaired regardless of whether anyone is using
the code applies directly and is the reason this is not deferred.
