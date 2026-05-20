import { getCommandSpec } from './command-metadata'
import type { KeyArity } from './types'

/** Convert Redis-native glob (* ? [abc] [a-z]) to a JS RegExp anchored on the whole string. */
export function globToRegex(glob: string): RegExp {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') out += '.*'
    else if (c === '?') out += '.'
    else if (c === '[') {
      const end = glob.indexOf(']', i)
      if (end === -1) out += '\\['
      else {
        out += glob.slice(i, end + 1)
        i = end
      }
    } else if ('.^$+(){}|\\'.includes(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  out += '$'
  return new RegExp(out)
}

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
  if (!spec) return { ok: true }

  const keyIndexes = expandKeyArity(spec.keyArity, args.length)
  for (const idx of keyIndexes) {
    const key = args[idx]
    if (key === undefined) continue
    for (const pat of rules) {
      if (globToRegex(pat).test(key)) {
        return { ok: false, matchedKey: key, matchedPattern: pat }
      }
    }
  }

  if (spec.keyArity.kind === 'pattern') {
    const userPat = args[spec.keyArity.argIndex]
    if (userPat !== undefined) {
      for (const pat of rules) {
        if (patternsOverlap(userPat, pat)) {
          return { ok: false, matchedKey: null, matchedPattern: pat }
        }
      }
    }
  }
  return { ok: true }
}

function expandKeyArity(arity: KeyArity, argCount: number): number[] {
  switch (arity.kind) {
    case 'no-key':
    case 'pattern':
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
  }
}
