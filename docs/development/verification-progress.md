# Observe canonical verification progress

This repository operator tool reads a specified `make verify` log. It does not
execute verification, alter any gate, or write to the log. Run canonical
verification separately and keep its actual exit status and candidate-bound
evidence in the [selected handoff record](agent-workflow.md#choose-one-evidence-record).
Use one log file per verification run.

```sh
bun run scripts/verification-progress.ts /path/to/verify.log
bun run scripts/verification-progress.ts /path/to/verify.log --follow
```

The default is a finite one-shot observation: at most the last 12 recognized
events plus one summary. `--follow` prints that same initial snapshot, then only
new events as the log grows. Ctrl-C or SIGTERM stops observation; no further
output at EOF is required to keep following. The file must already exist and be
a readable regular file. No additional dependencies are required.

Example output:

```text
START [7]
END [7] 2s exit 0
START [8]
Summary: IN_PROGRESS step [8]; attestation UNKNOWN
```

`START` and `END` use the existing `==> [n] ...` and
`<== [n] ... Ns exit C` markers. `END` preserves the gate's elapsed seconds and
exit code. Step numbers correspond to the canonical Makefile's order. Command
labels, file paths, test lines, database output, and arbitrary log contents are
never echoed, including secrets embedded in a marker's command label.

Only a complete newline-terminated `verification attestation: PASS|FAIL at
<revision> (sha256:<hash>)` line produces `ATTESTATION PASS` or `ATTESTATION FAIL`.
A finished step, a zero step exit, EOF, an empty log, an incomplete line, and a
quiet follow interval cannot produce a final result. Without that line the
summary remains `UNKNOWN` or `IN_PROGRESS`; a nonzero `END` still displays its
failure evidence. The observer's exit code is 0 for a successful one-shot read,
1 for an invalid invocation or read failure, and 130 when interrupted in follow
mode. Its exit code is not the verification verdict, including on observed FAIL.

The observer reads incrementally in 64 KiB chunks, retains at most 12 events and
a bounded partial line, and suppresses repeated start/end markers for each step
and repeated attestations. Incomplete lines wait for their newline in follow
mode; lines longer than 4096 characters are discarded. Numeric fields are
bounded (step 1–999, duration up to eight digits, exit up to three digits). An
appended step 1 after a final attestation begins a new observed run and clears
the previous verdict. Prefer separate logs so repeated runs cannot be ambiguous.

The tool reports marker evidence; it does not authenticate a log or validate the
attestation JSON/hash. A forged marker in raw test output can imitate that
evidence. The canonical process's actual exit status determines its result;
retain that result with the candidate identity and criterion observations in
the selected handoff record. Observer output alone cannot prove completion.
It expects an append-only file; do not rotate, replace, or truncate the log while
following. It does not add timestamps or infer elapsed time for a running step.
If observation fails, inspect the original log and canonical process directly.

Focused public CLI checks:

```sh
bun test tests/unit/scripts/verification-progress.test.ts
```
