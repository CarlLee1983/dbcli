---
phase: 24-audit-cli
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/adapters/capabilities.ts
  - resources/lang/en/messages.json
  - resources/lang/zh-TW/messages.json
autonomous: true
requirements: [CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06]
tags: [audit, capabilities, i18n, registry]
must_haves:
  truths:
    - "CommandCapabilityKey 與 COMMAND_CAPABILITY_KEYS 包含 auditTail / auditShow / auditClear / auditHealth 4 個新 key"
    - "ENGINE_INDEPENDENT 含 4 個 audit 條目，tier 為 audit tail/show/health = readonly、audit clear = local-write"
    - "en/messages.json 與 zh-TW/messages.json 都含完整 audit.* keys（4 子指令 description / clear 互動文案 6 條 / show 錯誤訊息 7 條 含 show_recovery_ambiguous / disabled hint / no_entries / n_capped_warning / n_must_be_positive）"
    - "兩語系 audit.* top-level keys 與 audit.clear.* keys 完全一致"
  artifacts:
    - path: "src/adapters/capabilities.ts"
      provides: "4 個新 audit capability keys + ENGINE_INDEPENDENT block 擴充"
      contains: "auditTail"
    - path: "resources/lang/en/messages.json"
      provides: "audit.* en 文案"
      contains: "audit"
    - path: "resources/lang/zh-TW/messages.json"
      provides: "audit.* zh-TW 文案"
      contains: "audit"
  key_links:
    - from: "src/commands/audit.ts (Wave 2)"
      to: "resources/lang/en/messages.json"
      via: "t('audit.<sub>.description') message-loader"
      pattern: "t\\('audit\\."
    - from: "src/adapters/capabilities.ts ENGINE_INDEPENDENT"
      to: "src/cli.ts (Wave 2 wiring)"
      via: "capability registry 已預備 4 audit keys"
      pattern: "auditTail|auditShow|auditClear|auditHealth"
---

<objective>
為 Phase 24 commander surface 預備兩個 cross-cutting registry：
1. **Capability registry** 加 4 個 audit keys（CommandCapabilityKey union + COMMAND_CAPABILITY_KEYS array + ENGINE_INDEPENDENT block）
2. **i18n** 完整 `audit.*` block（en + zh-TW），讓 Wave 2/3 commander `.description(t('audit.*.description'))` 與所有 stderr 文案有 i18n 來源

兩個 registry 都是 leaf modification（無 commander handler 邏輯）→ 與 24-01 reader 並行（Wave 1）安全。

Purpose: 集中所有跨 plan 共用的文案與 capability tier 一次完成，避免 Wave 2/3 每個子指令 plan 都要往 i18n 補檔形成 trailing edits。

Output:
- `src/adapters/capabilities.ts`：4 新 keys + 4 ENGINE_INDEPENDENT entries
- `resources/lang/en/messages.json`：audit.* block
- `resources/lang/zh-TW/messages.json`：audit.* block（與 en 一一對應）

REQ 覆蓋：CLI-01..06 全部，因為這 6 個 REQ 對應的 4 個子指令的 capability + 文案都在這 plan 落地（commander 與測試在 Wave 2/3）。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/24-audit-cli/24-CONTEXT.md
@.planning/phases/24-audit-cli/24-PATTERNS.md
@src/adapters/capabilities.ts
@resources/lang/en/messages.json
@resources/lang/zh-TW/messages.json

<interfaces>
From src/adapters/capabilities.ts (existing keys to extend):

CommandCapabilityKey union currently ends with `'recover' | 'skill'` — append 4 audit keys.

COMMAND_CAPABILITY_KEYS array currently ends with `'recover', 'skill',` — append 4 audit string literals.

SideEffectTier values: `'readonly' | 'dry-run' | 'local-write' | 'db-write' | 'interactive' | 'none'`

ENGINE_INDEPENDENT block currently has completion/upgrade/recover/skill — append 4 audit entries.

i18n message-loader supports `t(key)` and `t(key, vars)` for `{placeholder}` substitution.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 擴充 src/adapters/capabilities.ts 加 4 個 audit keys</name>
  <read_first>
    - src/adapters/capabilities.ts L13-103（CommandCapabilityKey union、COMMAND_CAPABILITY_KEYS array、ENGINE_INDEPENDENT block）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "src/adapters/capabilities.ts (modified — 4 new capability rows)" 含 tier mapping rationale）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（F decision §"Capability registry 更新"）
  </read_first>
  <action>
    在 `src/adapters/capabilities.ts` 做 3 處增改（**保留所有既有內容不動**）。

    **(A) `CommandCapabilityKey` union（約 L13-42）** — 在 `'skill'` 之後 append 4 個新 keys（順序：auditTail → auditShow → auditClear → auditHealth）。

    **(B) `COMMAND_CAPABILITY_KEYS` array（約 L51-80）** — 在 `'skill',` 之後 append 4 個 string literals（順序與 union 一致）。

    **(C) `ENGINE_INDEPENDENT` block（約 L90-103）** — 在 `skill: cap(...)` 之後 append 4 個 audit entries：
    - `auditTail: cap('supported', 'readonly', 'Reads JSONL audit entries; never writes to engines.')`
    - `auditShow: cap('supported', 'readonly', 'Looks up a single audit entry by id prefix or recovery_ref.')`
    - `auditHealth: cap('supported', 'readonly', 'Renders AuditLogger.getHealth() snapshot.')`
    - `auditClear: cap('supported', 'local-write', 'Removes <conn>.jsonl + .jsonl.1 from local disk; never touches DB.')`

    並把 `satisfies Pick<EngineCapabilities, ...>` 的聯集擴充為 `'completion' | 'upgrade' | 'recover' | 'skill' | 'auditTail' | 'auditShow' | 'auditHealth' | 'auditClear'`。

    **Tier rationale**（per F decision + 24-PATTERNS.md "Tier mapping reasoning"）：
    - tail / show / health → 'readonly'（純讀檔；不寫 disk、不寫 DB）
    - clear → 'local-write'（destructive on local disk only；SideEffectTier enum 無 'destructive'，最近的合身分類為 'local-write'，與 recover/skill 並列）

    **不要**為 audit 4 keys 在 SQL_BASE / MONGODB_BASE / REDIS_BASE / ELASTICSEARCH_BASE 等 per-engine block 加 override — audit subcommands engine-independent，由 ENGINE_INDEPENDENT spread 進每個 engine 即可（沿用 recover/skill/completion 的處理方式）。

    **不要**在這個 plan 觸碰 src/cli.ts、src/commands/audit.ts（Wave 2 plan 24-03 才建立）。

    **不要**改動既有 capability rows 的 status / tier / note。
  </action>
  <verify>
    <automated>bun run typecheck 2>&amp;1 | grep -E "src/adapters/capabilities\.ts.*error" | head -3</automated>
  </verify>
  <acceptance_criteria>
    - 4 個新 union members：grep -cE "^\s*\|\s*'audit(Tail|Show|Clear|Health)'" src/adapters/capabilities.ts 回 4
    - 4 個新 array entries：grep -cE "^\s*'audit(Tail|Show|Clear|Health)'," src/adapters/capabilities.ts 回 4
    - 4 個 ENGINE_INDEPENDENT entries：grep -cE "^\s*audit(Tail|Show|Clear|Health):\s*cap\(" src/adapters/capabilities.ts 回 4
    - clear tier 為 'local-write'：grep -A2 "auditClear:" src/adapters/capabilities.ts | grep "'local-write'"
    - tail/show/health tier 為 'readonly'：grep -A2 -E "audit(Tail|Show|Health):" src/adapters/capabilities.ts | grep -c "'readonly'" 回 3
    - 全部 4 keys 列入 satisfies Pick：grep -cE "auditTail|auditShow|auditHealth|auditClear" src/adapters/capabilities.ts | xargs -I{} test {} -eq 16（union 4 + array 4 + ENGINE_INDEPENDENT 4 + satisfies Pick 4 = 4 × 4 = 16；以已存在的 recover/skill 樣本驗證：每個 key 恰好出現 4 次：union 1 + array 1 + ENGINE_INDEPENDENT 1 + satisfies Pick 1）
    - satisfies Pick 子句必須含全部 4 keys：grep -cE "satisfies Pick<EngineCapabilities, .*auditTail.*auditShow.*auditHealth.*auditClear" src/adapters/capabilities.ts 回 1
    - typecheck 全綠：bun run typecheck exit 0
  </acceptance_criteria>
  <done>capabilities.ts 編譯通過；4 個新 audit keys 完整 wiring（union + array + ENGINE_INDEPENDENT + satisfies）；無 per-engine override；既有 keys 未動</done>
</task>

<task type="auto">
  <name>Task 2: 在 resources/lang/{en,zh-TW}/messages.json 新增 audit.* block（兩語系一致）</name>
  <read_first>
    - resources/lang/en/messages.json L52-120（"recovery" 與 "queries" block 為結構鏡像）
    - resources/lang/zh-TW/messages.json 對應位置（確認結構與 en 對齊）
    - .planning/phases/24-audit-cli/24-PATTERNS.md（§ "resources/lang/{en,zh-TW}/messages.json (modified — audit.* keys)"）
    - .planning/phases/24-audit-cli/24-CONTEXT.md（D-45 prompt 文案、D-46 non-TTY 拒絕、D-49 summary 文案、E disabled hint、L cap warning）
  </read_first>
  <action>
    在 `resources/lang/en/messages.json` 與 `resources/lang/zh-TW/messages.json` 的同一位置（建議插入「`recovery` 之後、`queries` 之前」；executor 若觀察到 alphabetical 慣例不同可調整 — **唯一鐵則：兩語系插入位置一致**）新增 `"audit"` block。

    **en/messages.json 內容（precise，逐字）：**

    ```json
    "audit": {
      "description": "Inspect, look up, clear, or check the health of the audit log",
      "tail": {
        "description": "Show recent audit entries (default: last 10 from current connection)"
      },
      "show": {
        "description": "Look up a single audit entry by id (UUID prefix >=4) or --recovery-ref"
      },
      "clear": {
        "description": "Delete audit log files (.jsonl + .jsonl.1) for the current connection",
        "prompt_header": "About to clear audit log for connection '{conn}':",
        "prompt_file_line": "  {file}       — {entries} entries, {size}",
        "prompt_continue": "Continue? [y/N] ",
        "requires_tty_or_yes": "Cannot prompt for confirmation in non-interactive session. Use --yes to clear without prompt.",
        "summary_cleared": "Cleared {count} entries from '{conn}'.",
        "summary_nothing": "Nothing to clear.",
        "summary_failed": "Failed to clear: {message}."
      },
      "health": {
        "description": "Show AuditLogger health snapshot (size, entries, lock state, last write)"
      },
      "disabled_hint": "Audit is disabled (audit.enabled = false in .dbcli). Use 'dbcli audit health' for details.",
      "no_entries": "No audit entries.",
      "show_no_match": "No audit entry matches '{prefix}'.",
      "show_ambiguous": "Ambiguous prefix '{prefix}': matches {count} entries. Please use a longer prefix.",
      "show_prefix_too_short": "Prefix must be at least 4 characters.",
      "show_recovery_no_match": "No audit entry has recovery_ref '{ref}'.",
      "show_recovery_ambiguous": "Multiple entries reference recovery_ref '{ref}': matches {count}. This should be rare; inspect file directly.",
      "show_mutex_violation": "Provide either <id> argument or --recovery-ref, not both.",
      "n_capped_warning": "--n value {requested} exceeds max {max}; capped to {max}.",
      "n_must_be_positive": "--n must be a positive integer."
    }
    ```

    **zh-TW/messages.json 內容（必須與 en key set 完全一致；繁體中文 / 台灣用語）：**

    ```json
    "audit": {
      "description": "檢視、查詢、清空或檢查 audit log 健康狀態",
      "tail": {
        "description": "顯示最近的 audit 紀錄（預設：當前連線最後 10 筆）"
      },
      "show": {
        "description": "依 id（UUID 前綴 ≥4 碼）或 --recovery-ref 查詢單筆 audit 紀錄"
      },
      "clear": {
        "description": "刪除當前連線的 audit log 檔案（.jsonl 與 .jsonl.1）",
        "prompt_header": "即將清空連線 '{conn}' 的 audit log：",
        "prompt_file_line": "  {file}       — {entries} 筆，{size}",
        "prompt_continue": "確認執行？[y/N] ",
        "requires_tty_or_yes": "非互動 session 無法顯示確認提示。請使用 --yes 直接清空。",
        "summary_cleared": "已從 '{conn}' 清除 {count} 筆 audit 紀錄。",
        "summary_nothing": "沒有可清除的內容。",
        "summary_failed": "清除失敗：{message}。"
      },
      "health": {
        "description": "顯示 AuditLogger 健康狀態（檔案大小、筆數、lock 狀態、最後寫入結果）"
      },
      "disabled_hint": "Audit 已停用（.dbcli 中 audit.enabled = false）。執行 `dbcli audit health` 查看詳情。",
      "no_entries": "沒有 audit 紀錄。",
      "show_no_match": "找不到符合 '{prefix}' 的 audit 紀錄。",
      "show_ambiguous": "前綴 '{prefix}' 不夠精確：匹配到 {count} 筆紀錄，請改用更長的前綴。",
      "show_prefix_too_short": "前綴至少需 4 個字元。",
      "show_recovery_no_match": "沒有任何 audit 紀錄的 recovery_ref 為 '{ref}'。",
      "show_recovery_ambiguous": "有 {count} 筆紀錄的 recovery_ref 為 '{ref}'，這應屬罕見情況；請直接檢視檔案。",
      "show_mutex_violation": "請擇一提供 <id> 參數或 --recovery-ref，兩者不可同時使用。",
      "n_capped_warning": "--n 值 {requested} 超過上限 {max}，已自動縮減為 {max}。",
      "n_must_be_positive": "--n 必須為正整數。"
    }
    ```

    **JSON 注意事項：**
    - 確保插入後仍為合法 JSON：尾隨逗號、引號、巢狀 `{}` 配對都正確
    - **不要**改動既有 `recovery` / `queries` / `errors` 任何 key 的內容
    - 兩語系檔案 audit block 的「插入位置」要一致
    - 兩語系檔案結尾仍為單一 `}`，不重複 closing brace

    **Verification helper（executor 寫完後自驗）：**
    ```bash
    node -e "JSON.parse(require('fs').readFileSync('resources/lang/en/messages.json','utf8'))"
    node -e "JSON.parse(require('fs').readFileSync('resources/lang/zh-TW/messages.json','utf8'))"
    ```
  </action>
  <verify>
    <automated>node -e "const en=JSON.parse(require('fs').readFileSync('resources/lang/en/messages.json','utf8'));const zh=JSON.parse(require('fs').readFileSync('resources/lang/zh-TW/messages.json','utf8'));const enKeys=Object.keys(en.audit||{}).sort();const zhKeys=Object.keys(zh.audit||{}).sort();if(JSON.stringify(enKeys)!==JSON.stringify(zhKeys)){console.error('MISMATCH top-level',JSON.stringify(enKeys),JSON.stringify(zhKeys));process.exit(1)}const enClear=Object.keys(en.audit.clear||{}).sort();const zhClear=Object.keys(zh.audit.clear||{}).sort();if(JSON.stringify(enClear)!==JSON.stringify(zhClear)){console.error('MISMATCH clear',JSON.stringify(enClear),JSON.stringify(zhClear));process.exit(1)}console.log('OK',enKeys.length,'top-level audit keys,',enClear.length,'clear keys')"</automated>
  </verify>
  <acceptance_criteria>
    - en JSON 合法且含 audit block：node -e "const j=JSON.parse(require('fs').readFileSync('resources/lang/en/messages.json','utf8'));if(!j.audit)process.exit(1)" exit 0
    - zh-TW JSON 合法且含 audit block：node -e "const j=JSON.parse(require('fs').readFileSync('resources/lang/zh-TW/messages.json','utf8'));if(!j.audit)process.exit(1)" exit 0
    - 兩語系 audit top-level + audit.clear key set 完全一致：上述 verify automated 指令 exit 0
    - 4 個子指令 description 都存在於 en：node -e "const j=JSON.parse(require('fs').readFileSync('resources/lang/en/messages.json','utf8'));['tail','show','clear','health'].forEach(k=>{if(!j.audit[k]||!j.audit[k].description)throw new Error(k)})" exit 0
    - 4 個子指令 description 都存在於 zh-TW：同上替換成 zh-TW
    - clear 互動文案 6 條存在於 en：node -e "const j=JSON.parse(require('fs').readFileSync('resources/lang/en/messages.json','utf8'));['prompt_header','prompt_continue','requires_tty_or_yes','summary_cleared','summary_nothing','summary_failed'].forEach(k=>{if(!j.audit.clear[k])throw new Error(k)})" exit 0
    - 同上於 zh-TW exit 0
    - show 錯誤訊息與 n 驗證鍵存在於 en：node -e "const j=JSON.parse(require('fs').readFileSync('resources/lang/en/messages.json','utf8'));['show_no_match','show_ambiguous','show_prefix_too_short','show_recovery_no_match','show_recovery_ambiguous','show_mutex_violation','n_capped_warning','n_must_be_positive'].forEach(k=>{if(!j.audit[k])throw new Error(k)})" exit 0
    - 同樣 8 個鍵存在於 zh-TW：node -e "const j=JSON.parse(require('fs').readFileSync('resources/lang/zh-TW/messages.json','utf8'));['show_no_match','show_ambiguous','show_prefix_too_short','show_recovery_no_match','show_recovery_ambiguous','show_mutex_violation','n_capped_warning','n_must_be_positive'].forEach(k=>{if(!j.audit[k])throw new Error(k)})" exit 0
    - typecheck 過：bun run typecheck exit 0
  </acceptance_criteria>
  <done>en/zh-TW messages.json 都含完整 audit block；兩語系 key set 一一對應；JSON 仍合法；無既有 keys 被改動</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| developer config → CLI behavior | capability tier 影響 agent 對指令副作用的預期；錯誤分類可能誤導 agent 把 destructive 視為 readonly |
| i18n locale → user message | 文案決定使用者對 destructive 行為的理解；錯誤翻譯可能讓 zh-TW 用戶誤判確認流程 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-24-05 | E (Elevation of privilege via wrong tier) | capabilities.ts auditClear tier | mitigate | tier 明確設為 'local-write'（destructive on disk）；F decision 寫明 audit clear 為 destructive；registry 為 agent 唯一信任來源；acceptance criteria grep 守住 tier 字面值 |
| T-24-01a | I (User confusion via missing locale) | resources/lang/zh-TW/messages.json audit.clear | mitigate | zh-TW 文案完整翻譯互動 prompt + summary + non-TTY rejection；acceptance node script 強制兩語系 key set 對齊 |
| T-24-01b | T (Misleading agent via inaccurate description) | en/zh-TW audit.show.description | mitigate | description 明示「prefix ≥4」與「--recovery-ref」雙路徑，agent 由 description 即可選擇正確查詢方式 |
</threat_model>

<verification>
- bun run typecheck exit 0
- 兩 JSON 檔案均可被 JSON.parse 解析
- 兩語系 audit.* key set 完全一致（acceptance node script 強制）
- 4 個 audit capability rows 都在 ENGINE_INDEPENDENT 且 tier 對應正確
- 既有 capability key 數量不減少
</verification>

<success_criteria>
- Wave 2/3 plans 引用 t('audit.tail.description') 等 i18n key 時不會 fallback 到 raw key
- Wave 2/3 plans 註冊 commander 時 capability registry 不會 throw unknown key
- Phase 26 docs / feature-matrix audit row 直接引用此 plan 文案即可
</success_criteria>

<output>
After completion, create `.planning/phases/24-audit-cli/24-02-SUMMARY.md` documenting:
- 4 個新 capability keys + 各自 tier 與 rationale
- audit.* i18n top-level keys 清單（兩語系一致）
- clear 互動 prompt 文案最終版（給 Wave 3 整合測試對 stderr 字串斷言用）
- show 錯誤訊息最終版（給 Wave 3 整合測試對 ambiguous / no-match / mutex 斷言用）
</output>
