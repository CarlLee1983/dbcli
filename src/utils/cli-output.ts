import type { Command } from 'commander'

const HUMAN_FORMATS = new Set(['text', 'table'])

/** Machine-oriented output must not receive update or skill reminders. */
export function isMachineReadableCommand(actionCommand: Command, rootCommand?: Command): boolean {
  for (
    let current: Command | undefined = actionCommand;
    current;
    current = current.parent ?? undefined
  ) {
    const options = current.opts<Record<string, unknown>>()
    if (options.forAgent === true || options.recovery === true) return true
    if (typeof options.format === 'string' && !HUMAN_FORMATS.has(options.format)) return true
  }

  if (rootCommand) {
    const options = rootCommand.opts<Record<string, unknown>>()
    if (options.agentOutput === true || options.forAgent === true || options.recovery === true)
      return true
    if (typeof options.format === 'string' && !HUMAN_FORMATS.has(options.format)) return true
  }
  return false
}
