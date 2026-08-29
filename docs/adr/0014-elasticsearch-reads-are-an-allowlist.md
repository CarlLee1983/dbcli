---
status: accepted
date: 2026-08-30
---

# Elasticsearch reads are an allowlist, and the classifier reads the routed path

Fixing the Elasticsearch shell's missing permission check required deciding two
things that are easy to get backwards, and this record exists because the first
attempt got both backwards inside the same change.

## Context

`dbcli shell` against Elasticsearch reached the cluster with no permission check
at all. Adding one meant routing the shell through
`classifyElasticsearchRequest`, the classifier `dbcli query` already uses — and
that immediately surfaced two properties of the classifier that had never been
exercised, because `query` can only synthesise one request shape
(`POST /<index>/_search`) while the shell sends whatever an operator types.

## Decision 1: reads are an allowlist, and everything else needs admin

The classifier lists the read shapes it recognises. Anything it does not
recognise is `DROP`, which requires `admin`.

**The first attempt inverted this.** The read rule had been a list of paths —
`_search`, `_count`, `_mapping`, `_settings`, `_alias`, `_doc`, `_source` — so
`GET /_cat/indices`, which the shell's own banner tells a new user to try,
required `admin`. The fix made every `GET` and `HEAD` a read, justified by "the
Elasticsearch REST API has no state-changing GET", with a deny-set planned for
the dangerous ones.

That justification was false, and the shape was wrong independently of the
justification:

- `GET /_scripts/painless/_execute` executes Painless. `GET /_sql` runs SQL and
  opens a cursor. `GET /_refresh`, `/_flush` and `/_cache/clear` are
  GET-registered in 7.x. `?scroll=1m` allocates server-side scroll contexts.
- With the default empty blacklist, `GET /_security/api_key`,
  `/_snapshot/_all`, `/_watcher/watch/*`, `/_ilm/policy`, `/_ml/*`,
  `/_transform`, `/_nodes` and `/_cluster/state` all became readable at
  `query-only`. They had required `admin` for the simple reason that nobody had
  listed them.

The deny-set that would have fixed this is the same enumeration one level down.
Both designs drift. **They drift at different rates**: an allowlist drifts when
Elasticsearch adds an endpoint a user wants, and that user is blocked and says
so; a deny-set drifts when Elasticsearch adds an endpoint nobody thought about,
and nobody finds out. The original design had the failure direction right and
only its usability wrong.

So the allowlist stays and is extended by exactly the shapes that made it
unusable: `_cat/*` (excluding `aliases` and `tasks`), `_cluster/health`, and a
bare single-segment index for `GET` and `HEAD`. The `_cat` exclusions are a
disclosure judgment and not a safety boundary — both endpoints are read-only,
but aliases resolve to indices, which `es-index-target.ts` records as
server-side knowledge dbcli does not have, so `_cat/aliases` turns a documented
ceiling into a lookup.

A bare index is recognised as "one segment, no leading underscore, no `*`, `?`
or `,`". The underscore rule covers every single-segment endpoint Elasticsearch
routes without listing them. The punctuation rule exists because `GET /*` and
`GET /_all` are the same request and must not land in two tiers.

**The read set is a floor, not a proof that everything absent from it is
dangerous.** Saying otherwise is what produced the inversion.

## Decision 2: the classifier normalises its own input

`ElasticsearchRequest.apiPath` is now `rawPath`, and the classifier strips the
query string and resolves percent-encoding and dot segments itself.

Before this, the shell computed the routed path twelve lines above the call and
passed the raw text anyway. Every substring test in the classifier therefore
matched on attacker-controlled query-parameter values, and `filter_path` is
accepted by every endpoint and takes an arbitrary string:

```
POST /orders/_delete_by_query?filter_path=_count   → classified SELECT → executed at query-only
DELETE /orders?filter_path=_bulk                   → classified SELECT → executed at query-only
PUT /orders/_mapping?filter_path=_bulk             → classified SELECT → executed at query-only
```

The correct value existed, in scope, twelve lines up, and the caller passed the
wrong one. That is not a lapse a second caller avoids; it is what the interface
invited, and `tsc` could not see it because both values are `string`.

Normalisation therefore lives at the single gate both callers reach.
`normalizeEsPath` is idempotent, so a caller that already normalised loses
nothing.

Matching is on segments and is **position-aware**. Exact segment matching alone
is not enough: `_search`, `_count` and `_bulk` are legal document ids, so
`POST /orders/_doc/_search` is an index-with-id write whose final segment is
`_search`. `_search` and `_count` count only as the endpoint of a one- or
two-segment path; a document id is opaque and is never matched against anything.

## Consequences

- The routed-versus-literal mismatch refusal in the shell is **unconditional**.
  It began as a blacklist check and is now load-bearing for the tier gate too:
  `%2F` can manufacture a segment the server never sees, so
  `/a%2F_search/_delete_by_query` routes, in dbcli's view, to a search. Gating
  it on a blacklist being configured would leave the classifier reading a string
  the server will not receive, for the default configuration. It remains the
  only thing standing between the classifier's view of a request and
  Elasticsearch's, and normalising the classifier's input without it trades one
  asymmetry for its mirror image.
- An unreadable `_bulk` body is `DROP`. It was `SELECT`, and since the bulk
  branch is selected by the path alone, that made it a general-purpose
  downgrade.
- `_update_by_query` is now `admin` rather than `read-write`: it is its own
  segment, distinct from `_update`, so exact matching drops it to the
  destructive default. That is stricter and correct — it rewrites every document
  in an index.
- Users who relied on `GET` of an endpoint outside the read set now need
  `admin`. That is the cost this record accepts, and it is recoverable by
  escalating a tier; the alternative failure is not recoverable.
- `_ingest` and `_tasks` left the shell's unscoped-metadata allowlist: pipeline
  definitions embed credentials, and detailed task listings carry the request
  source of running searches.

**Falsified if:** `classifyElasticsearchRequest` in
`src/core/permission/elasticsearch.ts` gains a rule that permits a request by
method alone, or matches any endpoint token with `includes()` rather than as a
positioned segment, or reads a path this module did not normalise; or the
routed-versus-literal refusal in `src/commands/es-shell.ts` becomes conditional
on any configuration; or an unrecognised request stops classifying as `DROP`.
