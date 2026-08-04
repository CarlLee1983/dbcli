import { describe, expect, test } from 'bun:test'
import { inferRuntimeSource } from '@/utils/runtime-info'

describe('inferRuntimeSource', () => {
  const packageRoot = '/workspace/dbcli'

  test('recognizes workspace launchers', () => {
    expect(inferRuntimeSource('/workspace/dbcli/src/cli.ts', packageRoot)).toBe('workspace')
    expect(inferRuntimeSource('/workspace/dbcli/scripts/release.ts', packageRoot)).toBe('workspace')
  })

  test('recognizes installed launchers', () => {
    expect(inferRuntimeSource('/workspace/dbcli/dist/cli.js', packageRoot)).toBe('installed')
  })

  test('recognizes bunx launchers before package-root classification', () => {
    expect(inferRuntimeSource('/tmp/.bunx/dbcli/dist/cli.js', packageRoot)).toBe('bunx')
    expect(
      inferRuntimeSource(
        '/Users/test/.bun/install/cache/pkg/dist/cli.mjs',
        '/Users/test/.bun/install/cache/pkg'
      )
    ).toBe('bunx')
  })

  test('returns unknown for launchers outside known layouts', () => {
    expect(inferRuntimeSource('/usr/local/bin/dbcli', packageRoot)).toBe('unknown')
  })
})
