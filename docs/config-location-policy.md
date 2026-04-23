# dbcli 設定位置與敏感資料分離規劃

> 目標：讓專案初始化後，`./.dbcli` 能**準確對應**到使用者家目錄下的 `~/.config/dbcli/`，同時避免 AI agent 在專案目錄中直接取得敏感設定。

## 1. 背景

目前 `dbcli init` 預設會在專案目錄建立 `.dbcli/`，而 `config.json`、`.env.local`、schema cache、blacklist 等內容可能共存於同一個位置。

這個設計的問題是：

- 專案工作區一旦被 AI agent 掃描，敏感資訊暴露面太大
- 連線設定、憑證、schema cache、blacklist 的責任邊界不清楚
- `.dbcli/` 既像專案資料夾，又像使用者密鑰容器，容易混淆

因此需要先確立一個穩定的原則，再進入實作。

## 2. 核心原則

**專案內的 `./.dbcli` 不是敏感資料的最終儲存地，而是專案綁定入口與非敏感快取區。**

**使用者家目錄下的 `~/.config/dbcli/` 才是敏感設定與全域連線定義的 canonical source of truth。**

補充原則：

- 不以 symlink 作為主要設計
- 專案目錄只保留必要的綁定資訊、快取與黑名單
- 明文密碼、token、可還原的憑證不得放在專案工作區內

## 3. 建議目錄角色

### 3.1 專案目錄 `./.dbcli/`

保留：

- 專案綁定資訊
- schema cache
- blacklist
- 其他不含敏感憑證的快取資料

不保留：

- 明文密碼
- token
- 任何可直接還原的認證資料

### 3.2 使用者目錄 `~/.config/dbcli/`

保留：

- 全域設定入口
- 連線定義
- 敏感憑證或其安全引用
- 可跨專案重用的使用者層級設定

## 4. 目標行為

### 4.1 init 的語意

`dbcli init` 在專案中執行時，應建立一個**專案綁定**，而不是把秘密複製進工作區。

建議語意：

1. 在 `./.dbcli/` 建立專案識別與綁定資訊
2. 解析到 `~/.config/dbcli/` 中對應的全域設定
3. 後續所有命令都先解讀這個綁定，再讀取真正的連線資訊

### 4.2 read 的語意

`configModule.read()` 應維持向後相容，但優先遵循以下邏輯：

1. 讀取專案綁定
2. 解析全域設定位置
3. 只把非敏感內容回傳給命令層

### 4.3 write 的語意

寫入行為應分流：

- 專案資料：寫回 `./.dbcli/`
- 敏感資料：寫回 `~/.config/dbcli/`

避免把兩類資料混在同一個 JSON 或同一個 `.env.local`。

## 5. 建議資料結構

以下是建議的概念模型，實際檔名可在實作時再微調。

### 5.1 專案綁定檔

`./.dbcli/config.json` 在新模式下會變成**綁定 stub**，只保留對 home storage 的指向，不再存真正的連線內容：

```json
{
  "version": 3,
  "binding": {
    "type": "home-storage",
    "storagePath": "~/.config/dbcli/projects/<project-id>",
    "projectPath": "/absolute/path/to/project/.dbcli",
    "createdAt": "2026-04-23T00:00:00.000Z"
  },
}
```

### 5.2 全域設定

`~/.config/dbcli/projects/<project-id>/config.json` 保留真正的使用者層級設定，例如：

```json
{
  "version": 2,
  "default": "default",
  "connections": {
    "default": {
      "system": "postgresql",
      "host": { "$env": "DB_HOST" },
      "port": { "$env": "DB_PORT" },
      "user": { "$env": "DB_USER" },
      "password": { "$env": "DB_PASSWORD" },
      "database": { "$env": "DB_NAME" },
      "permission": "query-only"
    }
  }
}
```

## 6. 路徑解析規則

建議建立明確的優先序：

1. 明確指定的 `--config`
2. 專案綁定檔所指向的 home storage
3. 使用者家目錄下的 legacy / 相容路徑
4. 舊版 `.dbcli` 相容路徑

這樣可確保：

- 舊專案仍可讀
- 新專案可以無痛切到全域設定
- 路徑責任清楚且可預測

## 7. 既有命令的影響

### 7.1 init

- 建立專案綁定
- 產生或更新全域設定
- 不在專案目錄留下明文秘密

### 7.2 use

- 變更的是全域層級的 default connection 或 profile
- 不應把敏感值複製回專案目錄

### 7.3 status

- 只顯示安全摘要
- 不輸出憑證、不輸出可重建秘密的內容

### 7.4 schema / blacklist / doctor

- schema cache 與 blacklist 可留在專案 `.dbcli/`
- 讀取敏感設定時必須透過全域解析

## 8. 遷移策略

### Phase 1：引入雙路徑解析

- 支援專案綁定與全域設定並存
- 舊 `.dbcli` 可繼續運作
- 新 init 開始寫入綁定資訊

### Phase 2：搬移敏感資料

- 將明文憑證從專案目錄遷出
- 將 `.env.local` 類型資料改為全域或系統環境變數

### Phase 3：收斂專案資料

- 專案 `.dbcli` 只保留非敏感資料與 cache
- 文件與診斷資訊更新為全域優先

## 9. 安全考量

- **不要假設提示詞能阻止存取**：真正的保護是檔案位置與權限邊界
- **不要以 symlink 當安全機制**：跨平台與工具行為不一致
- **不要在專案目錄保留可還原秘密**：即使 blacklist 做得再好，也不能代替 secrets 分離
- **建議檔案權限最小化**：`~/.config/dbcli/` 應以使用者私有權限保存

## 10. 未決問題

1. 全域設定的最終根目錄要用 `~/.config/dbcli/` 還是 `~/.dbcli/`
2. 專案綁定檔是否沿用 `config.json`，或改成更明確的 `binding.json`
3. schema cache 是否完全留在專案內，或部分遷移到全域
4. 舊版 `.dbcli/.env.local` 的遷移與相容時間表

## 11. 建議下一步

1. 先把這份原則定案
2. 再定義實際檔案格式與路徑解析優先序
3. 最後才修改 `init`、`read`、`write`、`use` 的實作
