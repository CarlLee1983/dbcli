---
phase: 11-schema-optimization
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [
  src/core/schema-cache.ts,
  src/core/schema-index.ts,
  src/core/schema-loader.ts,
  src/types/schema-cache.ts
]
autonomous: true
requirements: []
must_haves:
  truths:
    - "启动时只加载索引和热点 schema，< 100ms"
    - "冷表按需加载时使用 LRU 缓存，10-50ms"
    - "字段查询通过索引 O(1) 完成，< 1ms"
    - "100+ 张表场景下整体响应时间优先"
  artifacts:
    - path: "src/core/schema-cache.ts"
      provides: "SchemaCacheManager 类，两层缓存策略"
      min_lines: 150
    - path: "src/core/schema-index.ts"
      provides: "SchemaIndexBuilder 和索引加载逻辑"
      min_lines: 100
    - path: "src/core/schema-loader.ts"
      provides: "分层加载器，支持热点预加载和冷点按需"
      min_lines: 120
    - path: "src/types/schema-cache.ts"
      provides: "SchemaIndex、CacheStats、LoaderOptions 类型定义"
      min_lines: 50
  key_links:
    - from: "src/core/schema-cache.ts"
      to: "lru-cache npm 包"
      via: "LRUCache 构造和 sizeCalculation"
      pattern: "new LRUCache.*maxSize.*sizeCalculation"
    - from: "src/core/schema-loader.ts"
      to: "src/core/schema-cache.ts"
      via: "初始化缓存管理器"
      pattern: "new SchemaCacheManager"
    - from: "src/core/schema-index.ts"
      to: ".dbcli/schemas/index.json"
      via: "读取索引文件"
      pattern: "schemas/index.json"
---

# Phase 11.1: Schema 缓存基础设施与文件结构改造

## 目标
建立四层架构的第一层：**存储层 + 缓存层**。通过文件分层、LRU 缓存、索引加速，实现整体响应时间优先的 schema 管理，支持中等规模（100-500 张表）的性能要求。

**输出:** 三个核心模块 + 一个类型定义文件，为后续增量更新、并发控制、性能优化奠定基础。

---

## 执行上下文

@.planning/11-schema-optimization/11-RESEARCH.md
@.planning/11-schema-optimization/11-CONTEXT.md
@src/types/index.ts
@src/core/config.ts

---

## 架构设计说明

### 文件结构改造（目标状态）

```
.dbcli/
  ├── config.json                    # 连接配置 + 表索引清单（精简）
  ├── schemas/
  │   ├── index.json                 # 全局索引：表名 → 存储位置映射
  │   ├── hot-schemas.json           # 热点表 schema（启动预加载）
  │   ├── cold/
  │   │   ├── infrequent.json        # 不常用表
  │   │   └── legacy.json            # 历史表
  │   └── .schema-cache.json         # 缓存元数据（内部用）
  └── .env.local                     # 敏感信息
```

### 四层架构概览

| 层级 | 模块 | 职责 | 性能目标 |
|------|------|------|---------|
| 1. 存储层 | schema-loader | 分层文件加载（热/冷分离） | init < 100ms |
| 2. 缓存层 | schema-cache | LRU 内存缓存管理 | 缓存命中 < 1ms |
| 3. 更新层 | schema-updater (下一 plan) | 原子文件写入 + DIFF | write < 50ms |
| 4. 查询层 | schema-index | 字段索引加速 | lookup O(1) |

---

## 任务分解

<tasks>

<task type="auto">
  <name>Task 11.1.1: 创建类型定义 - SchemaIndex 和 CacheStats</name>
  <files>src/types/schema-cache.ts</files>
  <action>
创建新文件 src/types/schema-cache.ts，定义 schema 缓存系统的所有类型。包括：

1. **SchemaIndex** 接口
   - tables: Record<tableName, { location: 'hot' | 'cold'; file: string; estimatedSize: number; lastModified: string }>
   - hotTables: string[] (Top 20% 常用表列表)
   - metadata: { version: string; lastRefreshed: string; totalTables: number }

2. **CacheStats** 接口（用于监控）
   - hotTables: number
   - cachedTables: number
   - cacheSize: number (字节)
   - cacheHitRate: string (百分比)
   - maxItems: number
   - maxSize: number

3. **LoaderOptions** 接口
   - maxCacheItems?: number (默认 100)
   - maxCacheSize?: number (默认 50MB = 52428800)
   - hotTableThreshold?: number (默认 20，前 N% 作为热点)
   - enableStreaming?: boolean (默认 false，超过 1MB 启用)
   - streamingTimeout?: number (默认 30000ms)

4. **TableSchemaRef** 接口（用于索引）
   - tableName: string
   - location: 'hot' | 'cold'
   - file: string
   - estimatedSize: number

从 RESEARCH.md 架构模式章节（第 85-135 行）提取设计，确保与 lru-cache@10.4.3 API 对齐。
  </action>
  <verify>
    <automated>
bun test --run 'src/types/schema-cache.ts' 2>&1 | grep -q "TypeScript compilation" || tsc --noEmit src/types/schema-cache.ts
    </automated>
  </verify>
  <done>
- src/types/schema-cache.ts 存在，导出 SchemaIndex、CacheStats、LoaderOptions、TableSchemaRef
- 所有类型通过 TypeScript 编译（tsc --noEmit）
- 类型与 lru-cache 和 Bun.file API 兼容
  </done>
</task>

<task type="auto">
  <name>Task 11.1.2: 实现 SchemaCacheManager - LRU 内存缓存管理</name>
  <files>src/core/schema-cache.ts</files>
  <action>
创建新文件 src/core/schema-cache.ts，实现核心的 LRU 缓存管理器。从 RESEARCH.md（第 149-266 行）的代码示例为参考。

**类: SchemaCacheManager**

构造函数参数：
- dbcliPath: string
- options?: { maxCacheItems?: number; maxCacheSize?: number }

**关键方法：**

1. **constructor**
   - 初始化 LRUCache<string, TableSchema>，配置 maxItems 和 maxSize
   - sizeCalculation: (schema) => JSON.stringify(schema).length
   - 初始化 hotSchemas: Map<string, TableSchema> = new Map()
   - 初始化 index: SchemaIndex | null = null

2. **async initialize(): Promise<void>**
   - 读取 .dbcli/schemas/index.json，解析为 SchemaIndex
   - 读取 .dbcli/schemas/hot-schemas.json
   - 遍历热点表清单，将每个表加入 hotSchemas Map 和 cache
   - 若文件不存在，打印 warn 日志但不抛异常（graceful degradation）

3. **async getTableSchema(tableName: string): Promise<TableSchema | null>**
   - 三层查询（优先级）：
     a. 检查 hotSchemas Map（最快，< 1ms）
     b. 检查 LRU cache（中速，< 5ms）
     c. 从 index 定位冷文件，读取并缓存（慢，10-50ms）
   - 返回 null 如果表不存在或加载失败

4. **async findFieldsByName(fieldName: string): Promise<Array<{ table: string; column: ColumnSchema }>>**
   - 仅搜索 hotSchemas 中的表（冷表太多，不效率）
   - 返回匹配字段的 [{ table, column }, ...] 数组
   - 用于 --where 字段快速检查

5. **getStats(): CacheStats**
   - 返回缓存统计：hotTables 数量、cachedTables 数量、cacheSize、hitRate
   - hitRate = (cache.size / cache.max) * 100%

**导入：**
- import { LRUCache } from 'lru-cache'
- import type { SchemaIndex, CacheStats } from '@/types/schema-cache'
- import type { TableSchema, ColumnSchema } from '@/types'
- import { join } from 'path'
- import { Bun } from 'bun' (Bun.file)

**注意：**
- 使用 Bun.file 而非 fs.readFileSync（per CLAUDE.md）
- 所有文件操作都包装 try-catch，失败时记录 console.error 但不抛异常
- 热点预加载失败时输出 warn，系统继续运行
- 每个方法添加注释说明性能特征和使用场景
  </action>
  <verify>
    <automated>
bun test --run 2>&1 | grep -E "src/core/schema-cache.*test|schema-cache.*passed"
    </automated>
  </verify>
  <done>
- src/core/schema-cache.ts 实现完整，> 150 行
- SchemaCacheManager 导出
- 五个核心方法实现（constructor, initialize, getTableSchema, findFieldsByName, getStats）
- 所有文件操作使用 Bun.file API
- 注释清晰说明三层查询策略和性能指标
  </done>
</task>

<task type="auto">
  <name>Task 11.1.3: 实现 SchemaIndexBuilder - 索引生成和管理</name>
  <files>src/core/schema-index.ts</files>
  <action>
创建新文件 src/core/schema-index.ts，实现索引构建和加载逻辑。索引用于：
1. 快速定位表的存储位置（热/冷文件）
2. 计算热点表（频率排序）
3. 重建索引时的幂等性

**类: SchemaIndexBuilder**

**静态方法：**

1. **static async loadIndex(dbcliPath: string): Promise<SchemaIndex | null>**
   - 读取 .dbcli/schemas/index.json
   - 解析并返回 SchemaIndex 对象
   - 若文件不存在或 JSON 解析失败，返回 null

2. **static async buildIndex(config: DbcliConfig, options?: { hotTableThreshold?: number }): Promise<SchemaIndex>**
   - 参数 config 来自 config.json（包含 schema 字段，若无则返回空索引）
   - 统计各表的 schema 大小：estimatedSize = JSON.stringify(tableSchema).length
   - 对所有表按大小降序排序
   - 前 hotTableThreshold% 的表标记为 'hot'，其余为 'cold'
   - 返回 SchemaIndex 对象：
     ```typescript
     {
       tables: {
         'users': { location: 'hot', file: 'hot-schemas.json', estimatedSize: 5000, lastModified: '2026-03-26...' },
         'orders': { location: 'cold', file: 'cold/infrequent.json', estimatedSize: 2000, ... },
         ...
       },
       hotTables: ['users', 'products', ...],
       metadata: {
         version: '1.0',
         lastRefreshed: Date.now().toISOString(),
         totalTables: N
       }
     }
     ```

3. **static async saveIndex(dbcliPath: string, index: SchemaIndex): Promise<void>**
   - 写入 .dbcli/schemas/index.json（使用 Bun.file().write()）
   - 格式化为可读的 JSON (indent: 2)
   - 若目录不存在，先创建（使用 mkdir -p 或 Bun.spawn）

4. **static calculateFileMapping(index: SchemaIndex): Record<'hot' | 'cold', Array<{ table: string; file: string }>>**
   - 反向查询：从 index 生成文件 → 表的映射
   - 用于写入热/冷文件时知道哪些表应在同一文件中
   - 返回：{ hot: [{table, file}, ...], cold: [{table, file}, ...] }

**导入：**
- import type { SchemaIndex } from '@/types/schema-cache'
- import type { DbcliConfig, TableSchema } from '@/types'
- import { join } from 'path'
- import { Bun } from 'bun'

**注意：**
- 所有文件操作包装 try-catch，失败时抛 Error（区别于 SchemaCacheManager 的宽松策略）
- 索引版本号硬编码为 '1.0'（未来扩展时更新）
- lastModified 统一使用 toISOString()，便于 schema-updater 比对
- buildIndex 的热点计算使用**文件大小作为权重**（假设常用表通常包含更多字段）
  </action>
  <verify>
    <automated>
bun test --run 2>&1 | grep -E "SchemaIndexBuilder|buildIndex|saveIndex"
    </automated>
  </verify>
  <done>
- src/core/schema-index.ts 实现完整，> 100 行
- SchemaIndexBuilder 导出，四个静态方法实现
- loadIndex 返回 null 时不抛异常
- buildIndex 正确标记热/冷表
- saveIndex 使用 Bun.file().write()
- calculateFileMapping 返回正确的结构
  </done>
</task>

<task type="auto">
  <name>Task 11.1.4: 实现 SchemaLayeredLoader - 分层加载与初始化</name>
  <files>src/core/schema-loader.ts</files>
  <action>
创建新文件 src/core/schema-loader.ts，实现启动时的分层加载逻辑。这是最关键的模块，直接影响启动性能和整体响应时间。

**类: SchemaLayeredLoader**

构造函数参数：
- dbcliPath: string
- options?: LoaderOptions

**关键方法：**

1. **async initialize(): Promise<{ cache: SchemaCacheManager; index: SchemaIndex | null; loadTime: number }>**
   - 这是启动时调用的主要入口
   - 测量总耗时（使用 performance.now()）
   - 执行流程：
     a. 加载索引（SchemaIndexBuilder.loadIndex）
     b. 初始化缓存管理器（new SchemaCacheManager）
     c. 调用 cache.initialize()（预加载热点）
     d. 返回 { cache, index, loadTime }
   - **性能目标**：< 100ms（包括读文件、JSON 解析、热点加载）
   - 若索引不存在，记录 warn 但继续运行（graceful degradation）

2. **async loadColdTable(tableName: string, cache: SchemaCacheManager): Promise<TableSchema | null>**
   - 用于首次查询某个冷表时的加载
   - 调用 cache.getTableSchema(tableName)
   - 若表不存在，返回 null
   - 若加载失败，记录错误但不抛异常

3. **private async ensureDirectories(): Promise<void>**
   - 创建必要的目录结构：
     - .dbcli/schemas/
     - .dbcli/schemas/cold/
   - 使用 Bun.spawn(['mkdir', '-p', ...]) 或 fs.mkdir
   - 若已存在则忽略

4. **getBenchmark(): { initTime: number; hotTables: number; totalTables: number; estimatedSize: number }**
   - 返回性能基准数据（用于后续性能监控）
   - initTime: 初始化耗时（ms）
   - hotTables: 热点表数量
   - totalTables: 总表数
   - estimatedSize: 所有 schema 总大小（字节）

**导入：**
- import { SchemaCacheManager } from './schema-cache'
- import { SchemaIndexBuilder } from './schema-index'
- import type { SchemaIndex, LoaderOptions, CacheStats } from '@/types/schema-cache'
- import type { TableSchema } from '@/types'
- import { join } from 'path'

**核心设计：**
- 两层策略：initialize() 处理热点，loadColdTable() 处理冷点按需加载
- 所有文件操作非阻塞（使用 Bun.file）
- 超时控制：流式加载时 > streamingTimeout 则中止（可选特性，先不实现）
- 失败不中断：任何单个文件加载失败不影响整体初始化

**注意：**
- 不导出 SchemaCacheManager，只导出 SchemaLayeredLoader
- 调用者通过 loader.initialize() 得到 cache 对象
- 这个设计避免了外部直接操作缓存，统一由 loader 管理
  </action>
  <verify>
    <automated>
bun test --run 2>&1 | grep -E "SchemaLayeredLoader|initialize|loadColdTable"
    </automated>
  </verify>
  <done>
- src/core/schema-loader.ts 实现完整，> 120 行
- SchemaLayeredLoader 类导出
- initialize() 方法完整，包括性能测量
- loadColdTable() 方法可用
- ensureDirectories() 创建必要目录
- getBenchmark() 返回性能数据
- 所有文件操作使用 Bun.file API
  </done>
</task>

<task type="auto">
  <name>Task 11.1.5: 集成与单元测试 - schema 缓存系统</name>
  <files>
    src/core/schema-cache.test.ts,
    src/core/schema-index.test.ts,
    src/core/schema-loader.test.ts
  </files>
  <action>
为三个核心模块编写单元测试，确保缓存、索引、加载逻辑正确。

**文件 1: src/core/schema-cache.test.ts** (40+ 测试用例)

测试覆盖：
- SchemaCacheManager 初始化：index 和 hot-schemas 存在 vs 不存在
- getTableSchema() 三层查询：
  - Hot table 查询 < 1ms（无网络 I/O）
  - Cache hit < 5ms
  - Cold table load 10-50ms
- findFieldsByName() 仅返回热表中的字段
- getStats() 返回正确的统计数据
- 并发访问同一个表时的缓存一致性

**文件 2: src/core/schema-index.test.ts** (30+ 测试用例)

测试覆盖：
- loadIndex() 成功读取 index.json
- loadIndex() 不存在时返回 null（不抛异常）
- buildIndex() 正确分类热/冷表（按大小排序）
- buildIndex() 热点数量 = totalTables * hotTableThreshold%
- saveIndex() 写入文件，re-load 后数据一致
- calculateFileMapping() 返回正确的表→文件映射

**文件 3: src/core/schema-loader.test.ts** (20+ 测试用例)

测试覆盖：
- initialize() 耗时 < 100ms（模拟 100+ 表）
- loadColdTable() 加载之前缓存 miss，加载后 hit
- 目录不存在时 ensureDirectories() 创建成功
- getBenchmark() 返回有效数据

**测试工具与模式：**
- 使用 bun:test 和 expect() 断言
- Mock 文件系统：创建临时 .dbcli 目录用于测试，测试后清理
- 示例 Mock 热点表：
  ```typescript
  const mockHotSchemas = {
    users: { name: 'users', columns: [...] },
    products: { name: 'products', columns: [...] }
  }
  ```
- 性能测试：用 performance.now() 测量初始化耗时，断言 < 100ms

**导入：**
- import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
- import { SchemaCacheManager } from './schema-cache'
- import { SchemaIndexBuilder } from './schema-index'
- import { SchemaLayeredLoader } from './schema-loader'
- import type { SchemaIndex, LoaderOptions } from '@/types/schema-cache'

**注意：**
- 所有测试独立，不依赖真实数据库或 .dbcli 配置
- 清理：每个测试后移除临时目录
- 性能断言：不硬卡 < 100ms，而是记录实际耗时并允许 80-120ms 范围（防止 CI 随机波动）
  </action>
  <verify>
    <automated>
bun test --run src/core/schema-*.test.ts 2>&1 | grep -E "pass|fail" | head -5
    </automated>
  </verify>
  <done>
- 三个 test 文件存在（schema-cache.test.ts, schema-index.test.ts, schema-loader.test.ts）
- 总 test 用例 > 90
- 所有 test 通过（0 failures）
- 覆盖主要路径和边界情况
- 性能断言记录真实耗时
  </done>
</task>

<task type="auto">
  <name>Task 11.1.6: 更新核心 index 导出与集成验证</name>
  <files>src/core/index.ts</files>
  <action>
更新 src/core/index.ts，导出新增的三个模块，并验证整体集成。

**修改内容：**

1. 添加导出：
   ```typescript
   export { SchemaLayeredLoader } from './schema-loader'
   export { SchemaIndexBuilder } from './schema-index'
   export { SchemaCacheManager } from './schema-cache'
   ```

2. 导出类型：
   ```typescript
   export type { SchemaIndex, CacheStats, LoaderOptions, TableSchemaRef } from '@/types/schema-cache'
   ```

3. 添加方便的初始化函数（可选）：
   ```typescript
   export async function initializeSchemaSystem(dbcliPath: string, options?: LoaderOptions) {
     const loader = new SchemaLayeredLoader(dbcliPath, options)
     const { cache, index, loadTime } = await loader.initialize()
     console.log(`Schema system initialized in ${loadTime}ms`)
     return { loader, cache, index }
   }
   ```

**验证步骤：**

1. 类型检查：`tsc --noEmit` 通过
2. 导入验证：
   ```typescript
   import { SchemaLayeredLoader, SchemaIndexBuilder, SchemaCacheManager } from '@/core'
   ```
3. 构建验证：`bun run build` 成功

**导入：**
- 无新增导入，更新现有 index.ts
  </action>
  <verify>
    <automated>
tsc --noEmit && echo "TypeScript: OK" && grep -q "SchemaLayeredLoader\|SchemaIndexBuilder\|SchemaCacheManager" src/core/index.ts && echo "Exports: OK"
    </automated>
  </verify>
  <done>
- src/core/index.ts 更新，导出三个新类和相关类型
- tsc --noEmit 通过，无类型错误
- 初始化函数添加（可选）
  </done>
</task>

</tasks>

---

## 性能目标与验收标准

### 关键指标

| 指标 | 目标 | 验收标准 |
|------|------|---------|
| 启动初始化时间 | < 100ms | 100+ 张表，index + hot-schemas 加载 |
| 热点表查询 | < 1ms | 缓存命中，无文件 I/O |
| 冷点表首次加载 | 10-50ms | 单个表 schema JSON 解析 |
| 冷点表再次查询 | < 5ms | LRU 缓存命中 |
| 字段快速查询 | < 1ms | 热点表中查找字段名（哈希查询） |
| 缓存容量 | 50MB max | LRU 自动淘汰超出大小的旧表 |
| 缓存命中率 | > 80% | 热点 + 最近查询的表保留在缓存 |

### 功能验收

- [ ] 启动时只读取 index.json 和 hot-schemas.json，冷表按需加载
- [ ] 100+ 张表场景下，初始化 < 100ms
- [ ] 查询冷表时，LRU 缓存自动管理，无内存泄漏
- [ ] 热点表遍历字段 < 1ms
- [ ] 并发访问同一表时，缓存一致性正确
- [ ] 所有 test 用例通过（> 90 cases）
- [ ] TypeScript 编译无错误
- [ ] 代码注释清晰，性能特征文档齐全

---

## 架构集成图

```
┌─────────────────────────────────────────────────────┐
│ Phase 11.1: Schema 缓存基础设施 (本 plan)            │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────────────────────────────────┐   │
│  │ SchemaLayeredLoader (schema-loader.ts)       │   │
│  │ - initialize(): 启动时加载索引 + 热点        │   │
│  │ - loadColdTable(): 按需加载冷点              │   │
│  └──────────────────────────────────────────────┘   │
│           ↓ 依赖                   ↓ 使用           │
│  ┌──────────────────────┐  ┌─────────────────────┐ │
│  │ SchemaIndexBuilder   │  │ SchemaCacheManager  │ │
│  │ (schema-index.ts)    │  │ (schema-cache.ts)   │ │
│  ├──────────────────────┤  ├─────────────────────┤ │
│  │ - loadIndex()        │  │ - initialize()      │ │
│  │ - buildIndex()       │  │ - getTableSchema()  │ │
│  │ - saveIndex()        │  │ - findFieldsByName()│ │
│  │ - calcFileMapping()  │  │ - getStats()        │ │
│  └──────────────────────┘  └─────────────────────┘ │
│           ↓ 读写                     ↓ 使用        │
│  ┌────────────────────────────────────────────────┐ │
│  │ 文件系统 (.dbcli/schemas/)                      │ │
│  │ - index.json (索引)                             │ │
│  │ - hot-schemas.json (热点)                       │ │
│  │ - cold/*.json (冷点)                            │ │
│  └────────────────────────────────────────────────┘ │
│                                                       │
│  依赖库：lru-cache@10.4.3, zod@3.22+                │
└─────────────────────────────────────────────────────┘

后续 plan 依赖关系：

Phase 11.2 (Wave 2):
  ├─ SchemaUpdater (增量更新 + 原子写入)
  │   ↓ 使用 SchemaIndexBuilder.buildIndex() 重建索引
  │   ↓ 使用 SchemaCacheManager.getTableSchema() 验证缓存
  │
  └─ ColumnIndexBuilder (字段索引)
      ↓ 读取 SchemaCacheManager.hotSchemas 构建字段索引
```

---

## 关键设计决策

### D-11.1.1: 热点表识别策略
**决策**: 按 schema 文件大小排序，前 hotTableThreshold% (默认 20%) 标记为热点
**理由**:
- 文件大小 ∝ 字段数量 ∝ 查询复杂度 ∝ 实际使用频率
- 无需额外的访问日志统计，启动时一次性计算
- 可配置 threshold，不同项目可自定义

### D-11.1.2: 冷点按需加载策略
**决策**: 首次查询时从 cold/*.json 文件读取，结果加入 LRU 缓存
**理由**:
- 避免启动延迟（只加载热点）
- 避免内存浪费（冷表不常用，不预加载）
- LRU 自动淘汰很少查询的表

### D-11.1.3: 索引格式（.dbcli/schemas/index.json）
**决策**: 简单 JSON，包含表名 → {location, file, size} 映射
**理由**:
- 启动时快速解析（< 10ms）
- 人类可读，便于调试
- 足够信息用于定位和加载

### D-11.1.4: LRU 缓存配置
**决策**: maxItems: 100, maxSize: 50MB, sizeCalculation: JSON.stringify 长度
**理由**:
- 100 张表足以覆盖中等规模（100-500 表）的热点和 warm 表
- 50MB 内存预算合理（CLI 工具内存成本不关键）
- sizeCalculation 基于序列化长度，便于精确大小估算

---

## 风险与缓解

### 风险 1: 索引过期，指向不存在的文件
**症状**: 加载冷表时，index.json 指向的文件已删除，报 FileNotFound
**缓解**:
- 加载前验证文件存在（Bun.file(path).exists()）
- 若文件丢失，记录 error 但返回 null（graceful）
- 提示用户运行 `dbcli schema --refresh` 重建索引

### 风险 2: 热点表遍历性能退化
**症状**: hotSchemas Map 有 1000+ 个表（用户配置 threshold=90%），遍历耗时 > 10ms
**缓解**:
- findFieldsByName() 文档化仅适用于热点，不适合频繁的全库搜索
- 下一个 plan 实现 ColumnIndex，提供真正的 O(1) 字段查询

### 风险 3: 并发访问导致缓存不一致
**症状**: 两个 dbcli 实例同时查询不同表，LRU 计数不准确
**缓解**:
- 当前 plan 不处理（LRU 是进程内缓存）
- 下一个 plan 的原子更新会解决跨进程问题

### 风险 4: Bun.file() 异步操作导致超时
**症状**: 磁盘 I/O 缓慢时，schema 加载 > 1s，UI 卡顿
**缓解**:
- 所有文件操作使用 timeout 包装（可选特性）
- 文档化初始化耗时可能受磁盘性能影响
- 后续 plan 可添加流式加载（stream-json）支持

---

## 实现指导

### 关键集成点

1. **在 dbcli 初始化流程中调用**（待整合）
   ```typescript
   // 在 src/cli.ts 中
   const loader = new SchemaLayeredLoader(dbcliPath)
   const { cache, index } = await loader.initialize()
   ```

2. **在 query、list 等命令中使用缓存**（待整合）
   ```typescript
   // 在 src/commands/query.ts 中
   const schema = await cache.getTableSchema(tableName)
   ```

3. **schema --refresh 时重建索引**（下一 plan）
   ```typescript
   // 在 src/commands/schema.ts 中
   const newIndex = await SchemaIndexBuilder.buildIndex(config)
   ```

### 代码质量检查清单

- [ ] 所有导出类型都在 @/types/schema-cache.ts
- [ ] 所有文件操作使用 Bun.file，避免同步 fs
- [ ] 错误处理遵循 graceful degradation 原则（初始化不因单个文件失败而中止）
- [ ] 注释说明每个方法的时间复杂度和性能特征
- [ ] 性能目标在代码中可验证（performance.now() 测量）
- [ ] test 覆盖 > 80%，关键路径都有 test
- [ ] 无 console.log（用 logger 或有条件的 debug）

---

## Wave 1 小结

本 plan 完成四层架构的**存储层 + 缓存层**：
- ✓ 文件分层（hot-schemas.json + cold/*.json）
- ✓ 快速索引（schemas/index.json）
- ✓ LRU 缓存管理（sizeCalculation 基于序列化长度）
- ✓ 分层加载（启动热点，按需冷点）

**Wave 2** 将在此基础上构建：
- 原子化增量更新（Task 11.2.1-2）
- 并发安全写入（Task 11.2.3）
- 字段索引加速（Task 11.2.4）

---

## 输出位置

`.planning/phases/11-schema-optimization/11-PLAN.md` 已创建

**下一步**: 执行本 plan 后，运行 `/gsd:execute-phase 11-schema-optimization --wave 1` 进行 Wave 1 实现。

---

*Last updated: 2026-03-26 (Plan Phase)*
