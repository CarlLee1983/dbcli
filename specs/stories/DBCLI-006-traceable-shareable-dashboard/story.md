# Story: DBCLI-006 Traceable Shareable Dashboard

## Goal

Make a generated query dashboard self-contained and safely traceable when it
is shared, so a recipient can see the execution context without receiving
secrets or query contents.

## Context

The HTML dashboard already presents query results, charts, truncation, and
redaction notices. Sharing the standalone output needs a narrowly defined,
non-secret provenance contract rather than an execution transcript.

## Classification

Both declarations are required. `yes` makes the matching section below
mandatory.

* Security sensitive: no
* Baseline conformance: no

## Scope

### In Scope

* Add safe provenance to standalone dashboards created from saved queries.
* Present the provenance alongside existing truncation and blacklist notices.
* Keep the dashboard usable as a standalone HTML file with no server or local
  workspace lookup.

### Out of Scope

* Query replay, dashboard authentication, remote hosting, collaboration, or
  sharing links.
* Adding provenance to direct-query dashboards.
* Exporting audit logs, raw query text, bound parameters, or connection
  configuration.
* Changing query execution, permissions, result redaction, charts, or limits.

## Inputs

* The dashboard result rows and existing safe display metadata.
* Logical connection identity and engine.
* Saved-query identity and source classification.
* The effective permission and applied limit metadata for the execution.

## Outputs

* A standalone HTML dashboard with a visible, safe traceability section.
* A closed `provenance` version `1` object containing:
  * `connection`: bounded `name` and `system`, where `system` is one of
    `postgresql`, `mysql`, `mariadb`, `mongodb`, `redis`, or `elasticsearch`.
  * `savedQuery`: bounded `key` and `source`, where `source` is `builtin`,
    `shared`, or `local`.
  * `permission`: `query-only`, `read-write`, `data-admin`, or `admin`.
  * `limit`: either `applied` with a positive integer `limitApplied` and a
    `truncated` boolean, or `not-applied` with `truncated: false` and no limit
    value.

## Rules

* R1: The traceability section must travel with the standalone HTML and must
  not depend on a live connection, local config, source file, or server.
* R2: A saved query must use its logical identity and source classification,
  not its file path.
* R3: Effective permission and limit must describe what actually governed this
  execution, not requested/default values that did not take effect.
* R4: The dashboard must preserve existing truncation and blacklist notices,
  and the applied-limit provenance must agree with the truncation warning.
* R5: Provenance must exclude raw query bodies, parameter values, credentials,
  endpoints, file paths, rows beyond the displayed result, and other secret or
  protected execution detail.
* R6: The shareable payload is an allowlisted projection containing only
  displayed rows; applied-limit and security notices; the closed provenance
  object; and a `display` object containing bounded `name`, optional
  `description`, and the existing validated `visual` title, KPI, and chart
  definitions that reference displayed fields. The encoded `display` object is
  at most 16 KiB and each display string is at most 1 KiB. Unknown display
  fields are rejected. The payload must not serialize unused saved-query
  metadata such as parameter defaults/enums, target index or collection,
  verification query/expectation, or source path.
* R7: Across the entire emitted HTML, not only the visible traceability section,
  canaries seeded exclusively in excluded query/default/credential/endpoint/
  path/blocked-identifier metadata and undisplayed rows must be absent.
  User-controlled `</script>` text must be encoded within the injected payload
  so it cannot terminate the script or add executable markup.
* R8: The encoded provenance object is at most 4 KiB; `connection.name` and
  `savedQuery.key` are each at most 512 UTF-8 bytes. Unknown fields, invalid enum
  values, over-limit text, and inconsistent limit states are rejected before
  HTML is written.
* R9: Missing required provenance is rejected before HTML is written; the
  dashboard must not infer or fabricate it.

## Expected Errors

* A malformed, unknown-field, oversized, or unsafe provenance/shareable-metadata
  payload is rejected before HTML generation rather than embedding ambiguous or
  unsafe traceability data.
* A dashboard generation failure must not emit a partially formed shareable
  file containing result data without its required safety handling.

## Dependencies

* Existing HTML dashboard formatter/template, query execution metadata,
  saved-query metadata, permission handling, and applied-limit metadata.
* The Interactive HTML Dashboards sections in both user-guide languages and
  formats.

## Constraints

* Do not add a service, database write, network request, or new sharing
  mechanism.
* Maintain rendered dashboard behavior outside the new traceability section;
  payload serialization intentionally narrows to the allowlist in R6.
* Update `docs/user/en/` and `docs/user/zh-TW/`, keeping each Markdown/HTML
  pair in parity when behavior changes.
* Use focused Bun tests and `make verify` for completion.
