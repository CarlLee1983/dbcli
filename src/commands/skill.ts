/**
 * dbcli skill command
 * Reads `assets/SKILL.md` (stdout / primary install) and `assets/reference.md` (install only, next to the skill)
 */

import { $ } from 'bun'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { t, t_vars } from '@/i18n/message-loader'
import { packageAssetPath } from '@/utils/package-root'
import { Command, Option } from 'commander'
import { gatherContext } from '@/core/context/context'
import { serializeXml, serializeJson, serializeMarkdown } from '@/core/context/serializer'
import { resolveConfigPath } from '@/utils/config-path'

/** Long-form command reference (sibling to SKILL in assets/ and in install dir) */
const REFERENCE_SOURCE_PATH = packageAssetPath('reference.md')

/**
 * Resolve the SKILL source markdown file path based on the requested language.
 * `--lang` is a SOURCE-FILE SELECTOR, not a `DBCLI_LANG` integration (D-73).
 * Target install/output filename stays `SKILL.md` regardless of source (D-74).
 */
function resolveSkillSource(lang: string): string {
  if (lang === 'zh-TW') return packageAssetPath('SKILL.zh-TW.md')
  return packageAssetPath('SKILL.md')
}

export interface SkillOptions {
  install?: string // platform: claude, gemini, antigravity, copilot, cursor
  output?: string // custom output file path
  lang?: 'en' | 'zh-TW' // source language for SKILL content (default 'en', D-73)
}

/**
 * Supported platforms for skill installation
 *
 * NOTE: `gemini` (Gemini CLI) is retained for now but is being phased out in
 * favour of `antigravity` (Antigravity CLI), Google's successor terminal agent.
 */
export const SUPPORTED_PLATFORMS = [
  'claude',
  'gemini',
  'antigravity',
  'copilot',
  'cursor',
  'codex',
  'windsurf',
] as const
export type Platform = (typeof SUPPORTED_PLATFORMS)[number]

/**
 * Skill command handler
 * Usage:
 *   dbcli skill                      # Print to stdout
 *   dbcli skill --output ./skill.md  # Write to file
 *   dbcli skill --install claude     # Install to ~/.claude/skills/dbcli/SKILL.md
 */
export async function skillCommand(_program: Command, options: SkillOptions): Promise<void> {
  try {
    // 1. Read static SKILL.<lang>.md (single source of truth; D-73 source selector)
    const lang = options.lang ?? 'en' // defensive: commander supplies default, but unit tests bypass commander
    const skillSourcePath = resolveSkillSource(lang)
    const skillFile = Bun.file(skillSourcePath)
    if (!(await skillFile.exists())) {
      throw new Error(`Skill source not found: ${skillSourcePath}`)
    }
    const refFile = Bun.file(REFERENCE_SOURCE_PATH)
    if (!(await refFile.exists())) {
      throw new Error(`Skill reference not found: ${REFERENCE_SOURCE_PATH}`)
    }
    const skillMarkdown = await skillFile.text()
    const referenceMarkdown = await refFile.text()

    // 2. Handle output based on options
    if (options.output) {
      await Bun.file(options.output).write(skillMarkdown)
      console.error(`Skill written to ${options.output}`)
      return
    }

    if (options.install) {
      const installPath = getInstallPath(options.install)
      const { referencePath } = await writeSkillInstall(
        options.install,
        installPath,
        skillMarkdown,
        referenceMarkdown
      )
      console.error(
        t_vars('skill.installed', { path: installPath, referencePath: referencePath ?? '' })
      )
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
    // A skill may be installed from any supported source language (D-73), and
    // every language ships the same version. An install is current if it matches
    // ANY current source. Comparing only against English falsely flagged every
    // `--lang zh-TW` install as outdated forever (fired on each command).
    const sourceContents: string[] = []
    for (const lang of ['en', 'zh-TW'] as const) {
      const sourceFile = Bun.file(resolveSkillSource(lang))
      if (await sourceFile.exists()) sourceContents.push(await sourceFile.text())
    }
    if (sourceContents.length === 0) return []

    for (const platform of SUPPORTED_PLATFORMS) {
      try {
        const installPath = getInstallPath(platform)
        const installedFile = Bun.file(installPath)

        if (await installedFile.exists()) {
          const installedContent = await installedFile.text()
          if (!sourceContents.includes(installedContent)) {
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

    case 'antigravity':
      // Antigravity CLI (Gemini CLI's successor) loads CLI-scoped skills from
      // ~/.gemini/antigravity-cli/skills/<name>/SKILL.md
      return path.join(home, '.gemini', 'antigravity-cli', 'skills', 'dbcli', 'SKILL.md')

    case 'codex':
      return path.join(home, '.codex', 'skills', 'dbcli', 'SKILL.md')

    case 'copilot':
      return path.join(process.cwd(), '.github', 'skills', 'dbcli', 'SKILL.md')

    case 'cursor':
      // Prefer the modern .cursor/rules/*.mdc format
      return path.join(process.cwd(), '.cursor', 'rules', 'dbcli.mdc')

    case 'windsurf':
      // Windsurf prefers .windsurfrules in project root
      return path.join(process.cwd(), '.windsurfrules')

    default:
      throw new Error(
        `Unknown platform: ${platform}. Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`
      )
  }
}

/**
 * Writes the primary skill file and companion reference.md for progressive disclosure.
 * For Cursor/Windsurf, the primary file is a rule file and reference is under a dedicated skills directory.
 */
async function writeSkillInstall(
  platform: string,
  installPath: string,
  skillMarkdown: string,
  referenceMarkdown: string
): Promise<{ referencePath: string | null }> {
  const platformLower = platform.toLowerCase()
  await ensureDir(path.dirname(installPath))
  await Bun.file(installPath).write(skillMarkdown)

  // Platforms that use a rule file in root + companion reference in a hidden dir
  if (platformLower === 'cursor' || platformLower === 'windsurf') {
    const hiddenDir = platformLower === 'cursor' ? '.cursor' : '.windsurf'
    const refPath = path.join(process.cwd(), hiddenDir, 'skills', 'dbcli', 'reference.md')
    await ensureDir(path.dirname(refPath))
    await Bun.file(refPath).write(referenceMarkdown)
    return { referencePath: refPath }
  }

  const refPath = path.join(path.dirname(installPath), 'reference.md')
  await Bun.file(refPath).write(referenceMarkdown)
  return { referencePath: refPath }
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
  } catch {
    // If shell syntax is unavailable, fall back to Node.js fs.mkdir
    try {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(dirPath, { recursive: true })
    } catch {
      throw new Error(`Cannot create directory: ${dirPath}`)
    }
  }
}

/**
 * Register the `skill` command (and return it) so callers can chain
 * additional sub-commands like `skill tasks list/show/plan` from cli.ts.
 */
export function registerSkillCommand(program: Command): Command {
  const skill = program
    .command('skill')
    .description(t('skill.description'))
    .option(
      '--install <platform>',
      'Install to platform directory (claude, gemini, antigravity, copilot, cursor, codex, windsurf)'
    )
    .option('--output <path>', 'Write skill to file instead of stdout')
    .addOption(
      new Option('--lang <lang>', 'Source language for SKILL content')
        .choices(['en', 'zh-TW'])
        .default('en')
    )
    .action(async (options: Record<string, unknown>) => {
      try {
        await skillCommand(program, options)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  skill
    .command('context')
    .description(t('skill.context_description'))
    .option('--format <type>', 'Output format: xml, json, markdown', 'xml')
    .action(async (options: { format?: 'xml' | 'json' | 'markdown' }, cmd) => {
      try {
        const format = options.format ?? 'xml'
        if (!['xml', 'json', 'markdown'].includes(format)) {
          throw new Error(`Invalid format: ${format}. Supported formats: xml, json, markdown`)
        }

        const configPath = resolveConfigPath(cmd)
        const workspaceRoot = process.cwd()
        const payload = await gatherContext(workspaceRoot, configPath)

        let output = ''
        if (format === 'xml') {
          output = serializeXml(payload)
        } else if (format === 'json') {
          output = serializeJson(payload)
        } else if (format === 'markdown') {
          output = serializeMarkdown(payload)
        }

        console.log(output)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(t_vars('errors.message', { message }))
        process.exit(1)
      }
    })

  return skill
}
