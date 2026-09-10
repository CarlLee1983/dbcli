# A FAIL names the step it stopped at

* Status: accepted
* Date: 2026-09-10

The Verification Attestation recorded `result`, `exit_code` and the revision. It
did not record what went wrong, so every FAIL looked like every other FAIL.

Two evidence records at the same revision made that concrete. ForgePilot wrote
`EV-048 FAIL at d387498b` and, minutes later, `EV-049 PASS at d387498b`. Nothing
had changed in the repository: six test containers had exited hours earlier, and
`services:check` — the third of twenty-three steps — refused before a single
test ran. Both records are true, the evidence store keeps both, and neither says
that one of them is about the machine and the other is about the code.

An evidence store whose failures cannot be told apart trains its readers to skip
them, and a record nobody reads is the failure this repository keeps paying for
in different costumes.

## Decision

**A FAIL attestation carries `failed_step`, naming the step the run stopped at.
A PASS carries no such field**, because nothing failed and the recipe's variable
on a passing run holds the last step, which would read as the step that failed.
`schema_version` moves to `2`: a field's existence and its requiredness both
changed.

**The name travels through the recipe's own shell, never a file.** DBCLI-017
refused to hand state between `begin` and `finish` through a `run.json`, because
a file left behind by a killed run gets adopted by the next `finish` and produces
one document describing two runs. A step marker file would reintroduce exactly
that. The revision already travels as shell words; the step now travels beside
it.

**The parentheses around the step chain are removed.** They never made the chain
stop — `&&` does, and `make` stops at a failing *line*, which is why the steps
are one line — but they made it a subshell, so the variable naming the running
step died before the attestation was written. Removing the grouping keeps both
properties DBCLI-017 added them for: a FAIL is still recorded, and the
attestation still cannot change a verdict.

**Every step names itself, and a contract test compares the two halves.** A
marker that names a different command would send a reader to a step that ran
fine, which is worse than having no field at all. The roster stays a literal
list, and the only `;` permitted among the steps is the one that ends the chain.

## Consequences

`bun run scripts/write-attestation.ts finish` takes five arguments instead of
four. The argument count is checked, as it already was, because a shifted
argument list produces an error naming the wrong problem.

The field says *where* the run stopped, not *why*. `services:check` failing still
needs its own output to say which container was down. That is the right split:
the attestation is a bounded record of one run's verdict, and a log is a log.

What this does not fix is the run-time half. A CI log still does not say which
step is executing, because the steps are one `@`-prefixed line; the Makefile
records that as an outstanding cost rather than pretending it is gone.

**Falsified if:** the recipe stops running its steps as one `&&` chain in one
shell — parallel steps, a step runner, a generated recipe — then the surviving
`step` variable no longer names the step that stopped the run, and
`failed_step` in `scripts/lib/verification-attestation.ts` would be recording
whichever step happened to be assigned last.
