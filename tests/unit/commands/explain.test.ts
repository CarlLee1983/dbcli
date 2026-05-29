import { test, expect } from 'bun:test'
import { explainCommand } from '@/commands/explain'

test('explainCommand: exports a commander Command named "explain"', () => {
  expect(explainCommand.name()).toBe('explain')
})

test('explainCommand: has --analyze flag', () => {
  const opt = explainCommand.options.find((o) => o.long === '--analyze')
  expect(opt).toBeDefined()
})

test('explainCommand: has --format flag with default markdown', () => {
  const opt = explainCommand.options.find((o) => o.long === '--format')
  expect(opt).toBeDefined()
  expect(opt?.defaultValue).toBe('markdown')
})

test('explainCommand: has --bulk flag', () => {
  const opt = explainCommand.options.find((o) => o.long === '--bulk')
  expect(opt).toBeDefined()
})
