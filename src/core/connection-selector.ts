import { Option } from 'commander'
export { resolveConnectionSelector, parseConnectionNames } from '@/agent-core/connection-selector'
export type { ConnectionSelectorInputs } from '@/agent-core/connection-selector'

export const CONNECTION_SELECTOR_DESCRIPTION =
  'Use a specific named connection for this invocation (v2 config)'

export function createConnectionSelectorOption(): Option {
  return new Option('--use <connection>', CONNECTION_SELECTOR_DESCRIPTION)
}
