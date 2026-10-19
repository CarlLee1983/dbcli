# MySQL／MariaDB：驗證式 TLS 與三引擎完整覆蓋

## Goal

來源：[issue #260](https://github.com/CarlLee1983/dbcli/issues/260)，父規格 [#258](https://github.com/CarlLee1983/dbcli/issues/258)。使用者於本次會話明確回覆「核准」，核准 Story SHA-256 `0b416f44f2c35d9b874f268508665d3cf38f5d4470faa551eff3e80300636eb1` 的範圍與測試邊界；此決定授權實作，不等於 exact-candidate 人工驗收。前置 #259 已由 PR #261 合併。

讓 MySQL 與 MariaDB 使用者透過正常具名 profile 保存、重讀並選取驗證式 TLS，以真實 CLI 執行唯讀查詢。沿用前置切片的唯一契約 `sqlTls: { mode: 'verify-full', caPath: string }` 與 `init --sql-tls verify-full --sql-tls-ca <path>`；支援從 PostgreSQL 擴至三引擎，任何驗證失敗均停止，不降級或繼續使用者查詢。

具體行為與邊界：

- 沿用 V1／V2 schema、正常 init、保存／重讀／具名選取、環境參照與既有設定優先序；將前置切片對 MySQL／MariaDB 的暫時拒絕改為真正支援。保留不能安全保留 TLS 的舊單檔 init 匯入拒絕，其他未支援引擎繼續明確拒絕。
- CA 仍為 init 正規化後保存的非空絕對 PEM 路徑，不新增 CA 環境參照形式。每次連線重新讀取並驗證 CA；缺失、空白或無效 CA 在連線前失敗。
- 沿既有 mysql2 共用 adapter 建立每連線驗證設定，驗證信任鏈、有效期及設定目標的 DNS／IP 身分；明確 TLS 拒絕 Unix socket。不使用全域 TLS 修改、不依賴 ambient 信任或另一 profile 的設定、不新增任意 driver-option API。driver 可接受 options 不是握手驗收證據。
- 初始化連線測試與實際查詢使用相同契約；TLS 錯誤與 recovery 保留明確原因並指向修正 CA／主機名／憑證，不移除 TLS、不關閉驗證、不重試明文。未設定 TLS 的三引擎 profile 沿用原行為。
- connection.tls 由既有 engine matrix 宣告三引擎支援，保持 ID、CLI surface、schemaVersion 及公開 shape。離線 discovery／check 不讀 CA、不握手、不改設定；available 不等於政策、連線、原生權限或 DBA 驗收成立。
- MySQL 與 MariaDB 各自建立本機隔離 TLS fixtures 與自產測試憑證，記錄引擎版本／映像與環境；健康檢查獨立於預期失敗的 profile。保留 PostgreSQL 正反例並重跑受共享邊界影響的檢查。
- DNS／IP 測試包括 IP-only SAN 正例，以及目標為 127.0.0.1、憑證僅含 DNS localhost SAN 的拒絕反例。驗證須在送出認證資料與 session SQL 前成立；沿用現有 driver 的具體接法由真實握手測試決定，不能假定 PostgreSQL 的 TLS options 可直接套用。若必須更換／重寫 driver 才能達標，停下回報範圍決策。
- 同步 docs/user/en、zh-TW 的 index.md／index.html 與 Tool Skill／reference 及受管理副本，移除已取代的 MySQL／MariaDB 不支援敘述。無新 production 依賴的方案優先。

### 測試邊界與依賴順序

1. 真實 CLI → 正常具名 profile → 各引擎隔離端點：驗證 init、查詢、身分拒絕與安全限制，並以對端觀察確認無後續查詢或明文重試；不代表 RDS 或全部 DBA 流程已驗收。
2. 公開 config 與具名連線介面：驗證 V1／V2 生命週期、轉換、同程序多 profile 及三引擎交錯選取，避免信任污染；不能單獨替代真 CLI 握手驗收。
3. 離線 capabilities／check CLI 與既有 contract gates：驗證 matrix、公開 shape、context／unknown／unavailable／權限語意及無連線／無修改；不能證明握手或 CA 可讀。

以上邊界隨本 Story 一併核准，依 tdd 每次一條行為 red → green。先完成 MySQL 正常 profile 到真實 TLS 的最小切片，再以同一契約完成 MariaDB；接著補齊分引擎五種負例、ambient／多 profile、舊 profile 與安全回歸，再完成 catalog／文件，最後固定 candidate 執行獨立 code-review、canonical make verify 與人工審查。

### 證據與交付

工作 base：`e133a1ea22453dab32c8282e950ad6f524e53511`；分支：`feat/260-mysql-mariadb-verified-tls`；隔離 worktree：`/Users/carl/Dev/CMG/Dbcli-260`。原工作區的未追蹤內容不納入候選。

採 local handoff 路徑，保留 base、完整可重建 patch／新增檔內容、source hash、驗證前後比對、完整 make verify 日誌／退出碼／attestation，以及下列 12 項 AC 與父規格七項邊界的觀察對照。同一 handoff 分列三引擎、本機與未觀察的 RDS，不另建進度帳本。前置證據只在 source／環境／假設仍成立時沿用。

核准 Story 授權實作與必要本機隔離 fixtures；commit 依使用者明示啟動的 implement 技能於實作、驗證與 agent review 後執行。exact-candidate 人工驗收仍是獨立決定，尚未完成前保持 pending。必要 fixture 或驗證失敗保留 partial／blocked，不降低驗收要求。

## Out of Scope

- mTLS、正式 CA／憑證簽發與輪替、變更使用者或生產資料庫／伺服器、雲端資源操作；允許建立與清理本 Story 專用的本機測試服務及憑證。
- driver 替換／重寫、通用 driver-option API、連線字串或設定系統全面重設計、其他引擎 TLS 契約、既有無 TLS profile 強制遷移。
- 放寬 CALL、agent mode、production 選擇、permission、blacklist、write gate、原生唯讀或 audit。
- DBA Role Skill 本體、跨工具批准／結論模型、RDS 真實驗收、升版／發布。
- 不安全 TLS 模式、移除 TLS／降版／明文 fallback；回滾時需要 TLS 的 MySQL／MariaDB 流程必須停止或維持支援版本。
- 無關工作與既存未提交內容；push、建立 PR、issue 留言、merge、tag、publication 不包含在本次授權內。

## Acceptance Criteria

以下完整保留 issue #260 的 12 項條件，核准與驗收時均以此為準；逐項驗證結果與人工驗收狀態記於 local handoff。

- [ ] MySQL 與 MariaDB 各自經正常 profile 輸入、驗證、保存、重讀、具名選取與真實 CLI，到達其實際 driver；本次支援的設定版本、轉換及入口均保留前置切片的 TLS 要求，不能僅修改 adapter options。
- [ ] 兩引擎各自以要求 TLS、可信 CA、有效且主機名相符的隔離端點成功執行唯讀查詢，保留分引擎、版本與環境的加密觀察證據。
- [ ] 兩引擎各自覆蓋不受信任憑證、過期憑證、主機名錯誤、CA 無法載入、對端不支援 TLS 五種負例，觀察到明確失敗、無後續使用者查詢、無明文重試及無自動關閉驗證；錯誤／recovery 不得降級。
- [ ] 信任鏈／有效期／主機名反例能提供加密但仍被拒絕，不以 cipher 非空、單一引擎結果或 mock driver options 取代伺服器身分驗證。
- [ ] 明確 TLS 要求不被較弱 ambient 行為削弱；不同 MySQL／MariaDB 具名 profile，以及混用三引擎 profile 時，各自使用自己的 CA／信任條件。覆蓋同程序依序選用多個 profile，並回歸 PostgreSQL 的 ambient 保護與 profile 隔離。
- [ ] 三引擎未設定 TLS 的既有 profile 維持舊行為；前置切片的 PostgreSQL 正反例保持成立。需要 TLS 的流程不能以移除設定、回退不支援版本或降級明文宣稱符合。
- [ ] agent mode 仍拒絕 TLS 設定修改，但可依既有權限使用已設定連線；production 選擇、permission、blacklist、write gate、原生唯讀與 audit 的受影響邊界有雙引擎回歸證據。
- [ ] connection.tls 支援由同一 engine matrix 擴至三引擎，維持穩定 ID、真實 CLI surface、離線 catalog／check 及既有公開 shape；不因增加引擎本身改 schemaVersion，也不把支援外推到其他引擎。
- [ ] 契約檢查保留 context 缺失／無法解析、unknown／unavailable 及既有權限語意，證明 discovery/check 不連線、不修改設定。available 與明確設定／CA 可讀／真實握手／原生權限／DBA 結論仍分開；必要能力非 available 的受影響步驟不得視為可執行。
- [ ] 兩引擎測試各自使用可重現的隔離 TLS fixture 與真 CLI 正常 profile 路徑；不使用個人憑證，不以預期失敗的 TLS profile 探測服務可用性而 skip。任一必要引擎或 fixture 不可用，保留 blocked／失敗，不能以另一引擎通過或空結果結案。
- [ ] 同步使用文件與適用 Tool Skill／reference，維持雙語及 parity；實際設定方法與三引擎支援清楚可用，保留相容性、失敗處理與 Role／Tool 邊界，移除已被本切片取代的 MySQL／MariaDB 尚未支援說明與臨時拒絕路徑。
- [ ] 依 Warrant 核准本切片 Story，使用 Bun 與 canonical make verify，提供本切片 exact-candidate 驗證與人工審查；在既有交付證據中對照父規格七項邊界及三引擎結果，不另建進度帳本。前置切片證據只在 source／環境與相關假設仍成立時沿用；共享邊界變動需重跑受影響檢查。本機與真實 RDS 證據分列，未觀察 RDS 時仍明示未驗證。
