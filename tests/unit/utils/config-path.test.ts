import { describe, expect, test } from 'bun:test'
import { resolveConfigPath } from '@/utils/config-path'
import { getGlobalConfigPath } from '@/core/config-binding'

function makeCommand(
  source: 'cli' | 'default' | 'env' | 'implied' | undefined,
  config: string | undefined,
  parent?: any
): any {
  return {
    getOptionValueSource: () => source,
    opts: () => ({ config }),
    parent,
  }
}

describe('resolveConfigPath', () => {
  test('prefers the command-local cli config over default ancestors', () => {
    const root = makeCommand('default', '.dbcli')
    const child = makeCommand('cli', '/tmp/child-dbcli', root)

    expect(resolveConfigPath(child)).toBe('/tmp/child-dbcli')
  })

  test('falls back to the nearest ancestor cli config', () => {
    const root = makeCommand('cli', '/tmp/root-dbcli')
    const child = makeCommand('default', '.dbcli', root)

    expect(resolveConfigPath(child)).toBe('/tmp/root-dbcli')
  })

  test('uses fallback when no cli config is present', () => {
    const root = makeCommand('default', '.dbcli')
    const child = makeCommand('default', '.dbcli', root)

    expect(resolveConfigPath(child)).toBe('.dbcli')
  })

  test('resolves the user-global path when the root --global option is explicit', () => {
    const originalConfigHome = process.env.DBCLI_CONFIG_HOME
    const globalRoot = '/tmp/dbcli-global-config-path-test'
    process.env.DBCLI_CONFIG_HOME = globalRoot

    const root = {
      getOptionValueSource: (name: string) => (name === 'global' ? 'cli' : 'default'),
      opts: () => ({ config: '.dbcli', global: true }),
      parent: undefined,
    }
    const child = {
      getOptionValueSource: (name: string) => (name === 'global' ? 'default' : 'default'),
      opts: () => ({ config: '.dbcli' }),
      parent: root,
    }

    try {
      expect(resolveConfigPath(child as any, { config: '.dbcli' })).toBe(getGlobalConfigPath())
    } finally {
      if (originalConfigHome === undefined) delete process.env.DBCLI_CONFIG_HOME
      else process.env.DBCLI_CONFIG_HOME = originalConfigHome
    }
  })

  test('explicit --config wins over --global', () => {
    const root = makeCommand('cli', '/tmp/explicit-dbcli')
    const child = {
      getOptionValueSource: (name: string) => (name === 'global' ? 'cli' : 'default'),
      opts: () => ({ config: '.dbcli', global: true }),
      parent: root,
    }

    expect(resolveConfigPath(child as any)).toBe('/tmp/explicit-dbcli')
  })

  test('explicit options config wins over an options global selector', () => {
    expect(
      resolveConfigPath(undefined, {
        config: '/tmp/explicit-options-dbcli',
        global: true,
      })
    ).toBe('/tmp/explicit-options-dbcli')
  })
})
