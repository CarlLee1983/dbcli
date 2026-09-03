import { test, expect, describe } from 'bun:test'
import {
  boundedDashboardDescription,
  buildDashboardDisplay,
  DashboardDisplayError,
  MAX_DISPLAY_BYTES,
  MAX_DISPLAY_STRING_BYTES,
  validateDashboardDisplay,
} from '../../../../src/core/dashboard/display'
import type { SavedQueryMeta } from '../../../../src/core/saved-queries/types'

const meta: SavedQueryMeta = {
  name: 'Daily Active Users',
  key: '@dau',
  description: 'Rolling DAU',
  params: [{ name: 'days', type: 'int', required: false, default: 30, enum: [7, 30, 90] }],
  tags: ['analytics'],
  index: 'events-*',
  target: 'events',
  verify: { query: 'SELECT count(*) FROM users', expects: '> 0' },
  visual: {
    title: 'DAU',
    kpis: [{ label: 'Users', value_column: 'users', format: 'number' }],
    charts: [{ type: 'line', title: 'Trend', x: 'day', y: ['users'] }],
  },
}

describe('buildDashboardDisplay', () => {
  test('keeps only the fields the dashboard renders', () => {
    const display = buildDashboardDisplay(meta, [{ day: '2026-09-01', users: 5 }])

    expect(display).toEqual({
      name: 'Daily Active Users',
      description: 'Rolling DAU',
      visual: {
        title: 'DAU',
        kpis: [{ label: 'Users', value_column: 'users', format: 'number' }],
        charts: [{ type: 'line', title: 'Trend', x: 'day', y: ['users'] }],
      },
    })
  })

  test('drops unused saved-query metadata from the payload', () => {
    const encoded = JSON.stringify(buildDashboardDisplay(meta, [{ day: 'd', users: 1 }]))

    for (const excluded of ['params', 'tags', 'index', 'target', 'verify', 'key', 'events-*']) {
      expect(encoded).not.toContain(excluded)
    }
  })

  test('drops KPIs and charts that reference undisplayed fields', () => {
    const redacted = buildDashboardDisplay(
      {
        name: 'Report',
        visual: {
          kpis: [
            { label: 'Users', value_column: 'users' },
            { label: 'Secret', value_column: 'password' },
          ],
          charts: [
            { type: 'line', x: 'day', y: ['users'] },
            { type: 'bar', x: 'day', y: ['users', 'password'] },
          ],
        },
      },
      [{ day: 'd', users: 1 }]
    )

    expect(redacted.visual?.kpis).toEqual([{ label: 'Users', value_column: 'users' }])
    expect(redacted.visual?.charts).toEqual([{ type: 'line', x: 'day', y: ['users'] }])
    expect(JSON.stringify(redacted)).not.toContain('password')
  })

  test('keeps existing visual definitions when there are no displayed rows', () => {
    const display = buildDashboardDisplay(meta, [])
    expect(display.visual?.kpis).toHaveLength(1)
    expect(display.visual?.charts).toHaveLength(1)
  })
})

describe('validateDashboardDisplay', () => {
  test('rejects unknown fields', () => {
    expect(() => validateDashboardDisplay({ name: 'a', sqlBody: 'SELECT 1' })).toThrow(
      DashboardDisplayError
    )
    expect(() =>
      validateDashboardDisplay({ name: 'a', visual: { title: 't', sourcePath: '/tmp/x.sql' } })
    ).toThrow(/unknown field/)
  })

  test('rejects a string over 1 KiB', () => {
    expect(() =>
      validateDashboardDisplay({ name: 'a', description: 'x'.repeat(MAX_DISPLAY_STRING_BYTES + 1) })
    ).toThrow(/1024 UTF-8 bytes/)
  })

  test('rejects an encoded object over 16 KiB', () => {
    const kpis = Array.from({ length: 40 }, (_, i) => ({
      label: `k${i}`.padEnd(512, 'x'),
      value_column: `c${i}`.padEnd(512, 'y'),
    }))

    expect(() => validateDashboardDisplay({ name: 'a', visual: { kpis } })).toThrow(
      new RegExp(`${MAX_DISPLAY_BYTES} byte limit`)
    )
  })

  test('rejects an invalid KPI format', () => {
    expect(() =>
      validateDashboardDisplay({
        name: 'a',
        visual: { kpis: [{ label: 'l', value_column: 'c', format: 'bytes' }] },
      })
    ).toThrow(/format/)
  })
})

describe('boundedDashboardDescription', () => {
  test('passes short text through unchanged', () => {
    expect(boundedDashboardDescription('SELECT 1')).toBe('SELECT 1')
  })

  test('bounds long text to the display string cap', () => {
    const bounded = boundedDashboardDescription('x'.repeat(MAX_DISPLAY_STRING_BYTES * 2))
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(MAX_DISPLAY_STRING_BYTES)
    expect(bounded.endsWith('…')).toBe(true)
    expect(() => validateDashboardDisplay({ name: 'a', description: bounded })).not.toThrow()
  })

  test('never splits a multi-byte character', () => {
    const bounded = boundedDashboardDescription('連'.repeat(MAX_DISPLAY_STRING_BYTES))
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(MAX_DISPLAY_STRING_BYTES)
    expect(bounded).not.toContain('�')
  })
})
