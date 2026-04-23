// tests/commands/shell.test.ts
import { describe, test, expect } from 'bun:test'
import { shellCommand } from '../../src/commands/shell'

describe('shellCommand', () => {
  test('is a Commander command', () => {
    expect(shellCommand.name()).toBe('shell')
  })

  test('has --sql option', () => {
    const opts = shellCommand.options
    const sqlOpt = opts.find((o) => o.long === '--sql')
    expect(sqlOpt).toBeDefined()
  })

  test('has description', () => {
    expect(shellCommand.description()).toBeTruthy()
  })
})
