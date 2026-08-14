import { describe, expect, test } from 'bun:test'
import {
  CORE_STDOUT_EXCEPTIONS,
  collectCoreStdoutViolations,
  findCoreStdoutViolations,
} from '../../scripts/check-core-no-stdout'

describe('core no-stdout gate', () => {
  test.each([
    ["console.log('hi')", 'console.log'],
    ["console.error('boom')", 'console.error'],
    ["console.warn('careful')", 'console.warn'],
    ["console.info('fyi')", 'console.info'],
    ["console.debug('trace')", 'console.debug'],
    ["process.stdout.write('raw')", 'process.stdout.write'],
    ["process.stderr.write('raw')", 'process.stderr.write'],
    ["writeSync(1, 'raw')", 'writeSync(1)'],
    ["writeSync(2, 'raw')", 'writeSync(2)'],
    ['Bun.write(Bun.stdout, payload)', 'Bun.write(Bun.stdout)'],
    ['Bun.write(Bun.stderr, payload)', 'Bun.write(Bun.stderr)'],
  ])('rejects %s', (source, callee) => {
    expect(findCoreStdoutViolations(source, 'fixture.ts')).toContain(
      `fixture.ts: writes to stdout via '${callee}'`
    )
  })

  test('reports each distinct callee once', () => {
    const source = "console.log('a')\nconsole.log('b')\nconsole.error('c')"
    expect(findCoreStdoutViolations(source, 'fixture.ts')).toEqual([
      "fixture.ts: writes to stdout via 'console.log'",
      "fixture.ts: writes to stdout via 'console.error'",
    ])
  })

  test('allows code that merely mentions logging', () => {
    const source = [
      'const logger = { log: (message: string) => sink.push(message) }',
      'logger.log("routed through the caller")',
      'export type Console = { log(message: string): void }',
    ].join('\n')
    expect(findCoreStdoutViolations(source, 'fixture.ts')).toEqual([])
  })

  test('allows reading stdout metadata without writing to it', () => {
    const source = 'const interactive = process.stdout.isTTY === true'
    expect(findCoreStdoutViolations(source, 'fixture.ts')).toEqual([])
  })

  test('allows writing files, which is what Bun.write is normally for', () => {
    const source = 'await Bun.write(tempFile, JSON.stringify(lockData))'
    expect(findCoreStdoutViolations(source, 'fixture.ts')).toEqual([])
  })

  test('allows writing to a file descriptor that is not stdout or stderr', () => {
    const source = 'writeSync(handle, buffer)'
    expect(findCoreStdoutViolations(source, 'fixture.ts')).toEqual([])
  })

  test('the exception list only shrinks: every entry still violates', async () => {
    const stale: string[] = []
    for (const relativePath of CORE_STDOUT_EXCEPTIONS) {
      const source = await Bun.file(new URL(`../../src/core/${relativePath}`, import.meta.url)).text()
      if (findCoreStdoutViolations(source, relativePath).length === 0) stale.push(relativePath)
    }
    expect(stale).toEqual([])
  })

  test('src/core has no violations outside the exception list', async () => {
    expect(await collectCoreStdoutViolations()).toEqual([])
  })

  test('the data executor is not exempt', () => {
    expect(CORE_STDOUT_EXCEPTIONS).not.toContain('data-executor.ts')
  })
})
