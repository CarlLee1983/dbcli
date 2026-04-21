import { describe, expect, test } from 'bun:test'
import { resolveConfigPath } from '@/utils/config-path'

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
})
