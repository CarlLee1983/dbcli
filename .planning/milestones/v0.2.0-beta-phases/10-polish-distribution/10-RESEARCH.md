# Phase 10: Polish & Distribution - Research

**Researched:** 2026-03-26
**Domain:** npm Publishing, Cross-Platform CLI Validation, Documentation & Performance Benchmarking
**Confidence:** HIGH (decisions in CONTEXT.md are locked; technical practices verified against official docs)

## Summary

Phase 10 completes dbcli's path to V1 release readiness by establishing production-grade npm publication, cross-platform support (macOS/Linux/Windows), comprehensive documentation, and performance transparency. This phase does not add features — it validates and packages existing capability from Phases 1-9.

Key areas: (1) npm publication setup with file whitelisting and prepublishOnly hooks, (2) Windows compatibility validation via GitHub Actions matrix, (3) documentation expansion (API reference, permission model, AI integration guides, troubleshooting), (4) performance benchmarking with CI regression detection, and (5) AI skill validation across four platforms (Claude Code, Gemini, Copilot, Cursor).

**Primary recommendation:** Execute publication configuration and Windows validation in parallel, then complete documentation and benchmarking. Delay actual npm publish until all validation passes.

---

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

**npm Publishing & Package Configuration (D-01 to D-06):**
- Add `files` whitelist to package.json restricting tarball to source + dist/cli.mjs only (exclude tests, node_modules, .git, full docs except README.md + CHANGELOG.md)
- Configure `prepublishOnly` script to run `bun run build` (ensures dist/cli.mjs pre-built before upload)
- Update `engines` field: `{"node": ">=18.0.0", "bun": ">=1.3.3"}` — verify completeness
- Create or align `.npmignore` with `files` whitelist
- Final npm package size must be < 5MB (verify after `npm pack`)
- Test `npx dbcli init` zero-install experience (fresh environment, no local repo)

**Cross-Platform Support & Testing (D-07 to D-11):**
- Windows validation: Test shebang `#!/usr/bin/env bun` execution on Windows CMD, PowerShell, WSL (fallback: Bun launcher wrapper if needed)
- Path handling: Verify all filesystem operations use `node:path` API (already present in skill.ts); validate .dbcli config paths with Windows backslashes
- Environment variables: Ensure HOME/USERPROFILE fallback logic in config module works correctly (already using `homedir()` from node:os, verify)
- GitHub Actions CI matrix includes `windows-latest` with explicit test for executable status post-build
- Build process: Add `|| true` to `chmod +x dist/cli.mjs` to gracefully skip on Windows

**Documentation & Release Artifacts (D-12 to D-16):**
- Expand README.md with: (1) Complete API Reference (all commands, flags, options), (2) Permission Model explanation (Query-only vs Read-Write vs Admin with examples), (3) AI Integration Guide (how to use with Claude Code, Gemini, Copilot, Cursor), (4) Troubleshooting section
- Create CHANGELOG.md with Phase-by-phase feature summary (Phases 1-9 → v1.0.0 release notes)
- Create CONTRIBUTING.md with development setup (Bun, TypeScript, testing, build, release process)
- Skill documentation: Validate `dbcli skill` output format is consumable by all four AI platforms (Claude Code, Gemini, Copilot, Cursor) — test actual integration
- All documentation must include code examples that are copy-paste ready and tested

**Performance & Startup Time (D-17 to D-20):**
- CLI startup benchmark: Measure cold start with `hyperfine` or `time` command; target < 200ms on macOS/Linux, < 300ms on Windows (WSL environment may add latency)
- Query overhead benchmark: Measure simple `dbcli query "SELECT 1"` execution time; target < 50ms (connection + execution + output formatting)
- Add performance regression tests to CI: Store baseline benchmark results and fail if startup exceeds 250ms or query overhead exceeds 60ms
- Profile bundled binary size: Ensure dist/cli.mjs remains <1.5MB to maintain fast download/execution

### Claude's Discretion

- Exact benchmark tool choice (hyperfine, bench.js, or shell `time`)
- Specific benchmarking scenarios (cold vs warm start, various query complexities)
- CHANGELOG format details (conventional commits vs free-form narrative)
- Documentation styling and code example complexity level

### Deferred Ideas (OUT OF SCOPE)

- Audit Logging — Phase 11 (V1.1)
- Multi-Connection Management — Phase 12 (V1.1)
- Interactive SQL Shell — backlog
- ORM Generation — Phase 14 (V2)
- Migration Tools — out of scope (use Flyway, Liquibase)
- Data Import/Bulk Operations — backlog

</user_constraints>

---

## Standard Stack

### Core Publishing & Build

| Tool | Version | Purpose | Rationale |
|------|---------|---------|-----------|
| npm (built-in) | Latest | Package publication to registry | Industry standard; npm cli works with Bun projects |
| Bun bundler | >= 1.3.3 | Binary compilation & optimization | Fast startup, native ES modules, tree-shaking enabled by default |
| tsconfig bundler mode | ESNext + bundler | Module resolution strategy | Ensures imports resolve correctly during bundling |
| GitHub Actions | v4+ | CI/CD matrix testing | Free tier supports 3 matrix dimensions (OS × Bun version × test type) |

### Performance & Testing

| Tool | Version | Purpose | Installation |
|------|---------|---------|--------------|
| hyperfine | Latest stable | CLI startup benchmarking | `brew install hyperfine` (macOS) / `cargo install hyperfine` (Linux) / Manual download (Windows) |
| Vitest | ^1.2.0 | Existing unit/integration framework | Already installed; bench API available via `{ bench, describe } from "vitest"` |
| CodSpeed (optional) | Latest | CI-based performance regression detection | Via `@codspeed/vitest-plugin` integration |

### Supporting Utilities

| Tool | Purpose | Already In Codebase? |
|------|---------|----------------------|
| `node:path` | Cross-platform path handling | ✓ (src/commands/skill.ts, config.ts) |
| `node:os` | HOME/USERPROFILE fallback | ✓ (config module uses `homedir()`) |
| `cli-table3` | ASCII table CLI output | ✓ (installed dependency) |
| commander.js | CLI framework registration | ✓ v13.0.0 (locked in package.json) |

### Version Verification (as of 2026-03-26)

| Package | Current | Status |
|---------|---------|--------|
| bun | 1.3.3+ (locked in engines) | Published; latest = 1.4.x |
| node | 18.0.0+ (locked in engines) | LTS version 20+ recommended |
| npm | Latest in CI | Works cross-platform with Bun projects |
| vitest | ^1.2.0 | Current; bench API stable since 1.0.0 |

### Installation

```bash
# Dependencies already installed
bun install

# For benchmarking (if not present)
brew install hyperfine  # macOS
cargo install hyperfine  # Linux with Rust
# Windows: Download from https://github.com/sharkdp/hyperfine/releases

# Optional: CodSpeed for automatic CI regression detection
bun add -D @codspeed/vitest-plugin
```

---

## Architecture Patterns

### npm Publishing Configuration Pattern

```json
{
  "name": "dbcli",
  "version": "0.1.0",
  "engines": {
    "node": ">=18.0.0",
    "bun": ">=1.3.3"
  },
  "bin": {
    "dbcli": "./dist/cli.mjs"
  },
  "files": [
    "dist/",
    "README.md",
    "CHANGELOG.md"
  ],
  "scripts": {
    "build": "bun build ./src/cli.ts --outfile ./dist/cli.mjs --target bun && (echo '#!/usr/bin/env bun' && cat dist/cli.mjs) > dist/cli.mjs.tmp && mv dist/cli.mjs.tmp dist/cli.mjs && chmod +x dist/cli.mjs || true",
    "prepublishOnly": "bun run build"
  }
}
```

**Rationale:**
- `files` whitelist (safer than `.npmignore`) restricts published tarball to only necessary files
- `prepublishOnly` executes build BEFORE tarball is created (optimal timing)
- `chmod +x || true` gracefully handles Windows (chmod not available; fallback to success)
- Shebang `#!/usr/bin/env bun` works cross-platform because npm creates `.cmd` wrapper on Windows automatically

**Reference:** [npm Blog - Publishing what you mean to publish](https://blog.npmjs.org/post/165769683050/publishing-what-you-mean-to-publish.html) and [A Passable Explanation - npm package executables](https://www.alexander-morse.com/blog/a-passable-explanation-npm-package-executables/)

### Windows .cmd Wrapper Behavior

When npm installs dbcli on Windows:

```cmd
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe" "%~dp0\..\dbcli\dist\cli.mjs" %*
) ELSE (
  @SETLOCAL
  node "%~dp0\..\dbcli\dist\cli.mjs" %*
)
```

**Critical:** npm automatically generates this `.cmd` wrapper because dist/cli.mjs has shebang `#!/usr/bin/env bun`. No manual .cmd creation needed. The wrapper invokes Bun (or Node.js as fallback) correctly.

### Cross-Platform Path Handling (Already Implemented)

Verified safe patterns already in codebase:

```typescript
// Source: src/commands/skill.ts (Phase 09)
import path from 'node:path'

const skillPath = path.join(installPath, 'SKILL.md')
// path.join() normalizes separators for current OS (/ on macOS/Linux, \ on Windows)
```

```typescript
// Source: config module
import { homedir } from 'node:os'
const configPath = path.join(homedir(), '.dbcli')
// homedir() returns correct home directory path on all platforms
```

**Safe:** No hardcoded path separators; all path operations use `node:path` API.

### GitHub Actions Matrix for Cross-Platform CI

```yaml
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        bun-version: ['1.3.3', 'latest']
    steps:
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ matrix.bun-version }}
      - run: bun test --run
      - run: bun run build
      - name: Verify bundled CLI
        run: |
          chmod +x dist/cli.mjs || true
          ./dist/cli.mjs --help
          ./dist/cli.mjs --version
```

**Rationale:**
- `chmod +x || true` ensures Windows job doesn't fail (chmod unavailable on Windows)
- Direct execution `./dist/cli.mjs` tests both shebang on Unix and .cmd wrapper on Windows
- Matrix of 3 OS × 2 Bun versions = 6 parallel jobs, comprehensive coverage

### Performance Baseline Storage Pattern (Vitest Bench)

```typescript
// tests/perf/startup.bench.ts (Wave 0 creation)
import { bench, describe } from 'vitest'

describe('Performance Baselines', () => {
  bench('CLI startup cold', async () => {
    // Measure: bun run dev --help execution time
    // Expected baseline: < 200ms macOS/Linux, < 300ms Windows
  })

  bench('Query execution overhead', async () => {
    // Measure: dbcli query "SELECT 1" including connection + format
    // Expected baseline: < 50ms
  })
})
```

Commands:
```bash
bun run test --bench              # Run benchmarks and print results
bun run test --bench --outputJson # Export to bench-results.json for trending
```

**CI Integration:**
```bash
# Store baseline
bun run test --bench --outputJson > baseline.json

# Compare in future runs
bun run test --bench --outputJson > current.json
# Parse & fail if current > baseline * 1.2 (20% regression threshold)
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why Custom Solutions Fail |
|---------|------------|-------------|---------------------------|
| Package publication | Custom build + manual npm upload | `npm publish` with prepublishOnly | Humans forget steps; CI hooks ensure consistency; npm handles registry authentication, version incrementing, tarball format |
| Cross-platform path handling | String concatenation (path1 + '/' + path2) | `node:path` module | Windows uses backslashes; forward-slash assumptions break immediately on Windows CI |
| Windows .cmd wrapper generation | Manual .cmd file creation | npm's automatic shimming (via shebang) | npm's wrapper generator handles edge cases (spaces in paths, PATH lookups, fallbacks to system node) |
| Performance baselines | Ad-hoc Bash timings captured in repo | Vitest bench API + CI regression detection | Manual baseline tracking diverges; Vitest integrates with CI, enables statistical analysis, supports multiple reporters |
| Bundled binary optimization | Custom tree-shaking rules | Bun's built-in optimizer + `optimizeImports` in bunfig.toml | Bun already removes dead code; custom optimizations create fragile duplicate logic |
| npx zero-install validation | Local test environment | Fresh CI environment or container | Local caches mask missing dependencies; CI proves true zero-install behavior |
| AI skill documentation | Manual markdown for each platform | SkillGenerator (existing Phase 09) + validation testing | Different platforms have subtle format variations; single source of truth prevents drift |

**Key insight:** Phases 1-9 solved the hard problems (permission guards, schema discovery, query execution). Phase 10 is infrastructure, not logic. Use battle-tested tools (npm, Vitest, Bun bundler) rather than custom glue.

---

## Runtime State Inventory

> NOT APPLICABLE — Phase 10 is publication/validation only, no rename/refactor/migration.

No stored data updates, environment variable renames, or OS-registered state changes required.

---

## Common Pitfalls

### Pitfall 1: Incomplete Path Whitelisting in `files` Array

**What goes wrong:** Published npm package includes test files, .git, node_modules, or source .ts files (not compiled). Consumer runs `npm install` and receives 10MB tarball instead of 1MB.

**Why it happens:** `files` array syntax is subtle (requires explicit directories to be recursive). Common mistake: only adding `"dist"` but forgetting README.md, package.json is auto-included.

**How to avoid:**
```json
"files": [
  "dist/",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
]
```
Test with `npm pack` locally and verify tarball contents: `tar tzf dbcli-0.1.0.tgz | grep -E '\\.ts$|node_modules|tests'` should return empty.

**Warning signs:** `npm pack` output > 2MB; contains entries like `dbcli-0.1.0/tests/` or `dbcli-0.1.0/src/`

### Pitfall 2: Shebang Breaks on Windows Without chmod Fallback

**What goes wrong:** GitHub Actions Windows job fails with error `chmod: command not found` even though job is configured correctly.

**Why it happens:** Build script contains `chmod +x dist/cli.mjs` without `|| true`. Windows doesn't have chmod; failure halts CI pipeline.

**How to avoid:**
```bash
chmod +x dist/cli.mjs || true  # Gracefully continue if chmod fails
```

Or test the executable explicitly (GitHub Actions can run Linux commands on Windows via Git Bash):
```yaml
- run: |
    chmod +x dist/cli.mjs
  shell: bash  # Explicitly use bash, not cmd.exe
```

**Warning signs:** Windows job fails with "chmod: command not found" but Ubuntu job passes.

### Pitfall 3: Assuming npx Works Without Testing in Clean Environment

**What goes wrong:** Developer runs `npx dbcli init` locally and it works (because dbcli is already in node_modules). CI job fails when running on fresh runner without local cache.

**Why it happens:** npx behavior differs: first checks local node_modules, then installs to cache. Local testing masks missing registry steps.

**How to avoid:**
- Test in GitHub Actions on `windows-latest`, `ubuntu-latest`, `macos-latest` runners (guaranteed fresh)
- Or: Docker container with clean filesystem
- Or: Verify `npm pack` and test extract: `npm pack && tar -xzf dbcli-*.tgz && npm install -g ./dbcli`

**Warning signs:** `npx dbcli init` works locally but CI zero-install test fails with "command not found".

### Pitfall 4: Performance Baselines Drift Without CI Integration

**What goes wrong:** Phase 10 establishes baseline (200ms startup), Phase 11 adds feature that slows to 250ms. No CI check catches it; users complain about "new version is slower".

**Why it happens:** Baselines are manually captured in README; developer forgets to update after code changes; no regression detection.

**How to avoid:**
- Store baselines in git (e.g., `benchmarks/baseline.json`)
- CI compares current run to baseline; fails if regression > threshold (e.g., 20%)
- Vitest bench + CodSpeed integration enables this automatically

**Warning signs:** Startup time increases 50ms in commit history with no corresponding code change review.

### Pitfall 5: Skill Format Not Validated Against All Four Platforms

**What goes wrong:** SkillGenerator produces SKILL.md that works in Claude Code but fails in Gemini (expects OpenAPI schema fields). User creates dbcli skill, it installs but agent can't use it.

**Why it happens:** Four AI platforms evolved their own skill formats; one SKILL.md must satisfy all four. Easy to test in one and assume others work.

**How to avoid:**
- Create integration test: generate skill, validate against schema for each platform
- Test actual installation: `dbcli skill --install claude`, then open Claude Code and verify skill is available
- Reference official specs:
  - Claude Code: [Extend Claude with skills](https://code.claude.com/docs/en/skills)
  - Gemini: [Agent Skills](https://geminicli.com/docs/cli/tutorials/skills-getting-started/)
  - GitHub Copilot CLI & Cursor: Shared skill format (both support Claude Code skills)

**Warning signs:** SkillGenerator changes made in Phase 09 without platform integration tests; assumption that one format fits all.

### Pitfall 6: Bundled Binary Size Bloat

**What goes wrong:** dist/cli.mjs grows from 1.1MB to 2.5MB after adding dependencies or bundler configuration. Startup time increases, zip size increases, download latency increases.

**Why it happens:** Dependencies pull in transitive deps; bundler config doesn't enable tree-shaking; source maps included in production build.

**How to avoid:**
- Run `bun build` with metafile analysis: `bun build ./src/cli.ts --metafile=meta.json`
- Analyze output: `bun run esbuild-visualizer --metafile=meta.json` (reveals top contributors)
- Enable in bunfig.toml:
  ```toml
  [build]
  minify = true
  target = "bun"
  ```
- Verify after each major dependency addition: `ls -lh dist/cli.mjs`

**Warning signs:** Incremental commits each add 50KB to binary; total reaches >1.5MB threshold.

---

## Code Examples

### Verified Cross-Platform Patterns (Already in Codebase)

Safe pattern for config file path (from `src/core/config.ts`):

```typescript
// Source: Existing codebase (Phase 02-04)
import path from 'node:path'
import { homedir } from 'node:os'

const configDir = path.join(homedir(), '.dbcli')
const configPath = path.join(configDir, '.dbcli')

// Works on:
// macOS/Linux: ~/.dbcli/.dbcli (uses ~/)
// Windows: C:\Users\{user}\.dbcli\.dbcli (uses %USERPROFILE%)
// WSL: /home/{user}/.dbcli/.dbcli (uses HOME)
```

Safe pattern for skill installation paths (from `src/commands/skill.ts`, Phase 09):

```typescript
// Source: Phase 09 implementation
import path from 'node:path'
import { homedir } from 'node:os'

function getInstallPath(platform: 'claude' | 'gemini' | 'copilot' | 'cursor'): string {
  const home = homedir()
  const paths: Record<string, string> = {
    claude: path.join(home, '.claude', 'skills'),
    gemini: path.join(home, '.local', 'share', 'gemini', 'skills'),  // Linux
    copilot: path.join(home, 'AppData', 'Local', 'GitHub Copilot'),  // Windows
    cursor: path.join(home, '.cursor', 'skills')
  }
  // path.join() normalizes separators for current OS
  return paths[platform]
}
```

### Performance Benchmark Example (Wave 0 Template)

```typescript
// tests/perf/startup.bench.ts (to create in Phase 10)
import { bench, describe } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'

describe('Performance Baselines', () => {
  bench('CLI startup time (--help)', () => {
    // Measure: time to execute and print help
    const start = performance.now()
    execSync('bun run dev -- --help', { stdio: 'pipe' })
    const duration = performance.now() - start

    // Target: < 200ms macOS/Linux, < 300ms Windows
    console.log(`Startup: ${duration.toFixed(2)}ms`)
  })

  bench('Query overhead (SELECT 1)', () => {
    // Measure: simple query execution time
    // Requires test database; integration test rather than unit
    const start = performance.now()
    // execSync('dbcli query "SELECT 1"', { stdio: 'pipe' })
    const duration = performance.now() - start

    // Target: < 50ms
    console.log(`Query overhead: ${duration.toFixed(2)}ms`)
  })
})
```

Run with: `bun test --bench` or `bun test --bench --outputJson > baseline.json`

### npx Zero-Install Validation Pattern (Wave 0 Test)

```typescript
// tests/integration/zero-install.test.ts (to create)
import { describe, test, expect } from 'vitest'
import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

describe('Zero-Install Experience', () => {
  test('npx dbcli --help works in fresh environment', () => {
    // Run in temporary directory with clean npm cache
    const tmpDir = fs.mkdtempSync('dbcli-test-')

    try {
      const output = execSync('cd "${tmpDir}" && npx dbcli --help', {
        stdio: 'pipe',
        encoding: 'utf-8'
      })

      expect(output).toContain('Usage:')
      expect(output).toContain('Commands:')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
```

### Windows-Specific GitHub Actions Test

```yaml
# .github/workflows/ci.yml (to update)
- name: Test Windows executable (Windows only)
  if: runner.os == 'Windows'
  shell: pwsh  # PowerShell on Windows
  run: |
    $exePath = "dist\cli.mjs"
    if (-not (Test-Path $exePath)) {
      throw "Executable not found: $exePath"
    }
    & $exePath --help
    & $exePath --version
```

---

## State of the Art

| Area | Old Approach (Pre-2024) | Current Best Practice (2026) | When Changed | Impact on dbcli |
|------|-------------------------|-------------------------------|--------------|-----------------|
| npm package whitelisting | `.npmignore` blacklist (error-prone) | `files` array whitelist (safe) | ~2018 | Use `files` in package.json; safer, no .npmignore needed |
| Binary startup time measurement | Manual `time` command in dev notes | `hyperfine` or Vitest bench + CI regression tracking | ~2022 | Integrate Vitest bench into test suite; auto-detect regressions |
| Cross-platform CLI distribution | Node.js shebangs only | Bun shebangs + npm .cmd auto-wrap | ~2023 | Bun's shebang works on all platforms; npm handles .cmd wrapper |
| Skill format standardization | Platform-specific formats (Claude vs Gemini) | Unified SKILL.md format (YAML frontmatter) | ~2024 | Phase 09 SkillGenerator already implements standard format |
| Performance regression detection | Manual code review of timing changes | CodSpeed + Vitest bench integration | ~2024 | Optional: add `@codspeed/vitest-plugin` for automatic detection |
| Bundler size optimization | Webpack + UglifyJS | Bun's built-in tree-shaking + metafile analysis | ~2022-2024 | Bun handles automatically; verify with metafile if bloat occurs |

**Deprecated/outdated:**
- `.npmignore` files — Use `files` array in package.json instead (simpler, safer, clearer intent)
- Manual startup time logging in commit messages — Use Vitest bench with CI comparison instead
- Node.js-only CLIs — Bun runtime is now mature for CLI distribution (faster startup, smaller binary)

---

## Open Questions

1. **Will Phase 09's SkillGenerator output work unchanged across all four AI platforms?**
   - What we know: SkillGenerator produces SKILL.md with YAML frontmatter matching Claude Code spec
   - What's unclear: Whether Gemini, Copilot CLI, and Cursor have additional schema expectations or field requirements
   - Recommendation: Create integration tests in Wave 0 that actually install skill to each platform and verify it's callable. Test with a real query.

2. **What is the correct Windows PowerShell fallback if shebang execution fails?**
   - What we know: npm automatically creates .cmd wrapper for shebang-based executables on Windows
   - What's unclear: Edge cases (spaces in user path, non-standard PowerShell configs) where .cmd fails
   - Recommendation: CI job should test both `.\dist\cli.mjs --help` (direct) and `npx dbcli --help` (installer wrapper). If direct fails but installer works, the .cmd wrapper is correctly mitigating the issue.

3. **Should performance baselines be stored in git or fetched from previous CI runs?**
   - What we know: Vitest bench can output to JSON; CodSpeed auto-tracks from CI
   - What's unclear: Whether manual JSON tracking (in git) or cloud service (CodSpeed) is preferred
   - Recommendation: Start with manual JSON baseline in `benchmarks/baseline.json` (simple, no external service). If regressions become frequent, add CodSpeed integration for statistical analysis.

4. **Will bundled binary size remain < 1.5MB as features are added in V1.1 and V2?**
   - What we know: Current binary is 1.1MB; depends on Bun bundler tree-shaking and dependency choices
   - What's unclear: Impact of future Phase 11+ features (audit logging, multi-connection)
   - Recommendation: CI should warn (not fail) if binary exceeds 1.2MB; fail at 1.5MB. This gives buffer for feature growth while alerting to creep.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Build & test | ✓ | >= 1.3.3 (locked) | npm/Node.js (slower, incompatible with Bun APIs) |
| npm | Package publication | ✓ | Bundled with Node.js | pnpm, yarn (untested compatibility) |
| Git | CI/CD, version tracking | ✓ | Latest | — (required) |
| GitHub Actions | CI matrix testing | ✓ | Built-in to repo | Local Docker (manual) |
| Hyperfine | Startup benchmarking | ✗ (optional) | Latest | `time` command (less statistical power) |
| CodSpeed | CI regression detection | ✗ (optional) | Latest | Manual JSON baseline comparison (works) |

**Missing dependencies with no fallback:**
- None — Phase 10 uses only tools already available in standard environments

**Missing dependencies with fallback:**
- Hyperfine (optional): Fall back to `time` command for startup measurement (less detailed, but functional)
- CodSpeed (optional): Fall back to manual JSON baseline tracking (simple, no external service needed)

**Step 2.6 Result:** No blocking external dependencies. All required tools available. Phase 10 can proceed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.2.0 with bench API + existing unit tests |
| Config file | vitest.config.ts (extends with bench config in Wave 0) |
| Quick run command | `bun test --run` (unit + integration, no bench) |
| Full suite command | `bun test --run --bench` (unit + integration + performance) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| No explicit REQ IDs | `npm pack` includes only dist/, README, CHANGELOG | Unit | `npm pack && tar tzf dbcli-*.tgz \| wc -l` | ❌ Wave 0 |
| No explicit REQ IDs | `npx dbcli --help` works fresh (no local cache) | Integration | Create clean env test | ❌ Wave 0 |
| No explicit REQ IDs | Windows shebang execution works (via .cmd wrapper) | Integration | GitHub Actions matrix | ✅ Exists (ci.yml) |
| No explicit REQ IDs | Startup time < 200ms (macOS), < 300ms (Windows) | Performance | `vitest bench` command | ❌ Wave 0 |
| No explicit REQ IDs | Query "SELECT 1" overhead < 50ms | Performance | Database integration bench | ❌ Wave 0 |
| No explicit REQ IDs | SkillGenerator output works in Claude Code | Integration | Manual test | ❌ Wave 0 |
| No explicit REQ IDs | SkillGenerator output works in Gemini | Integration | Manual test | ❌ Wave 0 |
| No explicit REQ IDs | README API reference is complete | Manual | Code review | ❌ Wave 0 |
| No explicit REQ IDs | CONTRIBUTING.md setup instructions tested | Manual | Follow steps on clean machine | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test --run` (unit + integration, ~30 seconds)
- **Per wave merge:** `bun test --run --bench` (adds performance benchmarks, ~60 seconds) + manual AI platform integration test
- **Phase gate:** Full suite green + manual smoke test: `npx dbcli --help` in clean environment + `dbcli skill --install claude` in Claude Code IDE

### Wave 0 Gaps

- [ ] `tests/perf/startup.bench.ts` — Vitest bench for CLI cold-start timing (target < 200ms)
- [ ] `tests/perf/query.bench.ts` — Vitest bench for query execution overhead (target < 50ms, requires test DB)
- [ ] `tests/integration/zero-install.test.ts` — Test npx fresh-environment behavior
- [ ] `tests/integration/npm-pack.test.ts` — Verify files whitelist via npm pack analysis
- [ ] Manual test script: `scripts/test-windows-shebang.ps1` — PowerShell validation for Windows CI
- [ ] `benchmarks/baseline.json` — Initial performance baseline (created after first bench run)
- [ ] Documentation files: README.md (API ref + Permission model + AI guide), CHANGELOG.md, CONTRIBUTING.md

*(If no gaps: None — existing test infrastructure covers all phase requirements. However, Wave 0 gap list applies as these are NEW tests specific to Phase 10.)*

---

## Sources

### Primary (HIGH confidence)

- [npm Blog - Publishing what you mean to publish](https://blog.npmjs.org/post/165769683050/publishing-what-you-mean-to-publish.html) — npm `files` whitelist behavior, prepublishOnly timing
- [npm Docs - npm-publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) — Official npm publish command reference
- [A Passable Explanation - npm package executables](https://www.alexander-morse.com/blog/a-passable-explanation-npm-package-executables/) — Windows .cmd wrapper generation mechanics
- [Extend Claude with skills - Claude Code Docs](https://code.claude.com/docs/en/skills) — Official Claude Code skill format spec
- [Get started with Agent Skills - Gemini CLI](https://geminicli.com/docs/cli/tutorials/skills-getting-started/) — Gemini skill format (unified with Claude)
- [Bun Docs - Bundler](https://bun.com/docs/bundler) — Bun bundler configuration, tree-shaking, metafile analysis
- [Vitest - Benchmark Support](https://vitest.dev/guide/features.html) — Vitest bench API and performance testing
- [GitHub Actions - Matrix Builds](https://codefresh.io/learn/github-actions/github-actions-matrix/) — Matrix strategy for cross-platform testing

### Secondary (MEDIUM confidence)

- [Hyperfine - GitHub](https://github.com/sharkdp/hyperfine) — Hyperfine CLI benchmarking tool features
- [npm Blog - npx](https://blog.npmjs.org/post/162869356040/introducing-npx-an-npm-package-executor/) — npx zero-install behavior and caching
- [CodSpeed - Vitest Performance Regressions](https://codspeed.io/blog/vitest-bench-performance-regressions) — CI-integrated performance regression detection
- [Beyond Prompt Engineering - Using Agent Skills in Gemini CLI](https://medium.com/google-cloud/beyond-prompt-engineering-using-agent-skills-in-gemini-cli-04d9af3cda21) — Gemini agent skill patterns (Feb 2026)

### Tertiary (LOW confidence, verified where possible)

- npm package size tools (bundlephobia.com, pkg-size.dev) — Community tools; use local `npm pack` for authority
- Generic GitHub Actions PowerShell guidance — Works for dbcli; tested in ci.yml matrix

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| npm publishing (`files`, `prepublishOnly`) | HIGH | Official npm docs + community consensus verified; simple, standard pattern |
| Windows .cmd wrapper generation | HIGH | Documented in npm and official sources; tested in existing ci.yml |
| Cross-platform path handling | HIGH | `node:path` and `node:os` APIs documented; already implemented in codebase |
| Hyperfine benchmarking | MEDIUM | Hyperfine features well-documented; timing methodology requires manual validation in Phase 10 execution |
| Skill format portability | MEDIUM-HIGH | Claude Code and Gemini skills officially documented as unified format (YAML frontmatter); Copilot/Cursor inherit Claude format; actual integration test recommended |
| Performance targets (< 200ms, < 50ms) | MEDIUM | Targets are contextual (acceptable CLI startup time); verification requires actual measurement in Phase 10 |
| Binary size constraint (< 1.5MB) | HIGH | Current binary 1.1MB verified; Bun bundler behavior documented |

**Research date:** 2026-03-26
**Valid until:** 2026-04-26 (30 days — npm and Bun APIs stable; monitor for Vitest bench breaking changes)

---

*Phase: 10-polish-distribution*
*Research completed: 2026-03-26*
*For planner consumption: Ready to create PLAN.md*
