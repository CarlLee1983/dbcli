# Clear the source-map-js and postcss-selector-parser advisories from the audit gate

## Goal

`make verify` fails at its `bun run audit` step on two advisories published
against build-time dev dependencies, so no change can pass verification until
the gate is green again.

- `source-map-js@1.2.1` (high, GHSA-68fv-2mgg-jv7q, fixed in 1.2.2) is reached
  through `postcss`, which declares `source-map-js: "^1.2.1"`
  (`bun.lock:552`). The patched release is inside that range; only the lockfile
  holds the old version.
- `postcss-selector-parser@6.1.4` (moderate, GHSA-rj75-hqrm-r3gf, fixed in
  7.1.6) is reached through `tailwindcss > postcss-nested`. `tailwindcss@3.4.19`
  requires `postcss-selector-parser: "^6.1.2"` and `postcss-nested@6.2.0`
  requires `"^6.1.1"` (`bun.lock:560`, `bun.lock:644`), and the 6.x line has no
  patched release. As with `braces` in ADR-0042, the exposure is CPU
  exhaustion inside a build tool that only parses this repository's own
  stylesheet (`scripts/build.ts:97`); nothing reaches it at runtime or from
  user input.

When this Story is done, the patched `source-map-js` is installed, the
`postcss-selector-parser` advisory is exempted in the open under ADR-0042's
rules, and the audit gate passes.

## Out of Scope

- Migrating to Tailwind v4 or replacing `postcss-nested`.
- Overriding `postcss-selector-parser` across a major version (to 7.x).
- Changing `scripts/audit.ts` or the exemption rules in ADR-0042.
- Renewing or changing the existing `braces` exemption.
- Any change to runtime dependencies.

## Acceptance Criteria

1. `bun.lock` resolves `source-map-js` to 1.2.2 or later, and
   `scripts/audit-exemptions.json` has no entry for GHSA-68fv-2mgg-jv7q.
2. `scripts/audit-exemptions.json` has an entry for GHSA-rj75-hqrm-r3gf with
   `package` `postcss-selector-parser`, a `reason` that names the build-time-only
   path through `tailwindcss > postcss-nested`, and `expires` `2026-11-30`.
3. `bun run audit` exits 0, and its output lists the GHSA-rj75-hqrm-r3gf
   exemption.
4. `git diff --name-only` against the base lists only `bun.lock`,
   `package.json`, `scripts/audit-exemptions.json`, `CHANGELOG.md` and this
   Story file (`specs/stories/audit-source-map-js-and-selector-parser.md`).
5. `CHANGELOG.md` has an `Unreleased` entry naming both advisories and how each
   was handled.
6. `make verify` passes.
