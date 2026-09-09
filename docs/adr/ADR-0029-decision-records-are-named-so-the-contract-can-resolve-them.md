# Decision records are named so the contract can resolve them

* Status: proposed
* Date: 2026-09-09

ADR-0027 decided that upstream ForgeFlow's rules are run, not reimplemented: CI
clones the adopted revision and runs `story-check` against this repository. That
made three of 0.6.0's four new Story sections real here. The fourth,
`## Architecture`, could not be declared at all — its `Decision:` bullet resolved
only against `specs/decisions/`, and this repository keeps its records in
`docs/adr/`.

DBCLI-020 needed that section. It changed what `BlacklistValidator` exposes, and
recorded the reasoning in ADR-0028; the link between the two lived in prose that
nothing checked. Moving twenty-eight records to `specs/decisions/` would have
satisfied the checker by splitting a decision from the documents that reference
it, which is the arrangement this repository's own rule exists to prevent.

Upstream fixed the directory in 0.7.0 (`FORGEFLOW_DECISIONS_ROOT`) after
ForgeFlowV2 issue #23. The filename grammar it did not, deliberately: a record is
looked up as `<root>/ADR-<digits>.md` or `<root>/ADR-<digits>-*.md`, and the id
must be `ADR-<digits>`. Measured here, `FORGEFLOW_DECISIONS_ROOT=docs/adr` alone
still reported `referenced decision record does not exist: ADR-0028`, and
referring to the record as `0028` failed with `architecture decision must be
ADR-<digits>`.

So the records are renamed to carry the prefix they are referred to by
everywhere else in this repository — `ADR-0028-<slug>.md` rather than
`0028-<slug>.md` — and stay where they are. The rename is mechanical, `git mv`
keeps the history, and the prefix duplicates nothing: the directory says `adr`
and so does the filename, which is a small cost against a link that is checked.

The alternative was to keep the section unused and the link in prose. That is
what DBCLI-020 had to do, and the reason this record exists: a decision a Story
rests on should be reachable by something that fails when it is not.

**Falsified if:** a record in `docs/adr/` is added without the `ADR-<digits>`
prefix and nothing fails, or `FORGEFLOW_DECISIONS_ROOT` stops being set where the
contract check runs so that resolution depends on the caller's environment. The
first means the naming is a convention again rather than a contract; the second
means the check passes or fails for a reason that has nothing to do with this
repository's contents.
