# dbcli 設定位置與敏感資料分離規劃

> 目標：讓專案初始化後，`./.dbcli` 只保留專案綁定與非敏感快取，敏感設定與連線定義落在使用者家目錄下的 `~/.config/dbcli/`。

> 現況：這份文件已對齊目前實作。`init`、`read`、`write` 都已使用 project binding + home storage 模式。

## 1. 背景

目前 `dbcli init` 會在專案目錄建立 `.dbcli/config.json` 綁定檔，並將真正的設定與敏感資料寫入 `~/.config/dbcli/projects/<project-name>-<hash>/`。

這個設計解決了原本幾個問題：

- 專案工作區被掃描時，不會直接暴露可還原的敏感資訊
- 連線設定、憑證、schema cache、blacklist 的責任邊界清楚
- `.dbcli/` 現在只扮演專案入口與非敏感快取容器

以下內容記錄的是已採用的規則，而不是待討論的方向。

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

實作上，專案綁定會導向 `~/.config/dbcli/projects/<project-name>-<sha1-12>/`，其中 hash 是專案絕對路徑的穩定摘要，用來避免不同路徑同名專案互相覆蓋。

## 4. 目標行為

### 4.1 init 的語意

`dbcli init` 在專案中執行時，會建立一個**專案綁定**，而不是把秘密複製進工作區。

目前語意：

1. 在 `./.dbcli/config.json` 寫入 `version: 3` 的 binding stub
2. 建立對應的 home storage 目錄
3. 解析並寫入 `~/.config/dbcli/projects/<project-name>-<sha1-12>/config.json`
4. 後續所有命令先解讀 binding，再讀取真正的連線資訊

### 4.2 read 的語意

`configModule.read()` 應維持向後相容，但優先遵循以下邏輯：

1. 讀取專案綁定
2. 解析全域設定位置
3. 只把非敏感內容回傳給命令層
4. 若 binding 缺失，回退到 legacy `.dbcli` 路徑

### 4.3 write 的語意

寫入行為應分流：

- 專案資料：寫回 `./.dbcli/`
- 敏感資料：寫回 `~/.config/dbcli/`

避免把兩類資料混在同一個 JSON 或同一個 `.env.local`。

`migrateLegacyProjectEnvLocal()` 會在初始化或遷移時，將專案目錄內的 `.env.local` 搬移到 home storage；若目標檔已存在，會保留既有版本。

## 5. 建議資料結構

以下是建議的概念模型，實際檔名可在實作時再微調。

### 5.1 專案綁定檔

`./.dbcli/config.json` 在新模式下就是**綁定 stub**，只保留對 home storage 的指向，不再存真正的連線內容：

```json
{
  "version": 3,
  "binding": {
    "type": "home-storage",
    "storagePath": "~/.config/dbcli/projects/<project-name>-<sha1-12>",
    "projectPath": "/absolute/path/to/project/.dbcli",
    "createdAt": "2026-04-23T00:00:00.000Z"
  }
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

目前的優先序如下：

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

## 10. 已落地的決策

1. 全域設定根目錄採用 `~/.config/dbcli/`
2. 專案綁定檔沿用 `config.json`
3. schema cache 與 blacklist 保留在專案層，敏感連線資料保留在 home storage
4. 舊版 `.dbcli/.env.local` 會在可行時遷移到 home storage

## 11. 後續維護原則

1. 任何變更都要同時確認 project binding 與 home storage 的讀寫路徑
2. 若未來要調整目錄結構，先改 `src/core/config-binding.ts`，再同步文件
3. 若新增敏感設定欄位，預設應跟隨 home storage，不要回寫到專案目錄
