/**
 * Dashboard display projection (DBCLI-006)
 *
 * The dashboard used to serialize the whole `SavedQueryMeta` into the shared
 * HTML file, which carried parameter defaults and enums, the target index or
 * collection, and the verification query and expectation into a file the
 * dashboard never rendered them in. This module is the allowlist: only what
 * the dashboard actually draws survives into the payload.
 */

import type { SavedQueryMeta, VisualConfig } from '../saved-queries/types'
import { utf8ByteLength } from './provenance'

/** Encoded display metadata upper bound, in UTF-8 bytes. */
export const MAX_DISPLAY_BYTES = 16 * 1024
/** Per-string upper bound, in UTF-8 bytes. */
export const MAX_DISPLAY_STRING_BYTES = 1024

export const KPI_FORMATS = ['currency', 'number', 'percent'] as const

export interface DashboardDisplayKpi {
  label: string
  value_column: string
  format?: (typeof KPI_FORMATS)[number]
}

export interface DashboardDisplayChart {
  type: string
  title?: string
  x: string
  y: string[]
}

export interface DashboardDisplayVisual {
  title?: string
  kpis?: DashboardDisplayKpi[]
  charts?: DashboardDisplayChart[]
}

export interface DashboardDisplay {
  name: string
  description?: string
  visual?: DashboardDisplayVisual
}

export class DashboardDisplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DashboardDisplayError'
    Object.setPrototypeOf(this, DashboardDisplayError.prototype)
  }
}

function fail(message: string): never {
  throw new DashboardDisplayError(message)
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`Dashboard display ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function rejectUnknownKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string
): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    fail(`Dashboard display ${path} has unknown field(s): ${unknown.sort().join(', ')}`)
  }
}

function boundedString(value: unknown, path: string, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    fail(`Dashboard display ${path} must be a non-empty string`)
  }
  if (utf8ByteLength(value) > MAX_DISPLAY_STRING_BYTES) {
    fail(`Dashboard display ${path} exceeds ${MAX_DISPLAY_STRING_BYTES} UTF-8 bytes`)
  }
  return value
}

/**
 * The set of fields a recipient can actually see in the table. Charts and KPIs
 * pointing anywhere else are dropped: a redacted column must not survive as a
 * chart axis label after its values were removed.
 */
function displayedFields(rows: readonly Record<string, unknown>[]): Set<string> {
  const fields = new Set<string>()
  for (const row of rows) for (const key of Object.keys(row)) fields.add(key)
  return fields
}

function keepsVisualDefinition(fields: Set<string> | undefined, referenced: string[]): boolean {
  // With no displayed rows there are no fields to check against and nothing
  // was redacted out of them, so existing definitions render as they did.
  if (fields === undefined) return true
  return referenced.every((field) => fields.has(field))
}

function projectVisual(
  visual: VisualConfig | undefined,
  fields: Set<string> | undefined
): DashboardDisplayVisual | undefined {
  if (!visual) return undefined

  const kpis = (visual.kpis ?? []).filter((kpi) =>
    keepsVisualDefinition(fields, [kpi.value_column])
  )
  const charts = (visual.charts ?? []).filter((chart) =>
    keepsVisualDefinition(fields, [chart.x, ...chart.y])
  )

  const projected: DashboardDisplayVisual = {
    ...(visual.title !== undefined ? { title: visual.title } : {}),
    ...(kpis.length > 0
      ? {
          kpis: kpis.map((kpi) => ({
            label: kpi.label,
            value_column: kpi.value_column,
            ...(kpi.format !== undefined ? { format: kpi.format } : {}),
          })),
        }
      : {}),
    ...(charts.length > 0
      ? {
          charts: charts.map((chart) => ({
            type: chart.type,
            ...(chart.title !== undefined ? { title: chart.title } : {}),
            x: chart.x,
            y: [...chart.y],
          })),
        }
      : {}),
  }

  return Object.keys(projected).length > 0 ? projected : undefined
}

/**
 * Project saved-query metadata onto the displayable allowlist. Fields the
 * dashboard never renders are dropped here rather than filtered downstream.
 */
export function buildDashboardDisplay(
  meta: Pick<SavedQueryMeta, 'name' | 'description' | 'visual'>,
  rows: readonly Record<string, unknown>[]
): DashboardDisplay {
  const fields = rows.length > 0 ? displayedFields(rows) : undefined
  const visual = projectVisual(meta.visual, fields)

  return validateDashboardDisplay({
    name: meta.name,
    ...(meta.description !== undefined ? { description: meta.description } : {}),
    ...(visual ? { visual } : {}),
  })
}

function validateKpi(input: unknown, index: number): DashboardDisplayKpi {
  const path = `visual.kpis[${index}]`
  const kpi = asObject(input, path)
  rejectUnknownKeys(kpi, ['label', 'value_column', 'format'], path)
  if (kpi.format !== undefined && !(KPI_FORMATS as readonly unknown[]).includes(kpi.format)) {
    fail(`Dashboard display ${path}.format must be one of: ${KPI_FORMATS.join(', ')}`)
  }
  return {
    label: boundedString(kpi.label, `${path}.label`),
    value_column: boundedString(kpi.value_column, `${path}.value_column`),
    ...(kpi.format !== undefined ? { format: kpi.format as DashboardDisplayKpi['format'] } : {}),
  }
}

function validateChart(input: unknown, index: number): DashboardDisplayChart {
  const path = `visual.charts[${index}]`
  const chart = asObject(input, path)
  rejectUnknownKeys(chart, ['type', 'title', 'x', 'y'], path)
  if (!Array.isArray(chart.y) || chart.y.length === 0) {
    fail(`Dashboard display ${path}.y must be a non-empty array`)
  }
  return {
    type: boundedString(chart.type, `${path}.type`),
    ...(chart.title !== undefined
      ? { title: boundedString(chart.title, `${path}.title`, { allowEmpty: true }) }
      : {}),
    x: boundedString(chart.x, `${path}.x`),
    y: chart.y.map((series, i) => boundedString(series, `${path}.y[${i}]`)),
  }
}

function validateVisual(input: unknown): DashboardDisplayVisual {
  const visual = asObject(input, 'visual')
  rejectUnknownKeys(visual, ['title', 'kpis', 'charts'], 'visual')

  if (visual.kpis !== undefined && !Array.isArray(visual.kpis)) {
    fail('Dashboard display visual.kpis must be an array')
  }
  if (visual.charts !== undefined && !Array.isArray(visual.charts)) {
    fail('Dashboard display visual.charts must be an array')
  }

  return {
    ...(visual.title !== undefined
      ? { title: boundedString(visual.title, 'visual.title', { allowEmpty: true }) }
      : {}),
    ...(visual.kpis !== undefined
      ? { kpis: (visual.kpis as unknown[]).map((kpi, index) => validateKpi(kpi, index)) }
      : {}),
    ...(visual.charts !== undefined
      ? {
          charts: (visual.charts as unknown[]).map((chart, index) => validateChart(chart, index)),
        }
      : {}),
  }
}

/**
 * Validate untrusted display metadata into the closed allowlist shape.
 * Throws before any HTML is written.
 */
export function validateDashboardDisplay(input: unknown): DashboardDisplay {
  const raw = asObject(input, 'payload')
  rejectUnknownKeys(raw, ['name', 'description', 'visual'], 'payload')

  const display: DashboardDisplay = {
    name: boundedString(raw.name, 'name'),
    ...(raw.description !== undefined
      ? { description: boundedString(raw.description, 'description', { allowEmpty: true }) }
      : {}),
    ...(raw.visual !== undefined ? { visual: validateVisual(raw.visual) } : {}),
  }

  const encodedBytes = utf8ByteLength(JSON.stringify(display))
  if (encodedBytes > MAX_DISPLAY_BYTES) {
    fail(
      `Dashboard display encodes to ${encodedBytes} bytes, over the ${MAX_DISPLAY_BYTES} byte limit`
    )
  }

  return display
}

const DESCRIPTION_ELLIPSIS = '…'

/**
 * Direct-query dashboards put the executed statement in the description. A
 * statement longer than the display cap must not turn an export into a hard
 * failure, so bound it here rather than reject it downstream.
 */
export function boundedDashboardDescription(text: string): string {
  if (utf8ByteLength(text) <= MAX_DISPLAY_STRING_BYTES) return text

  const budget = MAX_DISPLAY_STRING_BYTES - utf8ByteLength(DESCRIPTION_ELLIPSIS)
  let used = 0
  let kept = ''
  for (const char of text) {
    const size = utf8ByteLength(char)
    if (used + size > budget) break
    used += size
    kept += char
  }
  return kept + DESCRIPTION_ELLIPSIS
}
