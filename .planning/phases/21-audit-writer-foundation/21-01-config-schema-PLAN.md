---
phase: 21-audit-writer-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/utils/validation.ts
  - src/core/config.ts
  - tests/unit/core/config.test.ts
  - tests/unit/core/config-v2.test.ts
autonomous: true
requirements:
  - CONFIG-01
  - CONFIG-02
  - CONFIG-03
tags:
  - audit
  - config
  - zod-schema
  - phase-21
must_haves:
  truths:
    - "Existing v1.19.x .dbcli files parse successfully under v1.20.0 with audit fields auto-filled from zod defaults (CONFIG-03 / success criterion 6)"
    - "After parse, config object exposes audit.enabled (default true, D-01/D-11) and audit.rotation.max_bytes (default 10485760, D-11) and audit.rotation.max_entries (default 1000, D-11)"
    - "Both DbcliConfigSchema (V1) and DbcliConfigV2Schema (V2) accept the audit block so the V2 -> V1 down-mapping in src/core/config.ts:285-291 carries audit through"
    - "audit.enabled = false in .dbcli is preserved verbatim through parse (does not get overwritten by default)"
  artifacts:
    - path: "src/utils/validation.ts"
      provides: "AuditConfigSchema + AuditRotationConfigSchema zod definitions; audit field added to DbcliConfigSchema and DbcliConfigV2Schema"
      contains: "export const AuditConfigSchema"
    - path: "src/core/config.ts"
      provides: "audit field carried into V2 -> V1 down-mapping and legacy load path"
      contains: "audit: v2Config.audit"
    - path: "tests/unit/core/config-v2.test.ts"
      provides: "Parse coverage for upgraded .dbcli (no audit key), audit.enabled=false override, and full audit block override"
      contains: "audit.enabled"
  key_links:
    - from: "src/utils/validation.ts"
      to: "src/core/config.ts"
      via: "DbcliConfigSchema.parse({ ..., audit: v2Config.audit })"
      pattern: "audit:\\s*v2Config\\.audit"
    - from: "DbcliConfigV2Schema"
      to: "AuditConfigSchema"
      via: "schema composition (audit: AuditConfigSchema field)"
      pattern: "audit:\\s*AuditConfigSchema"
---

<objective>
Extend the zod config schemas with an `audit.*` block that satisfies CONFIG-01 (config surface), CONFIG-02 (opt-out kill switch), and CONFIG-03 (silent backwards-compatible migration). All three requirements are achieved through zod defaults — no procedural migration code is required, matching the existing pattern used by `BlacklistConfigSchema` and `MetadataSchema`.

Purpose: Provide a single, validated source of truth for `audit.enabled` and `audit.rotation` thresholds that the Wave-2 `AuditLogger` (Plan 21-04) will consume via constructor injection. Establish the opt-out kill switch before any writer code lands (per Roadmap Phase 21 sequencing).

Output: Two new exported zod schemas (`AuditConfigSchema`, `AuditRotationConfigSchema`); audit field added to both `DbcliConfigSchema` and `DbcliConfigV2Schema`; `src/core/config.ts` carries `audit` through V2 -> V1 down-mapping; unit tests prove backward-compat and override behavior.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/21-audit-writer-foundation/21-CONTEXT.md
@.planning/phases/21-audit-writer-foundation/21-PATTERNS.md
@AGENTS.md

<interfaces>
<!-- Existing zod patterns in src/utils/validation.ts that this plan extends. -->
<!-- Executor should mirror the BlacklistConfigSchema declaration style exactly. -->

From src/utils/validation.ts (existing, lines 113-144):
```typescript
export const MetadataSchema = z
  .object({
    createdAt: z.string().datetime().optional(),
    version: z.string().default('1.0'),
    schemaLastUpdated: z.string().datetime().optional(),
    schemaTableCount: z.number().int().nonnegative().optional(),
  })
  .optional()
  .default({})

export const BlacklistConfigSchema = z
  .object({
    tables: z.array(z.string()).default([]),
    columns: z.record(z.array(z.string())).default({}),
  })
  .optional()
  .default({ tables: [], columns: {} })

export const DbcliConfigSchema = z.object({
  connection: ConnectionConfigSchema,
  permission: PermissionSchema,
  schema: z.record(z.any()).optional().default({}),
  metadata: MetadataSchema,
  blacklist: BlacklistConfigSchema,
})

export const DbcliConfigV2Schema = z
  .object({
    version: z.literal(2),
    default: z.string().min(1),
    connections: z.record(NamedConnectionSchema).refine(/* ... */),
    schema: z.record(z.any()).optional().default({}),
    schemas: z.record(z.record(z.any())).optional().default({}),
    metadata: MetadataSchema,
    blacklist: BlacklistConfigSchema,
  })
  .refine(/* ... */)
```

From src/core/config.ts (existing, lines 285-291, the V2 -> V1 down-mapping):
```typescript
return DbcliConfigSchema.parse({
  connection: resolvedConnection,
  permission: resolved.permission,
  schema,
  metadata: v2Config.metadata,
  blacklist: v2Config.blacklist,
})
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add AuditConfigSchema + AuditRotationConfigSchema and extend both V1 and V2 schemas</name>
  <files>src/utils/validation.ts, tests/unit/core/config-v2.test.ts</files>
  <read_first>
    - src/utils/validation.ts (read in full — see existing BlacklistConfigSchema at lines 127-133 and DbcliConfigV2Schema at lines 186-201; mirror that style)
    - tests/unit/core/config-v2.test.ts (read existing structure to find where to add cases)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "MODIFIED: src/utils/validation.ts" (the analog excerpt)
    - .planning/phases/21-audit-writer-foundation/21-CONTEXT.md decisions D-11 (rotation defaults) and D-01 (default on)
  </read_first>
  <behavior>
    - Test 1: parsing a V2 `.dbcli` JSON that has NO `audit` key returns an object where `audit.enabled === true`, `audit.rotation.max_bytes === 10485760`, `audit.rotation.max_entries === 1000`
    - Test 2: parsing a V2 `.dbcli` JSON with `audit: { enabled: false }` returns `audit.enabled === false` and `audit.rotation` populated by defaults (10485760 / 1000)
    - Test 3: parsing a V2 `.dbcli` JSON with `audit: { enabled: true, rotation: { max_bytes: 5242880, max_entries: 500 } }` preserves the custom values
    - Test 4: parsing a V2 `.dbcli` JSON with `audit.rotation.max_bytes: 0` (invalid — must be positive int) throws a zod validation error
    - Test 5: parsing a V2 `.dbcli` JSON with `audit.rotation.max_bytes: -1` throws a zod validation error
  </behavior>
  <action>
    Add two new exported zod schemas to `src/utils/validation.ts` immediately above the `DbcliConfigSchema` declaration (after `BlacklistConfigSchema`, before line 138):

    ```typescript
    /**
     * Audit rotation thresholds schema (D-11)
     * Both thresholds default to the locked values; either trigger triggers rotation (OR relationship).
     */
    export const AuditRotationConfigSchema = z
      .object({
        max_bytes: z.number().int().positive().default(10_485_760),   // 10 MiB (D-11)
        max_entries: z.number().int().positive().default(1000),        // D-11
      })
      .optional()
      .default({ max_bytes: 10_485_760, max_entries: 1000 })

    /**
     * Audit configuration schema (CONFIG-01)
     * D-01: default enabled (opt-out).
     * D-11: rotation thresholds default to 10 MiB / 1000 entries.
     * Missing `audit` key in an upgraded .dbcli (CONFIG-03) is auto-filled by the zod default.
     */
    export const AuditConfigSchema = z
      .object({
        enabled: z.boolean().default(true),     // D-01: opt-out default ON
        rotation: AuditRotationConfigSchema,
      })
      .optional()
      .default({
        enabled: true,
        rotation: { max_bytes: 10_485_760, max_entries: 1000 },
      })
    ```

    Then extend `DbcliConfigSchema` (V1, currently at lines 138-144) to add `audit: AuditConfigSchema` after `blacklist`:

    ```typescript
    export const DbcliConfigSchema = z.object({
      connection: ConnectionConfigSchema,
      permission: PermissionSchema,
      schema: z.record(z.any()).optional().default({}),
      metadata: MetadataSchema,
      blacklist: BlacklistConfigSchema,
      audit: AuditConfigSchema,                 // NEW (CONFIG-01)
    })
    ```

    Then extend `DbcliConfigV2Schema` (V2, currently at lines 186-201) to add `audit: AuditConfigSchema` immediately after `blacklist: BlacklistConfigSchema` (before the `.refine(...)` call):

    ```typescript
    export const DbcliConfigV2Schema = z
      .object({
        version: z.literal(2),
        default: z.string().min(1),
        connections: z.record(NamedConnectionSchema).refine(/* existing — unchanged */),
        schema: z.record(z.any()).optional().default({}),
        schemas: z.record(z.record(z.any())).optional().default({}),
        metadata: MetadataSchema,
        blacklist: BlacklistConfigSchema,
        audit: AuditConfigSchema,               // NEW (CONFIG-01)
      })
      .refine(/* existing — unchanged */)
    ```

    Add five test cases to `tests/unit/core/config-v2.test.ts` (find a suitable existing `describe` block or add a new `describe('audit config schema (CONFIG-01 / CONFIG-03)', ...)` block). Use `DbcliConfigV2Schema.parse(...)` directly. The five cases correspond verbatim to Tests 1–5 in the behavior block.

    Do NOT add any imperative migration code. The zod `.optional().default(...)` chain is the migration mechanism — that is the locked decision per 21-PATTERNS.md "Why this satisfies CONFIG-03 with zero procedural code".
  </action>
  <verify>
    <automated>bun test tests/unit/core/config-v2.test.ts -t "audit config schema" 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `grep -E "^export const AuditRotationConfigSchema" src/utils/validation.ts` returns exactly one match
    - `grep -E "^export const AuditConfigSchema" src/utils/validation.ts` returns exactly one match
    - `grep -E "max_bytes.*10_485_760|max_bytes.*10485760" src/utils/validation.ts` returns at least two matches (schema default + outer default)
    - `grep -E "max_entries.*1000" src/utils/validation.ts` returns at least two matches
    - `grep -E "enabled:\s*z\.boolean\(\)\.default\(true\)" src/utils/validation.ts` returns exactly one match
    - `grep -nE "audit:\s*AuditConfigSchema" src/utils/validation.ts` returns exactly TWO matches (one in DbcliConfigSchema, one in DbcliConfigV2Schema)
    - `bun test tests/unit/core/config-v2.test.ts -t "audit config schema"` exits 0 with all five cases passing
    - `bun run typecheck` exits 0
  </acceptance_criteria>
  <done>
    AuditConfigSchema + AuditRotationConfigSchema exported from src/utils/validation.ts with the exact defaults specified above; both V1 and V2 root schemas include `audit: AuditConfigSchema`; five test cases in tests/unit/core/config-v2.test.ts pass; typecheck clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire audit field through src/core/config.ts (V2 -> V1 down-mapping and legacy load)</name>
  <files>src/core/config.ts, tests/unit/core/config.test.ts</files>
  <read_first>
    - src/core/config.ts (focus on lines 280-330 — the V2 -> V1 down-mapping at 285-291 and the legacy file branch at 316-325)
    - src/utils/validation.ts (post-Task-1 state — verify AuditConfigSchema is exported)
    - tests/unit/core/config.test.ts (read the existing test structure to find the right `describe` block)
    - .planning/phases/21-audit-writer-foundation/21-PATTERNS.md section "MODIFIED (likely no code change needed): src/core/config.ts"
  </read_first>
  <behavior>
    - Test 1: `configModule.read()` on a V2 .dbcli with no `audit` key returns a config object where `config.audit.enabled === true` and `config.audit.rotation.max_bytes === 10485760` and `config.audit.rotation.max_entries === 1000`
    - Test 2: `configModule.read()` on a V2 .dbcli with `audit: { enabled: false }` returns `config.audit.enabled === false`
    - Test 3: `configModule.read()` on a legacy V1 .dbcli with no audit key returns `config.audit.enabled === true` (defaults flow through legacy path)
  </behavior>
  <action>
    In `src/core/config.ts`, find the V2 -> V1 down-mapping block at lines 285-291 and add `audit: v2Config.audit` immediately after `blacklist: v2Config.blacklist`:

    ```typescript
    return DbcliConfigSchema.parse({
      connection: resolvedConnection,
      permission: resolved.permission,
      schema,
      metadata: v2Config.metadata,
      blacklist: v2Config.blacklist,
      audit: v2Config.audit,                  // NEW (CONFIG-03)
    })
    ```

    The legacy file branch at lines 316-325 calls `DbcliConfigSchema.parse(resolved)` directly — zod defaults will absorb a missing `audit` key automatically, so NO code change is needed there. Verify by reading the surrounding code; if the existing flow already routes through `DbcliConfigSchema.parse(...)`, leave it alone (this is the "no procedural migration" pattern from 21-PATTERNS.md).

    Add three test cases to `tests/unit/core/config.test.ts`:
    1. Mock or set up an in-memory V2 .dbcli with `version: 2`, one connection, NO audit key. Call `configModule.read(...)`. Assert `result.audit.enabled === true` and rotation defaults.
    2. Same fixture but with `audit: { enabled: false }`. Assert `result.audit.enabled === false`.
    3. Set up an in-memory V1 .dbcli (no `version` field or `version` !== 2) with no audit key. Call `configModule.read(...)`. Assert `result.audit.enabled === true`.

    If `configModule.read(...)` requires a file path rather than raw data, mirror the existing test setup pattern in `tests/unit/core/config.test.ts` (likely uses `mkdtemp` + write a `.dbcli` file then call read).

    Inspect DEFAULT_CONFIG in src/core/config.ts: if it exists and lacks an `audit` field, add `audit: { enabled: true, rotation: { max_bytes: 10_485_760, max_entries: 1000 } }`. If DEFAULT_CONFIG is typed against DbcliConfig (V1), typecheck failure after Task 1 will surface — fix at that point.
  </action>
  <verify>
    <automated>bun test tests/unit/core/config.test.ts 2>&1 && bun run typecheck 2>&1</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "audit:\s*v2Config\.audit" src/core/config.ts` returns exactly one match
    - `bun test tests/unit/core/config.test.ts` exits 0; the three new audit-related cases all pass
    - `bun run typecheck` exits 0 (no TypeScript errors from the added field)
    - `grep -n "audit" src/core/config.ts` shows the new audit reference inside the down-mapping block (around lines 285-291 vicinity)
    - DEFAULT_CONFIG check: `grep -n "DEFAULT_CONFIG" src/core/config.ts` — if it matches, read the block; the block MUST either already include `audit` or have been updated to include it
  </acceptance_criteria>
  <done>
    audit field is carried through V2 -> V1 mapping in src/core/config.ts; three test cases prove the audit defaults flow into the parsed config for both V2-upgrade and V1-legacy paths; full test file and typecheck pass.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `.dbcli` file on disk -> config loader | Untrusted user-editable JSON crosses this boundary; zod is the validation gate |
| Schema defaults -> downstream consumers | Defaults must not be mutated by downstream code (zod returns fresh objects, but consumer code must not push into shared default arrays/objects) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-21-01 | Tampering | `.dbcli` audit.rotation values | mitigate | zod `.int().positive()` rejects negative/zero/non-integer thresholds (Test 4, Test 5 in Task 1); parse throws -> caller gets ConfigError, no writer is constructed |
| T-21-02 | DoS | `.dbcli` audit.rotation.max_bytes set to extremely large value (e.g. `Number.MAX_SAFE_INTEGER`) | accept | Only affects rotation behavior (file grows larger than expected); does not consume memory or open additional handles. Out-of-Phase-21 scope to cap. |
| T-21-03 | Information Disclosure | audit.enabled accidentally defaulted to false hiding writes | mitigate | Test 1 verifies the default is `true`; defaults are double-declared (inner field default + outer optional().default) for safety |
| T-21-04 | Repudiation | User edits `.dbcli` to set audit.enabled=false to avoid writes | accept | By design (D-01 opt-out); audit log is for observability, not compliance. Documented in Phase 26 CHANGELOG (out of Phase 21 scope). |
</threat_model>

<verification>
- `bun test tests/unit/core/config.test.ts tests/unit/core/config-v2.test.ts` all green
- `bun run typecheck` clean
- `bun run lint` clean (no new warnings)
- `grep -E "audit" src/utils/validation.ts` shows the new AuditConfigSchema, AuditRotationConfigSchema, and two audit field references in DbcliConfigSchema + DbcliConfigV2Schema
</verification>

<success_criteria>
- Roadmap success criterion 6 verified at config-layer: a v1.19.x-shaped .dbcli (without `audit` key) parses successfully and yields `audit.enabled === true` + rotation defaults
- CONFIG-01 satisfied: `.dbcli` schema exposes `audit.enabled` + `audit.rotation.max_bytes` + `audit.rotation.max_entries`
- CONFIG-02 mechanically prepared: callers of `configModule.read()` can branch on `config.audit.enabled` (the actual short-circuit lands in Plan 21-04's AuditLogger)
- CONFIG-03 satisfied via zod default mechanism (no procedural migration code) — five Task-1 cases + three Task-2 cases prove it
</success_criteria>

<output>
After completion, create `.planning/phases/21-audit-writer-foundation/21-01-SUMMARY.md` documenting:
- The two new exported schemas (AuditConfigSchema, AuditRotationConfigSchema) and their default values
- Confirmation that no procedural migration was needed (CONFIG-03 fulfilled via zod defaults alone)
- Test file paths and case counts added
- Any deviations from PATTERNS.md (expected: none)
</output>
