/**
 * `bun audit`, with the registry's bad days told apart from this repository's.
 *
 * The audit job blocks every push on purpose: an advisory that lands mid-cycle
 * should turn the branch red while the change that pulled it in is still on
 * screen. That only works if red means "a dependency has an advisory". On
 * 2026-09-04 `main` went red because the npm advisory endpoint answered 503 —
 * a fact about npm, not about this repository, and exactly the kind of noise
 * that teaches people to re-run a gate without reading it.
 *
 * `bun audit` reports both with exit code 1, so the two are separated by what
 * it printed: transport-level failures are retried with a short backoff,
 * everything else fails immediately. Exhausting the retries still fails —
 * an audit that never reached the registry has not cleared anything.
 */

/**
 * Transport-level failures, which say nothing about the dependency tree.
 *
 * Deliberately narrow: a 5xx or 429 on an `error:` line, and the connection
 * errors Bun's fetch surfaces. A 4xx other than 429 is a real, stable answer
 * and is not retried.
 */
const TRANSIENT = [
  /^\s*error:.* - (?:5\d\d|429)\s*$/m,
  /\bConnection(?:Refused|Closed|Reset)\b/,
  /\bfetch failed\b/,
  /\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN)\b/,
  /\bsocket connection was closed\b/i,
]

/** True when the failure is the registry being unreachable rather than an advisory. */
export function isTransientAuditFailure(output: string): boolean {
  return TRANSIENT.some((pattern) => pattern.test(output))
}

export interface AuditAttempt {
  exitCode: number
  output: string
}

export interface RetryOptions {
  run: () => Promise<AuditAttempt>
  attempts: number
  wait: (ms: number) => Promise<void>
}

/** Run the audit, retrying only transport failures. Returns the exit code to exit with. */
export async function runAuditWithRetry({ run, attempts, wait }: RetryOptions): Promise<number> {
  let last: AuditAttempt = { exitCode: 1, output: '' }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await run()
    if (last.exitCode === 0) return 0
    if (!isTransientAuditFailure(last.output)) return last.exitCode

    if (attempt < attempts) {
      const delay = 2000 * attempt
      console.error(
        `bun audit: registry unreachable (attempt ${attempt}/${attempts}), retrying in ${delay}ms`
      )
      await wait(delay)
    }
  }

  console.error(
    `bun audit: registry still unreachable after ${attempts} attempts — failing rather than reporting an audit that never ran`
  )
  return last.exitCode
}

async function spawnAudit(): Promise<AuditAttempt> {
  const proc = Bun.spawn(['bun', 'audit'], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  process.stdout.write(stdout)
  process.stderr.write(stderr)
  return { exitCode, output: `${stdout}\n${stderr}` }
}

if (import.meta.main) {
  process.exit(
    await runAuditWithRetry({
      run: spawnAudit,
      attempts: 3,
      wait: (ms) => Bun.sleep(ms),
    })
  )
}
