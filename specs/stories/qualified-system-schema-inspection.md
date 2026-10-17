# Story: 單一物件 schema 查詢支援完整名稱與 metadata 保護

狀態：**已實作並通過 ForgePilot 驗證；2026-10-18 Human Review 通過**。
ForgePilot Work Item：`qualified-schema-inspection`；EV-002 PASS、EV-003 APPROVED，工作為 DONE。關聯：[#240](https://github.com/CarlLee1983/dbcli/issues/240) G1。

決策：[ADR-0048](../../docs/adr/ADR-0048-qualified-schema-inspection-is-a-single-object-operation.md)。
實測：[系統視圖查詢報告](../../docs/research/dba-system-view-probes.md)；其原始證據不可覆寫成修正後結果。

## Goal

使用者在 query-only、agent mode 與 blacklist 生效下，可以明確指定 PostgreSQL、MySQL、
MariaDB 的單一表或系統視圖，取得該物件可安全公開的完整 schema metadata，據此確認
後續唯讀查詢的實際欄位。不猜 namespace、不提高原生權限、不以其他同名物件或空資料
冒充成功。

## Out of Scope

- 全庫掃描、`list`、無參數 `schema` 的 namespace 範圍擴充；完整名稱的快取保存與遷移。
- insert／update／delete、verify、diff 等其他命令的名稱解析變更；query blacklist 語意重設。
- MongoDB、Redis、Elasticsearch、SQLite 的完整名稱功能或新 metadata 契約。
- 新增 permission tier、放寬 query-only／agent mode／write gate／production selection。
- #240 的 G2 授權錯誤重新分類、G3 MariaDB grant 文字去敏、G4／#241 的 RDS CALL 政策。
- RDS 資源、replica topology、PITR／還原演練、DBA Role Skill 實作，以及替使用者補 grant。
- 新增公開的 materialized-view 類型；改變既有無限定名稱的計數行為。

## 行為契約

### 1. 輸入與物件身分

新路徑接受兩段式完整名稱；PostgreSQL 第一段為 schema，MySQL／MariaDB 第一段為 database。
辨識引擎原生識別字引用、escaped quote、大小寫與 component 內的點號；不把原始輸入
拼接成可執行 SQL。以下是 shell 保留引號後傳入 CLI 的例子：

```sh
bun run src/cli.ts schema pg_catalog.pg_roles --format json
bun run src/cli.ts schema information_schema.TABLES --format json
bun run src/cli.ts schema '"Audit"."Order.Items"' --format json
bun run src/cli.ts schema '`reporting`.`order.items`' --format json
```

空 component、超過兩層、未閉合或無效引用都拒絕，不試查另一種解讀。
同名物件不存在時不退回 public／default database；本來含點號的局部名稱，例如
PostgreSQL `public` 中 literal `audit.orders`，以 `public."audit.orders"` 明確指定。
未限定的既有名稱仍依原本精確名稱語意處理，不能對所有 adapter 呼叫字串全面折疊大小寫。
MySQL／MariaDB 不以 PostgreSQL 的小寫折疊規則替代伺服器的識別字大小寫語意。

columns、enum、primary key、foreign keys、indexes、存在性、類型與可用的筆數估計，
都必須綁定同一 namespace／局部名稱。外鍵使用實際的來源與目標 namespace，
同名表、同名 constraint 不得串錯 metadata。

### 2. 單一物件、輸出與計數

完整名稱與 `--refresh`／`--reset` 的任一組合在執行掃描前失敗。
單一物件路徑不修改連線設定、schema cache、cache index 或 integrity record；
既有 audit／明確要求的 evidence receipt 不因此被關閉，其既有契約不擴充。

完整名稱路徑不得執行關係資料的 `COUNT(*)`，亦不以讀取關係資料來確認存在。
JSON 保留局部 `name`，另帶分開的 `schema` 字串；文字輸出也必須能辨識兩個 component，
含點號或大小寫敏感名稱須呈現得沒有歧義。
`tableType` 使用實際辨識的 `table`／`view`，materialized view 沿用 `view`。

未知筆數沿用既有 formatter 的未知表達：JSON `estimatedRowCount: null`、`sizeCategory: null`，
不填假的 `metadata.rowCount: 0`；文字不得印出假的零筆數或 small 分類。
可從 metadata 得到有效估計值時可以呈現，但不得把它標為精確計數；不存在與未知不能以零估計替代。

### 3. Blacklist 與失敗

SQL 單一物件 schema 的舊、新名稱形式都必須套用 blacklist；bare 與 qualified 的規則
任一命中即生效，保留既有 glob、大小寫匹配及保守過濾語意。
受保護的表不輸出其 schema；受保護的欄位不出現在 columns 或衍生 metadata。
含受保護欄位的複合主鍵／索引不可刪掉一欄後當成仍完整的約束，應省略該整項 metadata。

外鍵的來源或目標表／欄位受保護時，整條關聯從 `foreignKeys` 與 column `foreignKey`
兩種位置移除。實際目標 namespace 必須可確認，不能猜 default namespace 後錯誤放行。
文字、JSON、表格、錯誤附帶的候選或 metadata 都不能成為另一條洩漏路徑。
因保護而省略 metadata，與資料庫原本沒有該 metadata 必須可辨識；全部欄位被隱藏不能
被誤報成物件不存在。

確定沒有 PK／索引／外鍵可以回空集合。必要 metadata 查詢遭拒或失敗時回非零 exit，
不能 catch 後填空集合並回成功。資料庫只提供「不存在或不可見」證據時就保留這個不確定性，
不新增本 Story 範圍外的全域錯誤碼分類，也不要求或嘗試提升權限。

## Acceptance Criteria

每列均需在完成報告附實際命令及觀察；下列是待實作的驗收，不是現有通過證據。

| ID | 可觀察結果 | 驗證方式與證據 |
| --- | --- | --- |
| AC-01 | 三引擎完整名稱成功讀取一般表、一般 view 與可存取的系統視圖；JSON name/schema 對應實際物件。 | 真實隔離容器測試，包含 `pg_catalog.pg_roles`、`information_schema.TABLES`；CLI 為 query-only、`DBCLI_AGENT_MODE=1`、非空 blacklist。 |
| AC-02 | PostgreSQL 的 public 與另一 schema、MySQL／MariaDB 的兩個 database 各有同名表，取得各自不同的欄位、enum、PK、索引及 FK；沒有混用同名 constraint。 | fixture 刻意設置不同結構、同名 constraint 與跨 namespace FK；逐項比對實際 JSON，搭配 metadata lookup 的邊界測試。 |
| AC-03 | 有引號的大小寫、component 內點號與 escaped quote 正確定位；非法、空 component、三層名稱拒絕且不猜物件。 | parser／CLI 行為測試加實際具特殊名稱的 fixture；記錄拒絕時未進入掃描或資料查詢。 |
| AC-04 | 舊的未限定名稱仍依 PG public／MySQL、MariaDB default database 及既有精確名稱語意解析；其他 getTableSchema 呼叫者不被自動拆名。 | 既有大小寫與 DML／verify／diff 相關回歸測試；同時存在預設與非預設同名物件的實測。 |
| AC-05 | 完整名稱加 refresh／reset 均拒絕；成功、失敗、受保護的單一物件查詢皆不改設定及 schema 快取。 | CLI 旗標矩陣、設定與快取內容／檔案清單前後比較；audit／明示 receipt 產物分開核對。 |
| AC-06 | 完整名稱不執行關係 `COUNT(*)`；不存在物件不因空欄位回成功；未知筆數與大小分類不成為零或 small。 | 攔截 adapter 實際送出的 SQL，加真實 view／表查詢；檢查 JSON null 與文字表示，涵蓋估計不可用的情境。 |
| AC-07 | table／view 類型正確，PG materialized view 仍輸出 view；兩種輸出可區分 namespace 與局部名稱。 | 真實 table、view、materialized view fixtures；JSON／文字 formatter 行為測試。 |
| AC-08 | bare、qualified、glob blacklist 命中時舊／新 schema 形式皆受保護，換引用／大小寫寫法不能繞過既有匹配規則。 | 非空 blacklist 的真實 CLI 正反例；同名跨 schema 與 quoted identifiers 回歸測試，另證明未命中者仍可讀。 |
| AC-09 | 隱藏欄位及涉及它的 PK、索引、FK；來源或目標表／欄位受保護時整條 FK 在兩種表示都消失，不產生裁切的假約束。 | 複合鍵、複合索引、跨 namespace FK 的輸出檢查；JSON、文字、column FK、錯誤附帶 metadata 皆無受保護名稱，並可辨識保護性省略。 |
| AC-10 | 必要 metadata 查詢權限不足／失敗與真正空集合區分；全欄隱藏不誤判不存在。 | 邊界 fault-injection 測試涵蓋 columns／PK／index／FK 查詢失敗；真實受限原生帳號情境、全欄 blacklist 情境；保留真實錯誤與非零 exit。 |
| AC-11 | 不更動 query-only／agent mode／write gate／production selection；既有無參數 schema、scan、list 範圍不擴大。 | 既有權限、agent schema 邊界與命令回歸測試，搭配隔離 fixture 的設定前後觀察。 |
| AC-12 | #240 中因 schema 受阻的案例重新評估；原始證據保留，新增結果明確區分工具修復、版本差異、原生權限不足與環境缺失。 | 以新完整名稱重跑 PG catalog 與 MySQL／MariaDB 系統 schema 前置確認，欄位確認後才執行相應研究 SQL；附新命令與輸出，不要求 RDS／replica 尚未具備的情境通過。 |
| AC-13 | 使用者知道語法、shell 引號、預設名稱相容性、blacklist metadata 省略、未知筆數與不支援的旗標組合。 | 更新 `docs/user/en/`、`docs/user/zh-TW/` 各自 `index.md` 與 `index.html`；CHANGELOG 記錄輸出與含點號名稱的相容性差異。 |
| AC-14 | 全部 repo gates 通過，且 AC-01–13 每項有可重現觀察。 | `make verify` exit 0，加逐條驗收報告；缺少證據時只能報 partial。 |

## 實作與驗證邊界

沿用既有 adapter 與 metadata 型別，先檢查可重用的 quoting／identity 工具，但不得使用
無法辨認 quoted dot 的分割方式。可在 schema 命令解析完整名稱，透過相容的 optional
namespace 選項傳給 adapter；不要把 shared adapter 的所有 tableName 字串重新解讀。
不因這張 Story 建立新的通用查詢框架或持久化層。

測試 fixture 建置可在隔離容器準備 schema、表、view、受限角色與 grant；真正受測的
CLI 呼叫固定在 query-only／agent mode，不使用 production 或 ambient credentials。
真實引擎測試負責證明可見 metadata；fault injection 負責穩定驗證錯誤不被吞掉，
兩者不能互相冒充。若所需測試服務不可用，記為 blocked，不跳過後宣稱完成。

實作後需更新測試與使用者文件，再進行安全／公開介面獨立審查。除錯誤回報所必需者外，
不改其他命令的行為；若發現必須跨越 Out of Scope，停止並報告，而非擴大 Story。

## 核准與交付

本次對話已核准並指定本 Story；對應 ForgePilot Work Item 為 `qualified-schema-inspection`。
核准記錄不代表實作完成；不能把本檔存在或 ADR accepted 當作其他工作的核准。
實作完成以 `make verify` 與逐條驗收證據供人審查，不由 agent 自行宣告 Human Review 通過。
