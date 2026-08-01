import { expect, test } from 'bun:test'
import { resolveEnvRef } from '@/agent-core/public'

test('resolveEnvRef returns literal values unchanged', () => {
  expect(resolveEnvRef('literal', 'password', {})).toBe('literal')
})

test('resolveEnvRef resolves a present environment reference', () => {
  expect(resolveEnvRef({ $env: 'TOKEN' }, 'password', { TOKEN: 'secret' })).toBe('secret')
})

test('resolveEnvRef reports the missing variable and field', () => {
  expect(() => resolveEnvRef({ $env: 'MISSING_TOKEN' }, 'password', {})).toThrow(
    /MISSING_TOKEN.*password/s
  )
})

test('resolveEnvRef distinguishes an empty value from an undefined variable', () => {
  expect(resolveEnvRef({ $env: 'EMPTY_TOKEN' }, 'password', { EMPTY_TOKEN: '' })).toBe('')
  expect(() =>
    resolveEnvRef({ $env: 'EMPTY_TOKEN' }, 'password', { EMPTY_TOKEN: undefined })
  ).toThrow('EMPTY_TOKEN')
})
