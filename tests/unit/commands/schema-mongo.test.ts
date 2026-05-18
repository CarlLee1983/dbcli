import { describe, test, expect } from 'bun:test'
import { schemaCommand } from '@/commands/schema'

describe('schema command options', () => {
  test('declares --sample-method', () => {
    const opt = schemaCommand.options.find((o) => o.long === '--sample-method')
    expect(opt).toBeDefined()
    expect(opt?.description).toMatch(/random|natural/)
  })

  test('keeps --sample-size', () => {
    expect(schemaCommand.options.find((o) => o.long === '--sample-size')).toBeDefined()
  })
})
