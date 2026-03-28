// src/core/repl/meta-commands.ts
import type { MetaCommandResult, OutputFormat, ReplState } from './types'
import pc from 'picocolors'

const VALID_FORMATS: readonly OutputFormat[] = ['table', 'json', 'csv']

export function handleMetaCommand(
  input: string,
  state: ReplState,
  history: readonly string[]
): MetaCommandResult {
  const parts = input.trim().split(/\s+/)
  const cmd = parts[0]
  const arg = parts[1]

  switch (cmd) {
    case '.help':
      return { action: 'continue', output: helpText() }

    case '.quit':
    case '.exit':
      return { action: 'quit' }

    case '.clear':
      return { action: 'clear' }

    case '.format':
      return handleFormat(arg, state)

    case '.timing':
      return handleTiming(arg, state)

    case '.history':
      return handleHistory(history)

    default:
      return {
        action: 'continue',
        output: `Unknown command: ${cmd}. Type ${pc.bold('.help')} for available commands.`,
      }
  }
}

function helpText(): string {
  const lines = [
    pc.bold('Meta Commands:'),
    `  ${pc.cyan('.help')}                Show this help`,
    `  ${pc.cyan('.quit')} / ${pc.cyan('.exit')}      Exit the shell`,
    `  ${pc.cyan('.clear')}               Clear the screen`,
    `  ${pc.cyan('.format')} <table|json|csv>  Set output format`,
    `  ${pc.cyan('.history')}             Show command history`,
    `  ${pc.cyan('.timing')} <on|off>     Toggle execution time display`,
    '',
    pc.bold('Usage:'),
    `  SQL statements     Execute directly (end with ${pc.cyan(';')})`,
    `  dbcli commands     Run without ${pc.dim('dbcli')} prefix (e.g. ${pc.cyan('schema users')})`,
    `  Ctrl+D             Exit`,
  ]
  return lines.join('\n')
}

function handleFormat(arg: string | undefined, state: ReplState): MetaCommandResult {
  if (!arg) {
    return {
      action: 'continue',
      output: `Current format: ${pc.bold(state.format)}`,
    }
  }

  if (!VALID_FORMATS.includes(arg as OutputFormat)) {
    return {
      action: 'continue',
      output: `Invalid format. Valid options: ${VALID_FORMATS.join(', ')}`,
    }
  }

  return {
    action: 'continue',
    output: `Output format set to ${pc.bold(arg)}`,
    stateUpdate: { format: arg as OutputFormat },
  }
}

function handleTiming(arg: string | undefined, state: ReplState): MetaCommandResult {
  if (!arg) {
    return {
      action: 'continue',
      output: `Timing is ${pc.bold(state.timing ? 'on' : 'off')}`,
    }
  }

  if (arg === 'on') {
    return {
      action: 'continue',
      output: `Timing ${pc.bold('on')}`,
      stateUpdate: { timing: true },
    }
  }

  if (arg === 'off') {
    return {
      action: 'continue',
      output: `Timing ${pc.bold('off')}`,
      stateUpdate: { timing: false },
    }
  }

  return {
    action: 'continue',
    output: `Usage: .timing <on|off>`,
  }
}

function handleHistory(history: readonly string[]): MetaCommandResult {
  if (history.length === 0) {
    return { action: 'continue', output: pc.dim('No history yet.') }
  }

  const lines = history.map((entry, i) =>
    `  ${pc.dim(String(i + 1).padStart(4))}  ${entry}`
  )
  return { action: 'continue', output: lines.join('\n') }
}
