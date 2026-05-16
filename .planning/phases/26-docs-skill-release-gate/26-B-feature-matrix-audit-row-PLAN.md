---
phase: 26-docs-skill-release-gate
plan: B
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/feature-matrix.md
  - assets/reference.md
autonomous: true
requirements: [DOCS-03]
requirements_addressed: [DOCS-03]
tags: [docs, feature-matrix, reference, audit-log, capabilities]

must_haves:
  truths:
    - "`docs/feature-matrix.md` has exactly one new `audit` row (engine-independent, N/A across all 6 engines) following `recover` / `skill` precedent (D-75)."
    - "Side-effect tiers table examples now cite `audit tail` (readonly) and `audit clear` (local-write), mirroring `src/adapters/capabilities.ts:111-122` exactly (D-76)."
    - "`assets/reference.md` has a new `### audit` subcommand block (EN-only per D-72) documenting `tail` / `show` / `clear` / `health` with the Phase 24 flag contract."
    - "The new feature-matrix row is grep-friendly for D-78 release gate: line begins with `` | `audit` `` (exactly: leading pipe + space + backtick-audit-backtick + space) — Pitfall 7."
  artifacts:
    - path: "docs/feature-matrix.md"
      provides: "audit row + updated Side-effect tiers examples"
      contains: "| `audit` |"
    - path: "assets/reference.md"
      provides: "### audit subcommand block documenting all 4 subcommands"
      contains: "### audit"
  key_links:
    - from: "docs/feature-matrix.md (audit row)"
      to: "src/adapters/capabilities.ts:111-122"
      via: "side-effect tiers cited in Notes column must match SoT"
      pattern: "readonly|local-write"
    - from: "assets/reference.md (### audit)"
      to: ".planning/phases/24-audit-cli/24-CONTEXT.md"
      via: "subcommand surface + flag contract (D-31..D-46)"
      pattern: "audit tail|audit show|audit clear|audit health"
---

<objective>
Land the public documentation surface for the audit CLI: `docs/feature-matrix.md` gets a single new `audit` row (N/A across all 6 engines) plus Side-effect tiers examples are updated to cite audit subcommands; `assets/reference.md` gets a new `### audit` block documenting the 4 subcommands and their flag contract per Phase 24.

Purpose: DOCS-03 documentation half — the feature-matrix becomes a maintainer / agent compass for the audit capability with explicit tier mapping aligned to `src/adapters/capabilities.ts`. Reference becomes the comprehensive flag cheatsheet for agents looking up audit syntax. The new feature-matrix row is also the release-gate target for the doc-presence shell-grep step that lands in Plan C (D-77 / D-78); this plan creates the grep target.

Output: Updated `docs/feature-matrix.md` with audit row + tier examples; new `### audit` section in `assets/reference.md`.

Implements decisions: D-75 (single audit row + N/A across engines), D-76 (tier mapping `tail/show/health = readonly`, `clear = local-write`; do NOT introduce `interactive` tier), D-72 (reference.md stays EN-only — no ZH translation).

This plan is INDEPENDENT of Plan A (no file overlap). Both run in Wave 1.
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

# Phase 24 — audit CLI contract documented here
@.planning/phases/24-audit-cli/24-CONTEXT.md

# Source-of-truth for tier mapping (read-only reference)
@src/adapters/capabilities.ts
@docs/feature-matrix.md
@assets/reference.md

<interfaces>
<!-- From src/adapters/capabilities.ts:111-122 — D-76 single source of truth -->

```typescript
auditTail:   cap('supported', 'readonly',     'Reads JSONL audit entries; never writes to engines.'),
auditShow:   cap('supported', 'readonly',     'Looks up a single audit entry by id prefix or recovery_ref.'),
auditHealth: cap('supported', 'readonly',     'Renders AuditLogger.getHealth() snapshot.'),
auditClear:  cap('supported', 'local-write',  'Removes <conn>.jsonl + .jsonl.1 from local disk; never touches DB.'),
```

Tier strings MUST appear verbatim in the new feature-matrix Notes column and reference.md flag tables. Do NOT redefine, do NOT rename, do NOT add a 6th tier — RESEARCH §Anti-Patterns line 308.

<!-- Phase 24 contract — flag names this plan documents -->

From .planning/phases/24-audit-cli/24-CONTEXT.md (D-31..D-46):
- `audit tail [--n <N>] [--all] [--for-agent] [--brief] [--format table|json]`
- `audit show <id-prefix> | --recovery-ref <id>` (id-prefix >= 4 chars)
- `audit clear [--yes]` (interactive confirm without --yes; non-TTY rejects)
- `audit health [--format table|json]`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task B-1: Add `audit` row + Side-effect tiers examples to `docs/feature-matrix.md`</name>
  <files>docs/feature-matrix.md</files>

  <read_first>
    - docs/feature-matrix.md (full file; the EXACT lines to modify are 39-40 — `recover` and `skill` rows — and 46-53 — Side-effect tiers table)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«4. docs/feature-matrix.md» (Analog 1 + 2 + verbatim/adapt guidance + Pitfalls)
    - .planning/phases/26-docs-skill-release-gate/26-RESEARCH.md §«Common Pitfalls» Pitfall 7 (D-78 grep pattern is anchored to `^\| \`audit\` ` — exact spacing, backticks literal, single leading pipe + space + backtick-audit-backtick + space)
    - src/adapters/capabilities.ts:111-122 (audit tier mapping — single source of truth)
  </read_first>

  <action>
    Two atomic edits to `docs/feature-matrix.md`:

    **Edit 1 — Insert one new row in the engine support matrix.** Locate the table containing the `recover` / `skill` rows (currently lines 39-40). Insert ONE new row IMMEDIATELY AFTER the `| \`skill\` |` row (line 40), VERBATIM:

    ```markdown
    | `audit` | N/A | N/A | N/A | N/A | N/A | N/A | Cross-engine local capability writing `.dbcli/audit/<conn>.jsonl`. Subcommands: `tail` / `show` / `health` (`readonly`), `clear` (`local-write`). See `assets/reference.md` §audit. |
    ```

    **Grep target compliance (D-78 / Pitfall 7):** the line MUST start exactly with `| \`audit\` ` (pipe + space + backtick + audit + backtick + space). Any extra whitespace, tab, or removal of backticks breaks the release-gate grep that Plan C will install. The release-check grep is:
    ```bash
    grep -qE '^\| `audit` ' docs/feature-matrix.md
    ```

    **Do NOT:**
    - Split into 4 rows (one per subcommand) — D-75 lock: single row.
    - Use checkmarks or other engine markers — audit is cross-engine local; N/A across all 6 engines per `recover` / `skill` precedent.
    - Add the row anywhere except immediately after `skill` — agents and reviewers scan top-down and `audit` belongs with the engine-independent group at the bottom of the matrix.

    **Edit 2 — Append audit examples to Side-effect tiers Examples column.** Locate the Side-effect tiers table (currently lines 46-53). Modify TWO rows by appending to the Examples column (do not rewrite the cell — append):

    Original row 48 (`readonly`):
    ```markdown
    | `readonly` | Reads remote or local state without mutating the connected database. Local schema-cache refreshes are still treated as readonly when the command contract says so. | `list`, `schema`, `query`, `inspect`, `report`, `guide` |
    ```

    Updated row 48 (append `, audit tail`, `audit show`, `audit health` to Examples):
    ```markdown
    | `readonly` | Reads remote or local state without mutating the connected database. Local schema-cache refreshes are still treated as readonly when the command contract says so. | `list`, `schema`, `query`, `inspect`, `report`, `guide`, `audit tail`, `audit show`, `audit health` |
    ```

    Original row 50 (`local-write`):
    ```markdown
    | `local-write` | Writes local project or user configuration/artifacts, but does not mutate the connected database. | `use`, `queries`, `blacklist`, `skill`, `upgrade` |
    ```

    Updated row 50 (append `, audit clear` to Examples):
    ```markdown
    | `local-write` | Writes local project or user configuration/artifacts, but does not mutate the connected database. | `use`, `queries`, `blacklist`, `skill`, `upgrade`, `audit clear` |
    ```

    **Hard constraint (D-76):** Do NOT add `audit clear` to the `interactive` tier (line 52). Interactive confirmation in `audit clear` is a commander-layer prompt; the tier represents the side-effect class on local filesystem vs DB. `audit clear` removes `.dbcli/audit/<conn>.jsonl` + rotated `.jsonl.1` — that is `local-write`. RESEARCH §Anti-Patterns line 313 explicit.

    **Do NOT touch the Required CI validation block (lines 55-71) in this plan** — Plan C updates it (after release-check.sh step 8/8 lands). Keeps Wave 1 plans non-conflicting.
  </action>

  <verify>
    <automated>grep -qE '^\| `audit` ' docs/feature-matrix.md && grep -q 'audit tail.*audit show.*audit health' docs/feature-matrix.md && grep -q 'audit clear' docs/feature-matrix.md && ! grep -qE '^\|\s*`interactive`.*audit clear' docs/feature-matrix.md</automated>
  </verify>

  <done>
    - `grep -qE '^\| \`audit\` ' docs/feature-matrix.md` exits 0 (D-78 grep target ready).
    - The new row is immediately after the `| \`skill\` |` row.
    - `readonly` row Examples cell contains `audit tail`, `audit show`, `audit health`.
    - `local-write` row Examples cell contains `audit clear`.
    - `audit clear` is NOT in the `interactive` tier row.
    - No new tier introduced (tier names = readonly | dry-run | local-write | db-write | interactive | none).
  </done>
</task>

<task type="auto">
  <name>Task B-2: Add `### audit` subcommand block to `assets/reference.md` (EN-only, D-72)</name>
  <files>assets/reference.md</files>

  <read_first>
    - assets/reference.md (full 1254 lines; the EXACT analog block to mirror is `### recover` at lines 631-720)
    - assets/reference.md:584-629 (`### recovery` — shorter analog showing `**Permission:** n/a` style + Boundaries bullets)
    - .planning/phases/26-docs-skill-release-gate/26-PATTERNS.md §«3. assets/reference.md» (verbatim vs adapt + pitfalls)
    - .planning/phases/24-audit-cli/24-CONTEXT.md (D-31..D-46 — flag names and contract)
    - src/adapters/capabilities.ts:111-122 (tier mapping)
  </read_first>

  <action>
    Insert a new `### audit` block in `assets/reference.md`. Placement: alphabetically near the existing `### recover` (line 631) section is the cleanest insertion point — insert BEFORE `### recover` (audit comes before recover alphabetically). Verify ordering by running `grep -n '^### ' assets/reference.md` to confirm the layout — if reference.md is grouped topically rather than alphabetically, place `### audit` next to other read/diagnostic subcommands. Document the chosen placement in the SUMMARY.

    Insert this block VERBATIM (adjust position per the above note):

    ```markdown
    ### audit

    (v1.20.0+) Inspect, query, and manage the per-connection audit log written to `.dbcli/audit/<connection>.jsonl`.

    Audit entries are metadata-only by design — never raw SQL bodies, `--param` values, or result cell contents (D3 lock). Redaction is sourced from `tests/helpers/sensitive-output.ts` (same source as `inspect` / `guide` / `recover` agent contracts).

    #### Subcommands

    | Subcommand | Side-effect tier | Purpose |
    |---|---|---|
    | `audit tail` | `readonly` | List most recent entries on the current (or `--all`) connection. |
    | `audit show` | `readonly` | Print a single full entry by id prefix or `--recovery-ref`. |
    | `audit clear` | `local-write` | Delete `<conn>.jsonl` + rotated `.jsonl.1` from local disk. Requires `--yes` or interactive confirm. |
    | `audit health` | `readonly` | Render `AuditLogger.getHealth()` snapshot (writer state, lock state, rotation usage). |

    #### `audit tail`

    | Flag | Purpose | Default |
    |---|---|---|
    | `--n <N>` | Number of recent entries to print (latest at bottom — D5). | `20` |
    | `--all` | Merge entries across all connections; preserves `connection` field in each row. | off (current connection only) |
    | `--for-agent` | Shortcut for `--format json --brief`. JSON output is a flat array (agent-friendly). | off |
    | `--brief` | Drop large redaction fields from the entry; keep core identifiers. | off |
    | `--format <fmt>` | `table` \| `json`. | `table` |

    Examples:

        dbcli audit tail --n 10
        dbcli audit tail --all --for-agent --n 20
        dbcli audit tail --format json --brief

    #### `audit show`

    | Flag | Purpose | Default |
    |---|---|---|
    | `<id-prefix>` | Positional. UUID prefix >= 4 characters; ambiguous prefix exits non-zero with a disambiguation hint. | — |
    | `--recovery-ref <id>` | Find the audit entry that emitted a recovery envelope with this id. Mutually exclusive with positional `<id-prefix>`. | — |
    | `--all` | Search across all connections (envelope merged view). | off |
    | `--format <fmt>` | `table` \| `json`. | `table` |

    Examples:

        dbcli audit show 1a2b
        dbcli audit show --recovery-ref 8f0e-... --format json

    #### `audit clear`

    | Flag | Purpose | Default |
    |---|---|---|
    | `--yes` | Skip interactive confirmation. Required in non-TTY contexts. | off (interactive confirm) |

    Behavior: deletes `<conn>.jsonl` + rotated `<conn>.jsonl.1` for the current connection. Does NOT touch other connections. In non-TTY contexts without `--yes`, exits non-zero with a guidance message.

    Examples:

        dbcli audit clear           # interactive (TTY only)
        dbcli audit clear --yes     # CI / scripted

    #### `audit health`

    | Flag | Purpose | Default |
    |---|---|---|
    | `--format <fmt>` | `table` \| `json`. | `table` |

    Output reports: writer enabled/disabled, last write result, file-lock state, rotation cap usage (`max_bytes` / `max_entries`). When `audit.enabled = false` (D1 opt-out), output explicitly flags the disabled state.

    #### Boundaries

    - Entries are append-only JSONL; rotation triggers at `~10 MB` or `~1000` entries (whichever first). Previous segment is preserved as `.jsonl.1`.
    - Bi-directional `recovery_ref` / `audit_ref` linkage is wired on `query` / `inspect` / diagnostic surfaces (Phase 25 J1). The commands `insert / update / delete / export / q / schema` emit single-direction envelopes (no `audit_ref`) in v1.20.0 — tracked as Phase 23-04 follow-up.
    - Audit writer failures are non-fatal (D6): main command result and exit code are preserved; a stderr warning is emitted. `audit health` surfaces the failure reason.

    #### Exit codes

    | Code | Condition |
    |---|---|
    | 0 | Read/list/clear/health succeeded. |
    | 1 | `audit show` — id prefix ambiguous / not found, or `--recovery-ref` not found. |
    | 2 | `audit clear` — non-TTY without `--yes`. |
    | 3 | Reader error (corrupt JSONL line); `tail` skips and continues, `show` exits. |

    **Permission:** n/a
    ```

    **Hard constraints (D-72 + Pitfall — PATTERNS §3):**
    - This block goes ONLY in `assets/reference.md`. Do NOT create a `reference.zh-TW.md` (deferred per D-72).
    - Tier names in the table cells (`readonly`, `local-write`) MUST match the strings in `src/adapters/capabilities.ts:111-122`. Do NOT rename or invent.
    - Flag names (`--n`, `--all`, `--for-agent`, `--brief`, `--recovery-ref`, `--yes`, `--format`) match the Phase 24 contract verbatim — do NOT fabricate new flags.
    - If Phase 24 contract differs from what's documented here for a flag default or behavior, REPORT in SUMMARY (planner-error route) — do NOT silently adjust.
  </action>

  <verify>
    <automated>grep -qE '^### audit$' assets/reference.md && grep -q 'audit tail' assets/reference.md && grep -q 'audit show' assets/reference.md && grep -q 'audit clear' assets/reference.md && grep -q 'audit health' assets/reference.md && grep -q 'recovery_ref' assets/reference.md && grep -q 'Phase 23-04 follow-up' assets/reference.md</automated>
  </verify>

  <done>
    - `assets/reference.md` has a `^### audit$` heading.
    - Documents all 4 subcommands (`tail` / `show` / `clear` / `health`) each with its own flag table.
    - Tier strings match `src/adapters/capabilities.ts:111-122` (`readonly` for tail/show/health; `local-write` for clear).
    - Boundaries section mentions Phase 23-04 follow-up + the 6 unwired commands.
    - No new file created — only `assets/reference.md` modified.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

This plan modifies static markdown documentation only. No runtime trust boundary crossings.

## STRIDE Threat Register

No applicable threats in Plan B. This plan documents existing shipped behaviour (Phase 21–25 audit log). It introduces no new code paths, no new inputs, no new outputs, no new permissions.

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| — | (none) | docs/feature-matrix.md, assets/reference.md | n/a | Documentation-only changes; security review at PR-level. The new feature-matrix row is the release-gate target Plan C grep-checks (T-26-02 is registered in Plan C, not here). |

**Stated explicitly:** Plan B has no applicable STRIDE threats. The closest adjacent concern is content accuracy (could the docs mislead an agent into running unsafe commands?) — mitigated by tier strings copied verbatim from `src/adapters/capabilities.ts` rather than re-defined, plus PR review.
</threat_model>

<verification>
After both tasks complete:

```bash
# D-78 release-gate grep target ready
grep -qE '^\| `audit` ' docs/feature-matrix.md && echo "feature-matrix audit row OK"

# Reference.md audit block present and complete
grep -qE '^### audit$' assets/reference.md && echo "reference.md ### audit OK"

# Tier strings match capabilities.ts SoT
grep -E '^### audit' -A 25 assets/reference.md | grep -E 'readonly|local-write'

# No stray new tier or renamed tier
grep -E '^\| `[a-z-]+` \| ' docs/feature-matrix.md | head -10
```
</verification>

<success_criteria>
- `docs/feature-matrix.md` has the `audit` row in grep-friendly D-78 form (DOCS-03 part 1)
- Side-effect tiers Examples columns cite audit subcommands (DOCS-03 part 2)
- `assets/reference.md` has a complete `### audit` block documenting all 4 subcommands (DOCS-03 part 3)
- Tier names align with `src/adapters/capabilities.ts:111-122` (D-76 single source of truth)
- No ZH translation of reference.md created (D-72 lock honored)
- Plan B prepares the grep target consumed by Plan C step 8/8 doc-presence check
</success_criteria>

<output>
After completion, create `.planning/phases/26-docs-skill-release-gate/26-B-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. Set `requirements-completed: [DOCS-03]`. Note in Decisions: "audit row placed immediately after skill row (engine-independent group); reference.md `### audit` placed at <chosen-location> based on existing reference.md organization (alphabetical vs topical)."
</output>
