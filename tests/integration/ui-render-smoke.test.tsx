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
    meta: {
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

  // visual.title takes precedence over meta.name
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
  setPayload({ meta: { name: 'Empty', visual: {} }, rows: [] })
  expect(() => render(<App />)).not.toThrow()
})

test('App shows an unsupported-chart placeholder instead of a pie chart for unknown types', () => {
  setPayload({
    meta: {
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
    meta: {
      name: 'Pie',
      visual: { charts: [{ type: 'pie', title: 'Share', x: 'cat', y: ['val'] }] },
    },
    rows: [{ cat: 'A', val: 5 }],
  })

  expect(() => render(<App />)).not.toThrow()
})
