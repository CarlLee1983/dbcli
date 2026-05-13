export type ValueFormat = 'currency' | 'percent' | 'number'

const CURRENCY_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})
const PERCENT_FMT = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
})
const NUMBER_FMT = new Intl.NumberFormat('en-US')

export function formatValue(
  val: unknown,
  format?: ValueFormat
): string | number | null | undefined {
  if (val === null) return null
  if (val === undefined) return undefined
  if (typeof val !== 'number') return val as string
  if (format === 'currency') return CURRENCY_FMT.format(val)
  if (format === 'percent') return PERCENT_FMT.format(val / 100)
  if (format === 'number') return NUMBER_FMT.format(val)
  return val
}
