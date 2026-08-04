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

## Operator contract

- Give autonomous agents only database credentials that are safe for their task.
- Keep privileged credentials outside the agent's process environment and
  writable workspace.
- Use a separate human-approved execution identity for production writes.
- Treat `permission: query-only` as a dbcli guard, not proof that the underlying
  database account is read-only.

## Non-goals

This model does not claim to sandbox a malicious process with the same OS
identity as the credential store, nor to replace database authorization or an
external secret manager.
