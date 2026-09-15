# A guard over derived output states what must not change

* Status: accepted
* Date: 2026-09-15

`tests/fixtures/plat004/legacy-surface-baseline.json` pins eight CLI surfaces by
sha256. Five of them pin things nothing derives — `--version`, an unknown root
option, two human-error renderings, one command-local `--for-agent` payload —
and none has moved since it was captured at `cc7427be`.

The other three pinned the capability catalog's JSON, text and Markdown
renderings. ADR-0022 makes that catalog *derived*: `ENGINE_CAPABILITIES` is the
authority, and the catalog reads engines and risk out of it. Every change to the
matrix therefore changes all three hashes by construction, and three deliveries
in a row did exactly that:

| Delivery | Why the surface moved |
| --- | --- |
| `b80a236a` | bounded evidence receipts added capabilities |
| DBCLI-034 | a seventh engine appeared in 26 of 53 capabilities |
| DBCLI-035 | SQLite claimed `insert`, `update` and `delete` |

Each time the repair was the same: regenerate the three values, leave
`baselineCommit` alone. A guard whose expected repair is "write down whatever it
says now" reports that the catalog changed — which the diff already said — and
cannot report how. By the third repetition it is a step in a checklist, not a
check.

## Decision

**The three capability-catalog cases leave the hash fixture and become
structural assertions of the catalog's contract.** The five non-derived cases
keep their hashes, and `baselineCommit` keeps its meaning: it still names the
capture this fixture descends from.

The rules that survive the derivation are stated in
`tests/helpers/capability-catalog-contract.ts` and asserted in two places:

| Claim | Asserted in |
| --- | --- |
| the rendered JSON parses at the pinned schema version | `tests/integration/lazy-entry-path.test.ts` |
| the text and Markdown renderings list the same capabilities as the JSON | `tests/integration/lazy-entry-path.test.ts` |
| every capability names a command path the live Commander tree carries | `tests/contract/capability-catalog.test.ts` |

The document check runs `parseCapabilityCatalog` — the same validator an
external Skill is told to use — so a catalog that fails the guard fails for its
consumers too, and the failure names the field rather than a differing digest.

Two of the three answers the Story offered were rejected. Keeping the hashes and
paying the regeneration cost was rejected because the cost is not the problem:
the problem is that the repair carries no information, so the guard cannot fail
in a way anyone learns from. Deleting the three cases outright was rejected
because the contract test next door asserts the *declared* table, `CAPABILITIES`
as the process holds it — not the rendered document, which is the artifact an
external caller parses. Nothing else watched the rendering.

## Consequences

An engine gaining a supported command no longer touches this fixture. That is
the whole point, and it is also the risk: a guard that tolerates the change it
used to fail on can be written so loosely that nothing breaks it. Each
assertion is therefore exercised in both directions — a catalog with its
`schemaVersion` removed, a rendering with a capability deleted, and a capability
naming a dead command path each produce a failure naming what broke.

What is no longer watched: byte-level stability of the catalog renderers. A
change to spacing, ordering or column layout in the text or Markdown output now
passes silently. That was never what the hashes were protecting — they were
captured to prove PLAT-004's lazy entry path did not change the surface it
inherited, a question answered once, in 2026 — and the five remaining cases
still cover the entry path itself.

**Falsified if:** the catalog's renderings stop being derived from
`src/adapters/capabilities.ts` — if `src/core/capabilities/registry.ts` gains a
hand-written engine or risk claim, the output stops moving on its own, and a
byte-level pin over `tests/fixtures/plat004/legacy-surface-baseline.json`
becomes affordable again. It is also falsified if
`tests/helpers/capability-catalog-contract.ts` is reduced to assertions that
cannot fail, which the negative cases in
`tests/integration/lazy-entry-path.test.ts` exist to prevent.
