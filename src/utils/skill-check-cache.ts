/**
 * skill 安裝狀態檢查的 TTL 快取。
 *
 * 每個命令收尾都會逐一比對七個平台的 skill 安裝檔與兩份來源檔的完整內容——
 * 為了一個幾乎永遠是「沒事」的提醒，付出十來次檔案讀取。快取存在磁碟而不是
 * 記憶體，因為每次 CLI 呼叫都是新的 process：process 內的快取在這裡什麼都
 * 省不到。
 *
 * 快取帶 dbcli 版本：升級後 skill 來源內容就變了，舊結論不能再用。安裝
 * 路徑會清掉快取，讓提醒在使用者照做之後立刻消失，而不是等 TTL 到期。
 */

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'

/** 一天。skill 來源只隨 dbcli 版本變動，而版本已經是快取鍵的一部分。 */
export const SKILL_CHECK_TTL_MS = 24 * 60 * 60 * 1000

const CACHE_FILE_NAME = 'skill-check.json'

interface SkillCheckCache {
  version: 1
  /** 產生這筆結果的 dbcli 版本 */
  dbcliVersion: string
  checkedAt: number
  outdated: string[]
}

function cachePath(configPath: string): string {
  // 與 update-hints.json 同一套規則：`.dbcli` 是目錄，帶其他副檔名的是舊式
  // 單檔設定，快取放在該檔旁邊。
  const looksLikeFile = extname(configPath) !== '' && !configPath.endsWith('.dbcli')
  const directory = looksLikeFile ? dirname(configPath) : configPath
  return join(directory, CACHE_FILE_NAME)
}

/**
 * 讀取仍在有效期內的掃描結果。
 *
 * @returns 上次掃出的過期平台清單（可能是空陣列），或 null 表示需要重新掃描
 */
export async function readSkillCheckCache(
  configPath: string,
  dbcliVersion: string,
  options: { now?: number } = {}
): Promise<string[] | null> {
  try {
    const file = Bun.file(cachePath(configPath))
    if (!(await file.exists())) return null
    const raw = (await file.json()) as Partial<SkillCheckCache>
    if (raw.version !== 1 || !Array.isArray(raw.outdated)) return null
    if (raw.dbcliVersion !== dbcliVersion) return null
    if (typeof raw.checkedAt !== 'number') return null
    const age = (options.now ?? Date.now()) - raw.checkedAt
    if (age < 0 || age > SKILL_CHECK_TTL_MS) return null
    return raw.outdated
  } catch {
    // 快取是最佳努力：壞了就重新掃描，不讓命令失敗
    return null
  }
}

export async function writeSkillCheckCache(
  configPath: string,
  dbcliVersion: string,
  outdated: string[],
  options: { now?: number } = {}
): Promise<void> {
  const path = cachePath(configPath)
  const payload: SkillCheckCache = {
    version: 1,
    dbcliVersion,
    checkedAt: options.now ?? Date.now(),
    outdated,
  }
  try {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${process.pid}`
    await writeFile(temporary, JSON.stringify(payload), 'utf8')
    await rename(temporary, path)
  } catch {
    // 寫不進去就當作沒有快取，下次重新掃描
  }
}

/** 安裝或移除 skill 之後呼叫：讓下一個命令重新掃描 */
export async function invalidateSkillCheckCache(configPath: string): Promise<void> {
  await unlink(cachePath(configPath)).catch(() => undefined)
}
