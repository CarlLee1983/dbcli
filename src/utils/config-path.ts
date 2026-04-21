import type { Command } from 'commander'

type ConfigOptionValues = { config?: string }

export function resolveConfigPath(
  command: Command | undefined,
  options?: ConfigOptionValues,
  fallback = '.dbcli'
): string {
  for (let current = command; current; current = current.parent) {
    const source = current.getOptionValueSource('config')
    if (source && source !== 'default') {
      const currentOptions = current.opts() as ConfigOptionValues
      if (typeof currentOptions.config === 'string' && currentOptions.config.length > 0) {
        return currentOptions.config
      }
    }
  }

  if (typeof options?.config === 'string' && options.config.length > 0) {
    return options.config
  }

  return fallback
}
