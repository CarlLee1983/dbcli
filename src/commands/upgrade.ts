import { Command } from 'commander'
import { colors } from '@/utils/colors'
import { checkForUpdate } from '@/utils/version-check'
import pkg from '../../package.json'

// Pure formatting helpers (exported for testing)

export function formatAlreadyUpToDate(version: string): string {
  return colors.success(`✓ Already up to date (v${version})`)
}

export function formatUpgradeMessage(currentVersion: string, latestVersion: string): string {
  return [
    colors.info(`  Current version : v${currentVersion}`),
    colors.success(`  Latest version  : v${latestVersion}`),
  ].join('\n')
}

export function formatUpdateHint(latestVersion: string): string {
  return colors.warn(
    `[INFO] dbcli v${latestVersion} available. Run "dbcli upgrade" to upgrade.`
  )
}

export const upgradeCommand = new Command('upgrade')
  .description('Check for updates and upgrade dbcli to the latest version')
  .option('--check', 'Only check for updates, do not upgrade')
  .action(async (options) => {
    const configPath = upgradeCommand.parent?.opts().config ?? '.dbcli'
    const currentVersion = pkg.version

    console.log(colors.bold('Checking for updates...'))

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

    if (!result) {
      console.error(colors.warn('⚠ Could not check for updates (network error or registry unavailable)'))
      process.exit(0)
    }

    if (!result.hasUpdate) {
      console.log(formatAlreadyUpToDate(currentVersion))
      process.exit(0)
    }

    // Newer version available
    console.log(colors.warn(`\n  New version available: v${result.latestVersion}`))
    console.log(formatUpgradeMessage(currentVersion, result.latestVersion))
    console.log()

    if (options.check) {
      console.log(colors.dim('  Run "dbcli upgrade" to install the update.'))
      process.exit(0)
    }

    // Perform the upgrade
    console.log(colors.bold('Upgrading...'))
    console.log(colors.dim(`  bun add -g @carllee1983/dbcli@latest`))
    console.log()

    const proc = Bun.$`bun add -g @carllee1983/dbcli@latest`.nothrow()
    const result2 = await proc

    if (result2.exitCode === 0) {
      console.log(colors.success(`\n✓ Successfully upgraded to v${result.latestVersion}`))
    } else {
      console.error(colors.error('\n✗ Upgrade failed. Try running manually:'))
      console.error(colors.dim('  bun add -g @carllee1983/dbcli@latest'))
      process.exit(1)
    }
  })
