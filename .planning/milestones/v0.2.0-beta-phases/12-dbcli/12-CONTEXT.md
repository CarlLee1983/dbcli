# Phase 12: i18n System - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning
**Source:** Discussion phase (discuss-phase workflow)

---

<domain>

## Phase Boundary

Transform dbcli from Traditional Chinese-first system to support English as the primary language while maintaining Traditional Chinese as an additional supported language. This includes:

- Extracting all user-facing messages from code into translation files
- Implementing a centralized translation system
- Supporting language selection via environment variable
- Ensuring consistency across CLI help text, error messages, success messages, and documentation

**Scope:**
- CLI help text and command descriptions
- Error and warning messages
- Success messages and confirmations
- Documentation and README

**Out of scope:**
- Runtime language switching (language fixed at startup)
- Additional languages beyond English and Traditional Chinese in this phase
- RTL language support or complex pluralization rules
- Web UI translation (dbcli is CLI-only)

</domain>

---

<decisions>

## Implementation Decisions

### Message Architecture
- **Decision:** Separate JSON translation files (i18next pattern)
- **Rationale:** Industry standard, supports hot-reload, easy to audit
- **Structure:**
  - `resources/lang/en/messages.json` — English messages
  - `resources/lang/zh-TW/messages.json` — Traditional Chinese messages
  - Messages indexed by keys (e.g., `"init.welcome"`, `"error.invalid_config"`)

### Translation Content Scope
- ✅ CLI help text and command descriptions (all `--help` output)
- ✅ Error and warning messages (validation, runtime errors)
- ✅ Success messages and confirmations (operation feedback)
- ✅ Documentation and README files

### Language Selection Mechanism
- **Decision:** Environment variable (`DBCLI_LANG=en` or `DBCLI_LANG=zh-TW`)
- **Rationale:** Developer-friendly, explicit, consistent across environments
- **Default behavior:** If `DBCLI_LANG` unset, default to English
- **Configuration:** Language is selected at CLI startup, fixed for the session

### Message Management Strategy
- **Decision:** Centralized message registry
- **Structure:**
  - `resources/lang/en/messages.json` — all English messages (one file)
  - `resources/lang/zh-TW/messages.json` — all Traditional Chinese messages (one file)
  - Namespaced keys for organization (e.g., `"init"`, `"schema"`, `"query"`, `"errors"`, `"success"`)
- **Rationale:** Easy to audit, ensures no orphaned strings, scales well for Phase 12 scope

### Message Loader Implementation
- Create `src/i18n/MessageLoader` class to:
  - Load JSON files at startup based on `DBCLI_LANG`
  - Provide getter functions: `t(key: string): string`
  - Handle missing keys gracefully (fallback to English)
- Export as singleton for use across commands

### Code Integration Pattern
- Each command injects the i18n loader
- Replace all hardcoded messages with `t("key.path")`
- No controller-level message service (simpler than gravito-ddd pattern for CLI context)

### Documentation Approach
- Translate README.md, CONTRIBUTING.md, docs/
- Maintain synchronized versions:
  - `README.md` (English primary)
  - `README.zh-TW.md` (Traditional Chinese)
- Use same approach for all documentation files

### Deferred
- Runtime language switching (requires session state, Phase 13+)
- Additional languages beyond EN/ZH-TW (Phase 13+)
- Pluralization rules and gender-aware translations (Phase 13+ if needed)
- Community translation workflows (Phase 14+)

</decisions>

---

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — dbcli vision, constraints, and current state
- `.planning/REQUIREMENTS.md` — active requirements for phases 1-11
- `.planning/STATE.md` — current project state and completed phases

### Existing i18n Patterns (if any)
- Current codebase is entirely in Traditional Chinese — no existing translation infrastructure
- All messages are currently hardcoded in commands and components

### Related Prior Phases
- Phase 10: Polish & Distribution (set up npm publishing)
- Phase 11: Schema Optimization (performance baseline)

### CLI Pattern Reference
- `src/cli.ts` — CLI command registration and entry point
- `src/commands/*.ts` — all command handlers (target files for message extraction)

</canonical_refs>

---

<specifics>

## Specific Ideas & Examples

### Message Namespace Organization
```json
{
  "init": {
    "welcome": "Welcome to dbcli",
    "prompt_host": "Database host: "
  },
  "schema": {
    "fetching": "Fetching schema...",
    "success": "Schema updated"
  },
  "query": {
    "no_results": "No results returned"
  },
  "errors": {
    "invalid_config": "Invalid configuration",
    "connection_failed": "Failed to connect"
  },
  "success": {
    "inserted": "Successfully inserted {count} row(s)"
  }
}
```

### Environment Variable Usage
```bash
# Default (English)
dbcli init
# → All messages in English

# Traditional Chinese
DBCLI_LANG=zh-TW dbcli init
# → All messages in Traditional Chinese

# In .env file
DBCLI_LANG=zh-TW
```

### Language Fallback
- If `DBCLI_LANG` is set to unsupported value → log warning, default to English
- If key missing from current language file → fallback to English key
- If key missing from both → show key name (error case)

</specifics>

---

<deferred>

## Deferred Ideas

- **Runtime language switching** — Allow users to change language mid-session (`dbcli set-lang zh-TW`). Phase 13+.
- **Additional languages** — Support Japanese, Korean, Spanish, etc. Phase 13+ (requires translation workflows).
- **Pluralization & gender-aware messages** — Sophisticated message templates. Phase 13+ (likely not needed).
- **Community translations** — GitHub-based translation contributions. Phase 14+.
- **AI-assisted translation validation** — Use Claude API to validate translations for accuracy/consistency. Phase 14+.

</deferred>

---

*Phase: 12-dbcli*
*Context gathered: 2026-03-26 via discuss-phase workflow*
