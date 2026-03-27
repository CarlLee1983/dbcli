import { describe, test, expect } from 'bun:test'
import {
  parseVersionSegments,
  isMariaDBVersion,
  extractMariaDBVersion,
  compareVersions,
  checkDbVersion,
} from '@/utils/db-version-check'

describe('parseVersionSegments', () => {
  test('parses standard version', () => {
    expect(parseVersionSegments('8.0.35')).toEqual([8, 0, 35])
  })

  test('parses two-part version', () => {
    expect(parseVersionSegments('15.4')).toEqual([15, 4])
  })

  test('parses version with suffix', () => {
    expect(parseVersionSegments('10.11.6-MariaDB')).toEqual([10, 11, 6])
  })

  test('parses version with complex suffix', () => {
    expect(parseVersionSegments('15.4 (Ubuntu 15.4-1.pgdg22.04+1)')).toEqual([15, 4])
  })

  test('returns empty for non-version string', () => {
    expect(parseVersionSegments('unknown')).toEqual([])
  })
})

describe('isMariaDBVersion', () => {
  test('detects MariaDB', () => {
    expect(isMariaDBVersion('10.11.6-MariaDB')).toBe(true)
  })

  test('detects MariaDB with prefix', () => {
    expect(isMariaDBVersion('5.5.5-10.11.6-MariaDB-1:10.11.6+maria~ubu2204')).toBe(true)
  })

  test('returns false for MySQL', () => {
    expect(isMariaDBVersion('8.0.35')).toBe(false)
  })

  test('returns false for PostgreSQL', () => {
    expect(isMariaDBVersion('15.4')).toBe(false)
  })
})

describe('extractMariaDBVersion', () => {
  test('extracts from standard MariaDB string', () => {
    expect(extractMariaDBVersion('10.11.6-MariaDB')).toBe('10.11.6')
  })

  test('extracts from prefixed MariaDB string', () => {
    expect(extractMariaDBVersion('5.5.5-10.11.6-MariaDB-1:10.11.6+maria~ubu2204')).toBe('10.11.6')
  })

  test('falls back to input for unrecognized format', () => {
    expect(extractMariaDBVersion('10.5.0')).toBe('10.5.0')
  })
})

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    expect(compareVersions('8.0.35', '8.0.35')).toBe(0)
  })

  test('greater major version is positive', () => {
    expect(compareVersions('9.0.0', '8.0.0')).toBeGreaterThan(0)
  })

  test('lesser minor version is negative', () => {
    expect(compareVersions('8.0.0', '8.1.0')).toBeLessThan(0)
  })

  test('handles different segment lengths', () => {
    expect(compareVersions('12.0', '12.0.0')).toBe(0)
  })

  test('12.0 >= 12.0 is true', () => {
    expect(compareVersions('12.0', '12.0')).toBeGreaterThanOrEqual(0)
  })

  test('11.9 < 12.0', () => {
    expect(compareVersions('11.9', '12.0')).toBeLessThan(0)
  })
})

describe('checkDbVersion', () => {
  test('MySQL 8.0.35 is supported', () => {
    const result = checkDbVersion('8.0.35', 'mysql')
    expect(result.supported).toBe(true)
    expect(result.system).toBe('mysql')
    expect(result.serverVersion).toBe('8.0.35')
  })

  test('MySQL 5.7.44 is unsupported', () => {
    const result = checkDbVersion('5.7.44', 'mysql')
    expect(result.supported).toBe(false)
    expect(result.system).toBe('mysql')
  })

  test('PostgreSQL 15.4 is supported', () => {
    const result = checkDbVersion('15.4', 'postgresql')
    expect(result.supported).toBe(true)
    expect(result.system).toBe('postgresql')
  })

  test('PostgreSQL 11.22 is unsupported', () => {
    const result = checkDbVersion('11.22', 'postgresql')
    expect(result.supported).toBe(false)
  })

  test('PostgreSQL 12.0 is supported (boundary)', () => {
    const result = checkDbVersion('12.0', 'postgresql')
    expect(result.supported).toBe(true)
  })

  test('MariaDB detected from version string overrides declared system', () => {
    const result = checkDbVersion('10.11.6-MariaDB', 'mysql')
    expect(result.system).toBe('mariadb')
    expect(result.serverVersion).toBe('10.11.6')
    expect(result.supported).toBe(true)
  })

  test('MariaDB 10.4 is unsupported', () => {
    const result = checkDbVersion('10.4.32-MariaDB', 'mysql')
    expect(result.supported).toBe(false)
    expect(result.system).toBe('mariadb')
  })

  test('MariaDB 10.5.0 is supported (boundary)', () => {
    const result = checkDbVersion('10.5.0-MariaDB', 'mariadb')
    expect(result.supported).toBe(true)
  })

  test('MariaDB with 5.5.5 prefix is correctly parsed', () => {
    const result = checkDbVersion('5.5.5-10.11.6-MariaDB-1:10.11.6+maria~ubu2204', 'mysql')
    expect(result.system).toBe('mariadb')
    expect(result.serverVersion).toBe('10.11.6')
    expect(result.supported).toBe(true)
  })
})
