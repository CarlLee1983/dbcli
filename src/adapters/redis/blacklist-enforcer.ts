import { getCommandSpec } from './command-metadata'
import type { KeyArity } from './types'
import { globToRegex } from '@/utils/glob'

export { globToRegex }

/** Heuristic intersection probe — sound for `prefix:*`, literals, and most agent-written rules. */
export function patternsOverlap(a: string, b: string): boolean {
  const ra = globToRegex(a)
  const rb = globToRegex(b)
  const probeA = sampleFromGlob(a)
  const probeB = sampleFromGlob(b)
  if (probeA !== null && rb.test(probeA)) return true
  if (probeB !== null && ra.test(probeB)) return true
  return false
}

function sampleFromGlob(glob: string): string | null {
  let s = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') s += '__star__'
    else if (c === '?') s += 'x'
    else if (c === '[') {
      const end = glob.indexOf(']', i)
      if (end === -1) return null
      const first = glob[i + 1]
      if (!first) return null
      s += first
      i = end
    } else s += c
  }
  return s
}

export interface CheckResult {
  ok: boolean
  matchedKey?: string | null
  matchedPattern?: string
}

export function checkKeyArgs(command: string, args: string[], rules: string[]): CheckResult {
  if (rules.length === 0) return { ok: true }
  const spec = getCommandSpec(command)
  if (!spec) {
    // Fail-closed. This used to `return { ok: true }`, and the metadata table
    // was maintained separately from the permission map, so every command the
    // one allowed and the other had never heard of reached the server with its
    // keys unchecked — `LPOP secrets:list` destroys a blacklisted key and hands
    // back its value at `read-write`, `XRANGE secrets:stream - +` reads one at
    // `query-only`.
    //
    // Reachable only with a blacklist configured (the empty-rules case returned
    // above), so a user who protects nothing is not refused anything. What it
    // costs a user who does: a command dbcli has no spec for is refused, and the
    // refusal says so. `command-table-parity.test.ts` keeps that set empty.
    return {
      ok: false,
      matchedKey: null,
      matchedPattern: `${command.toUpperCase()} (no key-arity spec; refused because a blacklist is configured)`,
    }
  }

  const keyIndexes = expandKeyArity(spec.keyArity, args, args.length)
  for (const idx of keyIndexes) {
    const key = args[idx]
    if (key === undefined) continue
    for (const pat of rules) {
      if (globToRegex(pat).test(key)) {
        return { ok: false, matchedKey: key, matchedPattern: pat }
      }
    }
  }

  const userPat = userPattern(spec.keyArity, args)
  if (userPat !== undefined) {
    for (const pat of rules) {
      if (patternsOverlap(userPat, pat)) {
        return { ok: false, matchedKey: null, matchedPattern: pat }
      }
    }
  }
  return { ok: true }
}

/** The glob the *user* wrote, for the commands that take one. */
function userPattern(arity: KeyArity, args: string[]): string | undefined {
  if (arity.kind === 'pattern') return args[arity.argIndex]
  if (arity.kind === 'pattern-after-token') {
    // Case-insensitive, because Redis reads the option name that way — and an
    // uppercase-only match would have made `scan 0 match secrets:*` the bypass.
    const marker = args.findIndex((arg) => arg.toUpperCase() === arity.token)
    return marker === -1 ? undefined : args[marker + 1]
  }
  return undefined
}

function expandKeyArity(arity: KeyArity, args: string[], argCount: number): number[] {
  switch (arity.kind) {
    case 'no-key':
    case 'pattern':
    case 'pattern-after-token':
      return []
    case 'single':
      return [arity.argIndex]
    case 'multi-fixed':
      return arity.argIndices
    case 'multi-variable': {
      const indices: number[] = []
      for (let i = arity.startIndex; i < argCount; i += arity.step) indices.push(i)
      return indices
    }
    case 'after-token': {
      const marker = args.findIndex((arg) => arg.toUpperCase() === arity.token)
      if (marker === -1) return []
      const indices: number[] = []
      for (let i = marker + 1; i < argCount; i += 1) indices.push(i)
      return indices
    }
  }
}
