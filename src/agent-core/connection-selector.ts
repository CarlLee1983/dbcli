export interface ConnectionSelectorInputs {
  root?: string
  command?: string
  environment?: string
}

/** Resolve one invocation-scoped selector without changing persisted state. */
export function resolveConnectionSelector(inputs: ConnectionSelectorInputs): string | undefined {
  if (inputs.root !== undefined && inputs.command !== undefined && inputs.root !== inputs.command) {
    throw new Error(
      `Conflicting connection selectors: root value '${inputs.root}' does not match command value '${inputs.command}'`
    )
  }

  const explicit = inputs.command ?? inputs.root
  if (explicit !== undefined) return explicit

  const environment = inputs.environment?.trim()
  return environment ? environment : undefined
}

/** Parse a comma-separated selector into ordered, unique names. */
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
