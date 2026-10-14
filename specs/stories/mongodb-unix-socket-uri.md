# Preserve MongoDB Unix socket URIs

## Approval

Approved by the user in the current session on 2026-10-14: after the scoped plan below was presented, the user replied 「好」. This authorizes implementation and a reviewable PR, not merging or releasing.

## Goal

Preserve Unix socket connection strings supplied by `init --uri` or interactive paste instead of decomposing them into TCP host/port fields. Keep credentials, database and options unchanged.

## Out of Scope

Adapter redesign, schema changes, credential-policy changes, automatic migration of existing configurations, merging, tags, npm releases and deployment.

## Acceptance Criteria

1. A MongoDB URI whose authority is recognized as a Unix socket by the pinned driver is preserved through the existing raw-URI fallback; no `:27017` is appended to the socket path.
2. Both `--uri` and interactive paste preserve the URI and database, retaining existing plaintext warnings without printing credentials.
3. TCP and SRV decomposition continues to behave as before. Regression coverage includes socket path case/encoding, credentials and options, and an independent driver socket-path assertion.
4. English and Traditional Chinese user documentation, Markdown and HTML, describe the fallback.
5. Run `make verify` against the final commit and report exact observations and any blocked checks. Human review is still required.
