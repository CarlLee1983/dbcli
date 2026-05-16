# Phase 26: Docs, Skill & Release Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `26-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-16
**Phase:** 26-docs-skill-release-gate
**Areas discussed:** SKILL.md bilingual model, feature-matrix audit row + release-gate doc list
**Areas locked as Planner Discretion:** Phase 23-04 partial coverage disclosure, README D1 upgrade-impact placement, user docs index.{md,html} parity scope

---

## Gray Area Selection (Round 1)

| Option                                                       | Description                                                                | Selected |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- | -------- |
| SKILL.md bilingual model (DOCS-01)                           | EN-only assets/SKILL.md vs split-file vs inline bilingual                  | ✓        |
| feature-matrix audit row + release-gate doc list (DOCS-03)   | row shape, tier mapping, release-check extension                           |          |
| Phase 23-04 partial coverage disclosure (DOCS-04 honesty)    | how openly to communicate 6 unwired commands                               |          |
| README D1 upgrade-impact placement (DOCS-04)                 | section placement + visual treatment for default-on warning                |          |

**User's choice:** SKILL.md bilingual model (DOCS-01)

---

## SKILL.md Bilingual Model (DOCS-01)

### How should SKILL.md deliver bilingual content?

| Option                                | Description                                                                                              | Selected |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------- |
| Separate file + --lang flag           | Add `assets/SKILL.zh-TW.md`; extend `dbcli skill --install --lang zh-TW`. Consistent with README precedent. | ✓        |
| Inline bilingual (whole file)         | Single SKILL.md with EN + ZH paragraphs stacked. File grows ~2x.                                         |          |
| Inline bilingual (audit section only) | Keep most English; only Audit Log section dual-language. Sets awkward precedent.                          |          |
| Punt bilingual to user docs           | Keep SKILL.md English-only; ZH only in `docs/user/zh-TW/`. Violates DOCS-01 literal wording.             |          |

**User's choice:** Separate file + --lang flag (recommended)
**Notes:** Matches existing project pattern; default `en` preserves current `dbcli skill --install` behavior. → **D-71 / D-73 / D-74**

### What scope of SKILL.md should be translated?

| Option                              | Description                                                                | Selected |
| ----------------------------------- | -------------------------------------------------------------------------- | -------- |
| Full SKILL.md                       | Translate entire ~393-line SKILL.md to SKILL.zh-TW.md. Parity rule applies. | ✓        |
| Audit Log section only              | Stub file with only the new section in Chinese; rest points back to English.|          |
| Full SKILL.md + full reference.md   | Also translate reference.md (1254 lines). High cost.                       |          |

**User's choice:** Full SKILL.md (recommended)
**Notes:** `assets/reference.md` stays English-only. → **D-71 (scope) / D-72 (reference.md stays EN)**

### How should the language be selected at install time?

| Option                                          | Description                                                       | Selected |
| ----------------------------------------------- | ----------------------------------------------------------------- | -------- |
| --lang flag, default en                         | Keep current behavior; explicit opt-in only.                      | ✓        |
| --lang flag + auto-detect from DBCLI_LANG env   | If no --lang, fall back to env var.                               |          |
| Auto-detect from system locale (LANG env)       | Read OS LANG. Unpredictable in CI / containers.                   |          |

**User's choice:** --lang flag, default en (recommended)
**Notes:** No auto-detect to avoid container / CI surprises. → **D-73**

### File naming for the Chinese SKILL/reference variants?

| Option            | Description                                | Selected |
| ----------------- | ------------------------------------------ | -------- |
| SKILL.zh-TW.md    | Matches `README.zh-TW.md` precedent.       | ✓        |
| SKILL.zh.md       | Shorter; diverges from precedent.          |          |

**User's choice:** SKILL.zh-TW.md → **D-74**

---

## Gray Area Selection (Round 2)

Asked whether to explore remaining areas or move to context. User chose **"Explore more gray areas"**, then selected:

| Option                                                       | Description                                          | Selected |
| ------------------------------------------------------------ | ---------------------------------------------------- | -------- |
| feature-matrix audit row + release-gate doc list (DOCS-03)   | row shape, tier mapping, release-check extension     | ✓        |
| Phase 23-04 partial coverage disclosure (DOCS-04 honesty)    |                                                      |          |
| README D1 upgrade-impact placement (DOCS-04)                 |                                                      |          |
| User docs index.{md,html} parity scope                       |                                                      |          |

**User's choice:** feature-matrix audit row + release-gate doc list (DOCS-03)

---

## feature-matrix audit row + release-gate doc list (DOCS-03)

### How should `audit` appear in the feature-matrix command table?

| Option                                                 | Description                                                | Selected |
| ------------------------------------------------------ | ---------------------------------------------------------- | -------- |
| Single row `audit` with N/A across engines              | Match `recover` / `skill` precedent.                       | ✓        |
| Split into 2 rows: readonly subset + `clear`            | Surface destructive subcommand distinctly.                 |          |
| Split into 4 rows (one per subcommand)                  | Max granularity; adds noise.                               |          |

**User's choice:** Single row `audit` with N/A across engines (recommended)
**Notes:** Notes column to list all 4 subcommands with tier. → **D-75**

### Side-effect tier mapping for audit subcommands?

| Option                                                 | Description                                                  | Selected |
| ------------------------------------------------------ | ------------------------------------------------------------ | -------- |
| tail/show/health=readonly, clear=local-write           | Matches `src/adapters/capabilities.ts` Phase 24 wiring.       | ✓        |
| All `audit *` = readonly                                | Under-states clear's destructive nature.                     |          |
| tail/show/health=readonly, clear=interactive            | Blurs tier semantics (interactive ≠ TTY prompt).             |          |

**User's choice:** tail/show/health=readonly, clear=local-write (recommended) → **D-76**

### Should `release-check.sh` gain an automated doc-presence check?

| Option                                            | Description                                  | Selected |
| ------------------------------------------------- | -------------------------------------------- | -------- |
| Add doc-presence check (shell grep)                | Cheap, release-blocking.                     | ✓        |
| Add integration test (TypeScript)                  | Heavier; reuses bun test infra.              |          |
| Content-only update; no automated check            | Lowest cost; risks silent doc regressions.   |          |

**User's choice:** Add doc-presence check (recommended)
**Notes:** Shell grep style consistent with existing 7 steps. → **D-77**

### What should the doc-presence check actually grep for?

| Option                                            | Description                                                       | Selected |
| ------------------------------------------------- | ----------------------------------------------------------------- | -------- |
| audit row + CHANGELOG version                     | feature-matrix `\| `audit`` row + CHANGELOG `## [<version>]` heading. | ✓    |
| Above + SKILL.md audit section heading            | Also enforces SKILL.md + SKILL.zh-TW.md heading.                  |          |
| Above + README D1 sentinel marker                 | HTML comment sentinel.                                            |          |

**User's choice:** audit row + CHANGELOG version (recommended)
**Notes:** No SKILL.md / README sentinels. PR review + AGENTS.md doctrine guards those. → **D-78**

### More questions about feature-matrix / release-gate, or move to next?

**User's choice:** Next area

---

## Gray Area Selection (Round 3)

| Option                                                                 | Description | Selected |
| ---------------------------------------------------------------------- | ----------- | -------- |
| Phase 23-04 partial coverage disclosure (DOCS-04 honesty)              |             |          |
| README D1 upgrade-impact placement (DOCS-04)                           |             |          |
| User docs index.{md,html} parity scope                                 |             |          |
| I'm ready for context (lock remaining as planner discretion)           |             | ✓        |

**User's choice:** I'm ready for context (lock remaining as planner discretion)
**Notes:** Three areas (Phase 23-04 disclosure, README D1 placement, user docs parity scope) deferred to planner discretion with recommended defaults captured in CONTEXT.md §«Planner Discretion».

---

## Planner Discretion (Captured in CONTEXT.md, NOT discussed with user)

These areas were intentionally left to the planner. Defaults below reflect the agent's reading of prior phase patterns + AGENTS.md doctrine. Planner is free to deviate but must record reasoning in PLAN.md.

| Area                                                  | Recommended Default                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E. Phase 23-04 partial coverage disclosure            | CHANGELOG `### Changed` single-line known-limitation pointing at `25-J1-COVERAGE-MATRIX.md`                                                                                       |
| F. README D1 upgrade-impact placement                 | New top-level `## Audit Log` section in both README files with `>` blockquote; CHANGELOG repeats with `**Default-on, upgrade impact:**` prefix                                    |
| G. `docs/user/{en,zh-TW}/index.{md,html}` parity scope | Health table row + AI Agent Integration bullet only; full parity across 4 files; no standalone Audit Log chapter in user docs index                                              |

## Deferred Ideas

(Captured in CONTEXT.md §«Deferred Ideas»)

- `assets/reference.md` 中文化 — deferred until non-English demand signal
- `docs/user/` 加獨立 Audit Log 章節 — deferred; index stays as entry surface
- `release-check.sh` 加 SKILL.md 雙語 heading 一致性 check — deferred until first sync-drift incident
- Audit log marketing material — out of GSD workflow scope
- Phase 23-04（writeAuditEntry for 6 unwired commands）— v1.20.x follow-up milestone
