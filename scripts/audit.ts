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
 *
 * An advisory with no patched release would otherwise hold the gate red for
 * every change, whatever it touches, and a gate that is always red is ignored
 * as surely as one that is flaky. `audit-exemptions.json` lets the gate name
 * such an advisory and step past it, but only in the open: each entry carries
 * a reason and an expiry, an expired entry turns the gate red again, and every
 * run prints what it exempted. See ADR-0042.
 */

import { z } from 'zod'

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

/** `YYYY-MM-DD` that is also a real calendar day, so `2026-02-30` cannot pass as a date. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

// GHSA only: `bun audit --ignore` also takes numeric npm advisory IDs, but those
// are not what this gate exempts, and a typo should fail rather than ignore
// some other advisory. `package` is descriptive and is not checked against the
// advisory; the exemption applies by id.
const ExemptionSchema = z
  .object({
    id: z.string().regex(/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/, 'must be a GHSA id'),
    package: z.string().min(1),
    reason: z.string().min(1),
    expires: z.string().refine(isCalendarDate, 'must be a YYYY-MM-DD date'),
  })
  .strict()

export type Exemption = z.infer<typeof ExemptionSchema>

/**
 * Parse the exemptions file. A missing or blank file means no exemptions;
 * anything unreadable throws, because auditing without the exemptions the file
 * meant to grant would report a different gate than the one committed.
 */
export function parseExemptions(text: string | null): Exemption[] {
  if (text === null || text.trim() === '') return []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new Error(`audit-exemptions.json is not valid JSON: ${(error as Error).message}`)
  }

  const parsed = z.array(ExemptionSchema).safeParse(raw)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`audit-exemptions.json is invalid: ${problems}`)
  }

  const seen = new Set<string>()
  for (const entry of parsed.data) {
    if (seen.has(entry.id))
      throw new Error(`audit-exemptions.json lists ${entry.id} more than once`)
    seen.add(entry.id)
  }
  return parsed.data
}

export interface GateOptions extends Omit<RetryOptions, 'run'> {
  /** Raw contents of `audit-exemptions.json`, or null when the file does not exist. */
  exemptionsText: string | null
  /** Today as a UTC `YYYY-MM-DD`; injected so expiry is testable. */
  today: string
  run: (ignoreArgs: string[]) => Promise<AuditAttempt>
  report: (line: string) => void
}

/** Apply the exemptions, then audit with retry. Returns the exit code to exit with. */
export async function runAuditGate({
  exemptionsText,
  today,
  run,
  report,
  ...retry
}: GateOptions): Promise<number> {
  let exemptions: Exemption[]
  try {
    exemptions = parseExemptions(exemptionsText)
  } catch (error) {
    report(`bun audit: ${(error as Error).message}`)
    return 1
  }

  // The expiry day itself still counts: "until 2026-11-30" includes the 30th.
  const expired = exemptions.filter((entry) => entry.expires < today)
  if (expired.length > 0) {
    for (const entry of expired) {
      report(
        `bun audit: exemption for ${entry.id} (${entry.package}) expired on ${entry.expires} (UTC) — fix the dependency or renew it with a new reason`
      )
    }
    return 1
  }

  for (const entry of exemptions) {
    report(
      `bun audit: exempting ${entry.id} (${entry.package}) until ${entry.expires} — ${entry.reason}`
    )
  }

  const ignoreArgs = exemptions.map((entry) => `--ignore=${entry.id}`)
  return runAuditWithRetry({ ...retry, run: () => run(ignoreArgs) })
}

async function spawnAudit(ignoreArgs: string[]): Promise<AuditAttempt> {
  const proc = Bun.spawn(['bun', 'audit', ...ignoreArgs], { stdout: 'pipe', stderr: 'pipe' })
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
  const exemptionsFile = Bun.file(`${import.meta.dir}/audit-exemptions.json`)
  process.exit(
    await runAuditGate({
      exemptionsText: (await exemptionsFile.exists()) ? await exemptionsFile.text() : null,
      today: new Date().toISOString().slice(0, 10),
      run: spawnAudit,
      attempts: 3,
      wait: (ms) => Bun.sleep(ms),
      report: (line) => console.error(line),
    })
  )
}
