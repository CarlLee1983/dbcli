/**
 * Which stream a yes/no question is asked on.
 *
 * stdout is this CLI's data channel — the JSON envelope a caller parses — so a
 * question addressed to a person must not land there. The mutation tests spy on
 * `promptUser.confirm` itself and so never reach either implementation; these
 * cover both, the piped-stdin fallback and the inquirer path.
 */

import { describe, test, expect, afterEach, spyOn, mock } from 'bun:test'
import { confirm } from '@/utils/prompts'

describe('confirm asks on stderr', () => {
  const restore: Array<{ mockRestore: () => void }> = []
  let stdinDescriptor: PropertyDescriptor | undefined

  afterEach(() => {
    for (const spy of restore.splice(0)) spy.mockRestore()
    if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor)
    stdinDescriptor = undefined
  })

  function setStdinTTY(value: boolean): void {
    stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value })
  }

  test('the piped-stdin fallback writes the question to stderr, never stdout', async () => {
    setStdinTTY(false)

    const stderrWrites: string[] = []
    restore.push(
      spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        stderrWrites.push(String(chunk))
        return true
      }) as never),
      spyOn(process.stdout, 'write').mockImplementation((() => true) as never),
      spyOn(console, 'log').mockImplementation(() => {})
    )

    const answered = confirm('Proceed with this operation?')
    process.stdin.emit('data', Buffer.from('y\n'))

    expect(await answered).toBe(true)
    expect(stderrWrites.join('')).toContain('Proceed with this operation? (y/n): ')
    expect(process.stdout.write).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  test('the inquirer path is given stderr as its output', async () => {
    setStdinTTY(true)

    const inquirerConfirm = mock(async () => true)
    // The module is loaded through a dynamic import inside confirm(), so the
    // mock has to be in place before the call rather than at import time.
    mock.module('@inquirer/prompts', () => ({
      confirm: inquirerConfirm,
      input: mock(async () => ''),
      select: mock(async () => ''),
      password: mock(async () => ''),
    }))

    expect(await confirm('Proceed?')).toBe(true)
    expect(inquirerConfirm).toHaveBeenCalledWith(
      { message: 'Proceed?' },
      { output: process.stderr }
    )
  })
})
