import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { checkForUpdate } from '@/utils/version-check'
import { resolveConfigPath } from '@/utils/config-path'
import { checkSkillUpdates } from '@/commands/skill'
import { t, t_vars } from '@/i18n/message-loader'
import pkg from '../../package.json'

// Pure formatting helpers (exported for testing)

export function formatAlreadyUpToDate(version: string): string {
  return colors.success(t_vars('upgrade.already_up_to_date', { version }))
}

export function formatUpgradeMessage(currentVersion: string, latestVersion: string): string {
  return [
    colors.info(`  ${t_vars('upgrade.current_version', { version: currentVersion })}`),
    colors.success(`  ${t_vars('upgrade.latest_version', { version: latestVersion })}`),
  ].join('\n')
}

export function formatUpdateHint(latestVersion: string): string {
  return colors.warn(t_vars('upgrade.update_hint', { version: latestVersion }))
}

export function formatSkillUpdateReminder(platforms: string[]): string {
  if (platforms.length === 0) return ''
  return [
    colors.warn(`\n  ${t('skill.update_available')}`),
    ...platforms.map((p) => colors.info(`  - ${p}`)),
    colors.dim(`\n  ${t('skill.update_hint')}`),
  ].join('\n')
}

export const upgradeCommand = new Command('upgrade')
  .description(t('upgrade.description'))
  .option('--check', 'Only check for updates, do not upgrade')
  .action(async (options) => {
    const configPath = resolveConfigPath(upgradeCommand)
    const currentVersion = pkg.version

    console.log(colors.bold(t('upgrade.checking')))

    let cachePath: string | null = null
    try {
      const file = Bun.file(configPath)
      // configPath is a directory if it doesn't have a file extension
      const isDir = !configPath.includes('.') || (await file.exists()) === false
      if (isDir) {
        cachePath = configPath
      }
    } catch {
      cachePath = null
    }

    const result = await checkForUpdate(currentVersion, cachePath)
    const outdatedSkills = await checkSkillUpdates()

    if (!result) {
      console.error(colors.warn(t('upgrade.network_error')))
      if (outdatedSkills.length > 0) {
        console.log(formatSkillUpdateReminder(outdatedSkills))
      }
      process.exit(0)
    }

    if (!result.hasUpdate) {
      console.log(formatAlreadyUpToDate(currentVersion))
      if (outdatedSkills.length > 0) {
        console.log(formatSkillUpdateReminder(outdatedSkills))
      }
      process.exit(0)
    }

    // Newer version available
    console.log(colors.warn(`\n  ${t_vars('upgrade.new_version_available', { version: result.latestVersion })}`))
    console.log(formatUpgradeMessage(currentVersion, result.latestVersion))
    console.log()

    if (options.check) {
      console.log(colors.dim(`  ${t('upgrade.install_hint')}`))
      if (outdatedSkills.length > 0) {
        console.log(formatSkillUpdateReminder(outdatedSkills))
      }
      process.exit(0)
    }

    // Perform the upgrade
    console.log(colors.bold(t('upgrade.upgrading')))
    console.log(colors.dim(`  ${t('upgrade.manual_hint')}`))
    console.log()

    const proc = Bun.$`bun add -g @carllee1983/dbcli@latest`.nothrow()
    const result2 = await proc

    if (result2.exitCode === 0) {
      console.log(colors.success(`\n${t_vars('upgrade.success', { version: result.latestVersion })}`))
      console.log(colors.dim(`\n  ${t('upgrade.skill_recheck_hint')}`))
    } else {
      console.error(colors.error(`\n${t('upgrade.failed')}`))
      console.error(colors.dim(`  ${t('upgrade.manual_hint')}`))
      process.exit(1)
    }
  })
