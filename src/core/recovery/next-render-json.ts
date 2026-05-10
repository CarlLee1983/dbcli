import type { NextResult } from './next-types'

export function renderNextJson(result: NextResult): string {
  return JSON.stringify(result, null, 2)
}
