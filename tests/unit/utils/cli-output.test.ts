import { describe, expect, test } from 'bun:test'
import { Command } from 'commander'
import { isMachineReadableCommand } from '@/utils/cli-output'

describe('isMachineReadableCommand', () => {
  test('classifies json output as machine-readable', () => {
    const command = new Command('query')
      .option('--format <format>')
      .setOptionValue('format', 'json')
    expect(isMachineReadableCommand(command)).toBe(true)
  })

  test('keeps text and table output human-readable', () => {
    const command = new Command('list')
      .option('--format <format>')
      .setOptionValue('format', 'table')
    expect(isMachineReadableCommand(command)).toBe(false)
  })

  test('recognizes agent and recovery modes even without a format option', () => {
    const agent = new Command('guide').option('--for-agent').setOptionValue('forAgent', true)
    const recovery = new Command('query').option('--recovery').setOptionValue('recovery', true)
    expect(isMachineReadableCommand(agent)).toBe(true)
    expect(isMachineReadableCommand(recovery)).toBe(true)
  })

  test('walks parent commands for inherited machine output options', () => {
    const root = new Command('root').option('--format <format>').setOptionValue('format', 'json')
    const child = root.command('child')
    expect(isMachineReadableCommand(child, root)).toBe(true)
  })
})
