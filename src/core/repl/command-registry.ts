// src/core/repl/command-registry.ts
// Pure derivation of REPL-visible command names from the CLI command surface.
// No module-level state: callers build the snapshot once (in shell.ts) and pass
// it explicitly through ReplContext into createCompleter() / isKnownCommand().

// Commands that are unsafe or nonsensical to dispatch from inside the REPL.
// `shell` is excluded to prevent recursive shell launches.
export const REPL_DENYLIST: ReadonlySet<string> = new Set(['shell'])

/**
 * Filter a top-level command list down to the REPL-visible set, dropping any
 * denylisted command. Pure — the same input always yields the same snapshot.
 */
export function deriveReplCommandNames(topLevel: readonly string[]): readonly string[] {
  return topLevel.filter((n) => !REPL_DENYLIST.has(n))
}
