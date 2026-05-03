/**
 * 內建 YAML 子集 parser
 *
 * 支援：scalars（string/number/bool）、巢狀 map、行內 list `[a, b]`
 * 不支援：anchors、references、multi-line scalars、複雜 tags
 *
 * 用 2-space 縮排；tab 直接拒絕。回傳純物件。
 */

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue }

export function parseYamlMini(text: string): Record<string, YamlValue> {
  const lines = text.split('\n').filter((l) => !/^\s*(#.*)?$/.test(l))
  const root: Record<string, YamlValue> = {}
  // stack of [indent, container]
  const stack: Array<{ indent: number; node: any }> = [{ indent: -1, node: root }]

  for (const raw of lines) {
    if (raw.includes('\t')) {
      throw new Error(`YAML mini: tab indentation not supported: "${raw}"`)
    }
    const indent = raw.match(/^( *)/)![1]!.length
    const line = raw.slice(indent)

    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]!.node

    const colon = line.indexOf(':')
    if (colon === -1) {
      throw new Error(`YAML mini: expected "key:" at "${raw}"`)
    }
    const key = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()
    if (/^[&*]\w/.test(rest)) {
      throw new Error(`YAML mini: anchor/reference unsupported: "${raw}"`)
    }

    if (rest === '') {
      const child: Record<string, YamlValue> = {}
      parent[key] = child
      stack.push({ indent, node: child })
    } else {
      parent[key] = parseScalarOrInlineList(rest)
    }
  }

  return root
}

function parseScalarOrInlineList(s: string): YamlValue {
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((p) => parseScalar(p.trim()))
  }
  return parseScalar(s)
}

function parseScalar(s: string): string | number | boolean | null {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null' || s === '~' || s === '') return null
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  return s
}
