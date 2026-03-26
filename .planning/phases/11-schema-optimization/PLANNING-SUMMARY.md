# Phase 11: Schema 管理優化 - 規劃完成總結

**規劃時間:** 2026-03-26
**規劃狀態:** ✅ 完成，準備執行
**計畫文檔:** `11-PLAN.md` (Wave 1) + `11-PLAN-WAVES2-5.md` (Waves 2-5)

---

## 概述

dbcli 当前 schema 管理采用平铺存储（.dbcli/config.json），在中等规模数据库（100-500 张表）时面临性能瓶颈。本规划通过 **四层混合架构** 优化：

| 层级 | 模块 | 职责 | 性能目标 |
|------|------|------|---------|
| 1. 存储层 | SchemaLayeredLoader | 分层文件加载（热/冷分离） | init < 100ms |
| 2. 缓存层 | SchemaCacheManager | LRU 内存缓存管理 | 缓存命中 < 1ms |
| 3. 更新层 | SchemaUpdater + AtomicFileWriter | 增量更新 + 原子写入 | write < 50ms |
| 4. 查询层 | ColumnIndexBuilder + SchemaOptimizer | 字段快速索引 + 诊断 | lookup O(1) |

---

## 核心设计决策（来自 CONTEXT.md）

### 锁定约束（D-01 ~ D-07）

| 决策 | 内容 | 理由 |
|------|------|------|
| D-01 | 两层缓存：热点预加载 + 冷点 LRU | 平衡启动速度和内存使用 |
| D-02 | 热点识别基于 schema 文件大小 | 无需额外统计，启动时一次计算 |
| D-03 | 原子写入：temp file + rename | 防止并发冲突导致文件损坏 |
| D-04 | 增量 DIFF 更新 | 仅写改动部分，减少 I/O |
| D-05 | 无外部缓存服务（Redis） | CLI 工具独立性，简化部署 |
| D-06 | 手动 schema 刷新 | 业务 schema 变化不频繁 |
| D-07 | LRU 配置：100 表，50MB | 足以覆盖中等规模热点 |

---

## 性能目标验收

### 四大性能瓶颈（全部解决）

✅ **增量更新** < 50ms
- 实现方式：DIFF 算法 + 仅写改动部分
- Wave 2 任务 11.2.1-2 实现

✅ **大文件加载** 10-50ms（冷表首次）
- 实现方式：分层加载 + LRU 缓存
- Wave 1 任务 11.1.4 实现

✅ **事务一致性**（并发无损坏）
- 实现方式：原子重命名 + 备份恢复
- Wave 2-3 任务 11.2.2, 11.3.2 实现

✅ **字段查询** O(1)
- 实现方式：哈希索引（byName, byType）
- Wave 4 任务 11.4.1 实现

### 具体指标

| 指标 | 目标 | 实现方式 | Wave |
|------|------|---------|------|
| 启动初始化 | < 100ms | index + hot-schemas 加载 | 1 |
| 热表查询 | < 1ms | 内存 Map 直接访问 | 1 |
| 冷表首次 | 10-50ms | 文件 I/O + JSON 解析 | 1 |
| 冷表再次 | < 5ms | LRU 缓存命中 | 1 |
| 字段查询 | < 1ms | 哈希表 O(1) 查询 | 4 |
| 增量更新 | < 50ms | 原子写入 + DIFF | 2 |
| 缓存命中率 | > 80% | LRU 管理 + 预热 | 1, 4 |

---

## 规划分解（5 个 Wave）

### Wave 1: 基础设施（6 个任务）

**目标:** 建立存储层 + 缓存层

**任务:**
1. 创建类型定义 (schema-cache.ts)
2. 实现 SchemaCacheManager (LRU 缓存)
3. 实现 SchemaIndexBuilder (索引生成)
4. 实现 SchemaLayeredLoader (分层加载)
5. 单元测试 (> 90 个 test)
6. 集成导出 (src/core/index.ts)

**输出物:**
- 4 个 TypeScript 模块 (> 500 行)
- 3 个 test 文件 (> 90 个 test case)
- 支持 100+ 表的分层文件结构

**验收标准:**
- ✓ 初始化 < 100ms（100+ 表）
- ✓ 所有 test 通过
- ✓ 热点表 < 1ms，冷表 10-50ms

**时间估算:** ~120 min

---

### Wave 2-3: 增量更新 + 并发控制（6 个任务）

**Wave 2 目标:** 增量更新与原子写入

**任务:**
- 11.2.1: SchemaUpdater (增量更新协调)
- 11.2.2: AtomicFileWriter (原子写入 + 备份)

**Wave 3 目标:** 并发锁 + 错误恢复

**任务:**
- 11.3.1: 并发锁机制（进程级队列）
- 11.3.2: 备份恢复 + 自动回退

**输出物:**
- SchemaUpdater 和 AtomicFileWriter 类
- 备份和恢复机制
- 并发安全测试

**验收标准:**
- ✓ 增量更新 < 50ms
- ✓ 并发更新无数据损坏
- ✓ 失败自动回退

**时间估算:** ~150 min

---

### Wave 4: 性能优化（2 个任务）

**目标:** 字段快速查询 + 性能诊断

**任务:**
- 11.4.1: ColumnIndexBuilder (字段 O(1) 查询)
- 11.4.2: SchemaOptimizer (性能监控)

**输出物:**
- 字段索引实现
- 诊断和优化建议系统
- 可扩展的性能分析框架

**验收标准:**
- ✓ 字段查询 O(1)，< 1ms
- ✓ 诊断报告清晰
- ✓ 性能建议可操作

**时间估算:** ~100 min

---

### Wave 5: 集成验证（4 个任务）

**目标:** 完整流程验证 + 性能基准

**任务:**
- 11.5.1: 集成测试 (6+ 场景)
- 11.5.2: 性能基准测试 (5+ 基准)
- 11.5.3: 导出模块 (src/core/index.ts)
- 11.5.4: 文档 + 命令集成

**输出物:**
- 完整的集成测试套件
- 性能基准数据
- 扩展的 schema 命令 (--refresh, --analyze, --backup)
- 技术文档 (IMPLEMENTATION.md)

**验收标准:**
- ✓ 所有 integration test 通过
- ✓ 性能基准展示目标达成
- ✓ 新命令功能正常
- ✓ 文档完整

**时间估算:** ~130 min

---

## 总计工作量

| Wave | 任务数 | 模块数 | 行数 | Test 数 | 时间 (min) |
|------|--------|--------|------|---------|------------|
| 1 | 6 | 4 | 500+ | 90+ | 120 |
| 2-3 | 4 | 2 | 300+ | 40+ | 150 |
| 4 | 2 | 2 | 200+ | 30+ | 100 |
| 5 | 4 | 1 | 200+ | 40+ | 130 |
| **总计** | **16** | **9** | **1200+** | **200+** | **500** |

**总预期执行时间:** ~500 min = 8-10 小时（分布在 5 个 wave）

---

## 风险与缓解

### 风险 1: 索引过期导致加载失败

**症状:** index.json 指向已删除的文件
**缓解:** 加载前验证文件存在，失败时返回 null（graceful）

### 风险 2: LRU 缓存大小估算不准

**症状:** 缓存占用内存 > 50MB，导致内存溢出
**缓解:** sizeCalculation 基于序列化长度，精确限制

### 风险 3: 原子重命名在 Windows 上失败

**症状:** 跨平台兼容性问题
**缓解:** 使用 Bun.spawn(['mv', ...])，测试所有平台

### 风险 4: 并发 DIFF 冲突

**症状:** 两个进程同时修改 schema，最终数据不一致
**缓解:** AtomicFileWriter 和进程级锁组合，有备份恢复

### 风险 5: DIFF 算法遗漏修改

**症状:** 列类型改变未被检测到
**缓解:** 深度字段对比（type, nullable, default, primaryKey）

---

## 技术栈

### 核心依赖

- **lru-cache@10.4.3** — 高性能 LRU，支持 maxSize + sizeCalculation
- **zod@3.22+** — 已在项目中使用，config 验证
- **stream-json@1.8+** — 可选，超过 1MB 文件时启用

### 不使用

- ❌ Redis/Memcached（引入外部依赖，CLI 工具不划算）
- ❌ SQLite（相比文件存储增加不必要查询层）
- ❌ 自己实现 LRU（成熟库更可靠）

### 内建 API

- **Bun.file** — I/O 操作
- **Bun.spawn** — 原子重命名（mv 命令）
- **performance.now()** — 性能测量

---

## 代码组织

```
src/core/
  ├── schema-cache.ts           # LRU 缓存管理 (150+ lines)
  ├── schema-index.ts            # 索引生成和加载 (100+ lines)
  ├── schema-loader.ts           # 分层加载 (120+ lines)
  ├── schema-updater.ts          # 增量更新 (150+ lines)
  ├── atomic-writer.ts           # 原子写入 (100+ lines)
  ├── column-index.ts            # 字段索引 (120+ lines)
  ├── schema-optimizer.ts        # 性能诊断 (80+ lines)
  └── *.test.ts                  # 单元测试 (200+ lines)

src/types/
  └── schema-cache.ts            # 类型定义 (50+ lines)

src/commands/
  └── schema.ts                  # 扩展 --refresh, --analyze, --backup

src/benchmarks/
  └── schema-performance.bench.ts # 性能基准 (5+ 基准)

.planning/phases/11-schema-optimization/
  ├── 11-RESEARCH.md             # 研究报告（已完成）
  ├── 11-CONTEXT.md              # 决策上下文（已完成）
  ├── 11-PLAN.md                 # Wave 1 详细规划
  ├── 11-PLAN-WAVES2-5.md        # Waves 2-5 详细规划
  └── IMPLEMENTATION.md          # 实现说明（Wave 5 生成）
```

---

## 与既有代码的集成

### 现有依赖

✅ **src/core/schema-diff.ts** — 已存在的 DIFF 引擎
- 规划中的 SchemaUpdater.generatePatch() 将调用此模块
- 无需修改

✅ **src/core/config.ts** — 配置管理
- 规划中的 SchemaUpdater 将读写配置
- 集成点清晰

✅ **src/adapters/index.ts** — 数据库适配器
- SchemaUpdater 需要 DatabaseAdapter 查询最新 schema
- 现有接口足够

✅ **src/commands/schema.ts** — schema 命令
- 扩展 --refresh, --analyze 选项
- 向后兼容

### 新增导出

规划完成后，src/core/index.ts 将导出：
```typescript
// Wave 1
export { SchemaLayeredLoader, SchemaCacheManager, SchemaIndexBuilder }
export type { SchemaIndex, CacheStats, LoaderOptions }

// Wave 2-5
export { SchemaUpdater, AtomicFileWriter, ColumnIndexBuilder, SchemaOptimizer }
export type { SchemaPatch, SchemaRefreshResult, ColumnIndex, DiagnosisReport }
```

---

## 执行路径

### 正常执行

```
/gsd:execute-phase 11-schema-optimization --wave 1
  ↓ 完成 Wave 1
/gsd:execute-phase 11-schema-optimization --wave 2
  ↓ 完成 Wave 2-3（视为一个 wave）
/gsd:execute-phase 11-schema-optimization --wave 3
  ↓ 完成 Wave 4
/gsd:execute-phase 11-schema-optimization --wave 4
  ↓ 完成 Wave 5
/gsd:execute-phase 11-schema-optimization --wave 5
```

### 依赖关系

```
Wave 1 (基础设施)
    ↓
Wave 2-3 (增量更新 + 并发)
    ↓
Wave 4 (性能优化)
    ↓
Wave 5 (集成验证)
```

**无法并行:** 所有 wave 顺序执行，因为后续 wave 依赖前面的输出

---

## 文档清单

| 文档 | 位置 | 内容 |
|------|------|------|
| 研究报告 | 11-RESEARCH.md | 技术栈、架构模式、反模式、常见陷阱 |
| 决策上下文 | 11-CONTEXT.md | 用户需求、锁定决策、设计自主权范围 |
| Wave 1 规划 | 11-PLAN.md | 6 个详细任务、性能指标、验收标准、实现指导 |
| Waves 2-5 规划 | 11-PLAN-WAVES2-5.md | 后续 4 个 wave 的 10+ 个任务、集成测试、基准 |
| 实现说明 | IMPLEMENTATION.md | 架构总览、模块说明、性能数据、故障排查（Wave 5 生成） |

---

## 成功标志

规划被认为成功当：

✅ 所有 16 个任务完成
✅ 200+ 个 test 全部通过
✅ 1200+ 行新代码质量符合项目标准
✅ 所有性能指标达成（见上面表格）
✅ 并发安全验证通过（多进程测试）
✅ 文档完整可读

---

## 后续步骤

### 立即

1. 审查规划文档 (11-PLAN.md)
2. 确认时间估算和资源
3. 开始 Wave 1 执行

### Phase 11 完成后

1. 集成到主命令流程（dbcli init, list, schema 等）
2. 性能基准数据库优化
3. 实际数据库测试（> 500 张表）

### 未来增强

- Phase 12: 集成 schema 缓存到所有命令
- Phase 13: 自动热点学习（基于访问统计）
- Phase 14: 跨进程锁（数据库 advisory locks）
- Phase 15: 流式加载支持（超大 schema）

---

**规划状态:** ✅ 完成
**下一步:** 执行 `/gsd:execute-phase 11-schema-optimization --wave 1`
**预期周期:** 8-10 小时（分散执行）

---

*Generated by Claude Code Planner — 2026-03-26*
