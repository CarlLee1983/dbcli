# Story: SHOW GRANTS 的認證內容在輸出前去敏

狀態：使用者已核准本文與 ForgePilot 計畫；GATE-002 已核准，實作中。
關聯：#240 G3。G2 已通過 EV-004 與 EV-005 Human Review；本次不更動 G2 驗收。
決策：[ADR-0050](../../docs/adr/ADR-0050-grant-authentication-is-redacted-before-results-leave-the-adapter.md)。
背景：[原始研究](../../docs/research/dba-system-view-probes.md)，G3 的研究證據不可覆寫。

## Goal

MySQL／MariaDB 使用者透過 dbcli 檢視 SHOW GRANTS 時，可以判讀帳號、角色、授權範圍
與權限，但不會收到 grant 文字內的密碼、密碼雜湊或其他認證秘密。保護不依賴 blacklist，
對所有權限層級、agent 與互動模式一致生效，沒有輸出原始認證內容的 bypass。

## Out of Scope

- SHOW CREATE USER、直接讀取 mysql.user 等系統表、任意查詢文字的秘密掃描。
- SQL 輸入中本來就包含的秘密、既有匯出檔／歷史紀錄的清理或遷移。
- 新增 SHOW GRANTS 語法能力、放寬 saved query 的 SELECT／WITH 限制、多語句支援。
- 結構化授權模型、可重播的授權 SQL、帳號匿名化、修改資料庫 grant 或認證設定。
- 更動 blacklist、query-only、agent mode、write gate、production selection 或權限層級。
- G4／#241 RDS CALL 政策、其他引擎的去敏機制、通用資料清洗框架。

## 行為契約

### 1. 保護邊界

在 MySQL／MariaDB 共用 adapter 的結果回傳邊界進行去敏，涵蓋正常執行與 native-read-only
兩條路徑；原始 grant 儲存格不得先流向 formatter、shell、檔案輸出或其他 adapter 消費端。
辨識 SHOW GRANTS 不得只依原始 SQL 的簡單大小寫／前綴比對而漏掉目前已支援的空白、
註解或合法尾端分號形式。包括既有語法分析支援的 MySQL `/*!...*/`、MariaDB `/*M!...*/`
可執行註解（含緊鄰的版本數字）、整句包覆與 `SHOW /*! GRANTS */` 等 token 分段，
以及 `#` 與 MySQL `--` 的空白規則；不能用一律刪除註解的方式漏掉實際會執行的語句。
FOR 的帳號引用／CURRENT_USER 等既有可執行形式應受到同樣保護。
若既有語法或政策不接受某種輸入，維持拒絕，不為了本 Story 放行。
GATE-002：重用連線時已讀取的伺服器版本，不另增加 probe。版本資訊無法取得且
條件註解導致實際語句有歧義時，以固定安全錯誤拒絕，不執行語句或輸出原始結果；
可確定的非 SHOW GRANTS 查詢保持原有行為。AC-03／04 必須包含此正反例。

query、shell 與 SQL export 經同一邊界取得安全結果；JSON、CSV、表格與 HTML 不得有旁路。
saved query 目前不接受 SHOW GRANTS，保留此限制並驗證拒絕；不宣稱新增支援。
既有 audit 與 receipt 不增加結果內容欄位，亦不能因新增診斷或 parser 錯誤而寫入原始認證內容。

### 2. 已知認證格式

保留結果列數、欄名與原有結構。可完整安全辨識的 grant 文字保留帳號、角色、授權範圍
與權限，將認證 payload 替換為明確的 `[REDACTED]` 標記。

初始辨識範圍含 MariaDB／舊 MySQL 的 IDENTIFIED BY、IDENTIFIED BY PASSWORD，以及
IDENTIFIED VIA／WITH 的 USING／AS 認證參數、PASSWORD(...) 與 OR 串接的多認證方法。
所有認證參數都視為需遮蔽，不因參數看似 service name、空字串或不像密碼雜湊而保留。
處理 SQL 引號、雙重引號跳脫、反斜線跳脫、換行與多個認證片段；若解析語意存在歧義，
採下一節的省略規則，不透過猜測 SQL mode 決定哪段內容可公開。

不以固定 hash 長度、前綴或欄名 blacklist 作為認證內容判定依據。被授權的物件或帳號名稱
內含 IDENTIFIED／PASSWORD 等字樣不等於認證子句，不得因此破壞可安全辨識的非秘密資訊。
沒有認證子句且可安全辨識的純權限／角色列維持原文字。

### 3. 無法安全辨識時

未知、不完整或無法確定認證邊界的 grant 格式，整個儲存格替換為
`[OMITTED: grant text could not be safely redacted]`。保留該列與欄名，不原樣輸出、不靜默
丟列；其他可安全辨識的儲存格照常呈現。異常值型態也不得直接回傳可能承載秘密的內容。

此類省略不冒充完整授權資訊；標記須在所有輸出格式可辨識。不另增輸出 schema 或新的
metadata envelope。去敏結果供人或 agent 檢視，不能宣稱是可重播 SQL。
如果解析過程拋錯，錯誤處理不得帶出原字串或以原始結果作 fallback。

## Acceptance Criteria

| ID | 可觀察結果 | 必需證據 |
| --- | --- | --- |
| AC-01 | 已知認證子句的秘密消失，安全的帳號、角色、權限與範圍仍可判讀。 | 純轉換函式的表列測試：BY／BY PASSWORD、VIA／WITH、USING／AS、PASSWORD(...)、OR 串接、空認證參數、引號／跳脫／換行；使用合成秘密 sentinel 斷言沒有殘留。 |
| AC-02 | 未知、截斷、歧義與異常型態以整格省略標記取代，其他列保留。 | 反例矩陣與混合結果測試；不執行 raw fallback、不將原文放進例外或診斷。 |
| AC-03 | 兩種 adapter 執行模式都先去敏；目前支援的 SHOW GRANTS 輸入形式不能繞過保護。 | driver 邊界測試涵蓋 MySQL／MariaDB、normal／native-read-only、大小寫、空白、普通／可執行註解（版本數字、整句包覆與 token 分段）、尾端分號與 FOR 形式；不支援輸入維持拒絕。 |
| AC-04 | 非 SHOW GRANTS 查詢不被掃描或改寫；純權限／角色 grant 列與原結果結構相容。 | adapter 回歸正反例，包括物件／帳號名稱內含認證關鍵字、沒有認證子句的列；query-only 與 blacklist 既有測試保持通過。 |
| AC-05 | query、互動 shell 與 SQL export 的 JSON／CSV／表格／HTML 均無秘密，省略標記可見。 | 命令／REPL 的合成 driver 邊界測試與輸出檔檢查，涵蓋適用格式；權限與 agent 模式矩陣證明無 bypass，blacklist 空／非空均生效。saved SHOW GRANTS 仍拒絕。 |
| AC-06 | 真實 MariaDB 的 grant 認證內容受到保護，MySQL 無認證 grant 的授權資訊保持可讀。 | 隔離 Compose 帳號與真實 CLI：先 blacklist 檢查，SHOW GRANTS 無目標表所以記錄 schema 前置不適用；比對受控 fixture 與輸出，僅保存去敏後證據或安全斷言，不將原始 hash 寫入 repo／log。不同版本 grammar 的合成測試與本機觀察分開標示。 |
| AC-07 | audit、receipt 與錯誤沒有因新機制帶出 grant 結果秘密。 | 用合成 sentinel 檢查命令輸出、檔案與既有 audit／receipt artifacts；來源審查確認沒有新增 grant 結果紀錄路徑。 |
| AC-08 | 使用者清楚保護範圍、標記、資訊省略、無 bypass 及不可重播的相容性影響。 | docs/user/en、zh-TW 的 index.md／index.html 同步更新，CHANGELOG 說明；docs parity 通過。 |
| AC-09 | 全部 gates 通過，每項 AC 有可重現觀察，獨立安全／公開介面審查無未解決重大問題。 | make verify exit 0 與 ForgePilot 候選證據、逐項驗收報告；未通過或缺少觀察時只能報 partial。 |

## 驗證與交付

先在純轉換與 adapter 公開執行邊界完成 red → green，再驗證 CLI／REPL／匯出路徑。
純函式測試負責格式邊界；真實引擎只證明本機版本實際提供的格式，不能互相冒充。
真實測試使用隔離 fixture 管理員建置、受控帳號查詢及清理，不使用 ambient／production
憑證，不修改使用者資料庫。不將 driver 原始 grant 放進測試失敗 diff、console 或保存證據。

保留已核准 G2 與其他未提交工作，不在本 Story 修改或混入無關檔案；提交、推送與 PR
仍需當次授權。沒有新增依賴或資料遷移；移除保護會恢復洩漏，保守 fallback 是整格省略。
Story 核准後才匯入對應計畫並開始實作，完成驗證後等待 Human Review，不自行核准。
