# Raise the Bun floor to the first version current bson loads on

## Goal

On Bun 1.3.x, any dbcli command that touches MongoDB fails with
`NotImplementedError: node:v8 isBuildingSnapshot is not yet implemented in Bun.`
`mongodb@7.2.0` depends on `bson: "^7.2.0"`, and bson 7.3.0 added a static block
to `ObjectId` that calls
`process.getBuiltinModule('v8').startupSnapshot.isBuildingSnapshot()` on load
(observed at `node_modules/bson/lib/bson.node.mjs:2618` in bson 7.3.3, and absent
from 7.0.0, 7.1.0 and 7.2.0). Running `import("bson")` with bson 7.3.3 throws that
error on Bun 1.3.3 and 1.3.10–1.3.14, and succeeds on Bun 1.4.0–1.4.3.

This repository's `bun.lock` pins bson 7.2.0, so its own tests and the CI row at
Bun `1.3.3` (`.github/workflows/ci.yml:20`) never see the fault. A user
install has no lockfile and resolves bson to the newest 7.x, which is what users
actually run. `package.json:44` still declares `"bun": ">=1.3.3"`, so it promises
support for a runtime that cannot load the MongoDB driver dbcli ships with.

When this Story is done, dbcli declares, tests against, and documents Bun 1.4.0
as its minimum, so the stated floor is a runtime the published dependency range
can actually run on.

## Out of Scope

- Pinning or overriding the bson or mongodb version, or vendoring a patch to bson.
- Any runtime shim or polyfill for `v8.startupSnapshot`.
- Rewriting ADR-0008 or the historical entries in `CHANGELOG.md` that mention 1.3.3.
- Making the CI floor row resolve dependencies without the lockfile.
- Changing which Bun versions `bun.lock` or `make verify` run under locally.

## Acceptance Criteria

1. `package.json` declares `engines.bun` as `">=1.4.0"`.
2. The CI test matrix in `.github/workflows/ci.yml` lists `'1.4.0'` as its
   minimum Bun version in place of `'1.3.3'`.
3. `scripts/postinstall-check-bun.mjs` tells the user to install Bun 1.4.0+, and
   the fallback for `requiredBun` in `src/commands/doctor.ts` is `'1.4.0'`.
4. `README.md`, `README.zh-TW.md`, `README.dev.md`, `CONTRIBUTING.md`,
   `docs/user/en/index.md`, `docs/user/en/index.html`,
   `docs/user/zh-TW/index.md` and `docs/user/zh-TW/index.html` state the
   minimum as 1.4.0: `grep -n "1\.3\.3"` over these eight files prints nothing.
5. `CHANGELOG.md` has an `Unreleased` entry that names the new Bun floor and the
   bson 7.3 `isBuildingSnapshot` failure as its reason.
6. `make verify` passes.
