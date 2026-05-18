import type { GuideStep } from '@/core/guide/types'
import type {
  RecoveryContext,
  BranchPlan,
  BranchFork,
  BranchId,
} from './types'
import type { StepResultSummary } from './next-types'
import { shellQuote } from './shell-quote'

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
  'access denied',
  'login',
] as const

const NETWORK_KEYWORDS = [
  'host',
  'port',
  'refused',
  'timeout',
  'timed out',
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

type StepDraft = Omit<GuideStep, 'order' | 'branchId'>

function renumber(branchId: ConnectionBranchId, drafts: StepDraft[]): GuideStep[] {
  return drafts.map((d, i) => ({ ...d, order: i + 1, branchId }))
}

function planDoctorClean(): BranchPlan {
  const drafts: StepDraft[] = [
    {
      command: 'dbcli inspect --for-agent',
      rationale:
        'Re-anchor in the current context and confirm schemaCache.available; if stale, schema --refresh before retry.',
      risk: 'readonly',
      expects: 'JSON snapshot; check connection.online=true, schemaCache.available.',
    },
  ]
  return {
    description:
      'Doctor reports no errors. Likely a transient failure — verify baseline state, then retry the original command.',
    steps: renumber('doctor-clean', drafts),
  }
}

function planDoctorConfigMissing(): BranchPlan {
  const drafts: StepDraft[] = [
    {
      command: 'dbcli init',
      rationale: 'No usable config; run init to create it.',
      risk: 'write',
      interactive: true,
      expects: 'Init wizard prompts; new .dbcli written.',
    },
    {
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Verify config shape after init.',
      risk: 'readonly',
      expects: 'JSON snapshot with system/permission/blacklist sections populated.',
    },
  ]
  return {
    description:
      'Doctor flagged a config-level failure. Rebuild config before reattempting connection.',
    steps: renumber('doctor-config-missing', drafts),
  }
}

function planDoctorAuthError(): BranchPlan {
  const drafts: StepDraft[] = [
    {
      command: 'dbcli init --force',
      rationale:
        'Re-run init focused on credentials; --force overwrites the existing config in place.',
      risk: 'write',
      interactive: true,
      expects: 'Init wizard accepts new user/password; config rewritten.',
    },
    {
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Confirm config now resolves credentials.',
      risk: 'readonly',
      expects: 'JSON snapshot reflecting updated credentials.',
    },
  ]
  return {
    description:
      'Doctor confirms credentials were rejected. Re-init with --force to overwrite the credential fields.',
    steps: renumber('doctor-auth-error', drafts),
  }
}

function planDoctorNetworkError(ctx: RecoveryContext): BranchPlan {
  const drafts: StepDraft[] = [
    {
      command: 'dbcli inspect --no-connect --format json',
      rationale: 'Compare expected vs actual host/port without a live probe.',
      risk: 'readonly',
      expects: 'JSON snapshot with connection.name/host/port.',
    },
  ]
  if (ctx.connectionName) {
    drafts.push({
      command: `dbcli use ${shellQuote(ctx.connectionName)}`,
      rationale:
        'Re-select the failing named connection so subsequent commands target it explicitly.',
      risk: 'write',
      dbWrite: false,
      expects: 'Active connection switched.',
    })
  }
  drafts.push({
    command: 'dbcli init --force',
    rationale: 'If addressing is wrong, rewrite host/port via init.',
    risk: 'write',
    interactive: true,
    expects: 'Init wizard accepts new host/port; config rewritten.',
  })
  return {
    description:
      'Doctor confirms a network-level failure (host / port / DNS / timeout). Inspect expected vs actual addressing, optionally re-select named connection, then re-init host/port.',
    steps: renumber('doctor-network-error', drafts),
  }
}

export function buildConnectionBranches(
  ctx: RecoveryContext
): { branches: Record<BranchId, BranchPlan>; branchFork: BranchFork } {
  const branches: Record<BranchId, BranchPlan> = {
    'doctor-clean': planDoctorClean(),
    'doctor-config-missing': planDoctorConfigMissing(),
    'doctor-auth-error': planDoctorAuthError(),
    'doctor-network-error': planDoctorNetworkError(ctx),
  }
  return {
    branches,
    branchFork: { after: 1, branchIds: [...CONNECTION_BRANCH_IDS] },
  }
}
