import { describe, expect, test } from 'bun:test'
import { resolveQueryInput, type QueryInputReaders } from '@/core/query-input'

function readers(overrides: Partial<QueryInputReaders> = {}) {
  let fileReads = 0
  let stdinReads = 0
  const value: QueryInputReaders = {
    async readFile(path) {
      fileReads++
      return overrides.readFile ? overrides.readFile(path) : 'SELECT 1'
    },
    async readStdin() {
      stdinReads++
      return overrides.readStdin ? overrides.readStdin() : 'SELECT 1'
    },
    ...(overrides.stdinIsInteractive ? { stdinIsInteractive: overrides.stdinIsInteractive } : {}),
  }
  return { value, fileReads: () => fileReads, stdinReads: () => stdinReads }
}

describe('resolveQueryInput', () => {
  test('requires exactly one source without reading either input', async () => {
    const inputReaders = readers()
    await expect(resolveQueryInput({}, inputReaders.value)).rejects.toThrow('Exactly one')
    expect(inputReaders.fileReads()).toBe(0)
    expect(inputReaders.stdinReads()).toBe(0)
  })

  test('rejects positional and file sources before reading', async () => {
    const inputReaders = readers()
    await expect(
      resolveQueryInput({ positional: '', queryFile: 'query.sql' }, inputReaders.value)
    ).rejects.toThrow('conflict')
    expect(inputReaders.fileReads()).toBe(0)
    expect(inputReaders.stdinReads()).toBe(0)
  })

  test('rejects empty positional, whitespace file, and BOM-only file input', async () => {
    await expect(resolveQueryInput({ positional: '   ' })).rejects.toThrow('empty')
    await expect(
      resolveQueryInput(
        { queryFile: 'blank.sql' },
        readers({ readFile: async () => ' \n\t ' }).value
      )
    ).rejects.toThrow('empty')
    await expect(
      resolveQueryInput(
        { queryFile: 'bom.sql' },
        readers({ readFile: async () => '\uFEFF  ' }).value
      )
    ).rejects.toThrow('empty')
  })

  test('wraps missing and unreadable file failures with the supplied path', async () => {
    const missing = readers({ readFile: async () => Promise.reject(new Error('ENOENT')) })
    await expect(resolveQueryInput({ queryFile: 'missing.sql' }, missing.value)).rejects.toThrow(
      /missing\.sql.*ENOENT/
    )

    const unreadable = readers({ readFile: async () => Promise.reject(new Error('EACCES')) })
    await expect(resolveQueryInput({ queryFile: 'private.sql' }, unreadable.value)).rejects.toThrow(
      /private\.sql.*EACCES/
    )
  })

  test('removes one leading BOM and preserves multiline SQL', async () => {
    const sql = 'SELECT id,\n  name\nFROM users'
    const inputReaders = readers({ readFile: async () => `\uFEFF  ${sql}\n` })
    await expect(resolveQueryInput({ queryFile: 'query.sql' }, inputReaders.value)).resolves.toBe(
      sql
    )
  })

  test('removes exactly one leading BOM and preserves a trailing U+FEFF', async () => {
    await expect(resolveQueryInput({ positional: '\uFEFF\uFEFFSELECT 1' })).resolves.toBe(
      '\uFEFFSELECT 1'
    )
    await expect(resolveQueryInput({ positional: 'SELECT 1\uFEFF' })).resolves.toBe(
      'SELECT 1\uFEFF'
    )
  })

  test('reads an ordinary file once and never reads stdin', async () => {
    const inputReaders = readers()
    await expect(resolveQueryInput({ queryFile: 'query.sql' }, inputReaders.value)).resolves.toBe(
      'SELECT 1'
    )
    expect(inputReaders.fileReads()).toBe(1)
    expect(inputReaders.stdinReads()).toBe(0)
  })

  test('reads stdin exactly once for dash and preserves hostile MongoDB quotes', async () => {
    const pipeline = `[{"$match":{"message":{"$regex":"user's event"}}}]`
    const inputReaders = readers({ readStdin: async () => `\n${pipeline}\n` })
    await expect(resolveQueryInput({ queryFile: '-' }, inputReaders.value)).resolves.toBe(pipeline)
    expect(inputReaders.stdinReads()).toBe(1)
    expect(inputReaders.fileReads()).toBe(0)
  })

  // Reading an interactive terminal blocks with no prompt: the command looks
  // hung rather than wrong. Every other stdin consumer in the CLI checks first.
  test('refuses to read stdin when it is an interactive terminal', async () => {
    const inputReaders = readers({ stdinIsInteractive: () => true })
    await expect(resolveQueryInput({ queryFile: '-' }, inputReaders.value)).rejects.toThrow(
      'requires piped input'
    )
    expect(inputReaders.stdinReads()).toBe(0)
  })

  test('reads stdin when it is piped', async () => {
    const inputReaders = readers({ stdinIsInteractive: () => false })
    await expect(resolveQueryInput({ queryFile: '-' }, inputReaders.value)).resolves.toBe(
      'SELECT 1'
    )
    expect(inputReaders.stdinReads()).toBe(1)
  })

  test('a reader without the probe is treated as piped, not interactive', async () => {
    const inputReaders = readers()
    await expect(resolveQueryInput({ queryFile: '-' }, inputReaders.value)).resolves.toBe(
      'SELECT 1'
    )
    expect(inputReaders.stdinReads()).toBe(1)
  })
})
