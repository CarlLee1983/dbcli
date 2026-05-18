import type { StepResultSummary } from './next-types'

export const CONNECTION_BRANCH_IDS = [
  'doctor-clean',
  'doctor-config-missing',
  'doctor-auth-error',
  'doctor-network-error',
] as const
export type ConnectionBranchId = (typeof CONNECTION_BRANCH_IDS)[number]

const CONFIG_LABELS = new Set<string>([
  'Config exists',
  'Default connection',
  'V2 config validation',
  'Config valid',
])

const AUTH_KEYWORDS = [
  'auth',
  'password',
  'credentials',
  'credential',
  'permission denied',
  'login',
] as const

const NETWORK_KEYWORDS = [
  'host',
  'port',
  'refused',
  'timeout',
  'unreachable',
  'enotfound',
  'econnrefused',
  'etimedout',
  'eai_again',
  'dns',
] as const

interface DoctorResultEntry {
  group: string
  label: string
  status: string
  message: string
}

interface DoctorJson {
  results: DoctorResultEntry[]
  hasError: boolean
}

function parseDoctorJson(stdoutSummary: string | undefined): DoctorJson | null {
  if (!stdoutSummary || stdoutSummary.length === 0) return null
  let raw: unknown
  try {
    raw = JSON.parse(stdoutSummary)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.results)) return null
  const entries: DoctorResultEntry[] = []
  for (const r of obj.results) {
    if (typeof r !== 'object' || r === null) return null
    const e = r as Record<string, unknown>
    if (
      typeof e.group !== 'string' ||
      typeof e.label !== 'string' ||
      typeof e.status !== 'string' ||
      typeof e.message !== 'string'
    ) {
      return null
    }
    entries.push({ group: e.group, label: e.label, status: e.status, message: e.message })
  }
  return { results: entries, hasError: Boolean(obj.hasError) }
}

function anyKeyword(message: string, keywords: readonly string[]): boolean {
  const m = message.toLowerCase()
  return keywords.some((kw) => m.includes(kw))
}

export interface ResolverTraceLine {
  outcome: 'matched' | 'no-match' | 'parse-fail'
  branchId?: ConnectionBranchId
  detail?: string
}

export interface MatchOptions {
  /** Optional sink to capture a one-line verbose trace (§6.3). */
  trace?: (line: ResolverTraceLine) => void
}

/**
 * Pure deterministic resolver. Trigger order is locked (§3.1):
 *   1. doctor-clean
 *   2. doctor-config-missing
 *   3. doctor-auth-error
 *   4. doctor-network-error
 *
 * Any parse failure → null → caller falls back to envelope.recovery.
 */
export function matchConnectionBranch(
  prev: StepResultSummary,
  opts: MatchOptions = {}
): ConnectionBranchId | null {
  const doctor = parseDoctorJson(prev.stdoutSummary)
  if (doctor === null) {
    opts.trace?.({ outcome: 'parse-fail', detail: 'doctor JSON parse failed' })
    return null
  }

  // 1. doctor-clean — no errors at all
  if (doctor.results.every((r) => r.status !== 'error')) {
    opts.trace?.({ outcome: 'matched', branchId: 'doctor-clean' })
    return 'doctor-clean'
  }

  // 2. doctor-config-missing — config-shape check failed
  if (doctor.results.some((r) => r.status === 'error' && CONFIG_LABELS.has(r.label))) {
    opts.trace?.({ outcome: 'matched', branchId: 'doctor-config-missing' })
    return 'doctor-config-missing'
  }

  const connectionErrors = doctor.results.filter(
    (r) => r.status === 'error' && r.label === 'Connection'
  )

  // 3. doctor-auth-error
  if (connectionErrors.some((r) => anyKeyword(r.message, AUTH_KEYWORDS))) {
    opts.trace?.({ outcome: 'matched', branchId: 'doctor-auth-error' })
    return 'doctor-auth-error'
  }

  // 4. doctor-network-error
  if (connectionErrors.some((r) => anyKeyword(r.message, NETWORK_KEYWORDS))) {
    opts.trace?.({ outcome: 'matched', branchId: 'doctor-network-error' })
    return 'doctor-network-error'
  }

  opts.trace?.({ outcome: 'no-match' })
  return null
}

/** Exposed for the contract test in tests/contract/. */
export const CONNECTION_RESOLVER_KEYWORDS = {
  auth: AUTH_KEYWORDS,
  network: NETWORK_KEYWORDS,
  configLabels: [...CONFIG_LABELS],
} as const
