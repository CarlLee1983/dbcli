export interface ExecOptions {
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  stdoutCap?: number
  stderrCap?: number
}

export interface ExecOutcome {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  truncated: boolean
  timedOut: boolean
}

const DEFAULT_CAP = 64 * 1024

export async function executeStep(argv: string[], opts: ExecOptions): Promise<ExecOutcome> {
  const stdoutCap = opts.stdoutCap ?? DEFAULT_CAP
  const stderrCap = opts.stderrCap ?? DEFAULT_CAP
  const startedAt = performance.now()

  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      proc.kill()
    } catch {
      // proc already exited
    }
  }, opts.timeoutMs)

  const [stdoutRaw, stderrRaw, exitCode] = await Promise.all([
    capStream(proc.stdout, stdoutCap),
    capStream(proc.stderr, stderrCap),
    proc.exited,
  ])
  clearTimeout(timer)

  const truncated = stdoutRaw.truncated || stderrRaw.truncated
  return {
    exitCode: timedOut ? exitCode || 124 : exitCode,
    stdout: stdoutRaw.text,
    stderr: stderrRaw.text,
    durationMs: Math.round(performance.now() - startedAt),
    truncated,
    timedOut,
  }
}

async function capStream(
  stream: ReadableStream<Uint8Array>,
  cap: number
): Promise<{ text: string; truncated: boolean }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let truncated = false
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > cap) {
      const excess = received - cap
      const usable = value.subarray(0, value.byteLength - excess)
      text += decoder.decode(usable, { stream: false })
      truncated = true
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      break
    }
    text += decoder.decode(value, { stream: true })
  }
  try {
    text += decoder.decode()
  } catch {
    // ignore
  }
  return { text, truncated }
}
