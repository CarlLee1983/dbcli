# A Verification Attestation is not an Evidence Receipt

* Status: proposed
* Date: 2026-09-08

DBCLI-017 introduces a third evidence-shaped artifact, and the reason it is not
one of the two that already exist is worth writing down before someone
helpfully consolidates them.

An **Evidence Receipt** (`src/core/evidence-receipt/`, defined in `CONTEXT.md`)
records one dbcli operation against a database. A **Verification Artifact**
(`src/core/verification/`) records an `assert`, `snapshot` or
`recovery-verify` run against data. Both are product: shipped to users,
versioned by constants the package publishes, consumed by agents operating
databases.

A **Verification Attestation** records one run of this repository's `make
verify` against one revision. Its subject is a commit, not a database. Its
consumer is a reviewer, a CI job, or ForgePilot — never a dbcli user. Its
lifecycle is this repository's engineering process. Folding it into either
existing format would move a published schema version for reasons no user can
observe, and would ship process tooling to people who install dbcli to talk to
their database. So it lives under `scripts/`, is absent from the package, and
carries its own `schema_version`.

The name matters as much as the boundary. `CONTEXT.md` already defines
"evidence receipt" and "evidence pack"; calling this one an Evidence Receipt
would give one term two subjects, which is the failure the domain vocabulary
exists to prevent. "Attestation" appears nowhere in dbcli or ForgePilot.

## The repository writes it, not ForgePilot

The obvious design is `forgepilot evidence export`. It does not exist:
ForgePilot's commands at `8ce2c12` are `init`, `migrate`, `goal`, `work`,
`next`, `start`, `verify`, `gate`, `review` and `status`, and its development
plan contains no export. Waiting would put this repository's delivery on another
repository's schedule; reading `.forgepilot/state.json` would couple dbcli to
ForgePilot's internal format, which DBCLI-014 forbade.

So `make verify` writes it — the only participant that observes the result
first-hand — and ForgePilot, CI, or a human reads the file afterwards. The
integration is a file at a known path with a versioned schema. Nothing imports
anything, and dbcli keeps working with no ForgePilot installed.

## What the attestation deliberately does not say

It carries no Work Item ID and no Story reference, though both were asked for
and the omission was put to the human who asked, and accepted on 2026-09-08.
`make verify` does not know them, and a field a producer cannot verify is a
field that records whatever the caller claimed. ForgePilot already binds
evidence to work by revision; it can bind this the same way. This is a deferred
decision, not a permanent refusal: it reopens if a consumer appears that needs
the link and cannot compute it from the revision, and the shape it would take is
a caller-supplied `context` object marked explicitly as unattested.

It carries no repository name, for the same reason one level quieter. That field
was a hardcoded constant — validated against a pattern, never observed — so it
recorded what the author typed rather than where the run happened. Deriving it
from `git remote get-url origin` would have been worse than leaving it: a remote
URL can carry credentials, and keeping secrets out of the document is a rule this
Story states outright. A commit SHA identifies its subject without help.

It carries no staleness. The document states a revision; whether that revision
is still HEAD is a question with a different answer every time it is asked, and
an artifact that answers it is wrong immediately after being written.

**Falsified if:** the attestation gains a field the producer did not observe —
handed at call time, or fixed at authoring time as `repository` was — or a
second producer starts writing the document, anything other than `scripts/`'s
writer invoked by `make verify`. Either means the artifact has stopped being a
statement the repository can make about its own run, and the reason for keeping
it out of `src/core/evidence-receipt` no longer holds.
