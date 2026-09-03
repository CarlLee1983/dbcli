# Acceptance Criteria

## Happy Path

* [ ] A saved-query dashboard contains a standalone traceability section with
  logical connection identity/engine, saved-query identity/source
  classification, effective permission, and effective limit, without requiring
  access to the source file.
* [ ] Opening the generated HTML without dbcli, a database, or its workspace
  still displays results, existing notices, and safe traceability metadata.

## Business Rules

* [ ] Applied-limit provenance agrees with the displayed truncation warning;
  an execution without an applied limit is explicitly distinguishable.
* [ ] Blacklist redaction/omission notices remain visible before dashboards'
  KPIs, charts, and tables wherever they were previously shown.
* [ ] Traceability contains none of: raw query bodies, parameter values,
  credentials, endpoints, file paths, or undisplayed raw result data.
* [ ] Missing required provenance is rejected before HTML is written and is
  never guessed.
* [ ] The serialized shareable payload contains only displayed rows,
  applied-limit/security notices, the exact closed provenance version `1`
  schema, and a `display` object limited to bounded `name`, optional
  `description`, and existing validated visual title/KPI/chart definitions that
  reference displayed fields; unused `SavedQueryMeta` fields are absent.
* [ ] The encoded display object rejects unknown fields, content over 16 KiB,
  and individual strings over 1 KiB.
* [ ] The entire emitted HTML excludes canary values seeded exclusively in
  query bodies, parameter defaults/enums, verification queries/expectations,
  credentials, endpoints, source paths, blocked identifiers, and undisplayed
  rows. A user-controlled `</script>` canary remains encoded inside the
  injected payload and cannot terminate the script or add executable markup.
* [ ] Provenance rejects unknown fields, invalid system/source/permission/limit
  enums, inconsistent limit states, an encoded object over 4 KiB, and a
  connection name or saved-query key over 512 UTF-8 bytes.

## Failure Cases

* [ ] Invalid, oversized, or unsafe provenance/display metadata is rejected
  before HTML is written.
* [ ] A failed dashboard build does not leave a shareable partial artifact that
  bypasses existing redaction or truncation handling.

## Regression Requirements

* [ ] Existing direct-query dashboards remain unchanged; saved-query
  HTML-export, chart/KPI, truncation, and blacklist-notice behavior remains
  unchanged apart from the traceability section.
* [ ] English and zh-TW user-guide Markdown and HTML document identical safe
  provenance fields and exclusions.

## Verification Notes

Run focused Bun tests for HTML formatting, query/saved-query metadata, applied
limits, and redaction notices, then run `make verify` from the repository root.
