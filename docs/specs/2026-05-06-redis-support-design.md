# dbcli Redis Support Design

**日期**: 2026-05-06
**目標版本**: v1.8.0
**狀態**: 草案 (Draft)

---

## 1. 概述 (Overview)

本設計旨在為 `dbcli` 增加 Redis 支援。Redis 作為廣泛使用的 Key-Value 存儲系統，其整合目標是提供與 SQL/MongoDB 一致的安全操作介面，同時保留 Redis 特有的靈活性。

### 核心價值
- **統一介面**：AI 代理只需使用 `query`, `list`, `schema` 即可操作 Redis。
- **安全防護**：實作與 SQL/MongoDB 同等級的權限控制、黑名單遮罩與查詢守衛。
- **高效探索**：支援掃描 Keys 空間並自動分析資料結構。

---

## 2. 架構設計 (Architecture)

### 2.1 RedisAdapter
新增 `RedisAdapter` 類別，實作 `QueryableAdapter` 介面（而非 `DatabaseAdapter`，因為 Redis 的非 SQL 特性與 MongoDB 更接近）。

```typescript
export class RedisAdapter implements QueryableAdapter {
  // 實作 connect, disconnect, execute, listCollections (即 listKeys), insert, update, delete 等
}
```

### 2.2 AdapterFactory 整合
更新 `AdapterFactory.createAdapter` 以支援 `system: 'redis'`。

```typescript
case 'redis':
  return new RedisAdapter(options) as unknown as DatabaseAdapter;
```

---

## 3. 指令映射 (Command Mapping)

### 3.1 `dbcli query`
將查詢語法映射至 Redis 指令：
- **原生指令**：`dbcli query "GET mykey"` 或 `dbcli query "HGETALL user:1"`。
- **結構化查詢**：支援 `JSON` 格式以便於參數化（選配）。
- **回傳格式**：將 Redis 的傳回值（String, Array, Object）包裝成 `ExecutionResult` 格式，確保表格化輸出。

### 3.2 `dbcli list`
- **行為**：內部呼叫 `SCAN` 指令。
- **分頁**：預設每次 `SCAN` 限制數量，避免阻塞生產環境。
- **輸出**：顯示 `Key | Type | TTL`。

### 3.3 `dbcli schema <key>`
- **行為**：
  1. `TYPE <key>` 獲取資料類型。
  2. 根據類型呼叫對應的長度/結構指令（如 `HLEN`, `LLEN`, `SCARD`, `ZCARD`）。
  3. 對於 Hash 類型，嘗試獲取 Field 名稱範例。

---

## 4. 安全性與守衛 (Security & Safeguards)

### 4.1 權限模型 (Permissions)
- **Query-only**：`GET`, `MGET`, `HGET`, `HGETALL`, `LRANGE`, `SMEMBERS`, `ZRANGE`, `SCAN`, `TTL`, `TYPE`, `EXISTS`。
- **Read-Write**：包含以上，加上 `SET`, `SETEX`, `HSET`, `LPUSH`, `RPUSH`, `SADD`, `ZADD`, `DEL`, `EXPIRE`。
- **Admin**：包含以上，加上 `FLUSHDB`, `CONFIG`, `INFO`, `CLIENT LIST`。

### 4.2 黑名單 (Blacklist)
- **Key Pattern**：在 `.dbcli` 設定中支援 `blacklist.tables`（映射為 Key patterns）。
  - 例如：`"tables": ["session:*", "auth:*"]` 將禁止任何對符合該前綴的 Key 操作。
- **指令過濾**：在 `PermissionGuard` 中新增 Redis 指令分類，嚴格限制非 Admin 權限執行危險指令。

### 4.3 查詢守衛 (Size Guard)
- **SCAN 強制化**：禁止在沒有 Pattern 的情況下直接執行 `KEYS *`（將被攔截並警告，或自動轉換為 `SCAN`）。
- **大型結構警告**：當操作的 Hash/List/Set 長度超過設定閾值且未帶分頁參數時，觸發 Size Guard 攔截。

---

## 5. 實作細節 (Implementation)

- **Driver**: 使用 `ioredis` (Bun 環境相容性極佳，支援 Cluster/Sentinel)。
- **連線參數**:
  ```json
  {
    "system": "redis",
    "host": "localhost",
    "port": 6379,
    "password": "...",
    "database": 0
  }
  ```
- **錯誤處理**: 擴展 `error-mapper.ts`，將 Redis 特有的連線失敗、認證錯誤轉化為 `ConnectionError`。

---

## 6. 測試策略

- **單元測試**: 模擬 `ioredis` 進行指令映射與權限檢查測試。
- **整合測試**: 使用 `docker-compose.test.yml` 啟動 Redis 容器，驗證真實連線、黑名單過濾與大資料量守衛。

---

## 7. 自我審查 (Spec Self-Review)

1. **佔位符檢查**：無 TBD。
2. **內部一致性**：權限模型與 SQL/MongoDB 邏輯保持一致。
3. **範疇檢查**：聚焦於基礎 Key-Value 與安全性，複雜的 Redis Module (如 RediSearch) 暫不納入首波。
4. **歧義檢查**：明確了 `list` 與 `schema` 在 Redis 語境下的定義。
