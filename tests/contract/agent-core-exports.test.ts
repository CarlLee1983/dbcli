import { expect, test } from 'bun:test'
import * as agentCore from '@/agent-core/public'
import type {
  AppliedLimitMetadata,
  AppliedLimitResult,
  ConnectionSelectorInputs,
} from '@/agent-core/public'

test('agent-core runtime interface is exact', () => {
  expect(Object.keys(agentCore).sort()).toEqual([
    'loadEnvFile',
    'parseConnectionNames',
    'resolveConnectionSelector',
    'resolveEnvRef',
    'trimAppliedLimit',
  ])
})

test('agent-core type interface is importable', () => {
  const metadata: AppliedLimitMetadata = { truncated: false, limitApplied: 10 }
  const result: AppliedLimitResult<number> = { rows: [1], metadata }
  const inputs: ConnectionSelectorInputs = { command: 'primary' }
  expect({ result, inputs }).toBeDefined()
})
