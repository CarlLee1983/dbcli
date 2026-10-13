# Story: DBCLI-041 A Connection String That Becomes Fields

決策：`docs/adr/ADR-0043-a-connection-string-is-decomposed-into-fields-on-write.md`
（部分取代 ADR-0002）。用語依 `CONTEXT.md` 的「Connection configuration language」。

## Goal

使用者拿著從 Atlas / Compass 複製的 MongoDB 連線字串，不論在互動流程貼上，或在 CI
以 `dbcli init --uri` 非互動設定，dbcli 都把它拆解成欄位設定寫入：密碼因此分離到
`.env.local`，不再以明文留在 `config.json`。只有欄位設定表達不了的連線字串（多組
host、帶機密的 option）才原樣存進 `uri`，並明確警告。非互動流程另有 `--replica-set`、
`--srv`、`--tls` / `--no-tls`，不必為了這三項改用 `--uri`。

## Problem Statement

ADR-0002 讓欄位設定成為主要形式，但兩個最常見的情境仍走連線字串的逃生門：

- 從 Atlas / Compass 複製連線字串。互動流程只能原樣保存，且 Atlas 字串必帶的
  `retryWrites`、`w`、`appName` 本來就無法以欄位表達。
- CI 非互動設定。`init` 只有 `--auth-source`，需要複本集、SRV 或 TLS 時只能用 `--uri`。

兩者的結果都是帳密以明文寫進 `config.json`，`--use-env-refs` 碰到連線字串也只發警告。

## Solution

寫入前一律拆解連線字串；新增 `options` 欄位承接 driver 參數；補齊三個 flag；讓 SRV
欄位設定與等價連線字串得出相同的 authSource。

## User Stories

1. 身為從 Atlas 複製連線字串的使用者，我想在互動 init 貼上整條字串，讓 dbcli 自己拆成欄位，這樣我不必逐欄抄寫。
2. 身為使用者，我想在貼上後看到拆解結果（密碼遮蔽），這樣我知道 dbcli 怎麼理解這條字串。
3. 身為使用者，我想讓貼上字串裡的密碼自動存進 `.env.local`，這樣 `config.json` 可以安心分享或備份。
4. 身為 Atlas 使用者，我想保留 `retryWrites`、`w`、`appName` 等參數，這樣拆解後的連線行為和原字串一致。
5. 身為使用者，我想讓字串裡的 `authSource`、`replicaSet`、`tls`（或 `ssl`）變成正式欄位，這樣日後改單一欄位就生效。
6. 身為使用者，我想在同一參數同時出現在 `options` 與正式欄位時被拒絕，這樣不會遇到「改了卻沒生效」。
7. 身為使用者，我想讓字串路徑裡的資料庫名稱直接被採用，這樣不必回答一次重複的問題。
8. 身為使用者，字串沒帶資料庫名稱時，我想被要求填寫且沒有 `testdb` 這種預設值，這樣不會誤連到測試庫。
9. 身為使用多 host 複本集字串的使用者，我想讓設定仍然可用（存成 `uri`），並被警告帳密將明文存放，這樣我知道風險。
10. 身為使用 AWS IAM 或憑證密碼的使用者，我想讓帶機密的 option 不被拆進 `options` 明文落盤，而是退回 `uri` 並警告，這樣機密不會換個欄位外洩。
11. 身為 CI 維護者，我想讓 `--uri` 也被拆解，這樣 pipeline 產生的設定不再含明文密碼。
12. 身為 CI 維護者，我想用 `--replica-set <name>` 指定複本集，這樣不必改寫成連線字串。
13. 身為 CI 維護者，我想用 `--srv` 指定 SRV 網域，這樣能非互動地設定 Atlas。
14. 身為 CI 維護者，我想用 `--tls` / `--no-tls` 明確開關 TLS，兩者都不給時沿用 driver 預設。
15. 身為 CI 維護者，我想在 `--uri` 與欄位 flag 並用時得到明確錯誤，這樣不會猜哪邊生效。
16. 身為 CI 維護者，我想在 `--uri` 與 `--use-env-refs` 並用時得到錯誤，並看到兩條可行的替代做法。
17. 身為使用者，我想讓打錯的 option 鍵在連線測試時由 driver 報錯，這樣不用等到第一次查詢才發現。
18. 身為使用 SRV 欄位設定的使用者，我想讓 TXT record 指定的 authSource 被採用、沒有才補 admin，這樣欄位設定和連線字串連到同一個認證資料庫。
19. 身為既有使用者，我想讓含 `uri` 的舊設定檔不經遷移照常運作。
20. 身為互動使用者，我想讓選單第一項仍是逐欄填寫、第二項標示為「貼上連線字串（Atlas / Compass 複製的）」，這樣不再誤以為貼字串是進階功能。
21. 身為讀文件的使用者，我想在中英文使用者文件看到新的設定方式與 flag。
22. 身為升級中的使用者，我想在 CHANGELOG 看到 `--uri` 寫出的設定形狀改變的說明。

## Implementation Decisions

- 新增一個拆解模組：輸入連線字串，輸出「欄位設定」或「必須退回 `uri` 及原因」（多 host／帶機密 option）。
  以 `mongodb-connection-string-url` 解析，該套件改列為直接依賴，版本對齊 mongodb 7.2 使用的版本。
- 拆解規則：`authSource`、`replicaSet`、`tls`／`ssl` 進正式欄位；`mongodb+srv` 對應 `srv: true` 且不寫 port；
  路徑上的資料庫名稱進 `database`；其餘 query 參數原樣進 `options`；連線字串沒寫 authSource 時不寫該欄位。
- 帶機密的 option 鍵：`authMechanismProperties`、`tlsCertificateKeyFilePassword`、`proxyPassword`。
- `MongoDBConnectionConfigSchema` 新增 `options`：字串鍵對字串值，不接受 env-ref。`options` 與正式欄位同名時於驗證階段拒絕。
- adapter 組 URI 時附上 `options`；`srv: true` 時不再強制 `authSource=admin`，交給既有的 TXT 合併與 admin 後備。
- `init` 新增 `--replica-set <name>`、`--srv`、`--tls` / `--no-tls`（皆未給時 `tls` 不寫入）。
- `--uri` 與 `--host`／`--port`／`--user`／`--password`／`--auth-source`／三個新 flag 並用時報錯；`--name` 可並用並覆蓋字串內的資料庫名稱。
- `--uri` 與 `--use-env-refs` 並用時報錯，訊息指出兩條替代路徑：拿掉 `--use-env-refs`（密碼自動分離到 `.env.local`），或改用 `--env-*`。
- 互動流程：貼上字串後印出拆解結果（密碼遮蔽）後直接進連線測試，不再多一次確認；字串帶資料庫名稱時不問 Database name；沒帶時必填、無預設。
- 互動選單順序不變，只改第二項標籤。
- 退回 `uri` 時寫出的設定只含 `uri`、`database` 與 `system`，不再寫入空的 `host`／`port`／`user`／`password`。

## Testing Decisions

- 只測外部可觀察行為：寫進設定的內容、終端訊息、adapter 實際用來連線的 URI；不對拆解模組的內部結構斷言。
- 接縫一：`initCommand` 經 Commander 解析，沿用 `tests/unit/commands/init-mongodb-fields.test.ts` 的 harness（模擬 `promptUser`、攔截 `configModule.write`）。涵蓋拆解、flag、報錯、互動流程與警告。
- 接縫二：`MongoDBAdapter` 的連線 URI，沿用 `tests/unit/adapters/mongodb-adapter.test.ts` 的 `connectedUri` helper。涵蓋 `options` 組裝與 SRV authSource。
- 等價性測試放在接縫二：同一條連線字串，原樣作為 `uri` 與拆解後的欄位設定，解析出的主機、路徑與參數集合相同。這是唯一直接用到拆解模組的測試。
- 密碼不出現在 `config.json` 寫入內容，沿用 `tests/unit/commands/init-masked-secrets.test.ts` 的斷言方式。

## Out of Scope

- 從 `.env` 的 `MONGODB_URI`／`MONGO_URL` 自動帶入。
- env-ref 模式補強（`authSource`／`replicaSet` 的 env-ref、SRV 不需 `--env-port`）。
- 多 host 的欄位表達（`hosts` 陣列）。
- 既有含 `uri` 設定檔的遷移。
- 依 host 自動判斷 SRV（如 `.mongodb.net`）。
- `options` 的允許清單驗證。
- 其他引擎的 init 流程。

## Acceptance Criteria

1. 互動 init 貼上 `mongodb+srv://u:s3cr3tPw@cluster0.example.mongodb.net/app?retryWrites=true&w=majority&appName=Cluster0`
   後，寫入的連線含 `srv: true`、`host: cluster0.example.mongodb.net`、`database: app`、`user: u`、
   `options` 為 `{ retryWrites: 'true', w: 'majority', appName: 'Cluster0' }`，不含 `uri`、`port`、`authSource`；
   寫入的 `config.json` 內容不含 `s3cr3tPw`，該值改寫進 `.env.local`。
2. 同一條字串以 `--uri` 非互動傳入，寫出的連線與 AC-1 相同。
3. 字串含 `authSource=appdb&replicaSet=rs0&ssl=true` 時，三者分別寫入 `authSource`、`replicaSet`、`tls: true`，不出現在 `options`。
4. 貼上後終端印出拆解結果，密碼以遮蔽形式出現，且其後不再有確認提問。
5. 字串路徑帶資料庫名稱時不問 Database name；沒帶時會問且無預設值，非互動又未給 `--name` 時報錯。
6. 多 host 字串寫出只含 `system`、`uri`、`database` 的連線，並印出帳密將明文存放的警告。
7. 含 `authMechanismProperties`、`tlsCertificateKeyFilePassword` 或 `proxyPassword` 任一的字串，行為同 AC-6。
8. 設定的 `options` 與正式欄位同名（如兩邊都有 `replicaSet`）時，驗證失敗並指出該鍵。
9. `--replica-set rs0 --srv --tls` 非互動寫出 `replicaSet: 'rs0'`、`srv: true`、`tls: true`；`--no-tls` 寫出 `tls: false`；兩者皆無時不寫 `tls`。
10. `--uri` 與 `--host`、`--port`、`--user`、`--password`、`--auth-source`、`--replica-set`、`--srv`、`--tls` 任一並用時報錯；與 `--name` 並用時以 `--name` 為資料庫名稱。
11. `--uri` 與 `--use-env-refs` 並用時報錯，訊息提到拿掉 `--use-env-refs` 與改用 `--env-*` 兩條路徑。
12. 互動選單第一項仍為逐欄填寫，第二項標籤為「貼上連線字串（Atlas / Compass 複製的）」。
13. adapter 以帶 `options` 的欄位設定連線時，URI 參數包含每一個 `options` 鍵值。
14. `srv: true`、有 user、無 `authSource` 的欄位設定，在 TXT record 給 `authSource=other` 時以 `other` 連線；無 TXT 時以 `admin`。
15. 等價性：AC-1、AC-3 的字串原樣作為 `uri` 與拆解後的欄位設定，adapter 解析出的主機、路徑與參數集合相同。
16. 只含 `uri` 的既有設定檔照常通過驗證並以原字串連線（既有測試不變）。
17. `mongodb-connection-string-url` 出現在 `package.json` 的 `dependencies`。
18. `docs/user/en/` 與 `docs/user/zh-TW/` 的 `index.md`、`index.html` 皆描述連線字串拆解、退回 `uri` 的條件與三個新 flag。
19. `CHANGELOG.md` 標註 `--uri` 寫出的設定形狀改變為破壞性變更。
20. `make verify` 通過。

## Further Notes

- ADR-0002 的 falsification 條件（`uri` 優先於欄位、互動流程第一項不是貼字串）在本 Story 後仍須成立。
- ADR-0043 的 falsification 條件即本 Story 的回歸邊界。
