# Phase 7: Data Modification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis process.

**Date:** 2026-03-25
**Phase:** 07-data-modification
**Mode:** discuss
**Facilitator:** Claude Code (discuss-phase skill)
**Participants:** Carl (project lead)

---

## Discussion Summary

Phase 7 scope covers implementing `dbcli insert` and `dbcli update` commands with safety safeguards. Four key decision areas were identified and discussed.

---

## Decisions Made

### 1. Data Input Method (D-01)
**Question:** How should INSERT command accept data — JSON stdin, --data flag, or both?

**User Choice:** JSON stdin priority
- **Rationale:** Stdin enables piping, automation, and integration with scripts
- **Alternative:** --data flag as backup for simple single-row cases
- **Example:** `dbcli insert users < data.json` (primary), `--data '{"name":"Alice"}'` (fallback)

---

### 2. UPDATE WHERE Clause (D-02)
**Question:** How to specify WHERE condition for UPDATE — separate --where flag, part of --data, or interactive?

**User Choice:** `--set` + `--where` as separate, explicit flags
- **Rationale:** Clear distinction between data being updated and update conditions
- **Structure:** `dbcli update users --where "id=1" --set '{"name":"Bob"}'`
- **Safety note:** WHERE is mandatory at CLI level (enforced before SQL generation)

---

### 3. Pre-Execution Confirmation (D-03a, D-03b, D-03c)

**3a. Confirmation Flow**
- **Question:** Should execution require confirmation? Always interactive, or skippable?
- **User Choice:** Automatic confirmation with SQL display + interactive y/n prompt
- **Behavior:** Always show generated SQL before execution, always require user y/n

**3b. Skip Confirmation with --force**
- **Question:** Should --force flag allow skipping confirmation (for automation)?
- **User Choice:** Yes, support --force
- **Use case:** CI/CD pipelines, background scripts, non-interactive environments
- **Note:** SQL still shown before execution even with --force

**3c. --dry-run Mode**
- **Question:** Should --dry-run show SQL without executing?
- **User Choice:** Yes, support --dry-run
- **Behavior:** Display SQL and would-be results, zero database changes
- **Use case:** Testing, verifying command correctness before real execution

---

### 4. Output Format (D-04a, D-04b)

**4a. Output Content**
- **Question:** What should success output show — row count only, affected data, or full details?
- **User Choice:** Simple, concise summary (row count only)
- **Format:** `{"status":"success","rows_affected":1,"operation":"insert"}`

**4b. Output Format**
- **Question:** Should output be human-readable text, JSON, or support both?
- **User Choice:** Consistent JSON format (same as dbcli query --format json)
- **Rationale:** Aligns with existing tool conventions, enables automation

---

### 5. Error Messages & Permissions (D-05a, D-05b)

**5a. SQL Display in Errors**
- **Question:** Should error messages show the generated SQL?
- **User Choice:** Yes, show SQL for debugging transparency
- **Example:** `Error: SQL execution failed. Generated SQL: INSERT INTO... Cause: ...`
- **Benefit:** Helps users understand what command was attempted and why it failed

**5b. Permission Rejection Messages**
- **Question:** When Query-only mode rejects INSERT/UPDATE, what error message?
- **User Choice:** Clear message + upgrade suggestion
- **Format:** "Permission denied: Query-only mode allows SELECT only. Use Read-Write or Admin mode for INSERT/UPDATE."
- **Benefit:** User immediately understands restriction AND solution

---

## Areas of Agent Discretion

The following areas were NOT discussed because they are technical implementation details:

- Exact JSON field names in output structure
- Error message phrasing beyond the requirement for "clear + helpful"
- CLI argument parser implementation choice
- Connection/auth specific error messages

These are captured in CONTEXT.md section `### the agent's Discretion` for downstream agents to decide.

---

## Deferred Ideas (Out of Scope)

Ideas mentioned that belong to other phases:

- **Bulk operations** (CSV import, batch updates) — Phase 8+
- **Transaction support / rollback** — Phase 8+
- **Audit logging** (who changed what when) — Phase 9+
- **DELETE operation** — separate advanced data ops phase
- **Interactive field-by-field prompts** for INSERT — not needed for V1

---

## Next Steps

1. **Researcher** reads CONTEXT.md to investigate:
   - Parameterized query patterns for PostgreSQL/MySQL/MariaDB
   - CLI confirmation patterns (y/n prompts in Node.js)
   - JSON stdin parsing best practices

2. **Planner** creates implementation plan with tasks for:
   - INSERT command with stdin + --data flag support
   - UPDATE command with --set + --where flags
   - Confirmation flow (SQL display, y/n, --force, --dry-run)
   - Permission checking and error messages
   - Output formatting (JSON)

3. **Executor** implements following the plan

---

## Sign-Off

**Decisions confirmed:** All 9 decision items (D-01 through D-05b) agreed upon.
**Context ready for downstream:** CONTEXT.md captures all locked decisions.
**Ready to advance:** To planning phase.

*End of discussion log*
