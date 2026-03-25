# Development Guide

## npm Publishing Process

### Pre-Publication Checklist

Before running `npm publish`:

1. **Verify build is clean:**
   ```bash
   bun run build
   ls -lh dist/cli.mjs  # Should be 1.0-1.5MB
   ```

2. **Verify test suite passes:**
   ```bash
   bun test --run unit/
   ```

3. **Update version in package.json:**
   ```bash
   npm version minor  # Updates package.json version + creates git tag
   # OR manually update "version" field in package.json
   ```

4. **Verify package contents (dry run):**
   ```bash
   npm pack --dry-run
   # Should list only: dist/*, README.md, CHANGELOG.md, package.json
   ```

5. **Check package size:**
   ```bash
   npm pack
   ls -lh dbcli-*.tgz  # Must be < 5MB
   rm dbcli-*.tgz      # Cleanup
   ```

### Publication

The publication process is automated by npm hooks:

```bash
npm publish
```

This invokes (in order):
1. `prepublishOnly` hook: Runs `bun run build` → ensures fresh dist/cli.mjs
2. npm creates tarball with `files` whitelist → only intended files included
3. npm applies `.npmignore` rules → additional safety layer
4. npm publishes to registry

**Note:** The build CANNOT be skipped. If you try to publish with a stale dist/cli.mjs, prepublishOnly will rebuild it.

### Verification (Post-Publication)

After publishing:

1. **Test installation globally:**
   ```bash
   npm install -g dbcli
   which dbcli  # Should show: /usr/local/bin/dbcli or similar
   dbcli --version
   ```

2. **Test zero-install (npx):**
   ```bash
   cd /tmp
   mkdir test-dbcli && cd test-dbcli
   npx dbcli --help
   npx dbcli --version
   ```

3. **Test Windows installation (if available):**
   - On Windows machine: `npm install -g dbcli`
   - Verify: `dbcli --help` and `dbcli --version` work
   - npm creates .cmd wrapper automatically; no manual .cmd needed

### Rollback (if needed)

If critical bug discovered after publishing:

```bash
npm unpublish dbcli@VERSION  # Remove specific version
# OR
npm deprecate dbcli@VERSION "Critical bug; use VERSION-1"  # Mark as deprecated
```

Then publish a patch fix.

### Configuration Details

- **files whitelist (package.json):** Restricts tarball to source only
  - Includes: dist/, README.md, CHANGELOG.md, LICENSE
  - Excludes: src/, tests/, node_modules/, .git/, docs/
- **prepublishOnly hook:** Ensures build runs before pack
  - Prevents stale binaries from being published
  - Runs automatically; cannot be skipped with --no-scripts
- **engines field:** Declares minimum Node >=18.0.0, Bun >=1.3.3
  - npm warns if consumer's environment is too old
- **Cross-platform support:** Shebang `#!/usr/bin/env bun` works on all platforms
  - macOS/Linux: Direct shebang execution
  - Windows: npm creates .cmd wrapper automatically (no manual creation needed)

### Troubleshooting

| Issue | Solution |
|-------|----------|
| prepublishOnly fails (build error) | Fix TypeScript errors in src/, run `bun test --run unit/`, retry `npm publish` |
| Package size > 5MB | Run `bun build --metafile=meta.json`, analyze output, remove unused dependencies |
| Windows installation fails | Verify shebang is `#!/usr/bin/env bun` in dist/cli.mjs; npm's .cmd wrapper will be created automatically |
| npx hangs or times out | Run `npm cache clean --force`, retry `npx dbcli` |
