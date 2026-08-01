export interface QueryInputReaders {
  readFile(path: string): Promise<string>
  readStdin(): Promise<string>
}

export interface QueryInputSources {
  positional?: string
  queryFile?: string
}

const defaultReaders: QueryInputReaders = {
  readFile: (path) => Bun.file(path).text(),
  readStdin: () => Bun.stdin.text(),
}

const WHITESPACE = /\s/u

// ECMAScript trim() includes U+FEFF. Walk code points instead so the resolver
// removes exactly one leading BOM and preserves any additional/trailing U+FEFF.
function trimOuterWhitespace(value: string): string {
  let start = 0
  let end = value.length
  while (start < end) {
    const character = String.fromCodePoint(value.codePointAt(start)!)
    if (character === '\uFEFF' || !WHITESPACE.test(character)) break
    start += character.length
  }
  while (end > start) {
    const codePoint = value.codePointAt(end - 1)!
    const character = String.fromCodePoint(codePoint)
    if (character === '\uFEFF' || !WHITESPACE.test(character)) break
    end -= character.length
  }
  return value.slice(start, end)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve exactly one query source before config or database access. */
export async function resolveQueryInput(
  sources: QueryInputSources,
  readers: QueryInputReaders = defaultReaders
): Promise<string> {
  const hasPositional = sources.positional !== undefined
  const hasQueryFile = sources.queryFile !== undefined

  if (hasPositional && hasQueryFile) {
    throw new Error(
      'Query source conflict: provide either positional query text or --query-file <path>, not both'
    )
  }
  if (!hasPositional && !hasQueryFile) {
    throw new Error(
      'Exactly one query source is required: provide positional query text or --query-file <path>'
    )
  }

  let input: string
  if (hasPositional) {
    input = sources.positional!
  } else if (sources.queryFile === '-') {
    try {
      input = await readers.readStdin()
    } catch (error) {
      throw new Error(`Failed to read query from stdin: ${errorMessage(error)}`)
    }
  } else {
    const path = sources.queryFile!
    try {
      input = await readers.readFile(path)
    } catch (error) {
      throw new Error(`Failed to read query file "${path}": ${errorMessage(error)}`)
    }
  }

  const withoutBom = input.startsWith('\uFEFF') ? input.slice(1) : input
  const query = trimOuterWhitespace(withoutBom)
  if (query.length === 0) {
    throw new Error('Query input is empty')
  }
  return query
}
