/**
 * dbcli skill 命令
 * 讀取靜態 SKILL.md 並輸出或安裝到指定平台目錄
 */

import * as path from 'node:path'
import { homedir } from 'node:os'
import { t, t_vars } from '@/i18n/message-loader'
import type { Command } from 'commander'

/** 靜態 SKILL.md 的絕對路徑（基於專案根目錄） */
const SKILL_SOURCE_PATH = path.resolve(import.meta.dir, '../../assets/SKILL.md')

export interface SkillOptions {
  install?: string  // 平台: claude, gemini, copilot, cursor
  output?: string   // 自訂輸出檔案路徑
}

/**
 * Skill 命令處理器
 * 用法:
 *   dbcli skill                    # 列印到標準輸出
 *   dbcli skill --output ./skill.md  # 寫入檔案
 *   dbcli skill --install claude   # 安裝到 ~/.claude/skills/dbcli/SKILL.md
 */
export async function skillCommand(
  _program: Command,
  options: SkillOptions
): Promise<void> {
  try {
    // 1. 讀取靜態 SKILL.md（唯一來源）
    const skillFile = Bun.file(SKILL_SOURCE_PATH)
    if (!(await skillFile.exists())) {
      throw new Error(`Skill source not found: ${SKILL_SOURCE_PATH}`)
    }
    const skillMarkdown = await skillFile.text()

    // 2. 根據選項處理輸出
    if (options.output) {
      await Bun.file(options.output).write(skillMarkdown)
      console.error(`Skill written to ${options.output}`)
      return
    }

    if (options.install) {
      const installPath = getInstallPath(options.install)
      await ensureDir(path.dirname(installPath))
      await Bun.file(installPath).write(skillMarkdown)
      console.error(t_vars('skill.installed', { path: installPath }))
      return
    }

    // 3. 預設: 列印到標準輸出（用於管道傳輸）
    console.log(skillMarkdown)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(t_vars('errors.message', { message }))
    process.exit(1)
  }
}

/**
 * 取得平台特定的安裝路徑
 * 處理主目錄擴展和跨平台路徑
 */
function getInstallPath(platform: string): string {
  const home = process.env.HOME || homedir()
  const platformLower = platform.toLowerCase()

  switch (platformLower) {
    case 'claude':
      return path.join(home, '.claude', 'skills', 'dbcli', 'SKILL.md')

    case 'gemini':
      return path.join(home, '.gemini', 'skills', 'dbcli', 'SKILL.md')

    case 'copilot':
      return path.join(process.cwd(), '.github', 'skills', 'dbcli', 'SKILL.md')

    case 'cursor':
      // 偏好現代化的 .cursor/rules/*.mdc 格式
      return path.join(process.cwd(), '.cursor', 'rules', 'dbcli.mdc')

    default:
      throw new Error(
        `Unknown platform: ${platform}. Supported platforms: claude, gemini, copilot, cursor`
      )
  }
}

/**
 * 確保目錄存在，並建立必要的上層目錄
 * FIX: 使用原生 shell ($) 來進行跨平台 mkdir，而非 Bun.file
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    // 使用 Bun 的原生 shell ($) 進行跨平台 mkdir -p
    // 這能正確處理 Windows/macOS/Linux 的路徑分隔符
    await $`mkdir -p ${dirPath}`.quiet()
  } catch (error) {
    // 如果 shell 語法不可用，嘗試使用 Node.js fs.mkdir 作為後備
    try {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(dirPath, { recursive: true })
    } catch (fsError) {
      throw new Error(`Cannot create directory: ${dirPath}`)
    }
  }
}
