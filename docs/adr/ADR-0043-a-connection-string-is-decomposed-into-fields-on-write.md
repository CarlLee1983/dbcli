# 連線字串在寫入時拆解成欄位設定

* Status: accepted
* Date: 2026-10-14
* Supersedes in part: ADR-0002

`dbcli init` 收到 MongoDB 連線字串時，不論是互動貼上還是 `--uri`，都先拆解成欄位設定再寫入；
只有欄位設定表達不了的連線字串，才原樣存進 `uri`。

## 背景

ADR-0002 讓欄位設定成為主要形式，但把連線字串定位成「原樣保存的逃生門」，並承諾
`--uri` 行為不變。實務上最常見的兩個情境——從 Atlas / Compass 複製連線字串、CI 以
`--uri` 非互動設定——都走這條逃生門，結果設定檔裡是一整條不透明的 `uri`：要改單一
參數就得重寫整條字串，`--use-env-refs` 也無從作用。密碼不論哪種形狀都以明文寫進儲存
目錄的 `config.json`（v2 init 沒有分離密碼的步驟），所以拆解本身不改變密碼的落點；
分離密碼是跨引擎的另一個議題。

欄位設定原本也表達不了 Atlas 字串裡的 `retryWrites`、`w`、`appName`，所以單純拆解
只會讓這些字串全數退回 `uri`。因此一併新增 `options` 欄位承接任意 driver 參數。

## Considered options

- 維持 ADR-0002：連線字串原樣保存，只補 flag。最常見的兩個情境仍得到不透明的 `uri`。
- 只拆解互動貼上的字串，`--uri` 維持原樣。兩條路產生不同形狀的設定，而 CI 正是
  `--uri` 用得最多的地方。
- 兩條路都拆解，表達不了的才退回 `uri`（本案）。

## Consequences

- `--uri` 寫出的設定檔形狀改變，屬行為破壞性變更，須於 CHANGELOG 標註。連線本身
  等價；既有含 `uri` 的設定檔不遷移、照常運作。
- 退回 `uri` 的條件：多組 host，或帶有機密的 option（`authMechanismProperties`、
  `tlsCertificateKeyFilePassword`、`proxyPassword`）。退回時警告帳密將明文存放，
  避免機密改從 `options` 明文落盤。
- `options` 與正式欄位重複（如兩邊都有 `replicaSet`）時拒絕，不默默挑一邊；option
  鍵不另設允許清單，交由連線測試讓 driver 報錯。
- 為使拆解前後語意一致，`srv: true` 的欄位設定不再強制 `authSource=admin`，改與連線
  字串相同：TXT record 優先，沒有才補 admin。非 SRV 的字串沒寫 authSource 而路徑帶資料庫時，
  driver 以路徑資料庫認證，拆解因此把它明寫成 `authSource`，避免欄位設定的 admin 預設改變認證對象。
- `--uri` 與 `--use-env-refs` 並用改為報錯：env-ref 存變數名稱，連線字串是值。
- 拆解使用 driver 自身的 `mongodb-connection-string-url`，列為直接依賴，確保拆解
  結果與 driver 的理解一致。
- ADR-0002 的「逐欄為主」「`uri` 優先於欄位」「互動流程第一個選項不是貼字串」仍然有效。

**Falsified if:** `handleMongoDBInit()` in `src/commands/init-mongodb.ts` 把一條單一
host、不含機密 option 的連線字串原樣寫進 `uri`，或 `MongoDBConnectionConfigSchema`
in `src/utils/validation.ts` 不再有 `options` 欄位，或 `buildUri()` in
`src/adapters/mongodb-adapter.ts` 在 `srv: true` 時讓欄位設定與等價連線字串得出
不同的 `authSource`，或拆解非 SRV、有帳號、路徑帶資料庫且無 authSource 的字串時
沒有寫入 `authSource`。
