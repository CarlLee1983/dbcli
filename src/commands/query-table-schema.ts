/**
 * 按需取得單一張表的 schema（給 size guard 用）。
 *
 * `configModule.read()` 的 layered 模式會把索引裡的每一張表都讀進記憶體，
 * 只為了 size guard 可能會用到其中一張。查詢命令因此改成不做全載，改由這裡
 * 在真的需要時讀那一張——查一張表的成本不再隨資料庫的表數成長。
 *
 * 快取放在 process 內：一次 CLI 執行最多開一次索引，而一次執行結束後整個
 * process 就消失，不需要失效策略。
 */

import { SchemaCacheManager } from '@/core/schema-cache'
import { resolveConfigStoragePath } from '@/core/config-binding'
import type { DbcliConfig } from '@/utils/validation'

const _managers = new Map<string, Promise<SchemaCacheManager>>()

function managerFor(storagePath: string, connectionName: string | undefined) {
  const key = `${storagePath}:${connectionName ?? ''}`
  let manager = _managers.get(key)
  if (!manager) {
    manager = (async () => {
      const created = new SchemaCacheManager(storagePath, { connectionName })
      await created.initialize()
      return created
    })()
    _managers.set(key, manager)
  }
  return manager
}

/** 測試用：清掉 process 內的 loader 快取 */
export function resetTableSchemaCache(): void {
  _managers.clear()
}

/**
 * 找出一張表的 schema：先看設定檔內嵌的 schema，再退回 layered 快取。
 *
 * 兩個來源的優先序與全載時代一致——layered 快取覆蓋設定檔內嵌值——只是這裡
 * 一次只解析一張表。找不到時回傳 undefined，呼叫端（size guard）視為「沒有
 * 這張表的大小資訊」而放行，與先前行為相同。
 */
export async function resolveTableSchema(
  config: DbcliConfig,
  configPath: string | undefined,
  connectionName: string | undefined,
  table: string
): Promise<unknown | undefined> {
  // v2 的 schema 目錄以「實際選到的連線」分家；命令列沒指定 --use 時那是預設
  // 連線的名字，只有 config 讀完才知道。
  const effectiveName =
    (config as { effectiveConnectionName?: string }).effectiveConnectionName ?? connectionName
  const layered = await loadLayeredTableSchema(configPath, effectiveName, table)
  if (layered) return layered
  const inline = config.schema as Record<string, unknown> | undefined
  return inline?.[table]
}

async function loadLayeredTableSchema(
  configPath: string | undefined,
  connectionName: string | undefined,
  table: string
): Promise<unknown | undefined> {
  try {
    const storagePath = await resolveConfigStoragePath(configPath ?? '.dbcli')
    const manager = await managerFor(storagePath, connectionName)
    return (await manager.getTableSchema(table)) ?? undefined
  } catch {
    // 快取壞掉不該讓查詢失敗——size guard 少一個判斷依據，查詢照跑
    return undefined
  }
}
