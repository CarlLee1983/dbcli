# The audit gate may exempt a dated advisory

* Status: accepted
* Date: 2026-10-05

`bun run audit` blocks every push on purpose (see the header of
`scripts/audit.ts`). On 2026-09-18 GHSA-vfj7-8cjw-p6xm, a high-severity stack
exhaustion in `braces <= 3.0.3`, was published with no patched version:
`braces` 3.0.3 is the latest release, so the `overrides` pin that fixed
`brace-expansion` cannot be used here. The gate therefore failed with
`1 vulnerability (1 high)` for every change, whatever it touched, and a gate
that is always red stops being read.

`braces` reaches the tree only through the dev dependency `tailwindcss@3.4.19`,
via `micromatch` and `fast-glob`. Tailwind runs only at build time
(`scripts/build.ts:97`), over globs this repository writes itself.

## Decision

**The gate may exempt a named advisory, but only in the open.** Exemptions live
in `scripts/audit-exemptions.json`, a committed list, and `scripts/audit.ts`
turns each valid entry into a `bun audit --ignore=<id>` argument (available in
Bun 1.4.2). The rules:

- Every entry needs a GHSA `id`, the `package`, a `reason` and an `expires`
  date (`YYYY-MM-DD`). An entry missing any of them, with an unknown field, a
  non-GHSA id, an unparseable date or an id already listed fails the gate
  instead of being skipped.
- An expired entry fails the gate, naming the advisory and the date. The
  expiry day itself still counts as valid, and "today" is the UTC date.
- Every run prints each exemption it applied, with package, expiry and reason,
  so a green audit never hides what it stepped past.
- `package` is descriptive only and is not checked against the advisory;
  an exemption applies by GHSA id.
- A missing or empty file means no exemptions. An advisory that is not listed
  still fails the gate.

**The first entry exempts GHSA-vfj7-8cjw-p6xm until 2026-11-30.** The exposure
is a denial of service in a build-time tool fed by globs the repository itself
controls; nothing reaches `braces` at runtime or from user input, and no patch
exists to apply. The date forces a decision before it lapses: by then either
a patched `braces` exists, or `braces` has left the tree. Moving to Tailwind v4
through `@tailwindcss/postcss` would remove it, but `@tailwindcss/cli` v4 still
pulls `braces` through `@parcel/watcher` and `micromatch`, so that migration is
a separate Story and must pick the PostCSS plugin.

## Consequences

An exemption is a dated debt, not a fix: when 2026-11-30 passes the gate turns
red until the entry is removed or renewed with a fresh reason. Renewing is a
reviewed diff to a committed file, which is the point. Exemptions are applied by
advisory ID, so they cover that advisory wherever it appears in the tree, not
only under `tailwindcss`.

**Falsified if:** the exemption list stops being a dated, disclosed one — an
entry in `scripts/audit-exemptions.json` is honoured without a reason or past
its expiry, or `scripts/audit.ts` stops printing what it exempted. The gate
would then hide advisories rather than defer them with a visible deadline, and
exempting nothing at all would be the honest alternative.
