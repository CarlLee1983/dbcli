# Integration Check Report

**Product:** [dbcli](https://github.com/CarlLee1983/dbcli) (`@carllee1983/dbcli`)  
**Last reviewed:** 2026-04-23  
**Scope:** End-to-end wiring of config → adapters → permissions → commands (living checklist, not a one-time “milestone” gate).

**Status:** Re-run this document after refactors, new subcommands, or **minor** release candidates.

---

## Executive summary

The CLI is structured as: **read config (v1/v2, multi-connection)** → **open DB via `AdapterFactory`** → **enforce permission + blacklist** → **executors** (query / DML / schema / etc.). The **`skill`** subcommand does **not** generate markdown at runtime; it **copies** the bundled files **`assets/SKILL.md`** and **`assets/reference.md`** from the package (see `src/commands/skill.ts`).

**Cross-phase wiring** from old roadmap text (e.g. “Milestone v13.0” / a runtime **`SkillGenerator`**) is **not** the current `skill` implementation — the repo uses **static assets** so the skill text is reviewable in Git.

---

## How to re-verify (maintainer)

| Step | Command / action | Pass criteria |
| ---- | ----------------- | ------------- |
| Build | `bun run build` | `dist/cli.mjs` exists, executable, shebang `#!/usr/bin/env bun` (see `scripts/build.ts`) |
| TypeScript | (via build / IDE) | No compile errors in `src/` |
| Unit + core tests | `bun run test:unit` | Fast smoke; some **MongoDB** tests can fail if drivers or env are unavailable — treat as **env-specific** until CI is documented |
| Optional full suite | `bun test` | May include live DB; use `LIVE_DB_CONFIG_PATH`, `SKIP_INTEGRATION_TESTS` per [README.md](./README.md#development) |
| Package layout | `npm pack --dry-run` | See [README.dev.md](./README.dev.md): `dist/`, `assets/`, `README.md`, `CHANGELOG.md`, `LICENSE` |

> **Build size:** `dist/cli.mjs` is a **single bundle** (on the order of **a few MB** in dev builds). The **publishable `.tgz`** is much smaller. Ignore obsolete snapshots that cited **~1.1 MB** for `dist/` or **~315 kB** tarballs as fixed “truth.”

---

## Module wiring (conceptual)

| Area | Main entry / pattern | Used by (examples) |
| ---- | -------------------- | ------------------ |
| **Config** | `configModule`, v2 connections, `~/.config/dbcli/` + `.dbcli` | Init, any command that needs DB or project paths |
| **Adapters** | `AdapterFactory` (SQL + MongoDB) | `list`, `query`, `schema` (SQL), `migrate`, … |
| **Permissions** | `enforcePermission` + permission in config | Query / DML / `migrate` |
| **Blacklist** | Config + query result redaction | `query`, … |
| **Schema** | Cache / writers under `.dbcli/schemas/` | `schema`, `migrate` follow-up, `check`, … |
| **Execution** | `QueryExecutor` and DML paths | `query`, `insert`, `update`, `delete`, `export` |
| **AI skill** | **Static** `assets/SKILL.md` + `assets/reference.md` | `dbcli skill`, `dbcli skill --install` |

> **Name drift:** `SkillGenerator` appears in **`.planning/...`** and old phase write-ups; **runtime behavior** is **`src/commands/skill.ts`** + **`assets/`.**

---

## Representative E2E flows (high level)

| User flow | Involves (conceptually) | Notes |
| --------- | ------------------------- | ----- |
| New project + DB | `init` → config + connection test | v2: `--conn-name`, `--use`, `use` |
| Discover schema | `schema` (per-connection cache) | See `.dbcli/schemas/<connection>/` |
| Read / export | `list` / `query` / `export` + permission + blacklist | Query-only `LIMIT` as documented |
| Write data | `insert` / `update` / `delete` + permission | `--dry-run` for writes where applicable |
| DDL | `migrate` (defaults to dry-run) | `admin` permission |
| AI | `skill` / `skill --install` | Copies bundled `SKILL.md` and `reference.md` |

---

## API / “coverage” (intent, not a % gate)

| Component / asset | Role today |
| ----------------- | ---------- |
| `configModule` | Project binding and connection resolution |
| `AdapterFactory` | SQL and MongoDB command entry |
| `enforcePermission` | Operation vs allowed permission level |
| `assets/SKILL.md` + `assets/reference.md` | Shipped to users; `skill` copies or prints them |
| `SchemaDiffEngine` (and `diff` command) | Live vs snapshot schema diffs (see user docs) |

---

## Findings & follow-ups (non-binding)

1. **Import style:** Prefer a consistent barrel (`@/core`) vs deep imports where it helps readability; cosmetic.
2. **Test matrix:** MongoDB-related tests may need a real driver / network; failures are not always “logic bugs.”
3. **Planning doc drift:** Treat **code + [README.md](./README.md)** as the integration source of truth; sync `.planning/` if you still rely on it for onboarding.

---

## Conclusion

- **Integration model:** config → adapter → permission/blacklist → executors; **`skill` = static assets, not a generator.**
- **Re-run** this checklist after **wiring changes**, **new database engines**, or **changes to `package.json` `files`**.

**Publication:** [README.dev.md](./README.dev.md) + [CONTRIBUTING.md](./CONTRIBUTING.md); do not rely on frozen test counts or tarball sizes from earlier milestone snapshots.
