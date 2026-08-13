---
status: accepted
date: 2026-08-13
---

# Lazy subcommand registration runs beside the eager tree, not instead of it

`src/program.ts` statically imported about 40 command modules, so every CLI
invocation paid for all of them. Issue #50 proposed fixing that by making
subcommand registration lazy, and named two ways to do it: split each command
into a declaration file and an implementation file, or keep one file per
command and move the heavy dependencies into the action. Both change all ~40
command modules.

Neither was taken, because the constraint that decides this is not in the
command modules at all.

`buildProgram()` is **synchronous**, and three non-test callers plus eight test
files walk the tree it returns in-process: `scripts/check-cli-contract.ts`
verifies 115 command paths and 178 live long options against the shipped
documentation, `buildCompletionTree()` derives shell completion from it, and
`src/commands/shell.ts` rebuilds it per REPL session. Lazy loading is
asynchronous. Making `buildProgram()` async to accommodate it would convert a
performance change into a breaking change across eleven call sites, and any
design that keeps it synchronous must keep its static imports — which is
exactly the cost being removed.

## Decision

Two registration paths, sharing one set of declarations.

`buildProgram()` in `src/program.ts` is untouched: synchronous, eager, same
registration order, same signature. Every existing caller keeps working, and
the CLI contract check keeps seeing the whole tree.

`buildProgramFor(argv)` in `src/program-lazy.ts` is the path the real CLI entry
uses. It reads argv, and when argv names exactly one known command it registers
only that one, dynamically imported. Everything else — no command, `--help`, an
unknown name, anything after a bare `--` — falls back to `buildProgram()`.
Top-level help must list every command, so it is a fallback case by design, not
an oversight.

The two paths cannot drift in what they *declare*, because they do not each
hold a declaration. The seven commands whose options are declared in
`program.ts` moved to `src/commands/inline-registrars.ts` as functions taking
their implementation as a parameter; the other ~33 were already `Command`
objects exported by their own modules. Both paths call the same function or add
the same object. What can drift is the *set* of names in `COMMAND_LOADERS`, and
`tests/unit/program/lazy-registry.test.ts` pins that: the registry's keys must
equal the eager tree's top-level names, and every lazily built command must
deep-equal its eager twin down to option flags, defaults, parser presence,
choices, and the full subcommand tree.

`src/program-lazy.ts`, `src/program-root.ts` and
`src/commands/inline-registrars.ts` must never statically import `./program` or
any `./commands/*` module. One static edge makes the laziness a no-op, silently
— the tests above would still pass, because behaviour would be unchanged.

## Why record this

The measured payoff is much smaller than the issue estimated, and a later
reader looking at three extra files and a parallel registration path deserves
the real number rather than the projection.

Issue #50 estimated a 50ms saving from importing modules individually under
`bun -e`. dbcli ships as a single-file bundle (`bun build --outfile`, no code
splitting), where deferring a module defers its evaluation but not its parse.
Measured on the shipped bundle under `bun`, interleaved A/B, 21 paired samples,
median: `query --help` 72.1ms → 64.2ms, `list --help` 69.9ms → 62.1ms. The
`--help` fallback is unchanged within noise (68.7ms → 71.8ms on one bundle
pair, 72.9ms → 72.4ms on the other), which is what a path that loads the whole
tree anyway should show. Bundle size rises about 22KB.

So roughly 8ms, against an estimate of 50ms. That is worth having for a CLI
agents invoke in a loop, and it is not worth a second one of these. The next
such change should establish its ceiling on the shipped artifact before the
design is chosen, not after — measuring the module graph under `bun -e` says
almost nothing about a bundle with no code splitting.

Getting that 8ms honestly took three attempts, which is itself worth recording.
`bun run build` is **not deterministic**: successive builds of identical source
alternate `dist/cli-runtime.mjs` between two sizes about 690KB apart, on this
branch (1,913,004 / 2,604,444) and on `main` alike (1,891,038 / 2,582,505).
Comparing a bundle from one side against the other variant from the other side
produces a difference of ~13ms that has nothing to do with this change. Any
future measurement here has to pin both sides to the same variant.

One smaller consequence follows from the entry point rather than the registry.
`src/cli-runtime.ts` imports `formatUpdateHint`, `formatSkillUpdateReminder`
and `checkSkillUpdates` at the point of use; that shortens the static graph but
does not show up in the numbers above. And `findCommandName()` derives the set
of value-taking root options from `createRootProgram().options` rather than a
hardcoded list, in both long and short spellings, and refuses to guess at
optional-value options at all: mistaking an option's value for a command name
would dispatch to the wrong command silently, where failing to recognise a
command name merely falls back to eager.

`dbcli completion <shell>` had to stop deriving the command tree from
`completionCommand.parent`. Under the lazy path that parent holds one command,
so the generated script listed only `completion` itself — and `--install`
writes it into the user's shell rc, where it stays until reinstalled. It now
builds the tree from `buildProgram()` the way `src/commands/shell.ts` already
did. That failure is invisible to any test that constructs a program in-process,
which is why `tests/integration/lazy-entry-path.test.ts` spawns the real CLI:
the lazy path exists only at the process entry point, so only a real process
exercises it.

**Falsified if:** `buildProgram()` in `src/program.ts` becomes asynchronous, or
`src/program-lazy.ts` statically imports `./program` or any `./commands/*`
module, or `tests/unit/program/lazy-registry.test.ts` stops comparing the
lazily built tree against the eager one.
