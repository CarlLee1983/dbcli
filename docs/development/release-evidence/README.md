# Release evidence handoff

Store one sanitized `<version>.json` index here for each release. The index is
the durable handoff from the authoritative PR or local candidate evidence record
described in [the agent workflow](../agent-workflow.md#choose-one-evidence-record);
it should identify the approved snapshot/tree, release and merge commits, tag,
PR, exact-commit verification runs, package integrity/provenance and install
observations. Record intent, review and publication authorization separately;
one decision may be referenced by multiple tools.

Keep public source URLs and the relevant observations inline. Identify source
records and checksums for provenance, but do not depend on temporary local paths.
Exclude credentials, cookies, private environment values and raw sensitive logs.
Historical observations must say when they were recorded and must not imply a
new verification run. Any missing or inaccessible raw evidence is a limitation,
not a new passing check.

[12.0.0.json](12.0.0.json) preserves the existing 2026-10-18 release observations.
Its source-record names and SHA-256 digests describe the evidence read during
this retrospective; the raw local records themselves are not tracked here.
Public URLs allow independent inspection of the remote release chain, while
local snapshot/install observations remain historical reports.
