import { expect, test } from 'bun:test'
import * as agentCore from '@/agent-core/public'
import type {
  AppliedLimitMetadata,
  AppliedLimitResult,
  ConnectionSelectorInputs,
  EnvReference,
} from '@/agent-core/public'
import { ConfigError, resolveEnvRef } from '@/agent-core/public'

test('agent-core runtime interface is exact', () => {
  expect(Object.keys(agentCore).sort()).toEqual([
    'ConfigError',
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
  const reference: EnvReference = { $env: 'DBCLI_PRIMARY_PASSWORD' }
  expect({ result, inputs, reference }).toBeDefined()
})

test('downstream tools can narrow env-reference failures by type', () => {
  expect(() => resolveEnvRef({ $env: 'DBCLI_ABSENT_FIXTURE' }, 'password', {})).toThrow(ConfigError)
})
