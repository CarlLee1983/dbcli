/**
 * Asking a question through the shell's own readline interface — and taking it
 * back when the operator presses Ctrl-C.
 *
 * The REPL already owns the terminal, so anything that needs an answer has to
 * borrow that interface rather than open a second reader on stdin: two readers
 * split the operator's keystrokes between them, and the write gate's typed
 * confirmation was landing in both (#78).
 *
 * Withdrawal is the other half. Ctrl-C fires readline's SIGINT listener but
 * leaves a pending `question` outstanding, so the next line typed — a new
 * statement, as far as the operator is concerned — was consumed as the answer
 * (#85). Only aborting the signal takes the question down; readline then
 * delivers that line as a line.
 *
 * Lives apart from `shell.ts` so the precedence rules — cancel with nothing
 * pending, cancel twice, cancel after an answer — can be tested without a pty.
 */

import type { Interface } from 'node:readline'

export interface PromptAsker {
  /**
   * Ask, and resolve with what was typed — or `null` when the question was
   * withdrawn before an answer arrived.
   */
  ask(question: string): Promise<string | null>
  /** Withdraw the question on screen, if any. A no-op when nothing is pending. */
  cancel(): boolean
}

/**
 * Build an asker over whichever interface the shell has at the time. The
 * interface is fetched lazily because the gate that uses this is constructed
 * before the REPL's interface exists.
 */
export function createPromptAsker(getInterface: () => Interface | null): PromptAsker {
  let pending: { abort: () => void } | null = null

  return {
    // `async` so that the two failure modes below reach the caller the same
    // way: a function typed as returning a promise that sometimes throws
    // synchronously puts the burden of a try *and* a catch on every caller.
    async ask(question: string): Promise<string | null> {
      const rl = getInterface()
      // Unreachable in production — the gate is only consulted from the `line`
      // handler, which cannot run before the interface exists. Throwing rather
      // than answering with an empty string keeps a programming error from
      // being recorded as an operator who mistyped the table name.
      if (!rl) throw new Error('Write gate asked for confirmation before the shell started')

      return new Promise<string | null>((resolve) => {
        const controller = new AbortController()
        const settle = (answer: string | null) => {
          pending = null
          // `question()` resumes the interface to read the answer, undoing the
          // pause the line handler took out. Re-pausing here keeps that
          // handler's `finally` the single point at which the shell starts
          // reading lines again — otherwise the next line typed runs
          // concurrently with the statement just confirmed, through the same
          // engine and the same multiline buffer.
          rl.pause()
          resolve(answer)
        }
        pending = {
          abort: () => {
            controller.abort()
            settle(null)
          },
        }
        try {
          rl.question(`${question}: `, { signal: controller.signal }, settle)
        } catch (error) {
          // A closed interface throws here. Clearing the holder matters: left
          // set, it would swallow the next Ctrl-C, which then cancels neither
          // a confirmation nor the multiline buffer.
          pending = null
          throw error
        }
      })
    },

    cancel(): boolean {
      if (!pending) return false
      pending.abort()
      return true
    },
  }
}
