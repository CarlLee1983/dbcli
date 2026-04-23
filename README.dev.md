# Development Guide

Scoped package: **`@carllee1983/dbcli`**. All `npm` / `npx` examples below use this name.

## npm Publishing Process

### Pre-Publication Checklist

Before running `npm publish`:

1. **Verify build is clean:**
   ```bash
   bun run build
   ls -lh dist/cli.mjs   # expect a few MB (bundled CLI + dependencies)
   ```

2. **Verify tests pass (pick one):**
   ```bash
   # Fast path: unit + core only (matches CI-style smoke)
   bun run test:unit

   # Full suite (Bun test runner)
   bun test
   ```

   For live database integration tests, set an explicit config if needed:
   ```bash
   LIVE_DB_CONFIG_PATH=/path/to/.dbcli bun test tests/integration/live-db.test.ts
   ```

   If no live config is available, `tests/integration/live-db.test.ts` skips
   instead of falling back to the default PostgreSQL configuration. Use
   `SKIP_INTEGRATION_TESTS=true` to skip integration tests when running a broad `bun test`.

3. **Update version in package.json:**
   ```bash
   npm version minor   # bumps version + creates git tag (in this repo)
   # OR edit the "version" field in package.json by hand
   ```

4. **Verify package contents (dry run):**
   ```bash
   npm pack --dry-run
   ```
   Expect **`dist/`** (at least `cli.mjs`), **`assets/`** (e.g. `SKILL.md`, `reference.md` for `dbcli skill`), **`README.md`**, **`CHANGELOG.md`**, **`LICENSE`**, and **`package.json`**. There must be **no** `src/`, `tests/`, or `node_modules/`. The listing may also include other root `README*.md` files (npm can still pack them even when `files` is set); dev-only readmes are listed in **`.npmignore`** — re-check with dry-run if you add or remove docs.

5. **Check package size:**
   ```bash
   npm pack
   ls -lh carllee1983-dbcli-*.tgz   # compressed tarball (typically well under 5MB)
   rm carllee1983-dbcli-*.tgz       # cleanup
   ```

### Publication

Publication uses the `prepublishOnly` script in `package.json`:

```bash
npm publish
```

What runs (conceptually):

1. **`prepublishOnly`:** `bun run build` — rebuilds `dist/cli.mjs` from `src/cli.ts` via `scripts/build.ts`.
2. **Tarball** — paths from the **`files`** field in `package.json`, further filtered by **`.npmignore`**. (Some npm versions also merge in extra root `README*` files; use dry-run to see exactly what will ship.)
3. **Registry** — with `"publishConfig": { "access": "public" }`, the scoped package is published as **public**.

A failed `bun run build` will fail the publish, so you should not ship a stale `dist/` from a previous local build.

### Verification (Post-Publication)

After publishing:

1. **Global install:**
   ```bash
   npm install -g @carllee1983/dbcli
   which dbcli
   dbcli --version
   ```

2. **Zero-install (npx / bunx):**
   ```bash
   cd /tmp && mkdir -p test-dbcli && cd test-dbcli
   npx @carllee1983/dbcli --help
   npx @carllee1983/dbcli --version
   # or: bunx @carllee1983/dbcli --help
   ```

3. **Windows (if available):** `npm install -g @carllee1983/dbcli`, then `dbcli --help`. npm creates the `.cmd` stub for the `bin` entry; no hand-written `.cmd` in the repo.

### Rollback (if needed)

If a bad release must be mitigated:

```bash
npm unpublish @carllee1983/dbcli@<VERSION>
# and/or
npm deprecate @carllee1983/dbcli@<VERSION> "Reason; use <SAFE_VERSION> instead"
```

Then ship a patch version with the fix. Prefer **deprecate** over **unpublish** when consumers may already depend on the version.

### Configuration Details

- **`files` (in `package.json`):** Publishes `dist/`, `assets/`, `README.md`, `CHANGELOG.md`, `LICENSE`. The `assets/` tree is required for `dbcli skill` to copy bundled `SKILL.md` / `reference.md` from the installed package.
- **`prepublishOnly`:** `bun run build` so `dist/cli.mjs` matches current source.
- **`engines`:** Declares `node >= 18.0.0` and `bun >= 1.3.3` so npm can warn on outdated runtimes.
- **Shebang:** `scripts/build.ts` prepends `#!/usr/bin/env bun` to `dist/cli.mjs`; the `bin` field in `package.json` points at that file.
- **Live DB tests:** `tests/integration/live-db.test.ts` uses project `.dbcli` by default or `LIVE_DB_CONFIG_PATH` when you point at another config directory. Set `SKIP_INTEGRATION_TESTS=true` to skip all integration tests.

For contributor workflow and release process, see **[CONTRIBUTING.md](./CONTRIBUTING.md)** and the main **[README.md](./README.md)** Development section.

### Troubleshooting

| Issue | What to do |
|-------|------------|
| `prepublishOnly` / build fails | Fix TypeScript or build errors, run `bun run test:unit`, then `bun run build` again. |
| Tarball unexpectedly large or bloated | Inspect the bundle: e.g. `bun build ./src/cli.ts --outfile=dist/cli.mjs --target=bun --metafile=meta.json` and review the metafile; trim dependencies or dev-only code paths. |
| Windows: `dbcli` not found after global install | Confirm PATH includes npm’s global `bin`; reinstall `npm i -g @carllee1983/dbcli`. |
| `npx` download slow or cache weird | `npm cache clean --force` and retry `npx @carllee1983/dbcli --version`. |
