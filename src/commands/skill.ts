/**
 * dbcli skill command
 * Reads the static SKILL.md and outputs it or installs it to the specified platform directory
 */

import { $ } from 'bun'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { t, t_vars } from '@/i18n/message-loader'
import type { Command } from 'commander'

/**
 * Finds the package root (the directory containing package.json)
 * Supports dev mode (src/commands/) and bundle mode (dist/)
 */
function findPackageRoot(): string {
  let dir = import.meta.dir
  for (let i = 0; i < 5; i++) {
    if (Bun.file(path.join(dir, 'package.json')).size > 0) {
      return dir
    }
    dir = path.dirname(dir)
  }
  // fallback: go two levels up from import.meta.dir (dev mode: src/commands/ → root)
  return path.resolve(import.meta.dir, '../..')
}

/** Absolute path to the static SKILL.md (relative to package root) */
const SKILL_SOURCE_PATH = path.join(findPackageRoot(), 'assets', 'SKILL.md')

export interface SkillOptions {
  install?: string  // platform: claude, gemini, copilot, cursor
  output?: string   // custom output file path
}

/**
 * Supported platforms for skill installation
 */
export const SUPPORTED_PLATFORMS = ['claude', 'gemini', 'copilot', 'cursor'] as const
export type Platform = (typeof SUPPORTED_PLATFORMS)[number]

/**
 * Skill command handler
 * Usage:
 *   dbcli skill                      # Print to stdout
 *   dbcli skill --output ./skill.md  # Write to file
 *   dbcli skill --install claude     # Install to ~/.claude/skills/dbcli/SKILL.md
 */
export async function skillCommand(
  _program: Command,
  options: SkillOptions
): Promise<void> {
  try {
    // 1. Read static SKILL.md (single source of truth)
    const skillFile = Bun.file(SKILL_SOURCE_PATH)
    if (!(await skillFile.exists())) {
      throw new Error(`Skill source not found: ${SKILL_SOURCE_PATH}`)
    }
    const skillMarkdown = await skillFile.text()

    // 2. Handle output based on options
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

    // 3. Default: print to stdout (for piping)
    console.log(skillMarkdown)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(t_vars('errors.message', { message }))
    process.exit(1)
  }
}

/**
 * Checks if any installed skills are outdated compared to the current package version.
 * Returns a list of platforms that need updates.
 */
export async function checkSkillUpdates(): Promise<string[]> {
  const outdated: string[] = []

  try {
    const sourceFile = Bun.file(SKILL_SOURCE_PATH)
    if (!(await sourceFile.exists())) return []
    const sourceContent = await sourceFile.text()

    for (const platform of SUPPORTED_PLATFORMS) {
      try {
        const installPath = getInstallPath(platform)
        const installedFile = Bun.file(installPath)

        if (await installedFile.exists()) {
          const installedContent = await installedFile.text()
          if (installedContent !== sourceContent) {
            outdated.push(platform)
          }
        }
      } catch {
        // Skip platforms with errors (e.g. invalid paths)
      }
    }
  } catch {
    // Silent fail for check
  }

  return outdated
}

/**
 * Returns the platform-specific install path
 * Handles home directory expansion and cross-platform paths
 */
export function getInstallPath(platform: string): string {
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
      // Prefer the modern .cursor/rules/*.mdc format
      return path.join(process.cwd(), '.cursor', 'rules', 'dbcli.mdc')

    default:
      throw new Error(
        `Unknown platform: ${platform}. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`
      )
  }
}

/**
 * Ensures a directory exists, creating parent directories as needed
 * FIX: Uses native shell ($) for cross-platform mkdir instead of Bun.file
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    // Use Bun's native shell ($) for cross-platform mkdir -p
    // This correctly handles path separators on Windows/macOS/Linux
    await $`mkdir -p ${dirPath}`.quiet()
  } catch (error) {
    // If shell syntax is unavailable, fall back to Node.js fs.mkdir
    try {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(dirPath, { recursive: true })
    } catch (fsError) {
      throw new Error(`Cannot create directory: ${dirPath}`)
    }
  }
}
