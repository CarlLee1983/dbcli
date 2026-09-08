# Acceptance Criteria

Every criterion names the evidence that decides it: a command and the result
that counts as passing.

## Happy Path

* [ ] A passing `make verify` leaves `.verification/attestation.json`.
      Evidence: run it, then `test -f .verification/attestation.json` → exit `0`.
* [ ] The attestation names the revision that was verified.
      Evidence: its `revision` equals `git rev-parse HEAD` at the time of the
      run, as 40 lowercase hex characters, and `dirty_worktree` is `false`.
* [ ] It states the command and the outcome.
      Evidence: `command` is `make verify`, `result` is `PASS`, `exit_code` is
      `0`.
* [ ] It is machine-readable without a schema guess.
      Evidence: `schema_version` is `1`; a reader given `schema_version: 2`
      refuses the document rather than reading the fields it recognises.
* [ ] The document travels off the machine that produced it.
      Evidence: the CI `integration` job uploads it; the artifact is
      downloadable from the workflow run, and its `revision` is the commit CI
      checked out. The artifact's name states no revision — `github.sha` and the
      attestation's own `revision` agree only by the checkout's configuration,
      and a name that could contradict the file it names is worse than one that
      says nothing.

## Business Rules

* [ ] A failing `make verify` still writes an attestation, and still fails.
      Evidence: break one step deliberately, run, then confirm `result` is
      `FAIL` with the step's non-zero `exit_code`, and that `make verify` itself
      exited non-zero. This is the criterion the Story exists for; a PASS-only
      attestation records the case nobody needs.
* [ ] A dirty worktree produces an attestation that says so.
      Evidence: with an uncommitted change present, `dirty_worktree` is `true`
      and `revision` is still the committed SHA — the document never implies the
      commit was what ran.
* [ ] The same run serialises to the same bytes.
      Evidence: serialise one run's attestation twice; `cmp` reports no
      difference. Keys are in the schema's fixed order, endings are LF, and the
      file ends with exactly one newline.
* [ ] `attestation_hash` is the identity of the content.
      Evidence: it is `sha256:` plus the digest of the canonical bytes with the
      hash field removed; recomputing it from the file reproduces the value, and
      changing any field changes it.
* [ ] Every step of `make verify` is still present, in order, and still
      blocking.
      Evidence: `tests/contract/forgepilot-boundary.test.ts` passes with its
      `REQUIRED_STEPS` roster showing the same steps in the same order, and no
      step gains `-`, `|| true`, or `continue-on-error`.
* [ ] The attestation is never committed.
      Evidence: `git check-ignore .verification/attestation.json` → exit `0`,
      and `git status --porcelain` is empty immediately after a `make verify`
      run — the property ForgePilot's clean-worktree requirement depends on.
* [ ] The writer is repository tooling, not product.
      Evidence: no file under `src/` references it; `npm pack --dry-run` lists
      no `.verification` or attestation-writer path.
* [ ] Staleness is the reader's answer, not the document's.
      Evidence: the schema has no `current`, `stale`, or `applies_to_head`
      field; the only revision statement is `revision`.

## Failure Cases

* [ ] A repository where `git rev-parse HEAD` fails produces no attestation.
      Evidence: the writer exits non-zero naming the missing revision, and no
      file is written — an attestation with an unknown revision attests nothing.
* [ ] An unwritable output path does not change the verification result.
      Evidence: with `.verification` at mode `555` and no attestation file
      present, the recipe's shell reports `EACCES` and still exits with the
      verification's own status.
* [ ] A failure in the phase that runs *before* the first step does not change
      the verification result either.
      Evidence: with `git` replaced by a stub that exits `1`, `begin` reports
      that there is no revision to attest, `finish` reports that it was given
      nothing, every step still runs, and the recipe exits with the
      verification's own status. This is the direction the first implementation
      got wrong: `begin` was a blocking recipe line, so an unwritable directory
      failed the target before a single step ran.
* [ ] A truncated or malformed attestation is refused by the reader, not
      partially read.
      Evidence: a fixture with a removed required field fails parsing with the
      field named.

## Regression Requirements

* [ ] `make verify` passes on the delivered commit, run by ForgePilot in a
      detached worktree of that exact revision, and that run's own attestation
      names the same revision.
* [ ] `bun run forgeflow:check` still passes, and DBCLI-016's refusal rules are
      untouched.
* [ ] No dbcli source file or package manifest gains a reference to ForgePilot,
      and nothing reads `.forgepilot/`.
      Evidence: `tests/contract/forgepilot-boundary.test.ts`, plus a search for
      `.forgepilot` under `src/` and `scripts/` returning only prose — no
      `readFile`, `Bun.file`, `import`, or path join reaching into it.

## Security Fixture Matrix

Every row is a required case. The expected result is one of `preserve`,
`redact`, `reject`, or `omit`.

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `env.DBCLI_PASSWORD` | `hunter2` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `env.GITHUB_TOKEN` | `ghp_000000000000000000000000000000000000` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `env.CI` | `azure-pipelines` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `env.USER` | `carl` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `cwd` | `/Users/carl/Dev/CMG/Dbcli` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `hostname` | `carls-macbook-air.local` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `step.stderr` | `error: connect ECONNREFUSED 127.0.0.1:5432` | omit | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |
| `git.revision` | `980cc078b850f799615dce51b2993141b85c40c7` | preserve | `.verification/attestation.json` | `tests/unit/scripts/verification-attestation.test.ts` |

`env.CI` is `omit` for its *value*: the document records only whether the
variable was present, as a boolean. The payload is deliberately not the literal
`true` most providers set — as a substring that is indistinguishable from the
boolean the schema records, so it could not tell a copied value from a correctly
derived one. Copying the value would be one field's worth of harmless CI output
today and an arbitrary string from a caller tomorrow.

`step.stderr` is `omit` in this Story and stays that way. Per-step detail is
DBCLI-019's, and whatever it records will have to answer this same question
about unbounded command output.

## Verification Notes

The FAIL criterion cannot be proven by a passing run. Break a step on a scratch
branch, capture the attestation, and record it in the delivery report; do not
leave a broken step behind.

The CI upload criterion is proven by the workflow run for this Story's own pull
request. Record the run URL and the artifact name.

`make verify` is the authority for this Story as for every other one. The
attestation records what it decided; it never decides anything.
