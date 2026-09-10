# A step's label and its command are one string

* Status: accepted
* Date: 2026-09-10

`make verify` runs twenty-four steps as one `@`-prefixed recipe line, which is
what makes a failing run recordable — `make` stops at a failing *line*, so steps
on separate lines could only ever produce an attestation for a passing run. The
cost, written into the Makefile when it was paid rather than discovered later,
is that a running gate says nothing about where it is.

ADR-0033 paid the half you read afterwards: a FAIL attestation names the step it
stopped at. This is the half you read during — which step is running, and how
long each one took.

## Decision

**Each step announces itself.** A `run` shell function prints the step's number
and name, executes it, and prints the number, name, elapsed seconds and exit
status. A twelve-minute gate now says whether it is on step 3 or step 20, and
which step spent the twelve minutes.

**A step's label and its command are one string.** Each step line is
`step='<command>' && run`, and `run` executes `eval "$step"`. The obvious
alternative — `run bun run lint`, with the command as arguments — leaves two
copies of every command in the recipe, a label and an argv, which can disagree.
DBCLI-030 needed a contract test comparing the two halves precisely because they
were two halves; with one string there is nothing to compare and nothing that
can misattribute a line. A log or an attestation that names the wrong step is
worse than one that names none: it sends its reader to a step that ran fine.

The argv form also does not survive contact with the roster. One step sets two
environment variables inline, which as arguments is not a command at all and
would need an `env` prefix — a step spelled differently from every other step,
for the convenience of a mechanism that was already the weaker option.

**`eval` here is not the usual `eval`.** Its input is not user input, a
variable from the environment, or a value read at runtime: it is a single-quoted
literal on the line above, pinned character-for-character by a contract test that
also refuses a `;` anywhere in a step. A reader who arrives at this line and
reaches for the usual rule should read that test first.

**Whole seconds.** `date +%s` is POSIX and answers the question being asked.
Millisecond timing here would be precision this log has no use for, and the
steps that matter take minutes.

## Consequences

The verify log gains two lines per step. That is the cost, and it is small
against twenty-four steps of tool output.

Nothing else moves: the roster is unchanged in content and order, every step
still blocks, the recipe re-exits with the run's own status, `failed_step` still
names the step that stopped it, and the two attestation phases still exchange
state through the recipe's own shell rather than a file.

Per-step timings are not recorded in the attestation. The document states one
run's verdict and where it stopped; a per-step table is a different artifact,
and adding it would move the schema for something the log already says.

**Falsified if:** a step ever needs to be spelled differently from the way it is
run — a step whose command cannot be a single-quoted literal, or one that must
be built at runtime. Then `step='<command>' && run` in the `Makefile` is no
longer one string serving both purposes, and the label and the command separate
again, with the comparison test that separation requires.
