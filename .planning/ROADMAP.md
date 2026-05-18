# Roadmap: dbcli

## Milestones

- ✅ **v1.20.1 Phase 23-04 Closure Patch** — `insert/update/delete/export/q/schema` audit wiring + bi-directional ref (shipped 2026-05-18)
- ✅ **v1.20.0 Agent-Facing Audit Log** — Phases 21–26 (shipped 2026-05-17) — [archive](milestones/v1.20.0-ROADMAP.md) · [requirements](milestones/v1.20.0-REQUIREMENTS.md)
- ✅ **v1.19.1 Post-release Contract Stabilization Patch** — shipped 2026-05-14
- ✅ **v1.19.0 Expanded Antigravity Protocol & Agent Support** — shipped 2026-05-11
- ✅ **v1.18.0 Interactive HTML Dashboards** — shipped 2026-05-11
- ✅ **v1.17.0 Guided Remediation & Multi-turn Recovery** — shipped 2026-05-10
- ✅ **v1.11.0 Saved Queries Discovery** — shipped 2026-05-08
- ✅ **v1.10.x Packaging Hotfix + ES/Redis Saved Queries** — shipped 2026-05-08
- ✅ **v1.9.x Agent Task Packs + Skill 連線指引** — shipped 2026-05-06 / 2026-05-07
- ✅ **v1.8.0 Redis & Elasticsearch 完整支援** — shipped 2026-05-06
- ✅ **v1.7.0 Saved Queries (snippets)** — shipped 2026-05-04
- ✅ **v1.6.0 Full MongoDB Support** — shipped 2026-04-23
- ✅ **v1.5.x Layered Schema Cache & MongoDB SRV** — shipped 2026-04-21 / 2026-04-22
- ✅ **v1.3.0 Skill Update Reminders** — shipped 2026-04-02
- ✅ **v1.2.0 Multi-connection & REPL** — shipped 2026-03-31
- ✅ **v0.2.0-beta Data Access Control** — shipped 2026-03-26 — [archive](milestones/v0.2.0-beta-ROADMAP.md)
- ✅ **v0.1.0-beta Core + i18n + Schema Optimization** — shipped 2026-03-26 — [archive](milestones/v0.1.0-beta-ROADMAP.md)
- 📋 **Next milestone** — TBD (候選方向見 PROJECT.md → Next Milestone Goals)

## Phases

<details>
<summary>✅ v1.20.0 Agent-Facing Audit Log (Phases 21–26) — SHIPPED 2026-05-17</summary>

- [x] Phase 21: Audit Writer Foundation (5/5 plans) — completed 2026-05-15
- [x] Phase 22: Entry Schema & Redaction Contract (3/3 plans) — completed 2026-05-15
- [x] Phase 23: Engine Integration & Rejection Paths (3/3 plans + Phase 23-04 follow-up 2026-05-18) — diagnostic surface 2026-05-15；DML/DDL (`insert/update/delete/export/q/schema`) audit + bi-directional ref wiring shipped 2026-05-18 (`feat/audit-wire-6-commands`, merge `60eab9b`)
- [x] Phase 24: `dbcli audit` CLI (5/5 plans) — completed 2026-05-15
- [x] Phase 25: Recovery Envelope Bi-directional Linkage (9/9 plans) — completed 2026-05-16
- [x] Phase 26: Docs, Skill & Release Gate (4/4 plans) — completed 2026-05-17

**Full archive:** [`.planning/milestones/v1.20.0-ROADMAP.md`](milestones/v1.20.0-ROADMAP.md)

</details>

### 📋 Next Milestone (To Be Planned)

待定。候選方向參考 `.planning/PROJECT.md → Next Milestone Goals`。

**Carried over backlog:** 無 — Phase 23-04 (`writeAuditEntry` wiring + bi-directional `audit_ref` ⇄ `recovery_ref` on `insert / update / delete / export / q / schema`) 已於 2026-05-18 補完 (`feat/audit-wire-6-commands` merge `60eab9b`)，INTEGRATE-01 / INTEGRATE-04 partial 全部結清。

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 21. Audit Writer Foundation | v1.20.0 | 5/5 | Complete | 2026-05-15 |
| 22. Entry Schema & Redaction Contract | v1.20.0 | 3/3 | Complete | 2026-05-15 |
| 23. Engine Integration & Rejection Paths | v1.20.0 | 3/3 + 23-04 follow-up | Complete (diagnostic 2026-05-15; DML/DDL 2026-05-18) | 2026-05-18 |
| 24. `dbcli audit` CLI | v1.20.0 | 5/5 | Complete | 2026-05-15 |
| 25. Recovery Envelope Bi-directional Linkage | v1.20.0 | 9/9 | Complete | 2026-05-16 |
| 26. Docs, Skill & Release Gate | v1.20.0 | 4/4 | Complete | 2026-05-17 |

---

*Last updated: 2026-05-18 — v1.20.0 milestone archived 2026-05-17；Phase 23-04 follow-up (`feat/audit-wire-6-commands`, merge `60eab9b`) released as **v1.20.1** patch on 2026-05-18，所有 carry-over backlog 結清。Awaiting next milestone definition via `$gsd-new-milestone`.*
