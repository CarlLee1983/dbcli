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

## Decision 2: the routed path comes from the parser the request goes through

`ElasticsearchRequest.apiPath` is now `rawPath`, and the classifier derives the
routed path itself rather than trusting a caller to hand it one.

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

Normalisation therefore lives at the single gate both callers reach — and it is
**`new URL(...).pathname`, not `normalizeEsPath`**.

A third review round found why that distinction matters. `normalizeEsPath`
*approximated* what `fetch` does, and an approximation is worth exactly its
worst gap. `#` was one: `fetch` discards everything from the first `#`, so
`POST /_reindex#/_count` read here as a two-segment count while the server
received `POST /_reindex` — an arbitrary index-to-index copy at `query-only`,
and therefore also a blacklist bypass, since a protected index can be copied
into a readable one. Tab, LF, CR and `\` are three more gaps of the same shape.
Enumerating them is the mistake; asking the same parser is the fix.

**`normalizeEsPath` is dead for classification and must stay that way.**
`/orders/_doc/a%2Fb` is three segments to Elasticsearch and four to a decoder,
so leaving it in the classifier reopens the divergence in the opposite
direction. It remains correct for the blacklist, which decodes an index *name*
because Elasticsearch decodes segments too.

Two path functions is not the hazard. Two path functions answering **the same**
question was. Routing — where does this request go — and naming — which index
does it touch — are different questions, and anyone who merges them back on the
grounds that they look like duplicates will reintroduce this.

Matching is on segments and is **position-aware**. Exact segment matching alone
is not enough: `_search`, `_count` and `_bulk` are legal document ids, so
`POST /orders/_doc/_search` is an index-with-id write whose final segment is
`_search`. `_search` and `_count` count only as the endpoint of a one- or
two-segment path; a document id is opaque and is never matched against anything.

## Consequences

- The shell refuses any request target — path **and query string** — that is not
  **byte-identical** to what `new URL(...)` produces. No resolution, no repair: any softening is a
  second path function, which is the class of defect being removed. The refusal
  hands back the canonical spelling, because the rule legitimately rejects a
  document id containing a space or a non-ASCII character and an operator should
  be able to copy the answer rather than guess an encoding. The adapter builds
  its URL with the same parser, so what was verified is what is sent.
- Path and query are parsed from that one `URL`, never from `String.split('?')`.
  `split` splits at every `?` and the destructuring took only the second
  element, so everything after a second `?` vanished from the query these checks
  read while the adapter was handed the path whole — `?filter_path=x?&source=…`
  hid a smuggled body from every check that exists to find one. The path stopped
  being approximated in round three and the query string did not; this is the
  same defect one field over.
- The shell refuses a `source` query parameter. Elasticsearch accepts
  `source=<json>&source_content_type=...` in place of a request body, and every
  body-side check reads `req.body` — so a protected field named in a smuggled
  body was invisible to the check that exists to catch it. Refusing the
  parameter restores that invariant rather than teaching four checks about a
  second body location. The parameter is matched as an exact key: `_source`,
  `_source_includes` and `_source_excludes` are legitimate, and a substring test
  would catch them.
- The protected-field check also reads query-parameter values, because the
  URI-search form names fields directly (`?q=password:*`, `?sort=password:asc`,
  `?docvalue_fields=`) and returns their values under a key the request chose.
  A term matches when any **dot component** of it is a protected field, not only
  when it equals one: `password.keyword` is the multi-field every `text` field
  gets by default, and `params._source.password` is how a Painless script reads
  one, so a protected name can sit at either end of a dotted path.
- **Three stated ceilings.** A mapping-level `alias` naming a protected field
  under a different word is server-side knowledge, the same class as
  alias-to-index resolution. A script that assembles the name
  (`doc['pass' + 'word']`) defeats any literal scan. And a wildcard field
  expression expands after the request leaves, so `?q=pass*:hunter*` is a match
  oracle over a protected column — hit counts answer the question without the
  value appearing anywhere. Wildcards that *return* values are still caught, but
  by response redaction rather than by the request scan, which makes that
  backstop load-bearing rather than incidental. None of the three is closed by
  matching harder, and chasing the oracle with glob matching would mean guessing
  Elasticsearch's wildcard semantics — the approximate-the-parser mistake in a
  third field.
- The byte-identity refusal is **unconditional**. Its ancestor was a blacklist
  check gated on a blacklist being configured, which left the classifier reading
  a string the server would not receive for the default configuration. It is now
  the thing that keeps the classifier's view of a request and Elasticsearch's
  from parting company at all, so it cannot depend on unrelated settings.
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

## Decision 3: the checkpoint belongs to the transport, and audit brackets it

A fifth adversarial round found two CRITICALs that share a shape with the four
before them, in a place none of them had looked: not in how dbcli parses input,
but in *where* a control is mounted and *when* a record is written.

**`assertNoElasticsearchScript` moved to `ElasticsearchAdapter.request()`.** It
had been called from `execute()`, and its own module docstring claimed a
checkpoint "at the adapter's execution entry point, so every path passes through
the same check". Elasticsearch has two such entry points, and the shell uses the
other one — so `query-only` could run arbitrary Painless via `script_fields`,
read a blacklisted field back under a key of the request's choosing, and at
`read-write` rewrite documents with `ctx._source`. Two reviewers reached this
from unrelated directions, which is the strongest signal the round produced.

The general rule this records: **a control mounted on a caller is a control that
the next caller will not have.** Mount it where the bytes leave.

This also retires one of Decision 1's three stated ceilings. `doc['pass' +
'word']` was described there as unclosable by any literal scan, and that was
true of *term scanning* — but the wrong conclusion followed from it, because a
control that rejects the `script` key outright, regardless of what it names, had
existed in the repository all along. A ceiling is a claim about the whole system,
not about the check in front of you.

**Audit brackets the request rather than trailing it.** An `attempt` row is
written before the socket and an `outcome` row after, and every row now carries
the operation as `<METHOD> <routed path>`. Both halves were gaps, and both were
invisible to tests that only ask whether a request was refused: a client-side
timeout on `_delete_by_query` aborts the socket while the cluster finishes the
delete, and `DELETE /orders`, `POST /orders/_update_by_query`,
`PUT /orders/_mapping` and `POST /orders/_close` used to produce four identical
rows. Neither is a new idea here — `recordGateDecision` on the SQL path records
before executing, and says why in its own docstring.

**The shells drain before they exit.** `readline` does not await its `'line'`
handler, so `'close'` reached `process.exit(0)` while a request was still in
flight and its audit row unwritten — a pipeline could execute against the cluster
and leave nothing behind, which is exactly the property the original CRITICAL
was reported for. The permission and blacklist checks all complete
synchronously before the send, so the checks passed, the packet left, and only
the record was lost. The same defect was present on the SQL shell, which had the
serialising half of the fix and not the draining half; both now share
`createSubmitQueue`.

## Decision 4: two disclosures are accepted, in writing

`GET /_cat/indices` reports every index — name, `docs.count`, store size —
without naming one, so a blacklisted index is disclosed by an endpoint that
`/_cat/indices/secrets` is refused for. Refusing unqualified `_cat` subresources
whenever any index is blacklisted would take away the ordinary orientation
command, and filtering rows out of the response would make a response-shape
dependency load-bearing in the way Decision 1 pushed back against. **Accepted,
in the same spirit as classification rule 6:** the blacklist hides an index's
contents, and its existence and document count are disclosed to anyone who can
list the cluster. `docs.count` observed repeatedly is a write oracle, and that
is part of what is accepted.

The Lucene-syntax tokenizer gap that this round also found is *not* in this
category and was closed: `?q=+password:hunter2` passed while
`?q=password:hunter2` was refused, because the query-value splitter did not
treat `+`, `-`, `*`, `!`, `^`, `~`, `|`, `/` or `\` as separators. That was a
tokenizer defect, not a ceiling — the distinction Decision 3 exists to make.

## Decision 5: the published surface no longer exports the adapter factory

`./core` exported `AdapterFactory`, whose adapters expose a public `request()`.
Any library consumer could therefore hold a path that skips permission,
blacklist and audit together — every door this record describes, bypassed by one
import. `QueryExecutor` and `DataExecutor` stay: they carry their gates with
them. Closing it now costs nothing because the intended consumer, `dbcli-gui`,
does not yet exist; closing it after the first import would be a breaking change.
Re-opening the ability to construct an adapter means publishing a gated façade,
never the factory.

**Falsified if:** `classifyElasticsearchRequest` in
`src/core/permission/elasticsearch.ts` gains a rule that permits a request by
method alone, or matches any endpoint token with `includes()` rather than as a
positioned segment, or derives its path from anything but `new URL`; or the
byte-identity refusal in `src/commands/es-shell.ts` becomes conditional on any
configuration, stops covering the query string, or starts repairing a request
instead of refusing it; or any check in that file reads a path or query derived
from `String.split` rather than from the parsed `URL`; or
`normalizeEsPath` from `src/utils/es-index-target.ts` is used again to decide
where a request routes; or an unrecognised request stops classifying as `DROP`;
or `assertNoElasticsearchScript` in `src/adapters/server-side-script.ts` is
called from anywhere other than the transport boundary in
`src/adapters/elasticsearch-adapter.ts`, or a third execution entry point
appears there without it; or `runEsRequest` in `src/commands/es-shell.ts` stops
writing its `attempt` row before the request or drops the statement from a row;
or either shell's `'close'` handler in `src/commands/es-shell.ts` or
`src/commands/shell.ts` exits without draining `createSubmitQueue` from
`src/commands/shell-submit-queue.ts`; or `src/core/public.ts` exports
`AdapterFactory`, or any other value from which an ungated adapter can be
obtained.
