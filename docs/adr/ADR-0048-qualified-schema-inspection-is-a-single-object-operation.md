# 完整名稱的 schema 查詢只檢視單一物件，不擴大掃描與快取

* Status: accepted
* Date: 2026-10-18
* Decision: [#240](https://github.com/CarlLee1983/dbcli/issues/240) 的 G1 缺口，於本次設計訪談確認。

本決策記錄已確認的設計，尚未實作。[#240 的本機實測](../research/dba-system-view-probes.md)
發現 PostgreSQL 的 schema introspection 固定查 `public`，MySQL／MariaDB 固定查目前
default database，阻擋系統視圖的欄位確認。`schema.read=available` 不代表任意 namespace
都能被查到；本次補齊的是 Tool 的單一物件檢視，不是 DBA 工作流程或權限升級。

## 名稱與操作邊界

`schema <schema.table>` 支援 PostgreSQL、MySQL、MariaDB 的一般表與系統視圖。
完整名稱依引擎識別字規則辨識引號、大小寫與名稱內的點號，不以字串 `split('.')`
代替解析；最多兩層，格式錯誤就拒絕，不猜測或搜尋替代物件。

既有未限定名稱維持原本預設與精確名稱語意：PostgreSQL 查 `public`，MySQL／MariaDB
查連線的 default database。輸入完整名稱不修改連線設定、`search_path` 或 default database。
既有含點號的 literal 名稱須以完整名稱中的 quoted component 明確表達；不做有歧義的後備查找。

解析邊界放在 `schema` 命令，傳遞分開的 namespace 與局部名稱；不讓所有共用 adapter
呼叫者自動拆解原本的字串。後者會改變 DML、verify、diff 與快取刷新等既有呼叫的意義，
本次不採用。所有欄位、enum、主鍵、索引與外鍵 metadata 必須使用同一個物件身分，
不能因表名或 constraint 名稱相同而混入其他 namespace 的資料。

單一物件查詢維持不寫 schema 快取，不新增快取格式或遷移。完整名稱搭配 `--refresh`／
`--reset` 明確拒絕，不能落入旗標優先的全庫操作。無參數 `schema`、全庫掃描與 `list`
的範圍不擴大。

## Metadata 與保護

新增的完整名稱路徑不執行 `COUNT(*)`。物件存在與類型由 metadata 確認，不以成功計數
或空欄位結果推斷存在。可取得的有效估計值可保留；未知筆數與大小分類不填零或 `small`。
輸出保留局部 `name`，另呈現 `schema`；類型沿用 `table | view`，materialized view 歸為 `view`。

目前 SQL 單一物件 schema 路徑未套用 query 的 blacklist 過濾。本次明確補上保護，
同時適用未限定與完整名稱：bare 與 qualified 規則任一命中即生效，沿用既有 glob
及保守過濾語意，不縮減原有規則的適用範圍。表被封鎖即拒絕；欄位被封鎖時，
隱藏該欄位及暴露它的主鍵、索引與關聯 metadata。

外鍵來源或目標的表／欄位受保護時，省略整條外鍵，不裁切成看似完整的另一個約束。
表層級 `foreignKeys` 與欄位層級 `foreignKey` 都要處理；目標 namespace 不可猜測。
保護同時涵蓋 JSON、文字與錯誤中的附帶 metadata，不改動 query 的 blacklist 規則。

確定沒有的 metadata 可用空集合表達；必要 metadata 因權限或讀取錯誤而無法確認時，
整次查詢失敗，不把未知包成成功。不存在與不可見只在資料庫提供足夠證據時區分，
否則如實報告「不存在或不可見」；不為此提高原生權限。

## 相容性與後續

未限定名稱的預設解析不變，不代表輸出逐位元不變：blacklist 過濾與正確 view 類型
可能改變原輸出，完整名稱另帶 namespace 且不保證有筆數。這些差異須寫進使用者文件與
CHANGELOG。實作與驗收由 [G1 Story](../../specs/stories/qualified-system-schema-inspection.md)
界定；設計接受不等於 Story 已核准或實作已通過驗證。

若改成持久化完整名稱快取、擴大全庫掃描，或重新解讀其他命令的名稱字串，必須重新
審視本決策。回退功能不需要資料遷移，但撤回本次 metadata 保護會恢復既有的可見範圍，
不能把回退誤稱為仍保有這項保護。
