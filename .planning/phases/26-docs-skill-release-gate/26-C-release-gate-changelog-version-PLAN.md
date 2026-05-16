---
phase: 26-docs-skill-release-gate
plan: C
type: execute
wave: 2
depends_on:
  - 26-A
  - 26-B
files_modified:
  - package.json
  - CHANGELOG.md
  - scripts/release-check.sh
  - CONTRIBUTING.md
  - docs/feature-matrix.md
autonomous: true
requirements: [DOCS-03, DOCS-04]
requirements_addressed: [DOCS-03, DOCS-04]
tags: [release-gate, changelog, version, shell, audit-log]

must_haves:
  truths:
    - "`package.json` version is bumped from `1.19.1` to `1.20.0` (single field edit; Pitfall 6 + 10)."
    - "`CHANGELOG.md` has a new `## [1.20.0] - 2026-05-17` section with Added / Changed / Internal subsections including the D1 default-on upgrade-impact callout (`**Default-on, upgrade impact:**` prefix verbatim) and the Phase 23-04 known-limitation line citing `25-J1-COVERAGE-MATRIX.md` (Discretion E)."
    - "`scripts/release-check.sh` has step `8/8 doc-presence` appended after step `7/8 dist smoke`; all existing step labels renumbered from `N/7` to `N/8`. The new step uses pure shell (`grep` + `node -p`), NOT `bun test` (D-77)."
    - "Doc-presence step greps two targets: `^\\| \\`audit\\` ` in `docs/feature-matrix.md` (regex via `grep -qE`) and `## [<version>]` in `CHANGELOG.md` (fixed-string via `grep -qF` because `[`/`]` are regex metacharacters; Pitfall 8)."
    - "`CONTRIBUTING.md` §Release Process gains a bullet for the new step 8/8 doc-presence; the line about `four commands` is updated to reflect 8 steps; `docs/feature-matrix.md` §Required CI validation block is updated correspondingly."
    - "`bun run release:check` exits 0 end-to-end after all edits — the version bump + CHANGELOG section + grep target (from Plan B) align."
  artifacts:
    - path: "package.json"
      provides: "version field bumped to 1.20.0"
      contains: '"version": "1.20.0"'
    - path: "CHANGELOG.md"
      provides: "## [1.20.0] release section with Added / Changed / Internal + D1 callout + Phase 23-04 known-limitation"
      contains: "## [1.20.0]"
    - path: "scripts/release-check.sh"
      provides: "8-step release gate; new step 8/8 doc-presence"
      contains: "8/8 doc-presence"
    - path: "CONTRIBUTING.md"
      provides: "Pre-Release Checklist includes doc-presence step"
    - path: "docs/feature-matrix.md"
      provides: "Required CI validation block lists 8 steps including doc-presence"
  key_links:
    - from: "scripts/release-check.sh (step 8/8)"
      to: "docs/feature-matrix.md (audit row created by Plan B)"
      via: "grep -qE '^\\| `audit` '"
      pattern: "audit row in feature-matrix"
    - from: "scripts/release-check.sh (step 8/8)"
      to: "CHANGELOG.md (## [1.20.0] heading created by this plan)"
      via: "grep -qF '## [${PKG_VERSION}]'"
      pattern: "version heading in CHANGELOG"
    - from: "CONTRIBUTING.md §Release Process"
      to: "scripts/release-check.sh"
      via: "Pre-Release Checklist bullet sync"
      pattern: "doc-presence"
---

<objective>
Activate the v1.20.0 release gate: bump package.json version, write the v1.20.0 CHANGELOG section (Added / Changed / Internal — including D1 default-on upgrade-impact callout and Phase 23-04 known-limitation per Discretion E), add the release-blocking `8/8 doc-presence` shell-grep step to `scripts/release-check.sh`, and sync CONTRIBUTING.md + feature-matrix.md Required CI validation block.

Purpose: Wire the release gate so v1.20.0 cannot ship without (1) the feature-matrix `audit` row from Plan B, (2) the matching `## [<package.json version>]` CHANGELOG heading from this plan, (3) the version bump from this plan, all aligned. T-26-02 mitigation: the gate itself catches any future drift between package.json version and CHANGELOG.

Output: package.json 1.19.1 → 1.20.0; CHANGELOG.md gains `## [1.20.0]` section; release-check.sh becomes 8 steps; CONTRIBUTING.md + feature-matrix.md CI validation block reflect the new step.

Implements decisions: D-77 (shell-grep step, NOT `bun test`), D-78 (two grep targets: feature-matrix audit row + CHANGELOG version heading; do NOT grep SKILL or sentinels), Discretion E (Phase 23-04 partial-coverage CHANGELOG disclosure in `### Changed`), Discretion F item 2 (CHANGELOG D1 callout with `**Default-on, upgrade impact:**` prefix).

Depends on: Plan A (CHANGELOG references new ZH SKILL + `--lang` flag), Plan B (release-check.sh step 8/8 greps the audit row from Plan B). Wave 2.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/26-docs-skill-release-gate/26-CONTEXT.md
@.planning/phases/26-docs-skill-release-gate/26-RESEARCH.md
@.planning/phases/26-docs-skill-release-gate/26-PATTERNS.md
@.planning/phases/26-docs-skill-release-gate/26-VALIDATION.md

# Critical reference for Discretion E known-limitation
@.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md

# Files modified in this plan (read for line numbers + analog patterns)
@package.json
@CHANGELOG.md
@scripts/release-check.sh
@CONTRIBUTING.md
@docs/feature-matrix.md

# Wave 1 outputs this plan builds on
@.planning/phases/26-docs-skill-release-gate/26-A-SUMMARY.md
@.planning/phases/26-docs-skill-release-gate/26-B-SUMMARY.md

<interfaces>
<!-- Existing release-check.sh structure (lines 1-29). Step pattern is verbatim — preserve exactly. -->

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

step '1/7 bun audit'
bun audit

step '2/7 prettier --check'
bunx prettier --check "src/**/*.ts" "tests/**/*.ts"

# ... 5 more existing steps ending at:
step '7/7 dist smoke'
bun test tests/integration/dist-smoke.test.ts

printf '\n\033[1;32m✓ release:check passed\033[0m\n'
```

Plan C changes:
1. Rewrite `1/7 .. 7/7` -> `1/8 .. 7/8` (Pitfall 9 — line by line via Edit tool, not sed).
2. Append `step '8/8 doc-presence'` block (Pitfalls 7 + 8 for grep quoting).

<!-- Existing CHANGELOG structure (line 9 onward). Add new `## [1.20.0]` block above line 9 (newest at top per Keep a Changelog). -->

CHANGELOG layout: `## [<version>] - <YYYY-MM-DD>` then `### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Security` / `### Internal` / `### Notes` / `### Tests`. Pre-existing v1.19.1 (line 9), v1.19.0 (line 28), v1.17.0 (line 48). v1.17.0 is the best precedent for a feature release with Security + Internal subsections (CHANGELOG.md:48-86).

<!-- Existing CONTRIBUTING Pre-Release Checklist (lines 285-295). -->

Bullet format: `- [ ] \`<cmd>\` — <ZH description>`. Insert new bullet for step 8/8 doc-presence.

<!-- Existing package.json version field -->

Current `"version": "1.19.1"` (line 3). Edit to `"version": "1.20.0"`.
</interfaces>
</context>

<execution_order>
Tasks within this plan are sequential. Execute in this order: **C-1 -> C-2 -> C-3 -> C-4 -> C-5**.

- C-1 (bump package.json) must happen FIRST — D-78 grep reads version via `node -p`.
- C-2 (write CHANGELOG ## [1.20.0]) must happen BEFORE C-3 — step 8/8 greps for the heading.
- C-3 (release-check.sh step 8/8) installs the gate.
- C-4 (CONTRIBUTING.md + feature-matrix.md CI validation block) syncs documentation.
- C-5 (final integration test `bun run release:check`) confirms end-to-end green.
</execution_order>

<tasks>

<task type="auto">
  <name>Task C-1: Bump `package.json` version 1.19.1 -> 1.20.0</name>
  <files>package.json</files>

  <read_first>
    - package.json (line 3 — `"version": "1.19.1"`)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«14. package.json»
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Common Pitfalls» Pitfall 6 + 10
  </read_first>

  <action>
    Edit `package.json` to change exactly ONE line: the `version` field.

    Before (line 3):
    ```json
      "version": "1.19.1",
    ```

    After (line 3):
    ```json
      "version": "1.20.0",
    ```

    **Hard constraints:**
    - Do NOT modify any other field (no `files:` change, no `scripts:` change, no `engines:` change). All Phase 26 work is docs + script — no new runtime dependencies.
    - Use the Edit tool directly. Do NOT run `npm version minor --no-git-tag-version` — that creates a git tag side effect we don't want at this stage (tag is cut after `bun run release:check` passes — RESEARCH Pitfall 6 recommendation).
    - If `bun.lock` is present and tracks the version field, run `bun install --frozen-lockfile` to confirm no lock drift. If `bun.lock` does not track the project's own version, no regen needed.
  </action>

  <verify>
    <automated>node -p "require('./package.json').version" | grep -qF '1.20.0'</automated>
  </verify>

  <done>
    - `node -p "require('./package.json').version"` returns `1.20.0`.
    - No other `package.json` field modified (`git diff package.json` shows ONLY the version line).
  </done>
</task>

<task type="auto">
  <name>Task C-2: Add `## [1.20.0]` section to `CHANGELOG.md` (Discretion E + F)</name>
  <files>CHANGELOG.md</files>

  <read_first>
    - CHANGELOG.md (full file — insertion point is immediately above line 9 `## [1.19.1] - 2026-05-14`)
    - CHANGELOG.md:48-86 (v1.17.0 precedent — Added / Changed / Security / Internal layout; best precedent for feature release with upgrade-impact callout)
    - CHANGELOG.md:9-26 (v1.19.1 precedent — Changed / Fixed / Tests; shorter layout)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«7. CHANGELOG.md» (verbatim header format, Discretion E + F text, Pitfalls 6/8/10)
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Architecture Patterns» Pattern 3 (Keep a Changelog format) + §«Code Examples» Example 4
    - .planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md (the 6 unwired commands citation for the known-limitation)
  </read_first>

  <action>
    Insert a new `## [1.20.0] - 2026-05-17` block IMMEDIATELY ABOVE the existing `## [1.19.1] - 2026-05-14` heading (line 9). Use the exact content below VERBATIM. Today's date is 2026-05-17.

    ```markdown
    ## [1.20.0] - 2026-05-17

    ### Added

    - **Agent-facing Audit Log**: every db-touching command writes a structured JSONL entry to `.dbcli/audit/<connection>.jsonl`. Entry shape locked as a contract test (`tests/integration/audit-contract.test.ts`) covering `ts` / `session_id` / `engine` / `command` / `side_effect_tier` / `target` / `success` / `recovery_ref` / `redacted_sql`. Redaction sourced from `tests/helpers/sensitive-output.ts` (single source of truth).
    - `dbcli audit tail` / `audit show` / `audit clear` / `audit health` subcommands with `--n`, `--all`, `--for-agent`, `--brief`, `--recovery-ref <id>`, `--format table|json`, `--yes` flags. JSON output is a flat array suitable for agent direct consumption (CLI-01..06).
    - `dbcli audit tail --all` cross-connection merged view; `audit show --recovery-ref <id>` bi-directional lookup; `audit health` reports writer state, lock state, rotation cap usage.
    - Recovery envelope bi-directional linkage: audit entry `recovery_ref` points at `.dbcli/last-recovery.json`; envelope's new `audit_ref` points back at the audit entry id.
    - `inspect` / `guide` / `recover` / `recover --apply` `--for-agent` JSON output embeds `audit_recent: AuditEntryBrief[]` (last 5 entries) for immediate cross-session context.
    - `dbcli skill --install <platform> --lang en|zh-TW` (default `en`) to install Traditional Chinese SKILL.md content on agent platforms; target filename remains `SKILL.md` regardless of source.
    - New `assets/SKILL.zh-TW.md` — full Traditional Chinese translation of `assets/SKILL.md`, including the new `## Audit Log 使用` section.
    - New `## Audit Log usage` section in `assets/SKILL.md` (session handoff + forensics scenarios).
    - New `### audit` subcommand block in `assets/reference.md` documenting all 4 subcommands with flag tables.
    - `docs/feature-matrix.md` gains an `audit` row (engine-independent, N/A across all 6 engines) and the Side-effect tiers table examples now include `audit tail` / `audit show` / `audit health` (`readonly`) and `audit clear` (`local-write`).
    - `scripts/release-check.sh` step `8/8 doc-presence` — release-blocking shell-grep check that the feature-matrix `audit` row and the matching `CHANGELOG.md ## [<version>]` heading both exist.

    ### Changed

    - **Default-on, upgrade impact:** `audit.enabled = true` by default. Existing projects will begin creating `.dbcli/audit/<connection>.jsonl` on first command after upgrading. Set `audit.enabled = false` in `.dbcli` to opt out. The audit directory is gitignored by default; entries are metadata-only (D3) — never raw SQL bodies, `--param` values, or result cell contents. (D1)
    - `inspect` / `guide` / `recover` / `recover --apply` agent JSON output adds an `audit_recent` field (additive; shape stable; not a breaking change). v1.19.x consumers ignore the field.
    - _Known limitation (Phase 23-04 follow-up):_ Audit log captures `query`, `inspect`, and diagnostic-surface commands in v1.20.0; coverage for `insert / update / delete / export / q / schema` failure paths is tracked as Phase 23-04 follow-up (see `.planning/phases/25-recovery-envelope-bi-directional-linkage/25-J1-COVERAGE-MATRIX.md`). Recovery envelope linkage from the envelope side is unaffected — those commands continue to emit `.dbcli/last-recovery.json` envelopes; only the `audit_ref` back-pointer is missing in v1.20.0.

    ### Internal

    - New modules under `src/core/audit/`: `logger.ts`, `lock.ts`, `rotation.ts`, `reader.ts`, `recent.ts`, `session-id.ts`, `types.ts`, `integration-helper.ts`.
    - New contract / integration tests: `tests/integration/audit-contract.test.ts`, `tests/integration/audit-envelope.test.ts`, `tests/integration/recovery-audit-link.test.ts` (J1 asymmetry guard).
    - `scripts/release-check.sh` is now 8 steps (was 7); CONTRIBUTING.md §Release Process and `docs/feature-matrix.md` §Required CI validation block updated to match.
    - `src/commands/skill.ts` adds a `resolveSkillSource(lang)` selector and `--lang en|zh-TW` commander option via `new Option(...).choices(['en','zh-TW']).default('en')`. `getInstallPath()` is unchanged (target filename stays `SKILL.md`).
    ```

    **Hard constraints (Pitfalls 6, 8, 10 — RESEARCH §«Common Pitfalls»):**
    - Heading format MUST be exactly `## [1.20.0] - 2026-05-17` (literal `[` `]` brackets; the release-check grep uses `grep -qF` so brackets are literal not regex).
    - The `**Default-on, upgrade impact:**` prefix in `### Changed` is verbatim — required by Discretion F item 2 and used by humans + maintainers to find the upgrade callout.
    - The known-limitation line must cite `25-J1-COVERAGE-MATRIX.md` by path and list the 6 unwired commands explicitly (Discretion E lock).
    - Do NOT edit any historical entry (Keep a Changelog convention). v1.0.0's "audit logging deferred" note (if present) stays as-is.
  </action>

  <verify>
    <automated>grep -qF '## [1.20.0]' CHANGELOG.md && grep -qF '**Default-on, upgrade impact:**' CHANGELOG.md && grep -q '25-J1-COVERAGE-MATRIX' CHANGELOG.md && grep -q 'insert / update / delete / export / q / schema' CHANGELOG.md && grep -q 'audit_recent' CHANGELOG.md && grep -qF '`--lang en|zh-TW`' CHANGELOG.md</automated>
  </verify>

  <done>
    - `grep -qF '## [1.20.0]' CHANGELOG.md` exits 0 (D-78 grep target ready).
    - `## [1.20.0]` heading is immediately above `## [1.19.1]`.
    - `**Default-on, upgrade impact:**` callout present in `### Changed`.
    - Phase 23-04 known-limitation cites all 6 unwired commands AND `25-J1-COVERAGE-MATRIX.md`.
    - All 4 added artifact families (audit subcommands, recovery linkage, ZH SKILL, `--lang` flag, doc-presence step) listed in `### Added`.
  </done>
</task>

<task type="auto">
  <name>Task C-3: Add step `8/8 doc-presence` to `scripts/release-check.sh` (D-77 / D-78)</name>
  <files>scripts/release-check.sh</files>

  <read_first>
    - scripts/release-check.sh (full file — current 29 lines, 7 steps)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«12. scripts/release-check.sh» (verbatim text for step 8/8 + sed pattern)
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Code Examples» Example 3 + §«Common Pitfalls» Pitfalls 7, 8, 9
  </read_first>

  <action>
    Two atomic edits in lock-step:

    **Edit 1 — Renumber existing step labels.** Change all occurrences of `N/7 ` to `N/8 ` in the 7 existing step lines:

    Before (lines 8-27, abbreviated):
    ```bash
    step '1/7 bun audit'
    bun audit

    step '2/7 prettier --check'
    bunx prettier --check "src/**/*.ts" "tests/**/*.ts"

    step '3/7 typecheck'
    bun run typecheck

    step '4/7 lint'
    bun run lint

    step '5/7 test'
    bun test

    step '6/7 build'
    bun run build

    step '7/7 dist smoke'
    bun test tests/integration/dist-smoke.test.ts
    ```

    After (renumber `N/7` -> `N/8`):
    ```bash
    step '1/8 bun audit'
    bun audit

    step '2/8 prettier --check'
    bunx prettier --check "src/**/*.ts" "tests/**/*.ts"

    step '3/8 typecheck'
    bun run typecheck

    step '4/8 lint'
    bun run lint

    step '5/8 test'
    bun test

    step '6/8 build'
    bun run build

    step '7/8 dist smoke'
    bun test tests/integration/dist-smoke.test.ts
    ```

    Implementation: use the Edit tool 7 times (one per line). Do NOT use `sed -i` directly inside Bash — Edit tool keeps the change reviewable. Pitfall 9 — easy to miss one renumbering with sed.

    **Edit 2 — Append step 8/8 between the renumbered `7/8 dist smoke` step and the final `✓ release:check passed` printf.** Insert this block VERBATIM:

    ```bash
    step '8/8 doc-presence'
    PKG_VERSION=$(node -p "require('./package.json').version")
    if ! grep -qE '^\| `audit` ' docs/feature-matrix.md; then
      echo "  ✗ docs/feature-matrix.md missing 'audit' row" >&2
      exit 1
    fi
    if ! grep -qF "## [${PKG_VERSION}]" CHANGELOG.md; then
      echo "  ✗ CHANGELOG.md missing '## [${PKG_VERSION}]' heading" >&2
      exit 1
    fi
    echo "  ✓ feature-matrix has audit row"
    echo "  ✓ CHANGELOG.md has ## [${PKG_VERSION}] heading"
    ```

    Final file shape (after both edits):

    ```bash
    #!/usr/bin/env bash
    set -euo pipefail

    cd "$(dirname "$0")/.."

    step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

    step '1/8 bun audit'
    bun audit

    # ... 6 more renumbered steps ...

    step '7/8 dist smoke'
    bun test tests/integration/dist-smoke.test.ts

    step '8/8 doc-presence'
    PKG_VERSION=$(node -p "require('./package.json').version")
    if ! grep -qE '^\| `audit` ' docs/feature-matrix.md; then
      echo "  ✗ docs/feature-matrix.md missing 'audit' row" >&2
      exit 1
    fi
    if ! grep -qF "## [${PKG_VERSION}]" CHANGELOG.md; then
      echo "  ✗ CHANGELOG.md missing '## [${PKG_VERSION}]' heading" >&2
      exit 1
    fi
    echo "  ✓ feature-matrix has audit row"
    echo "  ✓ CHANGELOG.md has ## [${PKG_VERSION}] heading"

    printf '\n\033[1;32m✓ release:check passed\033[0m\n'
    ```

    **Hard constraints (Pitfalls 7, 8, 9; D-77 / D-78):**
    - The first `grep` uses SINGLE quotes: `'^\| `audit` '` — backticks must be literal, not shell command substitution (Pitfall 7).
    - The second `grep` uses `-F` (fixed string), not `-E` (regex), because `[` and `]` are regex metacharacters (Pitfall 8).
    - Do NOT replace step 8/8 with a `bun test` invocation (D-77 lock). Pure shell only — ~50ms vs `bun test`'s ~3s startup.
    - Preserve `#!/usr/bin/env bash` shebang and `set -euo pipefail` (line 2) — fail-fast contract.
    - Preserve `cd "$(dirname "$0")/.."` (line 4) — script must work from any cwd.
    - The `step()` function definition (line 6) is unchanged.
  </action>

  <verify>
    <automated>grep -q "step '8/8 doc-presence'" scripts/release-check.sh && grep -q "grep -qF" scripts/release-check.sh && ! grep -qE "'[0-9]+/7 " scripts/release-check.sh && bash scripts/release-check.sh</automated>
  </verify>

  <done>
    - `scripts/release-check.sh` contains `step '8/8 doc-presence'`.
    - Zero occurrences of `N/7` left (all renumbered to `N/8`).
    - First grep is `grep -qE '^\| `audit` '` (single-quoted; literal backticks).
    - Second grep is `grep -qF "## [${PKG_VERSION}]"` (fixed-string for literal `[`).
    - `bash scripts/release-check.sh` runs end-to-end and exits 0 (this validates Plan A's edits + Plan B's audit row + this plan's CHANGELOG section all align).
  </done>
</task>

<task type="auto">
  <name>Task C-4: Sync `CONTRIBUTING.md` Pre-Release Checklist + `docs/feature-matrix.md` Required CI validation block</name>
  <files>CONTRIBUTING.md, docs/feature-matrix.md</files>

  <read_first>
    - CONTRIBUTING.md (lines 279-295 — Release Process + Pre-Release Checklist; line 281 mentions "four commands" — needs update)
    - docs/feature-matrix.md:55-71 (Required CI validation section — currently says "four commands"; needs update)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«11. CONTRIBUTING.md»
    - scripts/release-check.sh (verify the new 8-step layout from Task C-3 — DO NOT edit it here)
  </read_first>

  <action>
    Two atomic edits:

    **Edit 1 — `CONTRIBUTING.md`:**

    Update line 281 (currently `The release gate is defined in [...]. The same four commands run in CI and must pass locally before tagging.`) to reflect 8 steps:

    Before:
    ```markdown
    The release gate is defined in [`docs/feature-matrix.md → Required CI validation`](./docs/feature-matrix.md#required-ci-validation). The same four commands run in CI and must pass locally before tagging.
    ```

    After:
    ```markdown
    The release gate is defined in [`docs/feature-matrix.md → Required CI validation`](./docs/feature-matrix.md#required-ci-validation). All 8 steps (encoded in `scripts/release-check.sh`) run in CI and must pass locally before tagging.
    ```

    Then insert ONE new bullet in the Pre-Release Checklist (lines 285-295), AFTER the existing `bun run build` bullet (line 290) and BEFORE the `CHANGELOG.md` bullet (line 292). The exact bullet text (matching the existing ZH-mixed style):

    ```markdown
    - [ ] `bash scripts/release-check.sh` 第 8/8 步 doc-presence — `docs/feature-matrix.md` 含 `audit` row、`CHANGELOG.md` 含 `## [<version>]` heading（D-78）
    ```

    Place this bullet at line ~291 so the final checklist order is: typecheck -> bun test -> lint -> build -> dist smoke -> **doc-presence (NEW)** -> CHANGELOG -> STATE.md -> package.json version -> benchmark.

    **Edit 2 — `docs/feature-matrix.md`:**

    Update the `## Required CI validation` block (lines 55-71). Replace the opening sentence + code fence + bullet list so it reflects 8 steps. Before (lines 55-71 abbreviated):

    ```markdown
    ## Required CI validation

    The release gate is four commands. CI runs them without `continue-on-error`, and they must also pass locally before tagging a release:

    ```bash
    bun run typecheck
    bun test
    bun run lint
    bun run build
    ```

    - `bun run lint` enforces `--max-warnings=0` — any new ESLint warning blocks release.
    - `bun run build` is followed by `dist/cli.mjs --help` / `--version` executable smoke checks (also release-blocking).
    - `tests/integration/dist-smoke.test.ts` is part of `bun test` and guards the packaged `assets/` path used by `dbcli skill --install`.
    - Benchmark (`bun run test:perf`) remains advisory and is allowed to fail (`continue-on-error: true`).
    ```

    After (rewrite to reflect 8 steps and reference the script as single source of truth):

    ```markdown
    ## Required CI validation

    The release gate is 8 shell steps encoded in `scripts/release-check.sh`. CI runs them without `continue-on-error`, and they must also pass locally before tagging a release:

    ```bash
    bun audit                                                              # 1/8
    bunx prettier --check "src/**/*.ts" "tests/**/*.ts"                   # 2/8
    bun run typecheck                                                      # 3/8
    bun run lint                                                           # 4/8
    bun test                                                               # 5/8
    bun run build                                                          # 6/8
    bun test tests/integration/dist-smoke.test.ts                          # 7/8
    bash scripts/release-check.sh   # 8/8 doc-presence (audit row + CHANGELOG version)
    ```

    - Step 4/8 (`bun run lint`) enforces `--max-warnings=0` — any new ESLint warning blocks release.
    - Step 7/8 (dist smoke) guards the packaged `assets/` path used by `dbcli skill --install` (including `SKILL.zh-TW.md` since v1.20.0).
    - Step 8/8 (doc-presence) is a shell-grep gate: confirms `docs/feature-matrix.md` has the `audit` row and `CHANGELOG.md` has a `## [<package.json version>]` heading. Catches doc-vs-version drift before tagging.
    - Benchmark (`bun run test:perf`) remains advisory and is allowed to fail (`continue-on-error: true`).
    ```

    **Hard constraints (PATTERNS §11):**
    - Keep the existing CONTRIBUTING.md ZH-mixed bullet style (the existing checklist is half-ZH).
    - The feature-matrix.md Required CI validation block is the canonical reference; keep it in sync with `scripts/release-check.sh`. STATE.md line 144 also references this block — STATE update is out of scope for this plan (Phase 26 completion will update STATE).
    - Do NOT re-add the `audit` row here (Plan B handled it). Only the CI validation block changes in feature-matrix.md.
  </action>

  <verify>
    <automated>grep -q '第 8/8 步 doc-presence' CONTRIBUTING.md && grep -q 'All 8 steps' CONTRIBUTING.md && grep -q 'release gate is 8 shell steps' docs/feature-matrix.md && grep -q '8/8 doc-presence' docs/feature-matrix.md && ! grep -q 'release gate is four commands' docs/feature-matrix.md</automated>
  </verify>

  <done>
    - `CONTRIBUTING.md` Pre-Release Checklist has the new doc-presence bullet.
    - `CONTRIBUTING.md` line 281 says "All 8 steps" not "four commands".
    - `docs/feature-matrix.md` Required CI validation block lists 8 steps with `# 1/8` ... `# 8/8` annotations.
    - No reference to "four commands" remains in either file.
  </done>
</task>

<task type="auto">
  <name>Task C-5: Run `bun run release:check` end-to-end to confirm Plan C activates the gate</name>
  <files></files>

  <read_first>
    - scripts/release-check.sh (verify Task C-3 changes — file is 8 steps now)
    - package.json (verify Task C-1 — version 1.20.0)
    - CHANGELOG.md (verify Task C-2 — `## [1.20.0]` heading present)
    - docs/feature-matrix.md (verify Plan B — `audit` row present)
  </read_first>

  <action>
    Run the full 8-step release gate locally and confirm green:

    ```bash
    bun run release:check
    ```

    Expected output ends with:
    ```
    ▶ 8/8 doc-presence
      ✓ feature-matrix has audit row
      ✓ CHANGELOG.md has ## [1.20.0] heading

    ✓ release:check passed
    ```

    **If any step fails:**

    - **Step 8/8 fails on feature-matrix grep:** Plan B did not land or audit row was reformatted by prettier. Run `grep -E '^\| \`audit\` ' docs/feature-matrix.md` to confirm — if not present, REPORT (do not auto-fix here; this would mask a Plan B bug). Use planner-error route.
    - **Step 8/8 fails on CHANGELOG grep:** Task C-2 did not land or `## [1.20.0]` heading was formatted differently. Run `grep -F '## [1.20.0]' CHANGELOG.md` to confirm — if not present, fix Task C-2.
    - **Step 2/8 fails (prettier):** any file in `src/**/*.ts` or `tests/**/*.ts` is not formatted. Run `bunx prettier --write "src/**/*.ts" "tests/**/*.ts"` to fix.
    - **Step 5/8 fails (test):** A regression. Investigate the specific failing test before committing.
    - **Step 6/8 fails (build):** likely `Skill source not found` for `assets/SKILL.zh-TW.md` — Plan A's Task A-2 did not land. Investigate.
    - **Step 7/8 fails (dist-smoke):** likely a packaging issue with `SKILL.zh-TW.md` — Plan A's Task A-4 didn't account for build.ts file enumeration. Read `scripts/build.ts` and add `SKILL.zh-TW.md` to its include list if needed.

    This task does not modify any file — it is a verification gate. The execute step is the `bun run release:check` invocation itself.
  </action>

  <verify>
    <automated>bun run release:check</automated>
  </verify>

  <done>
    - `bun run release:check` exits 0.
    - Output includes both `✓ feature-matrix has audit row` and `✓ CHANGELOG.md has ## [1.20.0] heading`.
    - All 8 step labels print in order (`1/8 bun audit` ... `8/8 doc-presence`).
    - T-26-02 mitigation verified live: the gate would catch any future drift (verifiable manually by temporarily renaming the audit row, running release-check, observing exit 1, then restoring).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Maintainer commit -> release tag | The release-check shell pipeline guards the boundary between "code that should ship" and "tagged release artifact." Any maintainer-introduced doc-vs-code drift (forgot CHANGELOG bump, forgot feature-matrix update) crosses this boundary undetected without step 8/8. |
| `node -p` shell expansion -> grep input | `${PKG_VERSION}` from `node -p` is interpolated into a `grep -qF` pattern. If a malicious `package.json` set `version` to something containing shell metacharacters, `-F` (fixed string) renders it harmless. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-26-02 | Repudiation / Supply-chain (ASVS V14) | `scripts/release-check.sh` doc-presence step | mitigate | The step itself IS the mitigation: shell-grep fails the gate when (a) `docs/feature-matrix.md` lacks the `audit` row, or (b) `CHANGELOG.md` lacks `## [<package.json version>]`. Verified live in Task C-5. Severity: LOW (the gate runs locally + in CI before tag cuts; a malicious actor would need to also tamper with release-check.sh itself, which shows up in PR diff). |
| T-26-02b | Tampering | `${PKG_VERSION}` shell interpolation in `grep -qF` | accept | `grep -qF` uses fixed-string matching; even if `package.json` were tampered with arbitrary content, the grep would simply fail to find a heading — not execute injected shell code. The `node -p require('./package.json').version` invocation parses JSON, so non-string `version` values produce a JS error and exit non-zero. Severity: LOW. |

**ASVS coverage:** V14 (Configuration) — release-gate aligns package.json + CHANGELOG + feature-matrix in lock-step.
</threat_model>

<verification>
After all 5 tasks complete:

```bash
# Version aligned with CHANGELOG
test "$(node -p 'require(\"./package.json\").version')" = "1.20.0" && echo "version OK"

# Step 8/8 actually runs
bash scripts/release-check.sh
# Final line should be: ✓ release:check passed

# Doc-presence catches drift (test the gate works — MANUAL only, do not commit)
# - Temporarily rename audit row to `audit2`: edit docs/feature-matrix.md
# - Run `bash scripts/release-check.sh` -> expect exit 1 + "missing 'audit' row"
# - Restore: edit back

# CONTRIBUTING + feature-matrix synced
grep -q '8 steps' CONTRIBUTING.md && grep -q '8 shell steps' docs/feature-matrix.md
```
</verification>

<success_criteria>
- `package.json` version is `1.20.0` (DOCS-04 prereq for D-78 grep)
- `CHANGELOG.md` has `## [1.20.0]` section with D1 callout + Phase 23-04 known-limitation (DOCS-04 narrative)
- `scripts/release-check.sh` is 8 steps, step 8/8 uses pure shell grep (D-77 / D-78)
- `CONTRIBUTING.md` Pre-Release Checklist + `docs/feature-matrix.md` CI validation block updated (DOCS-03 release-gate metadata)
- `bun run release:check` exits 0 end-to-end (T-26-02 mitigation verified live)
- The gate is now release-blocking: future v1.20.x / v1.21.x releases must bump CHANGELOG and feature-matrix in lock-step
</success_criteria>

<output>
After completion, create `.planning/phases/26-docs-skill-release-gate/26-C-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. Set `requirements-completed: [DOCS-03, DOCS-04]`. Note in Decisions:
- "v1.20.0 release date pinned at 2026-05-17 (today's date when phase 26 plans drafted)."
- "Step 8/8 placement: AFTER `7/8 dist smoke` (Option A from RESEARCH §Pattern 4 — ship-readiness check, not code-quality check)."
- "Used `grep -qF` for CHANGELOG version pattern (literal `[` `]` brackets, Pitfall 8) and `grep -qE` for feature-matrix audit row (regex anchoring with literal backticks via single-quotes, Pitfall 7)."
</output>
