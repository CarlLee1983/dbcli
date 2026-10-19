# PostgreSQL：正常 profile 的驗證式 TLS 與 capability 發現

## Goal

來源：[issue #259](https://github.com/CarlLee1983/dbcli/issues/259)，父規格 [#258](https://github.com/CarlLee1983/dbcli/issues/258)。使用者已於本次會話明確回覆「核准」，核准前一則提供的 Story（SHA-256 `9413418fb040e6ca0e6506d9297bc8695ccd7edbc54ef6e2233b1f24d5114600`）；此決定授權本 Story 實作，不等於 exact-candidate 人工驗收。

讓 PostgreSQL 使用者透過正常具名 profile 明確要求驗證式 TLS、指定信任 CA，保存、重讀、選取後經真實 CLI 執行唯讀查詢。加密、信任鏈、有效期與目標主機名驗證都必須成立；任何失敗不得降級、關閉驗證或繼續使用者查詢。

具體設定契約：

- 增加專用 SQL 設定物件 `sqlTls: { mode: 'verify-full', caPath: string }`，只接受完整驗證模式；不重用 MongoDB 的 `tls` 或 Elasticsearch 的 TLS 選項。
- 正常具名 `init` 入口增加 `--sql-tls verify-full --sql-tls-ca <path>`，與現有 `--conn-name` 配合。兩個 TLS 參數成對提供；格式錯誤、空值、不支援模式或引擎明確失敗，不可被剝除。
- init 將相對 CA 檔案路徑以執行目錄解析為絕對路徑後保存。`caPath` 必須為非空絕對路徑字串，本切片不新增 CA 欄位的環境變數參照；既有 host／user 等欄位的參照繼續可用且不得造成 TLS 物件流失。每次建立連線重新讀取 PEM CA bundle，無法讀取、空白或無效 CA 在建立連線前停止。離線 capability 檢查不得載入 CA 或握手。
- 保留 V1／V2 正常讀寫、具名選取、既有優先序及 V1→V2 轉換；不能表達的 TLS 要求明確拒絕。初始化連線測試與實際使用同一嚴格契約。
- PostgreSQL adapter 使用現有 driver 的每連線驗證設定，不改全域 TLS 環境。未指定 `sqlTls` 的 profile 沿用舊行為；MySQL／MariaDB 收到此物件或新 CLI 參數必須拒絕。其他未支援引擎不得靜默接受此 SQL 契約。
- 以設定的 DNS／IP 目標驗證憑證身分；明確 SQL TLS 不接受無法套用此目標身分契約的 Unix socket。不能只憑 `rejectUnauthorized: true` 或 cipher 非空宣稱目標驗證成立。
- 明確 SQL TLS 的錯誤 hints／recovery 指向修正 CA、主機名或憑證有效期，不建議 `rejectUnauthorized: false`、移除 TLS 或明文重試。舊版可能剝除新欄位，因此回滾時必須停止需要 TLS 的流程或維持支援版本，不能以降版後沿用 profile 宣稱仍符合。
- `connection.tls` 從現有 engine matrix 衍生，僅 PostgreSQL 宣告支援；使用真實既有 CLI command surface，不增加 TLS 子命令。正常使用已設定連線不標示為設定修改；available 不證明政策、CA 或握手成立。

依賴順序：先建立正常 profile 到 PostgreSQL transport 的最小正例；再完成驗證失敗、ambient／profile 隔離與既有安全回歸；接著完成離線 capability、雙語文件與 managed assets；最後對固定 candidate 做獨立 code-review、make verify 與人工審查。實作依 TDD 每次一條行為推進，不先批次寫完所有測試。

測試邊界沿用父規格：主要為真實 CLI → 正常 profile → PostgreSQL 隔離端點（含對端觀察）；次要為離線 capabilities／check CLI 與既有 contract gates。公開 config／多 profile 連線介面補足同程序隔離及版本轉換；不新增 production 測試 API。

工作 base：`8251c407cb8c679fb74ec4924e2daee5a201d075`；分支：`feat/259-postgresql-verified-tls`。使用 local handoff 證據路徑，排除原有未追蹤 `.scratch/` 內容與 `specs/stories/csv-serializes-objects-and-dates.md`。人工審查保持 pending，直到使用者審查 exact candidate。

## Out of Scope

- MySQL／MariaDB 的 TLS 支援；本切片只實作拒絕明確要求。父規格的三引擎交付仍未完成。
- mTLS、正式憑證簽發／輪替、變更使用者資料庫或伺服器設定、雲端資源操作；可建立與清理本 Story 必要的本機隔離測試服務與憑證。
- 不驗證身分模式、明文回退、任意 driver-option API、driver 替換、連線設定或 connection string 匯入的全面重設計。
- CA 欄位的新環境變數參照形式；此切片的 CA 表示為正常 init 保存的絕對 PEM 檔案路徑。
- 放寬 CALL、agent mode、production、permission、blacklist、write gate、原生唯讀或 audit。
- DBA Role Skill 本體、批准模型、DBA 結論／evidence envelope 擴充。
- RDS 真實驗收、發布或升版；本機結果不得宣稱 RDS 已通過。
- 無關檔案與既存未提交工作。Commit 依 implement 技能於實作及驗證後處理；push、PR、issue 留言、merge、tag、publication 不包含在本 Story 的授權內。

## Acceptance Criteria

以下逐字保留 issue #259 的 12 項條件；「證據」是驗證計畫，目前全部尚未驗證。

1. 經正常 profile 輸入、驗證、保存、重讀與具名選取，PostgreSQL TLS 要求及 CA 設定完整到達連線執行路徑；覆蓋本次宣稱支援的設定版本／轉換與入口，不只直接建構 adapter。無法表達的明確要求不得被丟棄後繼續連線。

   證據：正常 init CLI 建立具名 profile、保存後重讀及具名選取的整合測試；V1、V2、V1→V2、環境變數參照及實際連線選項解析的公開介面回歸。宣稱支援的入口逐一列出，不以 adapter mock 代替。

2. PostgreSQL 真實 CLI 正例使用要求 TLS、可信 CA、有效且主機名相符的隔離端點，成功執行唯讀查詢，另取得加密觀察證據。

   證據：隔離 PostgreSQL TLS fixture 的真實 CLI blacklist → schema → 唯讀 query；查詢結果、退出碼及同連線 pg_stat_ssl 或等效伺服器加密觀察。

3. 分別以不受信任憑證、過期憑證、主機名錯誤、CA 無法載入、對端不支援 TLS 五種負例證明明確失敗。使用可觀察的對端紀錄或等效隔離證據確認後續使用者查詢未執行，沒有明文重試或自動關閉驗證；錯誤／recovery 路徑不得降級。

   證據：五種負例各自記錄 fixture 健康證據、CLI 非零退出、TLS 原因及伺服器查詢／連線紀錄，驗證使用者查詢未執行、未明文重試；recovery 回歸。

4. 信任鏈／有效期／主機名反例使用能提供加密的端點，證明加密與身分驗證分開；不以 cipher 非空或 mock driver options 當作驗證成立。

   證據：不受信任、過期、錯誤主機名端點各自可提供加密的獨立 fixture 觀察，與 CLI 拒絕結果並列。

5. 明確 profile 在 PGSSLMODE=no-verify 等較弱 ambient 設定下仍維持驗證要求；不同 PostgreSQL 具名 profile 的 CA／信任條件不互相污染，包含同程序依序使用多個 profile 的路徑。

   證據：PGSSLMODE=no-verify 下真實 CLI 正反例；同程序經公開 profile 讀取／選取及連線路徑依序切換不同 CA 的具名 profile，觀察各自成功／失敗。

6. 未設定 TLS 的既有 SQL profile 維持舊行為，不新增全域強制 TLS／明文政策；此切片尚未支援的 MySQL／MariaDB 明確 SQL TLS 要求被拒絕，不因解析剝除或 adapter 忽略而連線。不影響其他引擎既有 TLS 契約。

   證據：未設定 sqlTls 的 SQL profile 回歸；MySQL／MariaDB 正常輸入及設定讀取的明確拒絕測試並證明未建立連線；其他引擎 TLS 既有測試。

7. 已設定連線的允許唯讀使用不被誤判成設定修改；agent mode 仍拒絕 TLS 設定修改。production 選擇、permission、blacklist、write gate、原生唯讀與 audit 的受影響既有邊界有回歸證據。

   證據：隔離 CLI agent mode 讀取已設定 TLS profile 與修改設定拒絕；production、permission、blacklist、write gate、原生唯讀、audit 受影響整合／回歸測試逐一對照。

8. 新增穩定 ID connection.tls，支援及風險由既有 engine matrix 衍生，映射到真實 CLI surface；本切片只宣告 PostgreSQL 支援，MySQL／MariaDB 及其他未支援引擎不回 available。沒有該 ID 的舊版仍屬 unknown 語意，不偽造新 TLS 子命令。

   證據：engine matrix、catalog、Commander 真實 command path 的 contract 測試；connection.tls 引擎與風險宣告及 unknown 行為測試。

9. 離線 catalog／check CLI 與 contract 檢查保持不連線、不修改設定；維持缺少／無法解析 context、未知 ID、引擎及既有權限判定語意。available 不證明本次政策所需的明確 TLS 設定、CA 可載入或握手成功，亦不授權修改設定。新增 ID 本身不改 schemaVersion；若公開 shape 改變，遵循既有版本規則。

   證據：不可連線目標／不存在 CA 路徑的離線 capabilities 與 check CLI 測試；設定前後內容一致、無連線觀察；context、ID、engine、permission 既有 contract 回歸。

10. 沿用隔離 workspace、HOME／config home／integrity anchor、正常 profile 與真 CLI 測試模式，避免載入使用者環境或憑證，遵循 blacklist／schema 前置。端點可用性與預期 TLS 拒絕分開判斷；必要 fixture 缺少須 blocked／失敗，不能把負例連線失敗當 skip。

   證據：fixture harness 與測試輸出：獨立 workspace、HOME、config home、anchor、--no-env-file；blacklist/schema 前置；服務健康與 TLS 拒絕分開斷言；必要 fixture 不可用時失敗。

11. 同步使用文件與適用 Tool Skill／reference，保留雙語及 parity 要求；清楚寫出本切片的 PostgreSQL 支援範圍、正常設定方法、拒絕行為、舊 profile 相容性，以及需要 TLS 的流程不可移除設定／降級明文來恢復符合。Role Skill 的結果與批准語意保持父規格邊界。

   證據：docs/user/en、zh-TW 的 index.md/index.html 與 assets/SKILL.md、assets/reference.md 及受管理副本；docs:check、plugin:check、platform:check、contract:check 與雙語人工審閱。

12. 依 Warrant 核准本切片 Story，使用 Bun 與 canonical make verify，逐項保留本切片 exact-candidate 驗證與人工審查證據。PostgreSQL 真實測試與未完成的 MySQL／MariaDB 支援分列；本機證據不宣稱真實 RDS 已通過，後續 RDS 驗收依既定策略處理。

   證據：核准本 Story 的使用者決定、Bun focused tests／typechecks、canonical make verify 完整日誌及退出碼；本地 handoff 保存 base、完整可重建 candidate、內容 hash、AC 觀察及 exact-candidate 人工審查。
