import { test, expect, afterEach } from 'bun:test'
import { render, screen, within, cleanup } from '@testing-library/react'
import App from '../../src/ui-template/src/App'

interface DbcliWindow {
  __DBCLI_PAYLOAD__?: unknown
}

const setPayload = (payload: unknown) => {
  ;(globalThis as { window: DbcliWindow }).window.__DBCLI_PAYLOAD__ = payload
}

afterEach(() => {
  cleanup()
  ;(globalThis as { window: DbcliWindow }).window.__DBCLI_PAYLOAD__ = undefined
})

test('App renders title, KPIs, table headers, row count and null cell from payload', () => {
  setPayload({
    display: {
      name: 'Sales Report',
      description: 'Weekly snapshot',
      visual: {
        title: 'Weekly Sales',
        kpis: [
          { label: 'Total Revenue', value_column: 'revenue', format: 'currency' },
          { label: 'Orders', value_column: 'orders', format: 'number' },
        ],
        charts: [{ type: 'bar', title: 'Revenue by Day', x: 'day', y: ['revenue'] }],
      },
    },
    rows: [
      { day: 'Mon', revenue: 1200, orders: 1234, note: null },
      { day: 'Tue', revenue: 1500, orders: 4567, note: 'peak' },
    ],
  })

  render(<App />)

  // visual.title takes precedence over display.name
  expect(screen.getByText('Weekly Sales')).toBeDefined()

  // KPI labels and formatted values — KPI displays comma-formatted number,
  // table cell renders raw String(value), so '1,234' is unique to the KPI.
  expect(screen.getByText('Total Revenue')).toBeDefined()
  expect(screen.getByText('$1,200.00')).toBeDefined()
  expect(screen.getByText('Orders')).toBeDefined()
  expect(screen.getByText('1,234')).toBeDefined()

  // Table headers preserve insertion order
  const table = screen.getByRole('table')
  const headers = within(table).getAllByRole('columnheader')
  expect(headers.map((h) => h.textContent)).toEqual(['day', 'revenue', 'orders', 'note'])

  // Header row + 2 data rows
  expect(within(table).getAllByRole('row')).toHaveLength(3)

  // null cell renders as the italic 'null' span
  expect(within(table).getByText('null')).toBeDefined()
})

test('App renders gracefully when rows is empty', () => {
  setPayload({ display: { name: 'Empty', visual: {} }, rows: [] })
  expect(() => render(<App />)).not.toThrow()
})

test('App warns before presenting charts when the HTML result is truncated', () => {
  setPayload({
    display: {
      name: 'Truncated Report',
      visual: { charts: [{ type: 'bar', title: 'Partial Data', x: 'day', y: ['value'] }] },
    },
    rows: [{ day: 'Mon', value: 1 }],
    appliedLimit: { truncated: true, limitApplied: 1000 },
    securityNotification: 'Security: 1 column was omitted',
  })

  render(<App />)

  expect(screen.getByRole('alert').textContent).toContain('truncated')
  expect(screen.getByRole('alert').textContent).toContain('1000')
  expect(screen.getByRole('status').textContent).toContain('1 column was omitted')
})

test('App shows an unsupported-chart placeholder instead of a pie chart for unknown types', () => {
  setPayload({
    display: {
      name: 'Unknown Chart',
      visual: { charts: [{ type: 'scatter', title: 'Scatter', x: 'a', y: ['b'] }] },
    },
    rows: [{ a: 1, b: 2 }],
  })

  render(<App />)
  expect(screen.getByText(/Unsupported chart type/i)).toBeDefined()
})

test('App renders a pie chart type without throwing', () => {
  setPayload({
    display: {
      name: 'Pie',
      visual: { charts: [{ type: 'pie', title: 'Share', x: 'cat', y: ['val'] }] },
    },
    rows: [{ cat: 'A', val: 5 }],
  })

  expect(() => render(<App />)).not.toThrow()
})

test('App renders the traceability section without dbcli, a database, or a workspace', () => {
  setPayload({
    display: { name: 'Traceable Report' },
    rows: [{ day: 'Mon', value: 1 }],
    appliedLimit: { truncated: true, limitApplied: 500 },
    securityNotification: 'Security: 1 column was omitted',
    provenance: {
      version: 1,
      connection: { name: 'analytics', system: 'postgresql' },
      savedQuery: { key: '@dau', source: 'shared' },
      permission: 'query-only',
      limit: { state: 'applied', limitApplied: 500, truncated: true },
    },
  })

  render(<App />)

  const traceability = screen.getByLabelText('Execution traceability')
  expect(within(traceability).getByText('analytics')).toBeDefined()
  expect(within(traceability).getByText('postgresql')).toBeDefined()
  expect(within(traceability).getByText('@dau')).toBeDefined()
  expect(within(traceability).getByText('shared')).toBeDefined()
  expect(within(traceability).getByText('query-only')).toBeDefined()
  expect(within(traceability).getByText('500 rows (truncated)')).toBeDefined()

  // Existing notices still precede the KPIs, charts, and table.
  expect(screen.getByRole('alert').textContent).toContain('500')
  expect(screen.getByRole('status').textContent).toContain('1 column was omitted')
})

test('App distinguishes an execution with no applied limit', () => {
  setPayload({
    display: { name: 'Unbounded Report' },
    rows: [{ value: 1 }],
    provenance: {
      version: 1,
      connection: { name: 'default', system: 'mysql' },
      savedQuery: { key: '@all', source: 'local' },
      permission: 'read-write',
      limit: { state: 'not-applied', truncated: false },
    },
  })

  render(<App />)
  expect(
    within(screen.getByLabelText('Execution traceability')).getByText('No limit applied')
  ).toBeDefined()
})

test('App omits the traceability section for direct-query dashboards', () => {
  setPayload({ display: { name: 'Query Results' }, rows: [{ value: 1 }] })

  render(<App />)
  expect(screen.queryByLabelText('Execution traceability')).toBeNull()
})
