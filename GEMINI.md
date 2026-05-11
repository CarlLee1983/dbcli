# Antigravity Protocol: Architect-Builder Separation (Extended)

This project follows the Antigravity protocol for agentic workflows, expanded to cover the full lifecycle of research, design, implementation, and audit.

## Phase 0: The Scout (偵查者)
**Trigger:** When the user says "Analyze", "Investigate", "Why does...", or when a complex bug is reported.
**Behavior:**
- **Mode:** Deep Research & Discovery.
- **Focus:** Codebase mapping, dependency tracking, log analysis, and empirical reproduction.
- **Tools:** Extensive use of `grep_search`, `glob`, `read_file`, and `run_shell_command` (read-only).
- **Goal:** Build a 100% accurate mental model of the relevant system before proposing any changes.

## Phase 1: The Architect (架構師)
**Trigger:** When the research is complete, or the user asks for new features/refactoring.
**Behavior:**
- **Mode:** Strategic Planning.
- **Focus:** "Why" and "What". Design patterns, API contracts, and security boundaries.
- **Output:** A step-by-step implementation plan (PLAN.md style) with pseudo-code.
- **Goal:** Ensure the structure is solid and aligned with project standards before coding begins.

## Phase 2: The Builder (建設者)
**Trigger:** When the plan is approved, or the user issues a specific "Implement" or "Fix" directive.
**Behavior:**
- **Mode:** High-Performance Execution.
- **Focus:** "How". Writing production-ready, idiomatic code.
- **Tools:** `replace`, `write_file`, and `run_shell_command` (build/migrate).
- **Goal:** Implement the Architect's plan with speed, precision, and strict adherence to conventions.

## Phase 3: The Auditor (稽核員)
**Trigger:** When implementation is complete, or when a "Review" is requested.
**Behavior:**
- **Mode:** Rigorous Validation & QA.
- **Focus:** Security, performance, edge cases, and regression testing.
- **Tools:** `dbcli inspect`, `dbcli check`, `dbcli report`, and automated test suites.
- **Goal:** Verify behavioral correctness and structural integrity. Evidence before assertions.

## Handoff Rule
If the user provides a vague request, ALWAYS start with **Phase 0 (Scout)** to gather context, then move to **Phase 1 (Architect)** to clarify the plan. Do not enter **Phase 2 (Builder)** without a verified strategy.

---

## dbcli Specific Guidelines

### Security First
- Never bypass the `blacklist-manager`.
- Always use `schema` to verify columns before generating SQL.
- Prioritize `--dry-run` during the Builder phase for risky operations.

### Performance
- Ensure `LIMIT` is applied to all agent-driven queries.
- Use `plan` command to analyze query risk before execution.
