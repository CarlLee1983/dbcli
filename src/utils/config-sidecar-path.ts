import { dirname, extname, join } from 'node:path'

/**
 * dbcli 在設定旁邊放的小檔案（更新提示狀態、skill 檢查快取、版本檢查快取）
 * 共用一條規則：`--config` 指到的若是目錄，sidecar 放進去；指到舊式單檔設定
 * 時，放在那個檔案旁邊。
 *
 * `.dbcli` 沒有副檔名但就是目錄，所以不能單純用 `extname` 判斷。
 */
export function configSidecarPath(configPath: string, fileName: string): string {
  const looksLikeFile = extname(configPath) !== '' && !configPath.endsWith('.dbcli')
  const directory = looksLikeFile ? dirname(configPath) : configPath
  return join(directory, fileName)
}
