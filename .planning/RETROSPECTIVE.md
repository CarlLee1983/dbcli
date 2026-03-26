# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v14.0 — Data Access Control

**Shipped:** 2026-03-26
**Phases:** 1 | **Plans:** 3 (1 core + 2 gap closure)

### What Was Built
- Table and column-level blacklisting with O(1) Set/Map lookups
- CLI management commands (blacklist list/table/column add/remove)
- Security notifications in all output formats (table, CSV, JSON)
- End-to-end CLI wiring across all 4 execution commands
- Context-aware override via environment variable
- 103 new tests (83 core + 12 wiring + 8 formatter)

### What Worked
- Infrastructure-first approach: building BlacklistManager, BlacklistValidator, and executor integration as a foundation was solid
- Gap closure workflow: verification caught the CLI wiring gap, gap plans fixed it cleanly with minimal scope
- Parallel executor agents for independent gap closure plans saved time
- TDD approach produced comprehensive test coverage from the start

### What Was Inefficient
- Plan 01 built all infrastructure but stopped short of CLI wiring — verification caught this as a critical gap
- Required 2 extra gap closure plans (13-02, 13-03) for what could have been included in the original plan
- The original plan had 15 tasks but left the final integration step for "a future phase"

### Patterns Established
- Gap closure workflow (verify → plan gaps → execute gaps-only) is effective for catching integration gaps
- `--gaps-only` flag allows targeted re-execution without re-running completed plans
- Single-day milestone delivery is feasible for focused, well-scoped work

### Key Lessons
1. Plans should include end-to-end integration, not just infrastructure — "wire it up" should be part of the original plan, not deferred
2. Verification after execution is essential — the gap between "code exists" and "code is connected" is where security bugs hide
3. Blacklist-style access control (deny-list) is simpler to implement and reason about than fine-grained ACL (allow-list)

### Cost Observations
- Model mix: ~10% opus (orchestration), ~90% sonnet (execution)
- Sessions: 2 (gap closure + full execution)
- Notable: Gap closure plans executed in ~6 minutes total; verification confirmed zero regressions

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v14.0 | 1 | 3 | Gap closure workflow validated; --gaps-only execution mode |

### Cumulative Quality

| Milestone | Tests | Key Metric |
|-----------|-------|------------|
| v14.0 | 230+ | 10/10 verification, 0 regressions, < 1ms blacklist overhead |

### Top Lessons (Verified Across Milestones)

1. End-to-end wiring must be part of the plan, not deferred — infrastructure without integration is dead code
2. Verification-driven development catches gaps that unit tests miss
