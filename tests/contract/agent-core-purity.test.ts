import { describe, expect, test } from 'bun:test'
import { findAgentCorePurityViolations } from '../../scripts/check-agent-core-purity'

describe('agent-core purity gate', () => {
  test.each([
    ["import 'commander'", 'commander'],
    ["export { x } from '@/core/config'", '@/core/config'],
    ["const module = await import('../adapters')", '../adapters'],
    ["const module = require('@/utils/errors')", '@/utils/errors'],
  ])('rejects %s', (source, specifier) => {
    expect(findAgentCorePurityViolations(source, 'fixture.ts')).toContain(
      `fixture.ts: forbidden dependency '${specifier}'`
    )
  })

  test('allows local modules and platform APIs', () => {
    const source = "import { ConfigError } from './errors'\nimport { join } from 'node:path'"
    expect(findAgentCorePurityViolations(source, 'fixture.ts')).toEqual([])
  })
})
