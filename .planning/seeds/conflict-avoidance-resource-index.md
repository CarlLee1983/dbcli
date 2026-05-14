---
title: Audit Log — 並發 Conflict Avoidance Resource Index
trigger_condition: 多 agent 並發成為實際痛點時（觀察到 race condition / 重複工作 / 互相覆寫）
planted_date: 2026-05-14
type: seed
related: "[[notes/audit-logging-exploration]]"
---

# Conflict Avoidance Resource Index

## 為什麼暫緩

v1.20.0 audit log 是「時間序列為主」的設計，回答「最近發生了什麼」。但「我準備動 `users` 表，最近誰碰過？」需要按資源（table / key / index）的二級索引才能高效查詢。

目前 dbcli 不是多 agent 並發場景優化的工具，這需求未被觀察到。做資源索引是大工程（檔案結構、寫入 cost、查詢 API），CP 值現在偏低。

## 觸發條件（什麼時候 plant）

任一發生即可考慮重新評估：

- 使用者回報「兩個 agent 同時操作同張表互相覆蓋」
- 使用情境變成「多人協作、多 agent 共用同一 DB connection」
- `dbcli audit tail` 的線性 scan 在資料量大時已造成可感知延遲

## 候選設計方向

當觸發時可考慮：

1. **二級索引檔**：`.dbcli/audit/index/<resource>.jsonl`，每資源獨立列表
2. **SQLite as audit store**：直接換 storage backend，支援按 resource SQL 查詢
3. **CLI**：`dbcli audit resource <table>` 列出該資源最近活動

## 預估規模

中型 milestone（可能 v1.22 - v1.25 範圍，視觸發時的需求量）。
