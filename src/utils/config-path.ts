import type { Command } from 'commander'
import { getGlobalConfigPath } from '@/core/config-binding'

type ConfigOptionValues = { config?: string; global?: boolean }

export function resolveConfigPath(
  command: Command | undefined,
  options?: ConfigOptionValues,
  fallback = '.dbcli'
): string {
  // An explicitly supplied --config path is the most specific selector. This
  // keeps `--global --config <path>` deterministic and preserves the existing
  // --config contract for embedders that pass a Command-like object.
  for (let current: Command | undefined = command; current; current = current.parent ?? undefined) {
    const source = current.getOptionValueSource('config')
    if (source && source !== 'default') {
      const currentOptions = current.opts() as ConfigOptionValues
      if (typeof currentOptions.config === 'string' && currentOptions.config.length > 0) {
        return currentOptions.config
      }
    }
  }

  // A non-default options path is explicit even when the caller also supplies
  // a global selector. Command-local sources above still handle the common
  // case where Commander knows whether the option was actually passed.
  if (
    typeof options?.config === 'string' &&
    options.config.length > 0 &&
    options.config !== fallback
  ) {
    return options.config
  }

  for (let current: Command | undefined = command; current; current = current.parent ?? undefined) {
    const source = current.getOptionValueSource('global')
    if (source && source !== 'default' && current.opts().global === true) {
      return getGlobalConfigPath()
    }
  }

  if (options?.global === true) return getGlobalConfigPath()

  // `options.config` is commonly the command option's default (`.dbcli`),
  // so resolve an explicit ancestor `--global` before using this fallback.
  if (typeof options?.config === 'string' && options.config.length > 0) {
    return options.config
  }

  return fallback
}
