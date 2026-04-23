import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test'
import {
  checkForUpdate,
  isStale,
  compareVersions,
  type VersionCheckCache,
} from '@/utils/version-check'

describe('compareVersions', () => {
  test('returns 0 when versions are equal', () => {
    expect(compareVersions('0.5.0-beta', '0.5.0-beta')).toBe(0)
  })

  test('returns positive when a > b', () => {
    expect(compareVersions('0.6.0-beta', '0.5.0-beta')).toBeGreaterThan(0)
  })

  test('returns negative when a < b', () => {
    expect(compareVersions('0.4.0-beta', '0.5.0-beta')).toBeLessThan(0)
  })

  test('handles patch version differences', () => {
    expect(compareVersions('0.5.1-beta', '0.5.0-beta')).toBeGreaterThan(0)
  })

  test('handles major version differences', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
  })

  test('handles versions without pre-release suffix', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
  })
})

describe('isStale', () => {
  test('returns true when checkedAt is more than 24 hours ago', () => {
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(isStale(twentyFiveHoursAgo)).toBe(true)
  })

  test('returns false when checkedAt is less than 24 hours ago', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
    expect(isStale(oneHourAgo)).toBe(false)
  })

  test('returns true when checkedAt is exactly 24 hours ago', () => {
    const exactlyTwentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(isStale(exactlyTwentyFourHoursAgo)).toBe(true)
  })

  test('returns true for invalid date string', () => {
    expect(isStale('invalid-date')).toBe(true)
  })
})

describe('checkForUpdate', () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  test('returns hasUpdate: true when newer version exists', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.6.0-beta' }),
    } as Response)

    const result = await checkForUpdate('0.5.0-beta', null)
    expect(result).not.toBeNull()
    expect(result?.hasUpdate).toBe(true)
    expect(result?.latestVersion).toBe('0.6.0-beta')
  })

  test('returns hasUpdate: false when already on latest', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.5.0-beta' }),
    } as Response)

    const result = await checkForUpdate('0.5.0-beta', null)
    expect(result).not.toBeNull()
    expect(result?.hasUpdate).toBe(false)
    expect(result?.latestVersion).toBe('0.5.0-beta')
  })

  test('returns null when fetch fails', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'))

    const result = await checkForUpdate('0.5.0-beta', null)
    expect(result).toBeNull()
  })

  test('returns null when response is not ok', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
    } as Response)

    const result = await checkForUpdate('0.5.0-beta', null)
    expect(result).toBeNull()
  })

  test('uses cache when cache is fresh', async () => {
    const freshCache: VersionCheckCache = {
      latestVersion: '0.6.0-beta',
      checkedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour ago
    }

    const result = await checkForUpdate('0.5.0-beta', null, freshCache)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result?.hasUpdate).toBe(true)
    expect(result?.latestVersion).toBe('0.6.0-beta')
  })

  test('fetches fresh data when cache is stale', async () => {
    const staleCache: VersionCheckCache = {
      latestVersion: '0.5.0-beta',
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25 hours ago
    }

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.6.0-beta' }),
    } as Response)

    const result = await checkForUpdate('0.5.0-beta', null, staleCache)
    expect(fetchSpy).toHaveBeenCalled()
    expect(result?.latestVersion).toBe('0.6.0-beta')
  })
})
