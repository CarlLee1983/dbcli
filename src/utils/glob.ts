/**
 * Glob matching shared by the guards that have to reason about wildcard
 * targets: Redis key patterns and Elasticsearch index expressions.
 */

/** Convert a glob (`*`, `?`, `[abc]`, `[a-z]`) to a RegExp anchored on the whole string. */
export function globToRegex(glob: string): RegExp {
  let out = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '\\' && i + 1 < glob.length) {
      // An escaped metacharacter is a literal: `sec\*` protects the key `sec*`.
      // Emitting the backslash itself made the pattern match `sec\x` and miss
      // the key it exists to protect.
      out += (glob[++i] as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      continue
    }
    if (c === '*') out += '.*'
    else if (c === '?') out += '.'
    else if (c === '[') {
      const end = findClassEnd(glob, i)
      // A class the glob does not close, or one whose contents do not form a
      // valid class (`[\]`), is treated as a literal `[` rather than emitted
      // into the pattern — an unparseable RegExp here would throw out of a
      // security check instead of answering it.
      const body = end === -1 ? '' : glob.slice(i, end + 1)
      if (body !== '' && isValidCharacterClass(body)) {
        out += body
        i = end
      } else {
        out += '\\['
      }
    } else if ('.^$+(){}|\\'.includes(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  out += '$'
  // `s` (dotAll): Redis's `stringmatchlen` compares byte by byte, so its `*`
  // and `?` eat a newline like any other byte. Without the flag JavaScript's
  // `.` stops at `\n`, and `secrets:*` left `secrets:\nx` unprotected while
  // `parseRedisCommand` happily carried that key through a quoted argument.
  // `$` needs no companion change: JavaScript anchors it at end of input,
  // unlike Perl, so a literal pattern still refuses a key with a trailing
  // newline — which is also what Redis answers.
  return new RegExp(out, 's')
}

/** Index of the `]` closing the class opened at `open`, honouring backslash escapes. */
function findClassEnd(glob: string, open: number): number {
  for (let i = open + 1; i < glob.length; i++) {
    if (glob[i] === '\\') {
      i++
      continue
    }
    if (glob[i] === ']') return i
  }
  return -1
}

function isValidCharacterClass(body: string): boolean {
  try {
    new RegExp(body)
    return true
  } catch {
    return false
  }
}
