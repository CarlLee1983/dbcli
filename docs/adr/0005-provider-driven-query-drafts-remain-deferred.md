---
status: accepted
date: 2026-08-07
accepted: 2026-08-16
reopen_trigger: Explicit product and security approval recorded against the checklist below.
---

# Provider-driven query drafts remain deferred

dbcli delivers the agent-driven `QueryDraft` workflow: an external agent creates
an explicit draft and `dbcli semantic draft validate` checks it locally. No
provider-driven generation is authorized in dbcli at this time.

## Decision

`status: accepted` here means the policy below is settled, not that
provider-driven generation is approved. What stays deferred is the feature —
SQD-05 and SQD-06 — and it stays deferred until a superseding record clears the
reopen checklist. This ADR is not an open question awaiting an answer.

Do not add a provider SDK, provider configuration, credential lookup, outbound
transport, or `semantic draft generate` command. No provider or model is
approved, so SQD-05 and SQD-06 remain deferred.

This is a fail-closed policy decision, not an approval inferred from an
environment variable, a signed-in agent, or an available API key. It preserves
the delivered agent-driven workflow without allowing dbcli to send any data to
a model provider.

## Why defer

Provider-driven generation creates obligations that the local validator does
not have: data egress and retention, account ownership, API-key handling,
cost/rate controls, error and retry behavior, metadata-only audit retention,
support ownership, offline behavior, and a revocation path. None has an
approved owner or policy in the current product contract.

## Reopen checklist

An approved product and security record must define all of the following before
this ADR may be superseded:

- The single approved provider, model, account owner, and supported regions.
- The exact sanitized payload. It must prohibit schema cache, saved-query SQL
  bodies, rows, credentials, blacklist entries, and local paths.
- Data egress, retention, training/use policy, and user-consent model.
- API-key storage and rotation, cost and rate limits, error/retry behavior, and
  metadata-only audit retention.
- Offline failure behavior, provider revocation/rollback, and support owner.

The approving record must also authorize a separately scoped implementation of
the adapter boundary and first `generate` command. It must not grant direct SQL
execution; every generated `QueryDraft` still passes the common validator and
requires a separate explicit `explain` or `query` invocation.

## Consequences

- The agent-driven validator remains the only shipped query-draft interface.
- dbcli stores no provider credential and makes no provider network request.
- Any provider-driven code, configuration, documentation, or skill guidance is
  out of scope until this ADR is superseded by the approved decision.
- Removing a future provider integration must restore this deferred state
  without changing the local validator or agent-driven workflow.

**Falsified if:** dbcli ships a provider SDK, provider credential/configuration,
outbound provider transport, or a `semantic draft generate` command without a
superseding approved decision record.
