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
