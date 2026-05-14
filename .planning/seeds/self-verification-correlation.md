---
title: Audit Log — Self-Verification 自動對照
trigger_condition: 使用者明確要求「audit log 應該自動驗證寫入結果」或 agent 出現大量「以為寫成功但實際失敗」案例
planted_date: 2026-05-14
type: seed
related: "[[notes/audit-logging-exploration]]"
---

# Self-Verification Correlation

## 為什麼暫緩

「我剛剛跑的 update 跟預期一致嗎？」目前已可透過組合既有工具完成：

1. `dbcli ... --plan` 預先看影響
2. `dbcli update ...` 執行
3. `dbcli query "SELECT ..."` 驗證
4. 失敗時 `recovery envelope` 提供修復路徑

v1.20.0 audit log 本身會記錄這四步的 entry，agent 可自行串接。**自動對照** 屬於「進階自動化」，要做得好涉及：

- 從 update SQL 反推驗證 query
- 期望值預測（rows_affected 要等於什麼）
- 不一致時的告警與修復建議

工程量不小，且偏「智能化」而非「資料收集」，與 v1.20.0 的「忠實紀錄」主題不衝突但職責不同。

## 觸發條件（什麼時候 plant）

- 使用者反饋：「我希望 dbcli 自己幫我檢查 update 有沒有真的生效」
- 觀察到 agent loop 中大量「執行了但沒驗證」造成的次生錯誤
- AI Enhancement milestone（PROJECT.md 候選方向之一）啟動時自然納入

## 候選設計方向

- 在 saved query 加 `verify:` frontmatter 區塊
- audit entry 加 `verification` 欄位，紀錄對照 query + 期望結果 + 實際結果
- CLI：`dbcli audit verify <id>` 重跑 entry 的驗證

## 預估規模

小型功能（單一 phase 1-2 plans），但需要 audit log 先就位才好實作。
