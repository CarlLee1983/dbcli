# 原生授權不足有獨立的復原路徑

* Status: accepted
* Date: 2026-10-18

G2 以 adapter 的 `DB_PERMISSION_DENIED` 區分原生授權不足與登入失敗，並在 recovery
schema v1 的 `PERMISSION_DENIED` 下保留 `details.connectionCode` 作為明確 discriminator。
這保留既有 envelope 版本，但要求消費端讀取 discriminator；直接沿用本機拒絕的復原步驟
會錯誤引導使用者放寬 dbcli 政策，而新增 recovery 大類則需要版本升級。
原生授權不足只給人工處理指引且不提供自動修復或驗證：連線成功與本機權限旗標都不能
證明原先被拒的操作已獲准。使用者已連同 G2 Story 核准；GATE-001 另確認沒有驗證步驟時
JSON 省略 `verify`，不輸出不相容的 null。
