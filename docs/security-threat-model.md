# dbcli Agent Safety Threat Model

## Security boundary

`dbcli` permission levels, blacklist rules, dry-run, and agent skills are
defence-in-depth controls. They reduce accidental operations performed through
dbcli; they are not an authorization boundary against a process that can alter
its own configuration or invoke another database client.

The enforceable authority is the database credential. An agent must receive a
database account whose grants match the intended operation (normally read-only),
and credentials must be protected from the agent's writable workspace.

## Assets and trust zones

| Asset | Trust zone | Required protection |
| --- | --- | --- |
| Database data and write privileges | Database server | Least-privilege roles; separate read-only and write credentials. |
| Credentials and named-connection policy | User/home secret store or external secret manager | Do not expose to an untrusted agent process; use environment references or a secret manager. |
| Project `.dbcli` binding and caches | Project workspace | Treat as agent-writable and non-authoritative. |
| `permission`, blacklist, and dry-run settings | dbcli configuration | Defence in depth only; audit changes and do not treat as a substitute for DB grants. |
| Audit logs | Per-connection local artifact | Route by resolved connection identity; do not use them as an access-control decision source. |

## Threats and decisions

1. **Prompt or skill bypass** — An agent can ignore instructions. Mitigation:
   database grants must deny the operation; dbcli guards provide a second check.
2. **Configuration tampering** — An agent able to write a config can raise its
   declared `permission`, select another connection, or replace a binding.
   Mitigation: credentials for privileged connections must not be available to
   that agent identity. Configuration location reduces accidental exposure but
   cannot protect against the same OS user.
3. **Wrong-environment operation** — A selector or default can target the wrong
   connection. Mitigation: named connections, explicit one-shot selectors,
   non-secret environment labels, safe JSON inventory, and per-connection audit
   routing. A future production policy requires an explicit risk classification;
   dbcli must not infer it from a connection name.
4. **Secret disclosure through machine output** — Mitigation: safe inventory,
   status, and audit projections exclude credentials, URIs, Cloud IDs, API keys,
   and environment-variable names.
5. **Read-looking statements that write** — A statement can pass a guard that
   judges it by its leading keyword and still write: stacked statements on
   drivers using the simple query protocol, data-modifying CTEs, `SELECT … INTO`,
   and MongoDB `$out` / `$merge` stages. Mitigation: statements are proven
   read-only rather than assumed, and every path from a command to an adapter is
   registered against the gate it relies on
   (`tests/unit/core/execution-path-contract.test.ts`), because this class of
   defect appears as an unguarded *path*, not as a missing mechanism. See
   [ADR-0004](adr/0004-database-access-stays-a-cli-surface.md).

   **Known ceiling:** the read-only proof classifies keywords, so it cannot see
   SQL that is passed as a *string* to something that executes it —
   `query_to_xml('DELETE …')`, `dblink_exec(…)`, or any volatile user-defined
   function. String literals must be stripped before classification, or ordinary
   queries would be rejected for mentioning a keyword. Saved snippets are
   therefore read-only *by contract and by keyword proof*, not by proof of
   effect. Treat a database account that can execute such functions as able to
   write, and grant accordingly.

6. **Blacklisted data reached through an unnamed table** — A guard that judges
   a statement by its first table name misses everything a `JOIN`, a comma, a
   `UNION` branch, or a subquery brings in. Mitigation: every table a statement
   references is enumerated (`src/utils/sql-tables.ts`), a statement is refused
   if *any* of them is blacklisted, and masking applies the union of their
   column rules. Enumeration reports every non-keyword identifier, not only the
   positions the grammar walk models, because successive adversarial review
   rounds each found new grammar corners in the positional version. Over-reporting blocks
   more; under-reporting discloses.

   Elasticsearch `--index` is an *expression*, not a name: it accepts comma
   lists, wildcards, `_all`, percent-encoding, date math and a remote-cluster
   qualifier. Concrete names are checked individually; a wildcard is refused
   when it could match a blacklisted index, and column rules are applied for
   every index the expression could reach, since which indices exist is
   server-side knowledge dbcli does not have. A shell request is checked on the
   path the server will actually route — percent-encoding decoded and `..`
   resolved, and refused outright when the two differ — segment by segment; on
   the index names its *body* carries (`_mget`'s `docs[]._index`, `_bulk`'s
   `_index`, a `terms` lookup's `index`); and its response has protected field
   names removed. A request that names no index at all (`GET /_search`,
   `/_msearch`, `/_sql`) cannot be scoped, so it is refused whenever a blacklist
   is configured; cluster-metadata endpoints (`_cat`, `_cluster`, `_nodes`,
   `_tasks`, `_ingest`, `_license`) are allowed by name rather than by guessing
   which endpoints return documents.

   For MongoDB the same rule reads `$lookup.from`, `$unionWith.coll`,
   `$graphLookup.from`, `$out` and `$merge.into`, including inside sub-pipelines,
   and re-anchors a looked-up collection's field rules under the `as` path its
   documents arrive at.

   **Known ceilings**, all of which return blacklisted *values* without naming
   the blacklisted object:

   - **Renaming or transforming.** Masking matches result column names, so
     `SELECT password_hash AS x FROM users`, `SELECT substr(password_hash,1,10) …`,
     `SELECT to_json(u) FROM users u` and MongoDB's
     `$project: { stolen: '$sec.token' }` return the value under a name no rule
     covers. Table-level entries are enforceable; **column-level entries are a
     display filter, not an access control**.
   - **Indirection through a view or a function.** `SELECT * FROM v_users`
     references `v_users`; that a view reads `users` is server-side knowledge
     dbcli does not have. The same holds for a set-returning function.
   - **Server-side statement text.** `PREPARE s FROM 'SELECT * FROM secrets'`
     followed by `EXECUTE s` passes the statement as a *string*. This is the
     ceiling already recorded above for the read-only proof, and it applies here
     for the same reason. Both statements classify as `UNKNOWN`, so permissions
     below `admin` refuse them; at `admin` in the shell, where one session
     persists across prompts, they run.

   - **An Elasticsearch alias or a differently-named backing index.** dbcli
     matches index *names*: `.ds-<name>-*` and `<name>-<nnn>` are covered by
     convention, but an alias pointing at a blacklisted index is server-side
     knowledge dbcli does not have, and `GET /_cat/aliases` reveals the mapping.
     Blacklist the alias as well, or rely on the Elasticsearch role.

   - **A column rule naming a leaf, against a flattened source.** The Elasticsearch
     adapter flattens `_source`, so `{profile:{ssn}}` arrives as the single key
     `profile.ssn` and there is no `profile` key at all. A rule for `profile` does
     cover it — every column under a blacklisted ancestor is withheld — but a rule
     for `ssn` alone does not, and neither does `profile` against
     `data.profile.ssn`. Matching any segment would close this, at the price of a
     rule for `id` hiding `user.id`, `order.id`, and every other qualified column;
     the trade was made in favour of the narrower rule. `dbcli schema` reports
     Elasticsearch fields under their dotted names, so blacklisting what `schema`
     shows is the workflow that holds. Pinned by the `KNOWN CEILING` tests in
     `tests/unit/core/blacklist-validator.test.ts`.

   The blacklist withholds objects and columns from ordinary reads. It is not a
   proof that a value cannot be reconstructed. An account that must not read a
   column needs a database grant that says so.

## Operator contract

- Give autonomous agents only database credentials that are safe for their task.
- Keep privileged credentials outside the agent's process environment and
  writable workspace.
- Use a separate human-approved execution identity for production writes.
- Treat `permission: query-only` as a dbcli guard, not proof that the underlying
  database account is read-only.

## Platform note

On POSIX filesystems dbcli keeps stored configuration private (`0o700`
directories, `0o600` files) and agent-mode reads refuse a group/world-writable
config. Windows has no equivalent mode bits — `stat()` reports a synthetic mode
and `chmod` only toggles the read-only flag — so confidentiality there rests on
the ACL the OS applies to the user profile. Tamper detection is unaffected on
either platform: it compares a content hash recorded at write time, not the
file mode.

## Non-goals

This model does not claim to sandbox a malicious process with the same OS
identity as the credential store, nor to replace database authorization or an
external secret manager.
