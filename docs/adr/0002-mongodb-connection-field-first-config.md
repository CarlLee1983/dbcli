---
status: accepted
date: 2026-08-04
---

# MongoDB 連線以逐欄設定為主要形式，URI 降為進階逃生門

MongoDB 連線的設定檔形式改以 `host` / `port` / `user` / `password` / `database`
加上 `authSource` / `replicaSet` / `tls` / `srv` 逐欄表達為主要路徑，與
PostgreSQL / MySQL / MariaDB 一致。完整連線字串 `uri` 保留為進階逃生門，供
逐欄欄位無法表達的場景（多組 host 混合埠、非標準 driver 選項）使用。

## 背景

逐欄欄位在 `MongoDBConnectionConfigSchema` 中一直存在，`MongoDBAdapter.buildUri()`
也一直有對應分支，但實務上不可用：

- schema 缺 `authSource` / `replicaSet` / `tls` / `srv`，其中 `authSource` 更是
  runtime 型別與 `init --auth-source` flag 都有、zod schema 卻沒有，導致寫入
  設定檔時被靜默 strip，flag 形同無效。
- 沒有這些欄位，任何需要認證資料庫、複本集或 TLS 的連線都只能改寫 `uri`，
  於是全部文件都只教「整條 URI 貼進去」，逐欄路徑事實上死亡。
- `uri` 內嵌帳密會明文落盤於 `config.json`：secret 抽取邏輯以 `password` 欄位
  是否為 env-ref 判斷，而 URI 模式下 `password` 恆為空字串。

## Considered options

- 維持 URI 為主，僅補上逐欄欄位作為次要選項。
- 移除 `uri` 欄位，強制逐欄設定。
- 逐欄為主、`uri` 保留為進階逃生門（本案）。

第一案不解決文件與精靈的實質引導，逐欄路徑會繼續無人使用而持續腐化。
第二案犧牲了 driver 選項的完整表達力，且會破壞既有設定檔。第三案讓常見場景
與 SQL 一致、機密可走既有 env-ref 機制，同時保留罕見場景的出口。

## Consequences

- `dbcli init` 對 MongoDB 的互動順序改變：預設逐欄詢問，貼 URI 成為明示選項。
  這是行為破壞性變更，須於 CHANGELOG 標註；`--uri` 等非互動 flag 行為不變。
- 設定檔格式向下相容：既有含 `uri` 的設定不需修改即可繼續運作。
- `uri` 與逐欄欄位同時存在時，`uri` 優先，並於驗證階段發出警告，避免
  「改了欄位卻沒生效」這類靜默失效。
- SRV 展開邏輯需由「僅 `uri` 開頭是 `mongodb+srv://` 時觸發」改為對逐欄的
  `srv: true` 一併適用，兩條路徑共用同一段解析。

**Falsified if:** `MongoDBConnectionConfigSchema` in `src/utils/validation.ts` 不再
同時接受 `uri` 與逐欄欄位，或 `buildUri()` / `buildResolvedUri()` in
`src/adapters/mongodb-adapter.ts` 不再讓 `uri` 優先於逐欄欄位，或
`handleMongoDBInit()` in `src/commands/init-mongodb.ts` 把 URI 改回互動流程的
第一個提問。
