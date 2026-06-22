// src/core/repl/command-registry.ts
// Single source of REPL-visible command names, seeded at shell startup from the
// same Commander tree that drives installed shell completion.

// Commands that are unsafe or nonsensical to dispatch from inside the REPL.
// `shell` is excluded to prevent recursive shell launches.
export const REPL_DENYLIST: ReadonlySet<string> = new Set(['shell'])

let names: readonly string[] = []
let known: ReadonlySet<string> = new Set()

export function setReplCommandNames(input: readonly string[]): void {
  names = [...input]
  known = new Set(input.filter((n) => !REPL_DENYLIST.has(n)))
}

export function getReplCommandNames(): readonly string[] {
  return names
}

export function isReplCommandKnown(name: string): boolean {
  return known.has(name)
}
