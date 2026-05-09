import type { ApplyResult } from './apply-types'

export function renderApplyJson(result: ApplyResult): string {
  return JSON.stringify(result, null, 2)
}
