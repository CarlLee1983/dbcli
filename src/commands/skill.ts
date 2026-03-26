/**
 * dbcli skill 命令
 * 生成、顯示、安裝 AI 代理技能文檔（SKILL.md）
 */

import * as path from 'node:path'
import { homedir } from 'node:os'
import { t, t_vars } from '@/i18n/message-loader'
import { SkillGenerator } from '@/core/skill-generator'
import { configModule } from '@/core/config'
import type { Command } from 'commander'

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
  program: Command,
  options: SkillOptions
): Promise<void> {
  try {
    // 1. 讀取配置以取得權限級別
    const config = await configModule.read('.dbcli')
    if (!config.connection) {
      throw new Error('Run "dbcli init" to initialize project')
    }

    // 2. 使用正確的選項物件建立 SkillGenerator
    const skillGen = new SkillGenerator({
      program,
      config,
      permissionLevel: config.permission
    })

    // 3. 生成 SKILL.md 內容
    const skillMarkdown = skillGen.generateSkillMarkdown()

    // 4. 根據選項處理輸出
    if (options.output) {
      // 寫入指定的檔案
      await Bun.file(options.output).write(skillMarkdown)
      console.error(`Skill written to ${options.output}`)
      return
    }

    if (options.install) {
      // 安裝到平台特定的目錄
      const installPath = getInstallPath(options.install)
      await ensureDir(path.dirname(installPath))
      await Bun.file(installPath).write(skillMarkdown)
      console.error(t_vars('skill.installed', { path: installPath }))
      return
    }

    // 5. 預設: 列印到標準輸出（用於管道傳輸）
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
