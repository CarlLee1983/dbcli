---
status: accepted
date: 2026-08-14
---

# Core does not write to stdout

`DataExecutor.executeMutation` printed the generated SQL and its parameters with
`console.log`, then called `promptUser.confirm` — inside `src/core`. Two consequences,
neither of them cosmetic.

The first is that a module whose job is to execute a statement could block on stdin. A
library consumer importing the published `./core` subpath got an interactive prompt it
never asked for, and `dist/core.mjs` shipped a real `import("@inquirer/prompts")` to make
that possible.

The second is the one that matters for what comes next. `dbcli update` and `dbcli delete`
emit a JSON envelope that agents parse. The confirmation block was written to the same
stdout, immediately before it. Anything core decided to print landed in the machine's
input stream, and the only thing keeping the two apart was that core happened to print
little. The upcoming interactive ceremony work would have made core print a great deal
more.

Measured before the change: 17 of 228 modules under `src/core` wrote to stdout or stderr,
about 40 call sites in total. 93% of core was already clean.

## Decision

Modules under `src/core` do not write to stdout or stderr. Core reports what happened as
structured data; the command layer decides how — and whether — to say it.

`DataExecutionOptions` gained a `confirm` callback. Core assembles a
`MutationConfirmationRequest` describing the pending mutation and asks the caller;
`src/commands/mutation-confirm.ts` holds the CLI's implementation. Its English text is the
pre-refactor text unchanged, which is what makes the move verifiable; the stream is not.
The block goes to stderr, because sharing stdout with the result envelope meant every
mutation nobody forced produced stdout no parser could read. The wording moved too: the
request carries `destructive: boolean` rather than a finished warning sentence and prompt,
so the words are chosen — and translated — by the layer that owns presentation. When a mutation would execute unconfirmed and no handler
was supplied, core throws rather than defaulting: proceeding silently and declining
silently are both worse than saying nobody was available to ask.

`scripts/check-core-no-stdout.ts` enforces this in CI, mirroring the existing agent-core
purity gate. The 16 modules that predate the rule sit in `CORE_STDOUT_EXCEPTIONS`, a
ratchet rather than an amnesty: a contract test fails if a listed module no longer
violates, so cleaning one forces its line to be deleted, and the list can only shrink.
`data-executor.ts` is deliberately not on it.

Detection is textual, like its sibling gate. It catches `console.*`, `process.std*.write`,
`writeSync` on a literal fd 1 or 2 — `src/core/recovery/emit.ts` already writes fd 1
directly, on purpose, to survive a pipe truncated by `process.exit` on Windows — and
`Bun.write` targeting `Bun.stdout`. An aliased write (`const c = console`) slips past. The
gate guards against drift by ordinary edits, not against deliberate circumvention, and an
AST pass would cost more than that buys.

## Why record this

The obvious reading of this rule is tidiness, and tidiness is negotiable under deadline.
It is not tidiness. It is what makes "ceremony cannot pollute the agent-facing output" a
structural fact instead of a habit: presentation work in core has no stream to leak into.
One indirect route is still open and is stated here rather than implied away —
`src/core/ddl-executor.ts:14` imports `promptUser` from `@/utils/prompts` and prompts from
inside core, and the gate, being textual, sees an import rather than a write. Closing it
means giving `ddl-executor` the same `confirm` callback `DataExecutor` now takes; until
that lands, the rule holds for direct writes and one module can still ask a question. A later contributor who adds one
`console.log` to a core module "just for debugging" is not making a small mess, they are
removing the guarantee.

The cheaper-looking alternative — leaving the existing 17 modules alone and only forbidding
new writes in the files being touched — was rejected because a gate that does not cover
future core modules is not a gate. The more thorough alternative — cleaning all 40 call
sites now — was rejected because it turns a scoped change into a 17-file refactor. The
ratchet gets the boundary today and the cleanup incrementally, and it is a long-term
arrangement rather than a stopgap: the end state is an empty exception list, reached one
deletion at a time.

`tests/unit/build/inquirer-shipping-contract.test.ts` carries the artifact-level half.
`dist/core.mjs` used to be required to import `@inquirer/prompts`; it is now required not
to reference it at all, so the removed edge cannot reappear unnoticed.

**Falsified if:** a module under `src/core/**` writes to stdout or stderr without
appearing in `CORE_STDOUT_EXCEPTIONS` in `scripts/check-core-no-stdout.ts`, or that list
grows, or `.github/workflows/ci.yml` stops running the gate, or `dist/core.mjs` regains a
reference to `@inquirer/prompts`.
