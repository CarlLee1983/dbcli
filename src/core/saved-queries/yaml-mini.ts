/**
 * 內建 YAML 子集 parser
 *
 * 支援：
 *  - scalars（string/number/bool/null）
 *  - 巢狀 map（block form, 2-space 縮排）
 *  - 行內 list `[a, b, c]`
 *  - block list（`- scalar`、`- key: value` 起始的 sub-map，可再含縮排子鍵）
 *
 * 不支援：anchors/references、multi-line scalars、複雜 tags、tab 縮排、行內 map（如 `{a: 1}`，僅允許 `{}`）。
 */

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue }

interface Token {
  indent: number
  content: string
  isDash: boolean
  raw: string
}

export function parseYamlMini(text: string): Record<string, YamlValue> {
  const tokens: Token[] = []
  for (const raw of text.split('\n')) {
    if (/^\s*(#.*)?$/.test(raw)) continue
    if (raw.includes('\t')) {
      throw new Error(`YAML mini: tab indentation not supported: "${raw}"`)
    }
    const indent = raw.match(/^( *)/)![1]!.length
    const lineBody = raw.slice(indent)
    const isDash = lineBody === '-' || lineBody.startsWith('- ')
    const content = isDash ? lineBody.slice(2).trim() : lineBody
    tokens.push({ indent, content, isDash, raw })
  }

  let i = 0

  function parseMapBlock(baseIndent: number): Record<string, YamlValue> {
    const map: Record<string, YamlValue> = {}
    while (
      i < tokens.length &&
      tokens[i]!.indent > baseIndent &&
      !tokens[i]!.isDash
    ) {
      const tok = tokens[i]!
      consumeKeyValueInto(map, tok)
    }
    return map
  }

  function parseListBlock(baseIndent: number): YamlValue[] {
    const list: YamlValue[] = []
    while (
      i < tokens.length &&
      tokens[i]!.indent > baseIndent &&
      tokens[i]!.isDash
    ) {
      const tok = tokens[i]!
      const itemIndent = tok.indent
      if (tok.content === '') {
        // bare `- ` line → child block on next deeper lines
        i++
        if (
          i < tokens.length &&
          tokens[i]!.indent > itemIndent
        ) {
          list.push(
            tokens[i]!.isDash
              ? (parseListBlock(itemIndent) as YamlValue)
              : (parseMapBlock(itemIndent) as YamlValue)
          )
        } else {
          list.push(null)
        }
        continue
      }
      const colonAt = colonOutsideBrackets(tok.content)
      if (colonAt === -1) {
        // pure scalar list item
        list.push(parseScalar(tok.content))
        i++
        continue
      }
      // `- key: value` starts a sub-map; subsequent indented lines belong to it
      const itemMap: Record<string, YamlValue> = {}
      consumeKeyValueInto(itemMap, tok)
      // continuation keys at deeper indent (must be > itemIndent and not dash)
      while (
        i < tokens.length &&
        tokens[i]!.indent > itemIndent &&
        !tokens[i]!.isDash
      ) {
        consumeKeyValueInto(itemMap, tokens[i]!)
      }
      list.push(itemMap)
    }
    return list
  }

  function consumeKeyValueInto(
    target: Record<string, YamlValue>,
    tok: Token
  ): void {
    const colon = colonOutsideBrackets(tok.content)
    if (colon === -1) {
      throw new Error(`YAML mini: expected "key:" at "${tok.raw}"`)
    }
    const key = tok.content.slice(0, colon).trim()
    const rest = tok.content.slice(colon + 1).trim()
    if (/^[&*]\w/.test(rest)) {
      throw new Error(`YAML mini: anchor/reference unsupported: "${tok.raw}"`)
    }
    i++
    if (rest === '') {
      // children: list or map?
      if (i < tokens.length && tokens[i]!.indent > tok.indent) {
        if (tokens[i]!.isDash) {
          target[key] = parseListBlock(tok.indent) as YamlValue
        } else {
          target[key] = parseMapBlock(tok.indent) as YamlValue
        }
      } else {
        target[key] = {}
      }
    } else {
      target[key] = parseScalarOrInlineList(rest)
    }
  }

  return parseMapBlock(-1)
}

function colonOutsideBrackets(s: string): number {
  let depth = 0
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
    else if (c === ':' && depth === 0) return k
  }
  return -1
}

function parseScalarOrInlineList(s: string): YamlValue {
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((p) => parseScalar(p.trim()))
  }
  if (s.startsWith('{') && s.endsWith('}')) {
    const inner = s.slice(1, -1).trim()
    if (inner === '') return {}
    throw new Error(`YAML mini: inline map entries unsupported, use block form: "${s}"`)
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
