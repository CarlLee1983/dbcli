# Frozen evidence artifact fixtures

These files are **fixed bytes**, not builder output. Nothing in `src/` may
regenerate them.

The legacy ones were produced by the code that actually shipped, so a test that
reads them proves the current reader recognises artifacts that exist in the
world — not merely that the current builder agrees with itself.

| File | Produced by | Declares |
| --- | --- | --- |
| `legacy-v1-pack.json` | `v2.1.0` `buildEvidencePack` | `version: 1`, `coverage` block, random `evp_` id, digest over `{version,id,createdAt,subject,claims,coverage}` via bare `JSON.stringify` |
| `legacy-v1-receipt-assert.json` | `v2.1.0` `buildEvidenceReceipt` | `version: 1`, `observation.fingerprint` |
| `legacy-v1-receipt-verify.json` | `v2.1.0` `buildEvidenceReceipt` | `version: 1`, `observation.fingerprint` |
| `v3-mislabeled-pack.json` | `v3.0.0` `buildEvidencePack` | `version: 1` **but** the v3 layout: no `coverage`, content-addressed id, sorted-key digest over `{version,subject,claims}` |
| `v3-mislabeled-receipt-assert.json` | `v3.0.0` `buildEvidenceReceipt` | `version: 1` **but** `observation: {kind, checksPassed, checksTotal}` |
| `v3-mislabeled-receipt-verify.json` | `v3.0.0` `buildEvidenceReceipt` | `version: 1` **but** `observation: {kind, status}` |

The v3 files are the reason artifact versioning exists at all: two mutually
incompatible layouts both claiming `version: 1`. See
`docs/adr/0013-evidence-artifact-format-versions-are-independent-of-the-package-version.md`.

Regenerating a legacy fixture defeats its purpose. If one of these ever needs to
change, the change is a new fixture with a new name.
