import { Option } from 'commander'

export const CONNECTION_SELECTOR_DESCRIPTION =
  'Use a specific named connection for this invocation (v2 config)'

export function createConnectionSelectorOption(): Option {
  return new Option('--use <connection>', CONNECTION_SELECTOR_DESCRIPTION)
}

export interface ConnectionSelectorInputs {
  root?: string
  command?: string
  environment?: string
}

/** Resolve one invocation-scoped selector without touching the persisted default. */
export function resolveConnectionSelector(inputs: ConnectionSelectorInputs): string | undefined {
  if (inputs.root !== undefined && inputs.command !== undefined && inputs.root !== inputs.command) {
    throw new Error(
      `Conflicting connection selectors: root --use '${inputs.root}' does not match command --use '${inputs.command}'`
    )
  }

  const explicit = inputs.command ?? inputs.root
  if (explicit !== undefined) return explicit

  const environment = inputs.environment?.trim()
  return environment ? environment : undefined
}

/** Parse an explicit invocation selector into ordered, unique connection names. */
export function parseConnectionNames(selector: string): string[] {
  const names = selector.split(',').map((name) => name.trim())
  if (names.some((name) => name === '')) {
    throw new Error('Connection selector contains an empty connection name')
  }

  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(`Connection selector contains duplicate connection name '${name}'`)
    }
    seen.add(name)
  }

  return names
}
