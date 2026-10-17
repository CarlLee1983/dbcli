# #240 待回填內容（尚未發佈）

G1 已實作：單一物件 `schema schema.table` 支援 PostgreSQL／MySQL／MariaDB；原生引用與 namespace metadata 保持一致，完整名稱不執行 relation COUNT，單一物件不保存 schema cache。舊／新 SQL 名稱路徑都套用 blacklist，整體保護 PK／index／FK 並明示 metadata 省略。

驗證：三引擎 CLI 整合測試 34 pass／0 fail（433 assertions），涵蓋 materialized-view enum、expression／partial index、逗號欄名與受限帳號。`make verify` exit 0，22 個 gates 全通過，7293 pass／0 fail。ForgePilot 不可變快照 EV-002 PASS；Human Review 已通過（EV-003 APPROVED），工作 DONE。

補充實測保留原 Q ID 與原 SQL：24 成功、11 不存在或原生帳號不可見、1 PG16 版本欄位不符、2 函式來源不屬 table/view schema。原始 `evidence.json` 未覆寫。命令與輸出在 `docs/research/dba-system-view-probes/g1-evidence.json`；重現用 `bun --no-env-file docs/research/dba-system-view-probes/g1-reproduce.ts --queries`。

G2 授權錯誤分類、G3 grant 文字去敏、G4／#241 RDS CALL 政策不在這次範圍；不應因 G1 修復而關閉整個 #240。
