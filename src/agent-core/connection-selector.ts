export interface ConnectionSelectorInputs {
  root?: string
  command?: string
  environment?: string
}

function normalizeSelector(value: string | undefined, source: string): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (normalized === '') {
    throw new Error(`${source} connection selector cannot be empty`)
  }
  return normalized
}

/** Resolve one invocation-scoped selector without changing persisted state. */
export function resolveConnectionSelector(inputs: ConnectionSelectorInputs): string | undefined {
  const root = normalizeSelector(inputs.root, 'Root')
  const command = normalizeSelector(inputs.command, 'Command')

  if (root !== undefined && command !== undefined && root !== command) {
    throw new Error(
      `Conflicting connection selectors: root value '${root}' does not match command value '${command}'`
    )
  }

  const explicit = command ?? root
  if (explicit !== undefined) return explicit

  // An unset/blank ambient environment variable is equivalent to no selector;
  // explicit CLI flags, by contrast, must never degrade into a default choice.
  const environment = inputs.environment?.trim()
  return environment || undefined
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
