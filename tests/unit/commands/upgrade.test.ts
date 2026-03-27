import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatUpgradeMessage, formatAlreadyUpToDate, formatUpdateHint } from '@/commands/upgrade'

describe('formatAlreadyUpToDate', () => {
  test('includes current version in message', () => {
    const msg = formatAlreadyUpToDate('0.5.0-beta')
    expect(msg).toContain('0.5.0-beta')
    expect(msg).toContain('up to date')
  })
})

describe('formatUpgradeMessage', () => {
  test('includes current and latest version', () => {
    const msg = formatUpgradeMessage('0.5.0-beta', '0.6.0-beta')
    expect(msg).toContain('0.5.0-beta')
    expect(msg).toContain('0.6.0-beta')
  })
})

describe('formatUpdateHint', () => {
  test('includes latest version and upgrade command', () => {
    const hint = formatUpdateHint('0.6.0-beta')
    expect(hint).toContain('0.6.0-beta')
    expect(hint).toContain('dbcli upgrade')
  })
})
