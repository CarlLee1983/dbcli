/**
 * Withdrawing a question the shell asked.
 *
 * Ctrl-C at the write gate's typed confirmation used to leave the question
 * outstanding: the operator, believing they had cancelled, typed a new
 * statement and readline handed it over as the answer (#85). What follows are
 * the precedence rules that fix depends on, against a stand-in for the readline
 * interface so they can be checked without a terminal.
 */

import { describe, test, expect } from 'bun:test'
import type { Interface } from 'node:readline'
import { createPromptAsker } from '@/commands/shell-prompt-asker'

/**
 * The parts of a readline interface an asker touches, with the abort semantics
 * Bun implements: an aborted signal means the callback is never invoked.
 */
function fakeInterface(): Interface & { answer(text: string): void; paused: number } {
  let respond: ((answer: string) => void) | null = null
  const rl = {
    paused: 0,
    question(_query: string, options: { signal: AbortSignal }, callback: (answer: string) => void) {
      respond = callback
      options.signal.addEventListener('abort', () => {
        respond = null
      })
    },
    pause() {
      rl.paused += 1
    },
    answer(text: string) {
      respond?.(text)
    },
  }
  return rl as unknown as Interface & { answer(text: string): void; paused: number }
}

describe('the shell prompt asker', () => {
  test('an answered question resolves with what was typed', async () => {
    const rl = fakeInterface()
    const asker = createPromptAsker(() => rl)

    const pending = asker.ask('Type users to run it')
    rl.answer('users')

    expect(await pending).toBe('users')
  })

  test('cancelling withdraws the question and answers null', async () => {
    const rl = fakeInterface()
    const asker = createPromptAsker(() => rl)

    const pending = asker.ask('Type users to run it')
    expect(asker.cancel()).toBe(true)

    expect(await pending).toBeNull()
  })

  test('a line typed after cancelling is no longer an answer', async () => {
    // The whole point: readline drops the aborted question, so what the
    // operator types next goes back to being a statement.
    const rl = fakeInterface()
    const asker = createPromptAsker(() => rl)

    const pending = asker.ask('Type users to run it')
    asker.cancel()
    rl.answer('SELECT 1')

    expect(await pending).toBeNull()
  })

  test('cancelling with nothing pending says so, and leaves SIGINT to the shell', async () => {
    // The shell reads this return value to decide whether Ctrl-C still has to
    // cancel a multiline buffer.
    const asker = createPromptAsker(() => fakeInterface())

    expect(asker.cancel()).toBe(false)
  })

  test('cancelling twice is not two withdrawals', async () => {
    const rl = fakeInterface()
    const asker = createPromptAsker(() => rl)

    const pending = asker.ask('Type users to run it')
    expect(asker.cancel()).toBe(true)
    expect(asker.cancel()).toBe(false)

    expect(await pending).toBeNull()
  })

  test('cancelling after an answer does nothing to the answer', async () => {
    const rl = fakeInterface()
    const asker = createPromptAsker(() => rl)

    const pending = asker.ask('Type users to run it')
    rl.answer('users')

    expect(asker.cancel()).toBe(false)
    expect(await pending).toBe('users')
  })

  test('each question is settled once, and the interface is paused each time', async () => {
    const rl = fakeInterface()
    const asker = createPromptAsker(() => rl)

    const first = asker.ask('Type users to run it')
    asker.cancel()
    await first

    const second = asker.ask('Type orders to run it')
    rl.answer('orders')

    expect(await second).toBe('orders')
    expect(rl.paused).toBe(2)
  })

  test('an interface that throws does not leave a phantom question behind', async () => {
    // A closed interface. Left registered, the dead question would swallow the
    // next Ctrl-C, which would then cancel neither a confirmation nor the
    // multiline buffer.
    const broken = {
      question: () => {
        throw new Error('readline was closed')
      },
      pause: () => {},
    } as unknown as Interface
    const asker = createPromptAsker(() => broken)

    await expect(asker.ask('Type users to run it')).rejects.toThrow('readline was closed')
    expect(asker.cancel()).toBe(false)
  })

  test('asking before the shell has an interface is a defect, not a decline', async () => {
    const asker = createPromptAsker(() => null)

    await expect(asker.ask('Type users to run it')).rejects.toThrow(/before the shell started/)
  })
})
