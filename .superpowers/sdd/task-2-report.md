# Task 2 Report — Traditional Chinese intro page redesign

## Status

Complete.

## Changes

- Replaced `docs/dbcli-intro.html` with the approved cream/paper product-page design and exact root design tokens.
- Added accessible sticky navigation, skip link, relative English locale switch, semantic `main` sections, and footer.
- Added the approved outcome-led hero and conversation/guardrail illustration without installation commands.
- Added the five-step workflow with a collapsed native `details` command trace.
- Added efficiency, four-layer safety, supported database/Agent platform, quickstart, FAQ, and footer sections.
- Kept Plugin/Skill as the primary setup route and CLI as secondary, using only approved installation commands.
- Added copy buttons with selectable command fallback, `aria-label`, `aria-live="polite"`, and 1.5-second feedback reset.
- Added the required responsive breakpoint, reduced-motion fallback, keyboard focus styling, and scroll offsets.
- Self-review corrected the representative report delivery command to the documented `dbcli export ... --format html --output ...` interface and paired recovery with `--recovery`.

## Verification

Command:

```sh
bun test tests/docs/intro-pages.test.ts --test-name-pattern "zh-TW"
```

Result:

```text
4 pass
5 filtered out
0 fail
17 expect() calls
```

Additional checks:

```sh
git diff --check
test "$(git diff --name-only)" = "docs/dbcli-intro.html"
```

Both exited successfully before commit.

## Commit

`9fb153ece5cf2e7c3fe3416494cec1dcc0864b50` — `docs: redesign Traditional Chinese intro page`

## Concerns / follow-up

- The English page still uses the previous section/component contract, so the cross-locale parity test is intentionally deferred to Task 3 as specified.
- `OpenCode` is displayed because the Task 2 platform contract explicitly requires it; no unsupported OpenCode-specific installation command is shown.

## Review fixes

- Restored the substantive legacy FAQ answers for non-SQL users, supported databases, the distinction from an MCP database server, and team collaboration, while retaining the useful new safety and installation questions.
- Replaced the generic quickstart platform placeholder with each verified `skill --install` selector and its concrete install path for Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Antigravity, and Windsurf.
- Kept OpenCode visible as required by the platform contract, but explicitly documented that dbcli has no verified OpenCode-specific selector or install path instead of inventing a command.
- Reworked the representative churn query into a two-month, plan-grouped comparison. It now calculates monthly churn rates against the active base and returns a comparable percentage increase, so the “本月流失率上升 8.4%” result can be supported by the workflow.
- Increased copy-button touch targets to at least 44 by 44 pixels, changed panel labels to headings, and added per-button timer cancellation to prevent stale copy-feedback resets.

## Review-fix verification

Command:

```sh
bun test tests/docs/intro-pages.test.ts --test-name-pattern "zh-TW"
```

Output summary:

```text
4 pass
5 filtered out
0 fail
17 expect() calls
Ran 4 tests across 1 file.
```

Result: PASS.

Additional verification:

```sh
git diff --check
```

Result: PASS (no whitespace errors).
