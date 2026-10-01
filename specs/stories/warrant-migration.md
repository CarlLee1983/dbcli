# Replace the ForgeFlow protocol with Warrant

## Goal

Replace this repository's ForgeFlow Story protocol with Warrant, with no
compatibility layer, while keeping ForgePilot as the external control plane.
Agents then find one contract in `AGENTS.md`: a Story is a single file at
`specs/stories/<slug>.md`, approval is a human commit or an explicit
assignment, and completion is proven by `make verify`. Line numbers below
locate text on `main` at the time of writing; the content anchors decide.

* In `AGENTS.md`, replace `## ForgeFlow Story Development` (currently lines
  143-192, including the handoff rules, the ADR naming contract at lines
  167-169, and the completion-report rule) with the Warrant block from
  `/Users/carl/.claude/plugins/cache/warrant/warrant/0.1.2/skills/warrant/agents-block.md`,
  its verification-command placeholder replaced by `make verify`.
* In `## ForgePilot Work Control Plane` (currently lines 123-141), change only
  the protocol wording: the `ForgeFlowV2` clause (lines 125-126) and step 4
  (line 135) name Warrant and `specs/stories/<slug>.md` instead of ForgeFlow.
  Every other `AGENTS.md` section stays byte-identical.
* Delete `specs/.forgeflow-adoption`, `specs/stories/_template/` (three files),
  `.agents/skills/story-development/SKILL.md`,
  `scripts/check-forgeflow-adoption.ts`, `scripts/lib/forgeflow-adoption.ts`,
  `scripts/check-forgeflow-handoff.ts`, `scripts/lib/forgeflow-handoff.ts`,
  `scripts/check-forgeflow-contract.ts`, `scripts/lib/forgeflow-contract.ts`,
  `tests/contract/forgeflow-adoption.test.ts`,
  `tests/unit/scripts/forgeflow-contract.test.ts`, and
  `tests/unit/scripts/forgeflow-handoff.test.ts`. They go in this one Story
  because the adoption checker fails as soon as `_template/` or the skill is
  removed.
* In `Makefile`, remove the `step='bun run forgeflow:check' && run` step of
  `verify` (currently line 79), and end the `bun run plan:check` step with
  `; \` instead of `&& \` so that `status=$$?` still captures the last step's
  result; leave the other steps and the attestation lines unchanged.
  In `package.json`, remove the `forgeflow:check` and
  `forgeflow:contract` scripts (currently lines 88-89).
* In `tests/contract/forgepilot-boundary.test.ts`, remove only
  `'bun run forgeflow:check',` from `REQUIRED_STEPS` (currently line 54).
* In `.github/workflows/ci.yml`, delete the `forgeflow-contract` job
  (currently lines 184-212); remove the integration job's `fetch-depth: 0` and
  its comment (currently lines 134-137), whose only purpose was reading
  `Story:` trailers; and make the "repository-owned ForgeFlow gate" comment
  above `Canonical verification` (currently lines 151-152) protocol-neutral.
* Rewrite `specs/stories/README.md` for Warrant.
* Rewrite `README.md`'s `## Governance` section (currently lines 1718-1791):
  Warrant governs how work is specified; ForgePilot and `make verify` decide
  when it is done; ForgeFlow is not mentioned. The
  `### Where decisions live: docs/adr/` subsection stays, rewritten to say
  that decision records live in `docs/adr/`, without citing ADR-0029 or a
  Story's `Decision:` field.
* Add `docs/adr/ADR-0040-<slug>.md`, "Replace ForgeFlow with Warrant", in the
  existing ADR format (`# Title`, then `* Status:` and `* Date:` bullets). Mark
  ADR-0025, ADR-0027, ADR-0029, ADR-0031, ADR-0032 and ADR-0036 superseded by
  ADR-0040 using the convention of
  `docs/adr/ADR-0030-a-permission-nobody-filled-in-is-not-a-control.md` lines
  3-5 (`* Status: superseded` and a `* Superseded by:` bullet), leaving their
  bodies unchanged.
* Commits no longer need a `Story:` trailer.

## Out of Scope

* The 49 `specs/stories/DBCLI-*` directories, `specs/handoff.md`, and
  `specs/stories/SCENARIO-MAP.md`: they stay byte-identical as legacy records
  (`tests/docs/capability-ordering-parity.test.ts` and others still read them).
* ADR-0026 and ADR-0033 (attestation, still in force), ADR-0030 (already
  superseded), and every other ADR not named in the Goal.
* `CHANGELOG.md`: this repository keeps no Unreleased section; the note that
  the package no longer ships the `story-development` skill is written at
  release time.
* Dated review documents under `docs/` (for example
  `docs/2026-09-08-forgeflow-and-forgepilot-adoption-review.md`,
  `docs/2026-09-10-handoff-sections-without-a-commit.md`, and
  `docs/plans/2026-09-04-agent-integration-contract-v1.md`).
* The product's own handoff feature (`src/`, `docs/user/`, `skills/dbcli/`,
  and the like), `CONTEXT.md`, and `GEMINI.md`.
* `scripts/write-attestation.ts` and the verification attestation, which
  ForgePilot still uses.
* Any `AGENTS.md` section other than the two named in the Goal, and any CI job
  other than `forgeflow-contract` and the integration job lines named above.
* Releases, version bumps, tags, pushes, merges, dependency changes, and
  `.forgepilot/`.

## Acceptance Criteria

1. `grep -n -i -E 'forgeflow|story-development|story id|handoff|(story|acceptance|task)\.md' AGENTS.md`
   prints nothing.
2. The text of `agents-block.md` (path in the Goal), with
   `<the single command that decides whether work is done>` replaced by
   `make verify`, appears verbatim in `AGENTS.md`:
   `bun -e 'const a=await Bun.file("AGENTS.md").text(); const b=(await Bun.file("/Users/carl/.claude/plugins/cache/warrant/warrant/0.1.2/skills/warrant/agents-block.md").text()).replace("<the single command that decides whether work is done>","make verify"); console.log(a.includes(b.trimEnd()))'`
   prints `true`, and `grep -n -F '<the single command' AGENTS.md` prints
   nothing.
3. `grep -n '^## ' AGENTS.md` lists `## ForgePilot Work Control Plane`,
   `## Warrant`, and `## dbcli Usage Guidelines` as consecutive entries in that
   order.
4. `diff <(git show main:AGENTS.md | sed -n '1,/^## ForgePilot Work Control Plane$/p') <(sed -n '1,/^## ForgePilot Work Control Plane$/p' AGENTS.md)`
   prints nothing.
5. `diff <(git show main:AGENTS.md | sed -n '/^## dbcli Usage Guidelines$/,$p') <(sed -n '/^## dbcli Usage Guidelines$/,$p' AGENTS.md)`
   prints nothing.
6. In `## ForgePilot Work Control Plane`, the lines other than the protocol
   wording are unchanged:
   `diff <(git show main:AGENTS.md | sed -n '/^## ForgePilot Work Control Plane$/,/^## ForgeFlow Story Development$/p' | grep -E '^(Before starting|[1235678]\. |ForgePilot.s own documentation)') <(sed -n '/^## ForgePilot Work Control Plane$/,/^## Warrant$/p' AGENTS.md | grep -E '^(Before starting|[1235678]\. |ForgePilot.s own documentation)')`
   prints nothing; step 4 names `specs/stories/<slug>.md`; and the opening
   paragraph still states that `make verify` is the canonical verification,
   that dbcli neither imports nor requires ForgePilot, and that
   `.forgepilot/` is local state, not source.
7. `git ls-files specs/.forgeflow-adoption specs/stories/_template .agents/skills/story-development scripts/check-forgeflow-adoption.ts scripts/lib/forgeflow-adoption.ts scripts/check-forgeflow-handoff.ts scripts/lib/forgeflow-handoff.ts scripts/check-forgeflow-contract.ts scripts/lib/forgeflow-contract.ts tests/contract/forgeflow-adoption.test.ts tests/unit/scripts/forgeflow-contract.test.ts tests/unit/scripts/forgeflow-handoff.test.ts`
   prints nothing.
8. `diff <(git show main:Makefile | grep -v -e 'forgeflow:check' -e 'plan:check') <(grep -v 'plan:check' Makefile)`
   prints nothing, and
   `grep -c -F "step='bun run plan:check' && run; \\" Makefile` prints `1`.
9. `diff <(git show main:package.json | grep -v -E '"forgeflow:(check|contract)"') package.json`
   prints nothing.
10. `diff <(git show main:tests/contract/forgepilot-boundary.test.ts | grep -v -F "'bun run forgeflow:check',") tests/contract/forgepilot-boundary.test.ts`
    prints nothing.
11. `grep -n -i -E 'forgeflow|fetch-depth|Story:' .github/workflows/ci.yml`
    prints nothing, and
    `git diff -U0 main...HEAD -- .github/workflows/ci.yml | grep -E '^\+[^+]'`
    prints only comment lines (each matching `^\+ *#`).
12. `specs/stories/README.md` states that a Story is `specs/stories/<slug>.md`
    with exactly the sections Goal, Out of Scope, and Acceptance Criteria; that
    a Story is approved only when a human commits it to the default branch or
    explicitly assigns it in the current session; that completion is proven by
    `make verify`; and that the existing `DBCLI-*` directories,
    `SCENARIO-MAP.md`, and `specs/handoff.md` are legacy records, not pending
    work.
13. `grep -n -i -E 'forgeflow|_template|story-development|trailer|(story|acceptance|task)\.md' specs/stories/README.md`
    prints nothing.
14. `sed -n '/^## Governance$/,/^## License$/p' README.md | grep -n -i -E 'forgeflow|story-development|trailer|_template|ADR-00(25|27|29|30|31|32|36)'`
    prints nothing, and the same section names Warrant, ForgePilot, and
    `make verify`. Within it,
    `` sed -n '/^### Where decisions live: `docs\/adr\/`$/,/^### /p' README.md | grep -c -F 'docs/adr/' ``
    prints a number of at least 2 (the heading plus at least one body line),
    and
    `` sed -n '/^### Where decisions live: `docs\/adr\/`$/,/^### /p' README.md | grep -n -F 'Decision:' ``
    prints nothing.
15. `diff <(git show main:README.md | sed '/^## Governance$/,/^## License$/d') <(sed '/^## Governance$/,/^## License$/d' README.md)`
    prints nothing.
16. `ls docs/adr/ADR-0040-*.md` lists exactly one file; it begins with a
    `# ` title line followed by `* Status: accepted` and a `* Date:` bullet;
    and
    `for n in 0025 0027 0029 0031 0032 0036; do grep -q "ADR-$n" docs/adr/ADR-0040-*.md || echo "missing $n"; done`
    prints nothing.
17. For each of ADR-0025, ADR-0027, ADR-0029, ADR-0031, ADR-0032, and
    ADR-0036, `git diff -U0 main...HEAD -- <that file> | grep -E '^[-+][^-+]'`
    prints exactly three lines: `-* Status: accepted`, `+* Status: superseded`,
    and `+* Superseded by: ADR-0040`.
18. `git diff --name-only main...HEAD -- docs/adr/ADR-0026-a-verification-attestation-is-not-an-evidence-receipt.md docs/adr/ADR-0033-a-fail-names-the-step-it-stopped-at.md docs/adr/ADR-0030-a-permission-nobody-filled-in-is-not-a-control.md`
    prints nothing.
19. `git diff --name-only main...HEAD -- 'specs/stories/DBCLI-*' specs/stories/SCENARIO-MAP.md specs/handoff.md`
    prints nothing.
20. `git grep -n -i -E 'forgeflow|story-development' -- ':!specs/stories/DBCLI-*' ':!specs/handoff.md' ':!specs/stories/SCENARIO-MAP.md' ':!specs/stories/warrant-migration.md' ':!specs/stories/brace-expansion-advisory-override.md' ':!specs/stories/integration-kit-test-builds-dist.md' ':!CHANGELOG.md' ':!docs/2026-09-08-forgeflow-and-forgepilot-adoption-review.md' ':!docs/adr/ADR-0025-*' ':!docs/adr/ADR-0027-*' ':!docs/adr/ADR-0029-*' ':!docs/adr/ADR-0030-*' ':!docs/adr/ADR-0031-*' ':!docs/adr/ADR-0032-*' ':!docs/adr/ADR-0036-*' ':!docs/adr/ADR-0040-*'`
    prints nothing.
21. `npm pack --dry-run 2>&1 | grep -F '.agents/skills/story-development'`
    prints nothing.
22. `git diff --name-status main...HEAD` lists only: `M .github/workflows/ci.yml`,
    `M AGENTS.md`, `M Makefile`, `M README.md`, `M package.json`,
    `M specs/stories/README.md`, `M tests/contract/forgepilot-boundary.test.ts`,
    `A docs/adr/ADR-0040-<slug>.md`, `M` for the six ADRs named in criterion
    17, `D` for the fourteen files listed in criterion 7 (the three
    `specs/stories/_template/` files and
    `.agents/skills/story-development/SKILL.md` counted individually), and
    `specs/stories/warrant-migration.md` if it is not already on `main`.
23. `make verify` exits 0.
