# A step that nothing reads is not a check

* Status: accepted
* Date: 2026-09-10

`make verify`'s roster is deliberately hard to shrink. Its own comment says a
step may be added deliberately and that removing one has to be argued for,
because a control plane that runs this gate must not become a reason to make it
say less.

This is that argument, for one step.

ADR-0034 made the gate's per-step timings visible. The first measured run, at
eleven minutes:

```text
<== [11] bun run build 59s exit 0
<== [12] bun run build:determinism 116s exit 0
```

`build:determinism` builds twice and compares four digests. Those two builds are
the property being checked — building once and trusting it is not a cheaper
check, it is no check — so its 116 seconds are the price of the answer. (That
116 is one sample of a number this machine also produced as 133, 151 and 207;
see the Consequences.)

The 59 seconds above it buy nothing. Step 11 built the same artifacts from the
same source; step 12 overwrote them with two more builds before anything read
them. The steps in between run `bun run dev`, from source. The steps that
execute `dist/` come after, and they execute what step 12 left — which the check
had just proved is byte-identical to what step 11 produced. The gate was
building three times to learn what two builds say.

## Decision

**`bun run build` leaves the roster.** The remaining steps are unchanged in
content and order, each still blocks, and a contract test now pins the ordering
that the removal makes load-bearing: a step executing `dist/` must come after a
step that builds it. The roster is a literal list, and a literal list is exactly
what can be rearranged without anyone noticing.

**A build that fails inside the determinism check reports itself.** That check
ran its builds with `.quiet()` and let `$` throw, which carried the exit status
and dropped the build's diagnostics. The removed step was, incidentally, what
made a broken build readable. Removing it without this would have traded a
minute of wall-clock for an unreadable failure, and the message names which of
the two builds failed — a second build failing after the first succeeded is a
much stranger event than an ordinary broken build and should not be reported in
the same words.

**The decisions move to `scripts/lib/build-determinism.ts`.** Comparing digests
and composing the failure message are pure, and separating them from the two
builds is what lets them be tested without spending two minutes. One of them was
worth testing on its own account: a missing digest now counts as drift, where
`undefined === undefined` would have read a build that produced nothing as
reproducible.

## Consequences

**The gate performs two builds per run instead of three.** That is the change,
stated the way it can be checked. Nothing else in the roster moved.

**How much wall-clock this saves is not something this machine can measure**,
and the first attempt to claim it was wrong. Comparing the two whole-gate runs
either side of the change said the gate got *slower*: `build:determinism` went
from 116s to 207s while the removed step's 59s went away. Measuring the pieces
directly said the opposite — 151s for `build:determinism` alone against 196s for
a build plus `build:determinism`, which is one build's worth of saving, as
expected.

Both readings are from the same machine on the same source. Identical builds
measured 63s, 94s and 104s; `build:determinism` measured 116s, 133s, 151s and
207s. The spread is larger than the effect, so *any* number attached to this
change here is noise with a decimal point, and the honest claim is the
structural one: one build fewer.

That the direction was measurable at all only in the direct comparison is worth
remembering — the whole-gate comparison put a 91-second swing on one step and a
confident wrong sign on the conclusion. GATE-002 and GATE-003 are the same
lesson about assertions; this is it about a claim in a decision record.

The saving is expected to be larger and steadier in CI, where every runner
starts cold and no earlier build has warmed anything. That is an inference from
the cold measurement above, not a measurement of CI, and it is written here as
one.

The measurement is the point, not the minute. This step had been running for
every verification since the roster was written, and it took making the timings
visible for one run to see it. Other steps in the list are now measured too, and
the same question can be asked of them — with the caution that this machine
answers a repeated question three different ways.

`bun run build:determinism` remains runnable on its own from a checkout with no
`dist/`, which is what makes it a usable pre-release check as well as a gate
step.

**Falsified if:** a step is added between `build:determinism` and the steps that
execute `dist/` which rebuilds, deletes, or modifies those artifacts. Then what
the later steps execute is no longer what the determinism check proved
reproducible, and the roster in `Makefile` needs its own build back — or that
step needs to come before it.
