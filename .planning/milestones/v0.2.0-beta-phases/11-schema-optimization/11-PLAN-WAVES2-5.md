---
phase: 11-schema-optimization
plan: 02-05
type: execute
wave: 2-5
depends_on: [11-01]
files_modified: [
  src/core/schema-updater.ts,
  src/core/schema-diff-applier.ts,
  src/core/atomic-writer.ts,
  src/core/column-index.ts,
  src/core/schema-optimizer.ts,
  src/types/schema-updater.ts,
  src/core/schema-cache.ts
]
autonomous: true
requirements: []
must_haves:
  truths:
    - "增量更新仅写入修改部分，写入时间 < 50ms"
    - "并发更新通过原子重命名防止文件损坏"
    - "字段索引提供 O(1) 查询能力"
    - "DIFF 算法检测所有类型修改（新增、删除、类型改变）"
  artifacts:
    - path: "src/core/schema-updater.ts"
      provides: "SchemaUpdater 类，协调增量更新流程"
      min_lines: 150
    - path: "src/core/atomic-writer.ts"
      provides: "AtomicFileWriter 类，原子写入和备份"
      min_lines: 100
    - path: "src/core/column-index.ts"
      provides: "ColumnIndexBuilder 和索引查询"
      min_lines: 120
    - path: "src/core/schema-optimizer.ts"
      provides: "性能监控和优化建议"
      min_lines: 80
  key_links:
    - from: "src/core/schema-updater.ts"
      to: "src/core/schema-diff.ts"
      via: "调用 SchemaDiffEngine.compare()"
      pattern: "SchemaDiffEngine"
    - from: "src/core/atomic-writer.ts"
      to: "Bun.file and Bun.spawn"
      via: "临时文件写入和原子重命名"
      pattern: "mv.*tmp"
    - from: "src/core/column-index.ts"
      to: "src/core/schema-cache.ts"
      via: "读取缓存中的 schema 构建索引"
      pattern: "SchemaCacheManager"
---

# Phase 11: Schema 管理优化 - 完整架构（Wave 2-5）

## 概述

本文档规划 Wave 2-5 的任务分解。Wave 1（基础设施）已完成，现在构建：
- **Wave 2**: 原子化增量更新 + DIFF 应用
- **Wave 3**: 并发安全 + 备份恢复
- **Wave 4**: 字段索引 + 性能优化
- **Wave 5**: 集成验证 + 性能测试

---

# Wave 2: 增量更新与 DIFF 应用

## 任务列表

<task type="auto">
  <name>Task 11.2.1: 实现 SchemaUpdater - 增量更新协调</name>
  <files>src/core/schema-updater.ts</files>
  <action>
创建 src/core/schema-updater.ts，实现增量更新的主逻辑流程。

**类: SchemaUpdater**

构造函数参数：
- dbcliPath: string
- adapter: DatabaseAdapter
- cache: SchemaCacheManager

**关键方法：**

1. **async refreshSchema(options?: { tablesToRefresh?: string[] }): Promise<SchemaRefreshResult>**
   - 主入口：从数据库查询最新 schema
   - 若 tablesToRefresh 指定了表名列表，只刷新这些表；否则全量刷新
   - 流程：
     a. 从 .dbcli/config.json 读取当前配置（previous）
     b. 从数据库查询所有表的 schema（current）
     c. 调用 generatePatch(previous, current)
     d. 调用 applyPatch(patch)
     e. 返回 SchemaRefreshResult
   - 返回类型：{ added: number; modified: number; deleted: number; totalTime: number; details: string }

2. **private generatePatch(previous: DbcliConfig, current: DbcliConfig): SchemaPatch**
   - 比较前后两个完整 schema，返回仅包含变化的 patch
   - Patch 结构：{ added, modified, deleted, deletedTables }
   - 使用 SchemaDiffEngine（已存在的 src/core/schema-diff.ts）进行细粒度对比
   - 示例：
     ```typescript
     const patch = {
       added: { 'new_table': { ... } },
       modified: { 'users': { columns: [...] } },
       deleted: {},
       deletedTables: ['old_table']
     }
     ```

3. **private async applyPatch(patch: SchemaPatch): Promise<void>**
   - 应用 patch 到配置文件
   - 读取现有 .dbcli/config.json
   - Object.assign(existing.schema, patch.added)
   - Object.assign(existing.schema, patch.modified)
   - 删除 patch.deletedTables 中的表
   - 更新元数据：lastRefreshed, schemaVersion += 1
   - 调用 AtomicFileWriter.write() 原子写入
   - 重建索引：SchemaIndexBuilder.buildIndex() 并保存
   - 更新缓存：调用 cache.initialize() 重新预加载热点

4. **async diffReport(options?: { verbose?: boolean }): Promise<SchemaDiffReport>**
   - 生成 DIFF 报告（用于 schema --refresh --dry-run）
   - 包含：added tables (N), modified columns (N), deleted tables (N)
   - 若 verbose=true，包含每个改变的详细信息

**导入：**
- import { SchemaDiffEngine } from './schema-diff'
- import { SchemaIndexBuilder } from './schema-index'
- import { AtomicFileWriter } from './atomic-writer'
- import { configModule } from './config'
- import type { DatabaseAdapter } from '@/adapters'
- import type { DbcliConfig, SchemaPatch, SchemaRefreshResult } from '@/types'

**注意：**
- 不做参数验证（adapter 和 cache 由调用方确保有效）
- 所有文件操作通过 AtomicFileWriter（不直接使用 Bun.file）
- 失败时提供清晰的错误信息（包括已修改的部分和建议的手动恢复步骤）
  </action>
  <verify>
    <automated>
bun test --run src/core/schema-updater.test.ts 2>&1 | grep -E "pass|fail"
    </automated>
  </verify>
  <done>
- src/core/schema-updater.ts 实现，> 150 行
- SchemaUpdater 类导出
- 四个核心方法实现
- generatePatch() 调用 SchemaDiffEngine
- applyPatch() 使用原子写入
- refreshSchema() 返回 SchemaRefreshResult
  </done>
</task>

<task type="auto">
  <name>Task 11.2.2: 实现 AtomicFileWriter - 原子文件写入与备份</name>
  <files>src/core/atomic-writer.ts</files>
  <action>
创建 src/core/atomic-writer.ts，实现原子写入模式，防止并发冲突导致的文件损坏。

**类: AtomicFileWriter**

**静态方法：**

1. **static async write(filePath: string, data: any, options?: { backup?: boolean; atomic?: boolean }): Promise<void>**
   - 参数：
     - filePath: 目标文件路径
     - data: 任意对象（自动 JSON.stringify）
     - options.backup: 写入前备份原文件（默认 true）
     - options.atomic: 使用原子重命名（默认 true）
   - 流程（atomic=true）：
     a. 若 backup=true 且目标文件存在，复制为 {path}.backup.{timestamp}
     b. 生成临时文件 {path}.tmp.{timestamp}
     c. 写入 JSON 到临时文件（Bun.file(tmpPath).write()）
     d. 验证临时文件可读（读回一行检查）
     e. 原子重命名：Bun.spawn(['mv', tmpPath, filePath])
     f. 若重命名失败，恢复备份（若存在）并抛异常
   - 若 atomic=false，直接覆盖（不推荐）

2. **static async restore(filePath: string, backupTimestamp?: string): Promise<void>**
   - 恢复文件到最近的备份或指定时间戳的备份
   - 若 backupTimestamp 未指定，自动使用最新备份
   - 检查备份文件是否存在，存在则恢复；否则报错

3. **static async createBackup(filePath: string): Promise<string>**
   - 手动创建备份
   - 返回备份文件路径
   - 用于 schema --refresh 之前

4. **static async listBackups(filePath: string): Promise<Array<{ path: string; timestamp: string }>>**
   - 列出所有备份文件
   - 返回 [{ path: 'config.json.backup.20260326-120000', timestamp: '20260326-120000' }, ...]

**导入：**
- import { join, dirname } from 'path'
- import { Bun } from 'bun'

**核心设计：**
- 临时文件命名：{path}.tmp.{Date.now()}（毫秒戳确保唯一）
- 备份命名：{path}.backup.{ISO8601 timestamp}
- 原子重命名：使用 Bun.spawn(['mv', ...]) 确保原子性（POSIX 保证）
- 验证：重命名前读取临时文件确保内容有效
- 恢复：保留最后 3 个备份，自动清理旧备份

**错误处理：**
- 写入失败：抛 Error，清理临时文件
- 重命名失败：抛 Error，恢复备份（若存在）
- 无备份可恢复：抛 Error，提示手动修复

**注意：**
- 不创建超过 3 个备份（自动清理）
- 备份占用空间可能 = 原文件 * 3，文档化此限制
- 原子重命名依赖 POSIX 文件系统（Win32 可能有兼容性问题，需要 Bun 兼容性验证）
  </action>
  <verify>
    <automated>
bun test --run src/core/atomic-writer.test.ts 2>&1 | grep -E "pass|fail"
    </automated>
  </verify>
  <done>
- src/core/atomic-writer.ts 实现，> 100 行
- AtomicFileWriter 类导出
- write() 方法实现原子重命名和备份
- restore() 和 createBackup() 可用
- listBackups() 列出备份
- 备份自动清理（保留 3 个）
  </done>
</task>

---

# Wave 3: 并发安全与增量优化

<task type="auto">
  <name>Task 11.3.1: 集成并发锁 - 防止冲突</name>
  <files>src/core/schema-updater.ts</files>
  <action>
增强 SchemaUpdater，添加简单的并发锁机制（进程级）。

**修改 SchemaUpdater：**

1. **添加私有成员：**
   ```typescript
   private updateLock: boolean = false
   private updateQueue: Array<() => Promise<void>> = []
   ```

2. **修改 refreshSchema() 为 async 队列方式：**
   ```typescript
   async refreshSchema(options?: ...): Promise<SchemaRefreshResult> {
     if (this.updateLock) {
       // 排队等待
       return new Promise((resolve, reject) => {
         this.updateQueue.push(async () => {
           try {
             resolve(await this._doRefresh(options))
           } catch (e) {
             reject(e)
           }
         })
       })
     }

     this.updateLock = true
     try {
       const result = await this._doRefresh(options)
       // 处理队列
       while (this.updateQueue.length > 0) {
         const fn = this.updateQueue.shift()!
         await fn()
       }
       return result
     } finally {
       this.updateLock = false
     }
   }

   private async _doRefresh(options): Promise<SchemaRefreshResult> {
     // 原有逻辑
   }
   ```

3. **文档化限制：**
   - 此锁仅在单进程内有效
   - 多 dbcli 进程并发调用仍需 AtomicFileWriter 保护
   - 未来可扩展为数据库级 advisory lock

**注意：**
- 这是**可选优化**，主要是防止单进程内多个异步操作的竞争
- 跨进程并发安全依赖 AtomicFileWriter（Wave 2 已实现）
  </action>
  <verify>
    <automated>
bun test --run src/core/schema-updater.test.ts 2>&1 | grep -E "concurrent|queue"
    </automated>
  </verify>
  <done>
- SchemaUpdater 添加 updateLock 和 updateQueue
- refreshSchema() 实现队列机制
- _doRefresh() 提取原有逻辑
- 并发测试通过
  </done>
</task>

<task type="auto">
  <name>Task 11.3.2: 错误恢复与回退策略</name>
  <files>src/core/schema-updater.ts, src/core/atomic-writer.ts</files>
  <action>
增强错误处理，添加更新失败时的自动回退机制。

**修改 SchemaUpdater.applyPatch()：**

1. 在应用 patch 前，创建备份：
   ```typescript
   const backup = await AtomicFileWriter.createBackup(configPath)
   ```

2. try-catch 包装 applyPatch 逻辑
3. 若任何步骤失败，自动恢复备份：
   ```typescript
   catch (error) {
     console.error('Apply patch failed, restoring backup:', error)
     await AtomicFileWriter.restore(configPath, backup)
     throw new Error(`Schema refresh failed and rolled back. Reason: ${error.message}`)
   }
   ```

4. 返回结果中添加字段：
   ```typescript
   interface SchemaRefreshResult {
     added: number
     modified: number
     deleted: number
     totalTime: number
     backup?: string  // 若有创建备份，返回其路径
     rollback?: boolean  // 若发生回退，设为 true
   }
   ```

**修改命令层（src/commands/schema.ts）：**

添加 --dry-run 支持（通过 SchemaUpdater.diffReport()）：
```typescript
if (options.dryRun) {
  const report = await updater.diffReport({ verbose: true })
  console.log('Changes that would be applied:')
  console.log(JSON.stringify(report, null, 2))
  return
}
```

**注意：**
- 自动回退是双刃剑：若回退本身失败，需要手动介入
- 文档化备份保留策略（最多 3 个）
- 错误消息包含恢复建议
  </action>
  <verify>
    <automated>
bun test --run src/core/schema-updater.test.ts 2>&1 | grep -E "rollback|restore"
    </automated>
  </verify>
  <done>
- applyPatch() 创建备份并有回退逻辑
- SchemaRefreshResult 包含 backup 和 rollback 字段
- 错误消息清晰
- --dry-run 通过 diffReport() 实现
  </done>
</task>

---

# Wave 4: 性能优化与索引加速

<task type="auto">
  <name>Task 11.4.1: 实现 ColumnIndexBuilder - 字段快速查询</name>
  <files>src/core/column-index.ts</files>
  <action>
创建 src/core/column-index.ts，实现字段反向索引，提供 O(1) 查询。

**类: ColumnIndexBuilder**

**静态方法：**

1. **static buildIndex(config: DbcliConfig): ColumnIndex**
   - 从完整 config 构建列索引
   - 三个索引维度：byName, byType, byTable
   - 示例输出：
     ```typescript
     {
       byName: {
         'id': [{ table: 'users', column: {...} }, { table: 'products', column: {...} }],
         'email': [{ table: 'users', column: {...} }]
       },
       byType: {
         'VARCHAR': [{ table: 'users', column: 'email' }, ...],
         'INT': [{ table: 'users', column: 'id' }, ...]
       },
       byTable: {
         'users': [{ name: 'id', type: 'INT' }, { name: 'email', type: 'VARCHAR' }]
       }
     }
     ```

2. **static findByName(index: ColumnIndex, columnName: string): ColumnLocation[]**
   - O(1) 查询列名
   - 返回 [{ table, column }, ...]

3. **static findByType(index: ColumnIndex, columnType: string): ColumnLocation[]**
   - O(1) 查询列类型
   - 返回 [{ table, column }, ...]

4. **static findByTable(index: ColumnIndex, tableName: string): ColumnSchema[]**
   - O(1) 查询表的所有列
   - 返回 [{ name, type, ... }, ...]

**类型定义（在 @/types/schema-cache.ts 中添加）：**

```typescript
interface ColumnIndex {
  byName: Record<string, ColumnLocation[]>
  byType: Record<string, ColumnLocation[]>
  byTable: Record<string, ColumnSchema[]>
}

interface ColumnLocation {
  table: string
  column: ColumnSchema
}
```

**集成点：**

在 SchemaCacheManager 中添加方法：
```typescript
getColumnIndex(): ColumnIndex {
  return ColumnIndexBuilder.buildIndex(this.getFullConfig())
}
```

**性能：**
- buildIndex() 耗时：O(n * m)，n=表数，m=平均列数（100 表 × 50 列 = 5000 项，< 10ms）
- 查询耗时：O(1)，哈希表直接访问

**注意：**
- 索引大小 = 原 schema 大小 × 3（三个维度）
- Schema 更新后需要重建索引（由 SchemaUpdater 调用）
- 列名/类型大小写敏感（用户需要指定正确的大小写）
  </action>
  <verify>
    <automated>
bun test --run src/core/column-index.test.ts 2>&1 | grep -E "pass|fail"
    </automated>
  </verify>
  <done>
- src/core/column-index.ts 实现，> 120 行
- ColumnIndexBuilder 类导出
- findByName(), findByType(), findByTable() 可用
- 类型定义完整
- SchemaCacheManager 集成 getColumnIndex() 方法
- 性能测试通过（< 10ms）
  </done>
</task>

<task type="auto">
  <name>Task 11.4.2: 实现 SchemaOptimizer - 性能监控与优化建议</name>
  <files>src/core/schema-optimizer.ts</files>
  <action>
创建 src/core/schema-optimizer.ts，实现性能监控和优化诊断工具。

**类: SchemaOptimizer**

**静态方法：**

1. **static diagnose(cache: SchemaCacheManager, index: ColumnIndex): DiagnosisReport**
   - 分析当前 schema 缓存和索引的性能特征
   - 返回诊断报告：
     ```typescript
     {
       cacheStats: CacheStats,
       indexStats: { entries: number; memoryEstimate: number },
       recommendations: [
         { severity: 'info' | 'warning' | 'error',
           message: string,
           suggestion: string }
       ],
       performanceProfile: {
         initTime: number,
         avgQueryTime: number,
         cacheHitRate: number
       }
     }
     ```

2. **static analyzeHotTables(config: DbcliConfig, threshold?: number): Array<{ name: string; size: number; rank: number }>**
   - 分析当前热点表分布
   - 返回排序后的表列表（按大小）
   - 建议调整热点 threshold（若不合理）

3. **static validateSchemaConsistency(config: DbcliConfig, index: ColumnIndex): ValidationResult**
   - 验证 schema 数据完整性
   - 检查：
     - 所有表都在索引中
     - 所有列都有类型信息
     - 无孤立的列定义
   - 返回 { isValid: boolean; errors: string[] }

**集成点：**

添加 dbcli 命令（扩展 src/commands/schema.ts）：
```typescript
// dbcli schema --analyze
if (options.analyze) {
  const report = SchemaOptimizer.diagnose(cache, columnIndex)
  console.log(JSON.stringify(report, null, 2))
}
```

**性能：**
- diagnose() 耗时：< 50ms（遍历所有表）
- 可用于定期性能审计

**注意：**
- 诊断是只读操作，不修改配置
- 建议信息基于启发式规则，非强制性
- 可作为未来性能调优的基础
  </action>
  <verify>
    <automated>
bun test --run src/core/schema-optimizer.test.ts 2>&1 | grep -E "pass|fail"
    </automated>
  </verify>
  <done>
- src/core/schema-optimizer.ts 实现，> 80 行
- SchemaOptimizer 类导出
- diagnose() 返回完整诊断报告
- analyzeHotTables() 和 validateSchemaConsistency() 可用
- 集成到 schema --analyze 命令
- 性能测试通过（< 50ms）
  </done>
</task>

---

# Wave 5: 集成验证与性能测试

<task type="auto">
  <name>Task 11.5.1: 集成测试 - 完整流程验证</name>
  <files>
    src/core/schema-system.integration.test.ts,
    src/commands/schema.test.ts
  </files>
  <action>
编写集成测试，验证整个 schema 管理系统的端到端流程。

**文件 1: src/core/schema-system.integration.test.ts**

测试场景：
1. **启动初始化**
   - 创建 100+ 张表的 mock schema
   - 启动 SchemaLayeredLoader
   - 验证初始化耗时 < 100ms
   - 验证热点表被预加载

2. **增量更新**
   - 添加 10 张新表
   - 调用 SchemaUpdater.refreshSchema()
   - 验证只有新表被写入（增量）
   - 验证原表不被重写

3. **并发更新**
   - 两个 SchemaUpdater 实例同时调用 refreshSchema()
   - 验证文件不被损坏
   - 验证最终数据一致

4. **冷表加载**
   - 查询一个冷表
   - 验证首次 10-50ms
   - 再次查询，验证 < 5ms（缓存命中）

5. **字段查询**
   - 构建 ColumnIndex
   - 查询 'id' 字段
   - 验证返回所有包含 'id' 的表（< 1ms）

6. **错误恢复**
   - 模拟中途失败
   - 验证自动回退到备份
   - 验证数据一致性

**文件 2: src/commands/schema.test.ts**

扩展现有 test，添加：
1. `dbcli schema --refresh` 整流
2. `dbcli schema --refresh --dry-run` 不修改文件
3. `dbcli schema --analyze` 诊断报告
4. 错误场景：数据库连接失败、权限不足

**Mock 数据：**

```typescript
const mockSchema = {
  users: {
    name: 'users',
    columns: [
      { name: 'id', type: 'INT', primaryKey: true },
      { name: 'email', type: 'VARCHAR(100)', nullable: false },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' }
    ]
  },
  // ... 99+ 更多表
}
```

**性能基准（与性能指标对齐）：**

| 操作 | 预期 | 实测 |
|------|------|------|
| 初始化（100+ 表） | < 100ms | _____ |
| 热表查询 | < 1ms | _____ |
| 冷表首次 | 10-50ms | _____ |
| 冷表再次 | < 5ms | _____ |
| 字段查询 | < 1ms | _____ |
| 增量更新 | < 50ms | _____ |
| 并发安全 | 无损坏 | ✓ |
  </action>
  <verify>
    <automated>
bun test --run src/core/schema-system.integration.test.ts src/commands/schema.test.ts 2>&1 | tail -20
    </automated>
  </verify>
  <done>
- 两个 test 文件存在
- 6+ 集成测试场景覆盖
- 性能基准测试完成
- 所有 test 通过
- 并发安全验证通过
  </done>
</task>

<task type="auto">
  <name>Task 11.5.2: 性能基准测试 (Benchmark)</name>
  <files>src/benchmarks/schema-performance.bench.ts</files>
  <action>
创建性能基准测试脚本，定量衡量四层架构的性能收益。

**文件: src/benchmarks/schema-performance.bench.ts**

使用 Bun 的 bench() 或手动 performance 测量：

```typescript
import { performance } from 'perf_hooks'

// 基准 1: 初始化耗时
async function benchmarkInitialization() {
  const start = performance.now()
  const loader = new SchemaLayeredLoader(dbcliPath)
  const { cache, index } = await loader.initialize()
  const elapsed = performance.now() - start
  console.log(`Init (100+ tables): ${elapsed.toFixed(2)}ms [TARGET: < 100ms]`)
}

// 基准 2: 热表查询
function benchmarkHotTableQuery(cache: SchemaCacheManager) {
  const start = performance.now()
  const schema = cache.getTableSchema('users') // 热表
  const elapsed = performance.now() - start
  console.log(`Hot table query: ${elapsed.toFixed(3)}ms [TARGET: < 1ms]`)
}

// 基准 3: 冷表加载
async function benchmarkColdTableLoad(cache: SchemaCacheManager) {
  const start = performance.now()
  const schema = await cache.getTableSchema('infrequent_table')
  const elapsed = performance.now() - start
  console.log(`Cold table load: ${elapsed.toFixed(2)}ms [TARGET: 10-50ms]`)
}

// 基准 4: 字段查询
function benchmarkColumnQuery(index: ColumnIndex) {
  const start = performance.now()
  const results = ColumnIndexBuilder.findByName(index, 'id')
  const elapsed = performance.now() - start
  console.log(`Column query: ${elapsed.toFixed(3)}ms [TARGET: < 1ms]`)
}

// 基准 5: 增量更新
async function benchmarkIncrementalUpdate(updater: SchemaUpdater) {
  const start = performance.now()
  const result = await updater.refreshSchema()
  const elapsed = performance.now() - start
  console.log(`Incremental update: ${elapsed.toFixed(2)}ms [TARGET: < 50ms]`)
}
```

**运行方式：**

```bash
bun run src/benchmarks/schema-performance.bench.ts
```

**输出格式：**

```
Schema Performance Benchmarks
==============================
Init (100+ tables): 85.23ms [TARGET: < 100ms] ✓
Hot table query: 0.12ms [TARGET: < 1ms] ✓
Cold table load: 32.45ms [TARGET: 10-50ms] ✓
Cold table (2nd): 0.98ms [TARGET: < 5ms] ✓
Column query: 0.08ms [TARGET: < 1ms] ✓
Incremental update: 42.15ms [TARGET: < 50ms] ✓
```

**CI 集成：**

在 .github/workflows/test.yml 中添加：
```yaml
- name: Run performance benchmarks
  run: bun run src/benchmarks/schema-performance.bench.ts
```

**注意：**
- 基准测试使用 100+ 张表的 mock data（不真实数据库）
- CI 环境性能波动可能导致偶发失败，允许 ±20% 容差
- 月度收集数据用于性能趋势分析
  </action>
  <verify>
    <automated>
bun run src/benchmarks/schema-performance.bench.ts 2>&1 | grep -E "Init|Hot|Cold|Column|Update"
    </automated>
  </verify>
  <done>
- src/benchmarks/schema-performance.bench.ts 存在
- 5 个基准测试完整
- 输出清晰展示性能指标
- 与性能目标对齐
- CI 集成准备就绪
  </done>
</task>

<task type="auto">
  <name>Task 11.5.3: 更新 src/core/index.ts 导出全部模块</name>
  <files>src/core/index.ts</files>
  <action>
更新 src/core/index.ts，导出 Wave 2-5 的所有新模块。

**添加导出：**

```typescript
// Wave 2: 增量更新
export { SchemaUpdater } from './schema-updater'
export { AtomicFileWriter } from './atomic-writer'

// Wave 4: 性能优化
export { ColumnIndexBuilder } from './column-index'
export { SchemaOptimizer } from './schema-optimizer'

// 类型
export type {
  SchemaPatch,
  SchemaRefreshResult,
  DiagnosisReport,
  ValidationResult,
  ColumnIndex,
  ColumnLocation
} from '@/types/schema-cache'
```

**验证：**
- tsc --noEmit 通过
- 导入验证：`import { SchemaUpdater } from '@/core'` 成功

**注意：**
- 不导出内部方法（如 _doRefresh），仅导出公共类和方法
- 类型从 @/types/schema-cache.ts 导出
  </action>
  <verify>
    <automated>
tsc --noEmit && grep -q "SchemaUpdater\|AtomicFileWriter\|ColumnIndexBuilder" src/core/index.ts
    </automated>
  </verify>
  <done>
- src/core/index.ts 更新，导出所有新模块
- 类型导出完整
- tsc 无错误
  </done>
</task>

<task type="auto">
  <name>Task 11.5.4: 文档与命令集成</name>
  <files>
    src/commands/schema.ts,
    README.md,
    .planning/11-schema-optimization/IMPLEMENTATION.md
  </files>
  <action>
更新命令和文档，集成新增功能。

**修改 src/commands/schema.ts：**

添加新的 command 选项：
- `--refresh [table]`：刷新全部或指定表
- `--refresh --dry-run`：预览将要进行的更改
- `--analyze`：分析 schema 性能和建议优化
- `--backup`：手动备份当前 schema

实现示例：
```typescript
schemaCommand
  .option('--refresh [table]', 'Refresh schema from database')
  .option('--dry-run', 'Preview changes without applying')
  .option('--analyze', 'Analyze schema performance')
  .option('--backup', 'Create backup of current schema')
  .action(async (options) => {
    if (options.refresh) {
      const updater = new SchemaUpdater(dbcliPath, adapter, cache)
      const result = options.dryRun
        ? await updater.diffReport()
        : await updater.refreshSchema()
      console.log(JSON.stringify(result, null, 2))
    }

    if (options.analyze) {
      const report = SchemaOptimizer.diagnose(cache, columnIndex)
      console.log(JSON.stringify(report, null, 2))
    }

    if (options.backup) {
      const path = await AtomicFileWriter.createBackup(configPath)
      console.log(`Backup created: ${path}`)
    }
  })
```

**更新 README.md：**

在 "Schema Management" 章节添加：
- `dbcli schema --refresh` 完整说明
- `--dry-run` 预览机制
- `--analyze` 诊断报告解读
- 性能目标和实际性能数据

**创建 IMPLEMENTATION.md：**

文件: .planning/11-schema-optimization/IMPLEMENTATION.md

内容：
1. 架构总览（四层）
2. 模块说明（5 个核心模块）
3. 性能目标与实测数据
4. 并发安全保证
5. 故障排查指南
6. 未来扩展方向

**示例内容片段：**

```markdown
# Schema 管理优化 - 实现说明

## 四层架构

| 层 | 模块 | 职责 |
|---|------|------|
| 1. 存储 | SchemaLayeredLoader | 分层文件管理 |
| 2. 缓存 | SchemaCacheManager | LRU 缓存 |
| 3. 更新 | SchemaUpdater + AtomicFileWriter | 增量更新 |
| 4. 查询 | ColumnIndexBuilder | 字段索引 |

## 性能达成

- ✓ 初始化 < 100ms（100+ 表）
- ✓ 热表 < 1ms
- ✓ 冷表首次 10-50ms
- ✓ 字段查询 O(1)
- ✓ 增量更新 < 50ms
- ✓ 并发安全（原子写入）

## 故障排查

**问题: 启动耗时 > 500ms**
-> 检查磁盘 I/O，可能是文件系统慢
-> 尝试 `dbcli schema --analyze` 诊断

**问题: 更新失败并回退**
-> 检查 .dbcli/config.json.backup.* 备份
-> 手动恢复或重新 `--refresh`
```

**注意：**
- 命令帮助文本需要更新（--help）
- 保证向后兼容（旧 schema 格式仍可用）
  </action>
  <verify>
    <automated>
bun run -- dbcli schema --help 2>&1 | grep -E "refresh|analyze|backup"
    </automated>
  </verify>
  <done>
- src/commands/schema.ts 更新，支持新选项
- 新命令可通过 --help 显示
- README.md 更新，含使用示例
- IMPLEMENTATION.md 创建，含完整技术说明
- 向后兼容验证通过
  </done>
</task>

</tasks>

---

## Wave 2-5 总结

### 交付物

| Wave | 模块 | 关键功能 |
|------|------|---------|
| 2 | SchemaUpdater, AtomicFileWriter | 增量更新 + 原子写入 |
| 3 | 锁机制 + 备份恢复 | 并发安全 + 自动回退 |
| 4 | ColumnIndexBuilder, SchemaOptimizer | 字段 O(1) 查询 + 性能诊断 |
| 5 | 集成测试 + 基准测试 + 文档 | 完整验证 + 性能目标达成 |

### 性能达成情况

所有四大性能瓶颈已解决：

✓ **增量更新** < 50ms（仅写改动部分）
✓ **大文件加载** 10-50ms（分层 + LRU）
✓ **事务一致性** 通过原子重命名保证
✓ **字段查询** O(1)（哈希索引）

### 架构完整性

```
Phase 11 四层架构 (完成)
├── 存储层: SchemaLayeredLoader (Wave 1)
├── 缓存层: SchemaCacheManager (Wave 1)
├── 更新层: SchemaUpdater + AtomicFileWriter (Wave 2-3)
└── 查询层: ColumnIndexBuilder + SchemaOptimizer (Wave 4-5)
```

### 后续建议

- **Phase 12**: 集成到 dbcli 主流程（init、list、query 等命令中）
- **Phase 13**: 性能监控和自动优化（基于 SchemaOptimizer 诊断）
- **Phase 14**: 跨进程锁（使用数据库 advisory locks）
- **Phase 15**: 流式加载支持（stream-json，处理 > 10MB schema）

---

*Last updated: 2026-03-26 (Plan Phase - Waves 2-5)*
