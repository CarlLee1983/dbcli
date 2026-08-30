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

## Decision 6: a control is matched by shape, and a record that is not written is not a record

A sixth round reviewed the fifth round's own patch. It found three CRITICALs,
**two of them regressions introduced by that patch** — which is the same ratio
the four rounds before it produced, and the reason this record now treats
"the fix is the most dangerous code in the change" as the working assumption
rather than an observation.

**Script slots are matched by shape, not by a list of names.** Decision 3 moved
`assertNoElasticsearchScript` to the transport and claimed the disclosure was
closed. It was not: `ES_SCRIPT_KEYS` held two literal names, and the
`scripted_metric` aggregation spells its four slots `init_script`, `map_script`,
`combine_script` and `reduce_script`. A `query-only` shell could therefore run
the exact Painless the previous decision named as the thing it had just shut,
and read the value back under `aggregations.<name>.value` — a key the request
chose, which response redaction cannot reach. Any key equal to `script` /
`script_fields` **or ending in `_script`** now matches, which also covers slots
Elasticsearch adds later. **A list of names cannot hold a door against an API
that composes names.**

The check is still blind to string-encoded bodies (a search template's `source`,
a stored template's `id`). That is not currently reachable, but the reason is the
tier gate, not this control — stated at `src/adapters/server-side-script.ts` so
that whoever adds a `_search/template` read rule sees what it costs.

**The tokenizer widening in Decision 4 re-opened what it meant to close.** Adding
`-` to the query-value separators split `user-password` into `user` and
`password`, neither of them blacklisted — and `?sort=user-password:asc` returns
the value verbatim under `hits.hits[].sort`, where redaction cannot reach it.
Elasticsearch field names legitimately contain `-`, `*`, `|` and `/`, so a
separator set tuned for Lucene *operators* cannot also be right for field
*names*. Both tokenisations now run and the results are unioned: over-tokenising
costs a few tokens that match nothing, under-tokenising loses a protected field,
and only one of those two errors is acceptable.

**Snapshot the block when it is queued, not when it runs.** Decision 3's queue
introduced a second defect of its own: `submit` read the shared `blockLines`
buffer at execution time, while `readline` kept pushing into it synchronously.
A pipeline carrying two commands merged them into one block and executed
**neither**, exiting 0 with an empty audit log — the same silence the original
report was filed for, reached by a different route. Interactively, lines an
operator had typed but not yet submitted were sent as the previous request's
body. Note what this is *not*: there is no divergence between the bytes checked
and the bytes sent. It is a divergence between what the operator submitted and
what was sent, which no amount of parser agreement would have caught.

**An `attempt` row records that an attempt began, so it cannot claim success.**
It was written with `success: true`, making "not sent" and "sent and succeeded"
the same row — including for requests the transport then refused — and doubling
every success count. It is now always `false`; the `outcome` row carries the
truth, so one operation contributes at most one success.

**`audit.strict` exists, defaulting to off.** Audit writes are best-effort:
a full disk, an unwritable directory, or an exhausted lock budget (which an
attacker can deliberately exhaust) makes `writeAuditEntry` return `null`, and
the request went out anyway with a single once-per-process stderr warning that
piped sessions discard. For most commands that is the right trade — losing a row
should not stop the tool. But on this path the audit *is* the control, and
before this there was no way to even express the opposite trade. With it on, a
failed `attempt` row refuses the request. Only that row: an `outcome` that
cannot be written describes a request the cluster already has.

Making it work required `writeAuditEntryResult`, because `writeAuditEntry`
collapsed "audit is disabled" and "audit failed" into the same `null` — the
first is the user's choice and the second is a control failing, and their
correct responses are opposite.

**Brief output is where the record is actually read.** `audit tail --for-agent`
defaults to brief, which kept only `ts`/`command`/`target`/`success` — so
Decision 3's statement field and phase were dropped, and every agent reading the
log saw two identical rows per request. "Says what it did" was true only of
`audit show --no-brief`. Brief now keeps the statement, the tier and the phase,
and the tail table has a `statement` column.

**`redactSql` is for SQL, and an Elasticsearch statement is a path.** Applied to
one it eats the object: `DELETE /orders/_doc/12345` became
`DELETE /orders/_doc/0`, `POST /logs-2026.08.30/_delete_by_query` became
`POST /logs-0.0/…`. Elasticsearch entries use `redactSensitive` instead.

**Cell sanitising covers more than C0.** U+202E and friends reverse the display
of everything after them, letting the tier and success columns be visually
swapped; U+2028 and U+0085 are line breaks to many terminals. This is
zero-privilege log injection — a refused request still writes an `outcome` row
whose target is an attacker-chosen string.

## Decision 7: what dbcli cannot read, it refuses; and a dotted name is a path

A seventh round found two CRITICALs. Unlike rounds five and six, **neither was a
regression** — both had survived every round so far, which is the first evidence
that the reviews had been circling the code they had just changed rather than
the surface as a whole.

**An encoded body is refused, not decoded.** The `wrapper` query carries a
base64-encoded query that the server decodes and runs. Every body-side check
walks object *keys* and never enters strings, so the only keys present are
`query`/`wrapper`/`query` — no amount of loosening the key match reaches inside.
The payload can be `function_score.script_score`, which returns a blacklisted
field's value as each hit's `_score`, a key response redaction has no reason to
touch. This is the same principle already applied to string request bodies and
to `?source=`: **what dbcli cannot inspect, it does not forward.** Decoding one
encoding only invites the next.

Note where the previous round's reasoning failed. Decision 6 recorded the
string-encoded-body blind spot and argued it was unreachable *because the tier
gate holds `_search/template`*. That argument was about one endpoint; `wrapper`
is a query type, and it rides the two-segment `/<index>/_search` path that the
read allowlist deliberately permits. An unreachability argument is only as good
as its enumeration of the ways in.

**A blacklist entry containing a dot never matched anything.**
`namesProtectedField` compared the whole term, then split it and compared each
single component — and a single component never contains a dot, so
`user.password` could not be matched by either branch. The same function is the
redaction rule, so the failure was symmetric: the request side let
`?docvalue_fields=user.password.keyword` through and the response side returned
`_source.user.password` in full. Elasticsearch renders every object field as a
dotted name, so this is the *natural* way to write the setting. Matching is now
over any contiguous run of dotted components, and `redactFields` carries the
walked key path so a nested response shape is compared against a dotted
configuration. Flat names behave exactly as before, which is what made the
defect invisible: every test used one.

**The `_script` suffix rule was over-broad and is now scoped by parent key.**
Decision 6 matched any key ending in `_script`. But `term`, `match`, `range`,
`sort` and `exists` all put *field names* in key position, so `deploy_script`
became a refused query at `query-only`, told that it "executes script code on
the cluster". `scripted_metric` is the only aggregation whose slots are spelled
`*_script` without a literal `script` key inside them, so the suffix rule now
applies only beneath it. Value shape cannot separate the two cases — both are
strings — and the parent key can.

**Encoded `..` is refused.** `%2F` survives the byte-identity check unchanged,
but `normalizeEsPath` decodes it and then lets `..` erase the preceding segment,
across a boundary the server never sees. `GET /secrets%2F..%2Fpublic/_search`
therefore disappeared from the segment check, from index extraction, and from
the audit target at once. Whether Elasticsearch resolves that index expression
at all is unverified — and that is precisely the reason to refuse rather than
normalise.

**`exit` discards what is queued.** The `'line'` handler enqueues every piped
line in one tick, so `rl.close()` ran with later blocks already on the chain and
`drain()` — meaning "run everything" — executed them. `printf 'exit\n\nDELETE
/orders\n\n'` deleted the index. Both shells now set a closing flag that stops
both enqueueing and execution.

**A whitespace-only line is content, not a submit.** Submitting on
`line.trim() === ''` let an editor's stray spaces split a block, sending the
first half as a request with **no body** — and `POST /_update_by_query` without a
body is valid and rewrites the whole index. The audit row was byte-identical to
the one the operator meant to send. Submitting only on a truly empty line
inverts the failure: a piped script whose separators carry spaces now merges and
fails to parse, sending nothing. Fail-closed replacing fail-open is the whole of
the argument.

**Two disclosure surfaces the review kept finding, now closed at the source.**
Refusal messages embed the operator's own path and went to stderr unescaped, so
`ESC[2K ESC[1G` could erase the word "Refused" and leave a forged success line;
the escaping written for audit tables is now shared as
`escapeControlCharacters` and applied there too. And the shell exited 0 whatever
happened, so `dbcli shell < script.txt` could not distinguish "all succeeded"
from "every statement was refused".

## Decision 8: a matcher normalises both sides, and a setting that means nothing is an error

An eighth round aimed away from the recent patches, at surfaces no round had
attacked directly. It found two CRITICALs, neither of them a regression — the
same result as round seven, and together they settle what round six got wrong
about where to look.

**Blacklist entries are expanded the same way requests are.**
`indexExpressionReaches` expanded the *request* — commas, wildcards, date math,
cross-cluster prefixes, percent-encoding — and compared the result to entries by
literal equality. So `blacklist.tables: ["secrets*"]` matched nothing, and
`["*"]` — the spelling that reads as "block everything" — was zero protection.

This is Decision 7's dotted-field defect one level up, and it has the same
tell: every test used the simplest spelling. What makes it worse is that the
spelling users are *taught* is the broken one. The same `blacklist.tables` array
is enforced as glob patterns on Redis connections, and the user documentation
says so. A setting written from the docs protected Redis and silently permitted
Elasticsearch.

Two supporting defects fed it. `dbcli blacklist table add` validated names
against `^[a-zA-Z_][a-zA-Z0-9_]*$` — a SQL identifier — so `my-index`,
`logs-2026.08.30` and `.kibana` were all rejected and Elasticsearch users had to
hand-edit the config file, which is exactly where glob spellings come from. **A
validation rule that pushes people around itself is worse than none.** And a
misspelled or Elasticsearch-flavoured blacklist (`indices`, `fields`, or one
placed inside a connection) was stripped by zod without a word, leaving an empty
blacklist and a config file that looked protective. Those shapes are now parse
errors. Not `.strict()` — that would reject harmless extra keys — only the ones
that *look like they configure security and do nothing*.

Note the mechanism, because it recurred while fixing it: zod strips unknown keys
**before** `superRefine` runs, so a check written there never fires. The first
version of this fix was a no-op and only a test caught it.

**`blacklist add` no longer destroys a v2 config.** The command read config
through the v1 path — which, for a v2 file, returns the *selected connection*
flattened — and wrote it back with the v1 writer, which overwrites the whole
file. Adding one blacklist entry collapsed a multi-connection config to a single
connection: `connections`, `default`, `envFile` and `environment` gone, and the
default permission tier silently replaced by whichever connection happened to be
selected. The Elasticsearch shell's gate reads that value. The write went
through `writeConfigWithIntegrity`, so the integrity record was updated too and
nothing downstream could tell.

While verifying this, two manual runs of the command edited the real project
config on the reviewing machine, because the root `--config` flag is shadowed:
every blacklist subcommand declares its own `--config` *with a default*, so
commander never falls back to the root one. `dbcli --config /path blacklist
table add x` edited `.dbcli` and reported success. **A configuration command
that writes to a different target than the one named, and says it worked, is a
correctness defect in its own right** — now fixed, and the accident is why it
was found.

**Two spellings of one request no longer land in two tiers.** `new URL().pathname`
does not decode percent-encoding; Elasticsearch decodes path parameters. So
`GET /%2A` classified as a read at `query-only` while `GET /*` required `admin`
— the exact condition `isBareIndexSegment`'s own comment forbids. Segments are
now decoded once, in `routedSegments`, and deliberately **not** re-split: a
decoded `/` stays inside its segment, because re-splitting would recreate the
`%2F..%2F` defect Decision 7 closed.

**The unscoped-metadata allowlist reaches sub-resources.** It matched only the
first path segment, so `_cluster` and `_cat` were permitted wholesale — and
`_cluster/state` returns `metadata.ingest.pipeline[]` (the credentials-bearing
pipeline definitions `_ingest` was removed for), `metadata.stored_scripts`, and
the full mappings of blacklisted indices, while `_cat/tasks` returns the running
search sources `_tasks` was removed for. Closing a door and leaving the one
beside it open is not a policy. `_nodes/stats`, `_nodes/settings` and
`_nodes/hot_threads` join them.

**Search templates are refused.** A template's `source` is a string that renders
into a full search body on the cluster, and a stored template's content is not
in the request at all — so a `terms` lookup against a blacklisted index is
invisible to every body-side check. Same rule as `wrapper`, and the third
instance of it.

### What this round settles about method

Round six concluded that the reviews should target the newest patch, because
that was where its CRITICALs were. Rounds seven and eight found four CRITICALs
between them and **none** was a regression. The pattern was not "defects live in
new code" but "reviewers look where they last looked". Both rounds got their
results by aiming at code that had never been attacked directly, and the two
worst findings came from asking the same question in a new place: *does this
matcher normalise both of the things it compares?*

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
obtained; or `isElasticsearchScriptKey` in `src/adapters/server-side-script.ts`
becomes a membership test over a fixed list again; or the query-value
tokenisation in `src/commands/es-shell.ts` stops emitting both the conservative
and the Lucene-operator splits; or `runEsShell` in that file reads `blockLines`
anywhere other than the `'line'` handler that fills it; or the `attempt` audit
row is written with `success: true`; or `writeAuditEntryResult` in
`src/core/audit/integration-helper.ts` stops distinguishing a disabled sink from
a failed one; or `briefify` in `src/commands/audit.ts` drops the statement or
the phase; or `namesProtectedField` in `src/commands/es-shell.ts` stops matching
contiguous dotted-component runs, or `redactFields` there stops carrying the
walked key path; or `ES_OPAQUE_BODY_KEYS` in
`src/adapters/server-side-script.ts` shrinks while Elasticsearch still accepts
an encoded body under that name; or either shell stops discarding queued input
after `exit`; or `runEsShell` submits on a line that is not empty before
trimming; or `audit.strict` is enforced anywhere other than
`writeAuditEntryBeforeEffect` in `src/core/audit/integration-helper.ts`; or
`indexExpressionReaches` in `src/utils/es-index-target.ts` stops expanding the
blacklist entries as well as the request; or `routedSegments` in
`src/core/permission/elasticsearch.ts` stops decoding segments, or starts
re-splitting them after decoding; or `isUnscopedMetadataPath` in
`src/commands/es-shell.ts` matches on the first path segment alone; or
`BlacklistConfigSchema` and `NamedConnectionSchema` in
`src/utils/validation.ts` stop rejecting the blacklist shapes that parse to
nothing; or `blacklist add`/`remove` writes a v2 config through the v1 writer.
