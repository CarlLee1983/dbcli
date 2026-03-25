# Phase 10: Polish & Distribution - Context

**Gathered:** 2026-03-26 (assumptions mode)
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete cross-platform validation, npm publication configuration, comprehensive documentation, and performance benchmarking to achieve V1 release quality. Covers: package publication setup, Windows compatibility testing, documentation expansion (API reference, Permission model, AI integration guide), and CLI performance benchmarking with CI integration.

</domain>

<decisions>
## Implementation Decisions

### npm Publishing & Package Configuration
- **D-01:** Add `files` whitelist to package.json to restrict npm tarball to source-only (exclude tests, node_modules, .git, docs except README.md, CHANGELOG.md)
- **D-02:** Configure `prepublishOnly` script to run `bun run build` before `npm publish` (ensures dist/cli.mjs pre-built)
- **D-03:** Update `engines` field: `{"node": ">=18.0.0", "bun": ">=1.3.3"}` (already partially done, verify completeness)
- **D-04:** Create or update `.npmignore` file to align with `files` whitelist
- **D-05:** Final npm package size must be < 5MB (verify after `npm pack`)
- **D-06:** Test `npx dbcli init` zero-install experience (fresh environment, no local repo)

### Cross-Platform Support & Testing
- **D-07:** Windows validation: Test shebang `#!/usr/bin/env bun` execution on Windows CMD, PowerShell, WSL (fallback: Bun launcher wrapper if needed)
- **D-08:** Path handling: Verify all filesystem operations use `node:path` API (already present in skill.ts); validate .dbcli config paths with Windows backslashes
- **D-09:** Environment variables: Ensure HOME/USERPROFILE fallback logic in config module works correctly (already using `homedir()` from node:os, verify)
- **D-10:** GitHub Actions CI matrix includes `windows-latest` with explicit test for executable status post-build
- **D-11:** Build process: Add `|| true` to `chmod +x dist/cli.mjs` to gracefully skip on Windows

### Documentation & Release Artifacts
- **D-12:** Expand README.md with: (1) Complete API Reference (all commands, flags, options), (2) Permission Model explanation (Query-only vs Read-Write vs Admin with examples), (3) AI Integration Guide (how to use with Claude Code, Gemini, Copilot, Cursor), (4) Troubleshooting section
- **D-13:** Create CHANGELOG.md with Phase-by-phase feature summary (Phases 1-9 → v1.0.0 release notes)
- **D-14:** Create CONTRIBUTING.md with development setup (Bun, TypeScript, testing, build, release process)
- **D-15:** Skill documentation: Validate `dbcli skill` output format is consumable by all four AI platforms (Claude Code, Gemini, Copilot, Cursor) — test actual integration
- **D-16:** All documentation must include code examples that are copy-paste ready and tested

### Performance & Startup Time
- **D-17:** CLI startup benchmark: Measure cold start with `hyperfine` or `time` command; target < 200ms on macOS/Linux, < 300ms on Windows (WSL environment may add latency)
- **D-18:** Query overhead benchmark: Measure simple `dbcli query "SELECT 1"` execution time; target < 50ms (connection + execution + output formatting)
- **D-19:** Add performance regression tests to CI: Store baseline benchmark results and fail if startup exceeds 250ms or query overhead exceeds 60ms
- **D-20:** Profile bundled binary size: Ensure dist/cli.mjs remains <1.5MB to maintain fast download/execution

### the agent's Discretion
- Exact benchmark tool choice (hyperfine, bench.js, or shell `time`)
- Specific benchmarking scenarios (cold vs warm start, various query complexities)
- CHANGELOG format details (conventional commits vs free-form narrative)
- Documentation styling and code example complexity level

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### npm & Publication
- `package.json` — Current bin field, engines field, scripts (verify prepublishOnly hook location and syntax)
- `.npmignore` or files whitelist pattern (if exists) — Understand current publication scope

### Build & Cross-Platform
- `.github/workflows/ci.yml` — Current matrix configuration, chmod commands, platform-specific workarounds
- `bunfig.toml` — Bundler configuration affecting binary size and startup performance
- `tsconfig.json` — Module resolution strategy (bundler mode requires validation)

### Documentation (to create)
- `README.md` — Expand existing file with API reference, Permission model, AI guide, troubleshooting
- `CHANGELOG.md` — New file; document features from Phases 1-9
- `CONTRIBUTING.md` — New file; development and release process

### Performance Benchmarking
- `vitest.config.ts` — Extend or add performance regression tests (no benchmark tests currently exist)
- `package.json` scripts — Add benchmark script (e.g., `bun run bench`)

### AI Skill Integration
- `src/core/skill-generator.ts` — Verify output format (from Phase 09 implementation)
- Test skill consumption by Claude Code, Gemini, Copilot, Cursor

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Bundled Binary (dist/cli.mjs):** Already 1.1MB, production-ready; no code changes needed, only publication/testing setup
- **Path Handling:** src/commands/skill.ts already uses `node:path` (cross-platform safe); config module uses `homedir()` from node:os (fallback safe)
- **Build Process:** Bun bundler with tsconfig.json "bundler" mode; proven fast startup baseline

### Established Patterns
- **Error Handling:** Zod validation throughout; custom error classes (EnvParseError, ConfigError) set precedent for Phase 10 error messages
- **Testing:** Vitest with 80%+ coverage goal; add performance regression tests using same framework
- **CLI Structure:** Commander.js v13.0+ with subcommands (init, schema, query, insert, update, delete, export, skill); skill command already generates documentation dynamically

### Integration Points
- **npm Registry:** Package metadata must align with distribution strategy (zero-install experience requires prepublishOnly)
- **GitHub Actions:** Existing CI workflow extended with Windows platform validation
- **AI Platforms:** Phase 09 SkillGenerator feeds into Phase 10 skill documentation validation

</code_context>

<specifics>
## Specific Ideas

- **Zero-Install Priority:** `npx dbcli init` must work on first invocation without local setup — this is the primary success metric for Phase 10
- **Windows First-Class Support:** Not an afterthought — Phase 10 validates that Windows users have equal experience to macOS/Linux
- **Performance Transparency:** Publish benchmark results in README so users understand trade-offs (CLI startup vs feature richness)
- **AI Agent Partnership:** CONTRIBUTING.md should acknowledge that dbcli is designed for AI agent consumption (skill documentation, structured output) as first-class concern

</specifics>

<deferred>
## Deferred Ideas

- **Audit Logging:** Who did what, when, why — Phase 11 (V1.1)
- **Multi-Connection Management:** Support multiple databases per project — Phase 12 (V1.1)
- **Interactive SQL Shell:** psql-like mode for manual exploration — backlog (potentially Phase 13)
- **ORM Generation:** Auto-generate ORM code from schema — Phase 14 (V2, requires deeper AI integration)
- **Migration Tools:** Schema versioning and migrations — out of scope (use Flyway, Liquibase)
- **Data Import/Bulk Operations:** Large-scale data loading — backlog

</deferred>

---

*Phase: 10-polish-distribution*
*Context gathered: 2026-03-26*
