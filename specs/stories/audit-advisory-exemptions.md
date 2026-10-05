# Let the audit gate carry dated, explained advisory exemptions

## Goal

`bun run audit` (step 3 of `make verify`, `scripts/audit.ts`) fails with
`1 vulnerability (1 high)`: GHSA-vfj7-8cjw-p6xm, stack exhaustion in
`braces <= 3.0.3`, published 2026-09-18 with no patched version (`braces` 3.0.3
is the latest release). `braces` reaches the tree only through the dev
dependency `tailwindcss@3.4.19` (`package.json:129`), via `micromatch` and
`fast-glob`, and Tailwind runs only at build time, over globs this repository
writes itself (`scripts/build.ts:97`, `src/ui-template/tailwind.config.js`).
Raising an `overrides` pin, the fix used for `brace-expansion`
(`specs/stories/brace-expansion-advisory-override.md`), is not possible without
a patched release. The gate therefore stays red for every change, whatever it
touches.

When this Story is done, the gate can exempt a named advisory, but only in the
open: each exemption is a committed entry with its advisory ID, the package, a
reason, and an expiry date. Expired exemptions turn the gate red again. Every
audit run prints what it exempted. The first entry exempts GHSA-vfj7-8cjw-p6xm
until 2026-11-30. Removing `braces` from the tree, for example by moving to
Tailwind v4 through `@tailwindcss/postcss`, is a separate Story. Note that
`@tailwindcss/cli` v4 still pulls `braces` through `@parcel/watcher` and
`micromatch`. The exemption mechanism uses `bun audit --ignore=<GHSA>`, which
Bun 1.4.2 already provides.

## Out of Scope

- Upgrading or replacing `tailwindcss`, `micromatch`, `fast-glob` or any other
  dependency, and any change to `package.json`, `bun.lock` or `overrides`.
- The transport-failure retry in `scripts/audit.ts` (`isTransientAuditFailure`,
  `runAuditWithRetry`) beyond what is needed to pass the ignore arguments.
- Exempting any advisory other than GHSA-vfj7-8cjw-p6xm.
- Any other gate, `Makefile`, and CI workflow files.
- `CHANGELOG.md` and any release.

## Acceptance Criteria

1. `scripts/audit-exemptions.json` exists and holds exactly one entry, with
   `id` `GHSA-vfj7-8cjw-p6xm`, `package` `braces`, a `reason` stating that
   `braces` is reached only through the build-time `tailwindcss` dependency over
   repository-controlled globs, and `expires` `2026-11-30`.
2. On this branch, `bun run audit` exits 0. Its output names each exempted
   advisory with its package and expiry date.
3. `tests/unit/scripts/audit.test.ts` covers the following, and each of these
   tests fails before the change:
   - an unexpired entry becomes an `--ignore=<id>` argument to `bun audit`;
   - an entry whose `expires` date has passed fails the audit with a non-zero
     exit and a message naming the advisory ID and the date;
   - a missing or empty exemptions file runs `bun audit` with no
     `--ignore` argument;
   - an entry missing `id`, `package`, `reason` or `expires`, or with an
     `expires` that is not a `YYYY-MM-DD` date, fails the audit with a message
     naming the problem.
4. An advisory that is not exempted still fails the audit. A test shows this
   by injecting a run whose output reports a different advisory.
5. The existing tests in `tests/unit/scripts/audit.test.ts` pass unchanged.
6. A new ADR, `docs/adr/ADR-0042-*.md`, with status `accepted`, records the
   following:
   - why the gate may exempt advisories;
   - the rules: an entry needs a reason and an expiry, an expired entry fails
     the gate, and every run prints what it exempts;
   - the GHSA-vfj7-8cjw-p6xm entry and its justification;
   - a `**Falsified if:**` paragraph whose condition names `scripts/audit.ts`
     and `scripts/audit-exemptions.json` in backticks.
7. `git diff --name-only main...HEAD` lists only `scripts/audit.ts`,
   `scripts/audit-exemptions.json`, `tests/unit/scripts/audit.test.ts`, the
   new ADR file, and this Story file (`specs/stories/audit-advisory-exemptions.md`).
8. `make verify` passes.
