import { join } from 'node:path'
import { containsBlockedSemanticIdentifier } from '@/core/semantic'

export const SEMANTIC_CONTRACT_VERSION = 1

export type SemanticContractStatus = 'draft' | 'approved' | 'deprecated'
export type SemanticContractEvidencePolicy = 'none' | 'receipt-required' | 'verification-required'

export interface SemanticContract {
  name: string
  status: SemanticContractStatus
  description: string
  subjects: string[]
  owner: string
  aliases: string[]
  evidencePolicy: SemanticContractEvidencePolicy
}

export interface SemanticContractValidationIssue {
  path: string
  message: string
}

export class SemanticContractValidationError extends Error {
  constructor(
    readonly filePath: string,
    readonly issues: SemanticContractValidationIssue[]
  ) {
    super(
      `Invalid semantic contracts: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`
    )
    this.name = 'SemanticContractValidationError'
  }
}

export interface LoadSemanticContractsInput {
  workspaceRoot: string
  filePath?: string
  /** Existing semantic module callers provide this filtered, canonical registry. */
  references: ReadonlySet<string> | readonly string[]
  /** Existing blacklist callers provide terms that must not enter contract output. */
  blockedTerms?: readonly string[]
  missingFile?: 'allow' | 'error'
}

export interface InspectSemanticContractDriftInput extends LoadSemanticContractsInput {
  /** False only when the caller cannot provide a semantic registry to compare. */
  referencesAvailable?: boolean
}

export interface SemanticContractDriftReport {
  status: 'valid' | 'stale' | 'invalid' | 'unavailable'
  issues: SemanticContractValidationIssue[]
}

const DEFAULT_FILE = 'dbcli.contracts.json'
const MAX_FILE_BYTES = 256 * 1024
const MAX_CONTRACTS = 100
const MAX_SUBJECTS = 20
const MAX_ALIASES = 20
const MAX_NAME_LENGTH = 100
const MAX_TEXT_LENGTH = 1_000
const IDENTIFIER = /^[a-z][a-z0-9-]*$/
const STATUSES = new Set<SemanticContractStatus>(['draft', 'approved', 'deprecated'])
const EVIDENCE_POLICIES = new Set<SemanticContractEvidencePolicy>([
  'none',
  'receipt-required',
  'verification-required',
])

export function defaultSemanticContractsFile(workspaceRoot: string): string {
  return join(workspaceRoot, DEFAULT_FILE)
}

/**
 * Reads only the contract artifact. The caller owns semantic registry and
 * blacklist construction, so this module never reads a schema, SQL, or rows.
 */
export async function loadSemanticContracts(
  input: LoadSemanticContractsInput
): Promise<SemanticContract[]> {
  const loaded = await readContractsFile(input)
  if (!loaded) return []
  const { contracts, issues } = parseSemanticContracts(loaded.raw, input.blockedTerms)
  validateSubjects(contracts, input.references, input.blockedTerms, issues)
  if (issues.length > 0) throw new SemanticContractValidationError(loaded.filePath, issues)
  return normalizeSemanticContracts(contracts)
}

/**
 * Separates malformed artifacts, stale semantic references, and the absence
 * of an available registry without attempting to reconstruct semantic state.
 */
export async function inspectSemanticContractDrift(
  input: InspectSemanticContractDriftInput
): Promise<SemanticContractDriftReport> {
  let loaded: { filePath: string; raw: unknown } | null
  try {
    loaded = await readContractsFile({ ...input, missingFile: input.missingFile ?? 'allow' })
  } catch (error) {
    if (error instanceof SemanticContractValidationError) {
      return { status: 'invalid', issues: error.issues }
    }
    throw error
  }
  if (!loaded) {
    return {
      status: 'unavailable',
      issues: [{ path: '$', message: 'contract file is unavailable' }],
    }
  }

  const { contracts, issues } = parseSemanticContracts(loaded.raw, input.blockedTerms)
  if (issues.length > 0) return { status: 'invalid', issues }
  if (input.referencesAvailable === false) {
    return {
      status: 'unavailable',
      issues: [{ path: '$', message: 'semantic reference registry is unavailable' }],
    }
  }

  validateSubjects(contracts, input.references, input.blockedTerms, issues)
  return issues.length > 0 ? { status: 'stale', issues } : { status: 'valid', issues: [] }
}

/** Returns only contracts eligible for ordinary agent context, in stable order. */
export function filterApprovedSemanticContracts(
  contracts: readonly SemanticContract[]
): SemanticContract[] {
  return normalizeSemanticContracts(contracts.filter((contract) => contract.status === 'approved'))
}

/** Renders prevalidated contracts in the same stable order used for context. */
export function renderSemanticContractsMarkdown(contracts: readonly SemanticContract[]): string {
  const lines = ['# Semantic contracts', '']
  for (const contract of normalizeSemanticContracts(contracts.map(copyContract))) {
    lines.push(
      `## ${escapeMarkdown(contract.name)}`,
      '',
      escapeMarkdown(contract.description),
      '',
      `- Status: ${contract.status}`,
      `- Owner: ${escapeMarkdown(contract.owner)}`,
      `- Evidence policy: ${contract.evidencePolicy}`,
      `- Subjects: ${contract.subjects.map((subject) => `\`${escapeMarkdown(subject)}\``).join(', ')}`
    )
    if (contract.aliases.length > 0) {
      lines.push(`- Aliases: ${contract.aliases.map(escapeMarkdown).join(', ')}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

export function parseSemanticContracts(
  raw: unknown,
  blockedTerms: readonly string[] = []
): { contracts: SemanticContract[]; issues: SemanticContractValidationIssue[] } {
  const issues: SemanticContractValidationIssue[] = []
  const root = record(raw, '$', issues)
  rejectUnknownKeys(root, ['version', 'contracts'], '$', issues)
  if (root.version !== SEMANTIC_CONTRACT_VERSION) {
    issue(issues, '$.version', `must equal ${SEMANTIC_CONTRACT_VERSION}`)
  }
  const values = array(root.contracts, '$.contracts', issues)
  if (values.length > MAX_CONTRACTS) {
    issue(issues, '$.contracts', `must contain at most ${MAX_CONTRACTS} items`)
  }
  const names = new Set<string>()
  const contracts = values.map((value, index) =>
    parseContract(value, `$.contracts[${index}]`, names, blockedTerms, issues)
  )
  return { contracts, issues }
}

function copyContract(contract: SemanticContract): SemanticContract {
  return { ...contract, subjects: [...contract.subjects], aliases: [...contract.aliases] }
}

function normalizeSemanticContracts(contracts: SemanticContract[]): SemanticContract[] {
  return contracts
    .map((contract) => ({
      ...contract,
      subjects: [...contract.subjects].sort(compareCodeUnits),
      aliases: [...contract.aliases].sort(compareCodeUnits),
    }))
    .sort((a, b) => compareCodeUnits(a.name, b.name))
}

async function readContractsFile(
  input: Pick<LoadSemanticContractsInput, 'workspaceRoot' | 'filePath' | 'missingFile'>
): Promise<{ filePath: string; raw: unknown } | null> {
  const filePath = input.filePath ?? defaultSemanticContractsFile(input.workspaceRoot)
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    if (input.missingFile !== 'error') return null
    throw new SemanticContractValidationError(filePath, [{ path: '$', message: 'file not found' }])
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new SemanticContractValidationError(filePath, [
      { path: '$', message: `file exceeds ${MAX_FILE_BYTES} bytes` },
    ])
  }
  try {
    return { filePath, raw: JSON.parse(await file.text()) }
  } catch {
    throw new SemanticContractValidationError(filePath, [{ path: '$', message: 'invalid JSON' }])
  }
}

function parseContract(
  raw: unknown,
  path: string,
  names: Set<string>,
  blockedTerms: readonly string[],
  issues: SemanticContractValidationIssue[]
): SemanticContract {
  const value = record(raw, path, issues)
  rejectUnknownKeys(
    value,
    ['name', 'status', 'description', 'subjects', 'owner', 'aliases', 'evidencePolicy'],
    path,
    issues
  )
  const name = canonicalName(value.name, `${path}.name`, issues)
  if (names.has(name)) issue(issues, `${path}.name`, 'duplicate contract name')
  names.add(name)
  const status = enumValue(value.status, STATUSES, `${path}.status`, 'status', issues, 'draft')
  const description = plainText(value.description, `${path}.description`, blockedTerms, issues)
  const owner = plainText(value.owner, `${path}.owner`, blockedTerms, issues)
  const aliases = parseAliases(value.aliases, `${path}.aliases`, blockedTerms, issues)
  const subjects = parseSubjects(value.subjects, `${path}.subjects`, issues)
  const evidencePolicy = enumValue(
    value.evidencePolicy,
    EVIDENCE_POLICIES,
    `${path}.evidencePolicy`,
    'evidence policy',
    issues,
    'none'
  )
  return { name, status, description, subjects, owner, aliases, evidencePolicy }
}

function validateSubjects(
  contracts: readonly SemanticContract[],
  references: ReadonlySet<string> | readonly string[],
  blockedTerms: readonly string[] | undefined,
  issues: SemanticContractValidationIssue[]
): void {
  const registry = references instanceof Set ? references : new Set(references)
  const blocked = blockedTerms ?? []
  for (const [contractIndex, contract] of contracts.entries()) {
    for (const [subjectIndex, subject] of contract.subjects.entries()) {
      const path = `$.contracts[${contractIndex}].subjects[${subjectIndex}]`
      if (containsBlockedIdentifier(subject, blocked)) {
        issue(issues, path, 'must not contain a protected semantic reference')
      } else if (!registry.has(subject)) {
        issue(issues, path, 'must reference an available semantic entity')
      }
    }
  }
}

function parseSubjects(
  raw: unknown,
  path: string,
  issues: SemanticContractValidationIssue[]
): string[] {
  const values = array(raw, path, issues)
  if (values.length === 0 || values.length > MAX_SUBJECTS) {
    issue(issues, path, `must contain between 1 and ${MAX_SUBJECTS} items`)
  }
  const seen = new Set<string>()
  return values.map((value, index) => {
    const subject = text(value, `${path}[${index}]`, MAX_NAME_LENGTH, issues)
    if (seen.has(subject)) issue(issues, `${path}[${index}]`, 'duplicate subject')
    seen.add(subject)
    return subject
  })
}

function parseAliases(
  raw: unknown,
  path: string,
  blockedTerms: readonly string[],
  issues: SemanticContractValidationIssue[]
): string[] {
  if (raw === undefined) return []
  const values = array(raw, path, issues)
  if (values.length > MAX_ALIASES) issue(issues, path, `must contain at most ${MAX_ALIASES} items`)
  const seen = new Set<string>()
  return values.map((value, index) => {
    const alias = plainText(value, `${path}[${index}]`, blockedTerms, issues)
    if (seen.has(alias)) issue(issues, `${path}[${index}]`, 'duplicate alias')
    seen.add(alias)
    return alias
  })
}

function canonicalName(
  raw: unknown,
  path: string,
  issues: SemanticContractValidationIssue[]
): string {
  const value = text(raw, path, MAX_NAME_LENGTH, issues)
  if (!IDENTIFIER.test(value)) issue(issues, path, 'must be a canonical identifier')
  return value
}

function plainText(
  raw: unknown,
  path: string,
  blockedTerms: readonly string[],
  issues: SemanticContractValidationIssue[]
): string {
  const value = text(raw, path, MAX_TEXT_LENGTH, issues)
  if (containsBlockedIdentifier(value, blockedTerms)) {
    issue(issues, path, 'must not contain a protected identifier')
  }
  if (containsUnsafeText(value)) issue(issues, path, 'must contain bounded plain text only')
  return value
}

function enumValue<T extends string>(
  raw: unknown,
  values: ReadonlySet<T>,
  path: string,
  label: string,
  issues: SemanticContractValidationIssue[],
  fallback: T
): T {
  if (typeof raw === 'string' && values.has(raw as T)) return raw as T
  issue(issues, path, `must be a supported ${label}`)
  return fallback
}

function containsUnsafeText(value: string): boolean {
  return /[\r\n]|\b(select|insert|update|delete|drop|alter|grant|revoke|password|secret|credential)\b|--|\/\*|\*\/|\b(?:row|rows|example data)\b|\b[A-Za-z_][A-Za-z0-9_$]+\.[A-Za-z_][A-Za-z0-9_$]*\b/i.test(
    value
  )
}

function containsBlockedIdentifier(value: string, blockedTerms: readonly string[]): boolean {
  return containsBlockedSemanticIdentifier(value, blockedTerms)
}

function record(
  raw: unknown,
  path: string,
  issues: SemanticContractValidationIssue[]
): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  issue(issues, path, 'must be an object')
  return {}
}

function array(raw: unknown, path: string, issues: SemanticContractValidationIssue[]): unknown[] {
  if (Array.isArray(raw)) return raw
  issue(issues, path, 'must be an array')
  return []
}

function text(
  raw: unknown,
  path: string,
  maxLength: number,
  issues: SemanticContractValidationIssue[]
): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > maxLength) {
    issue(issues, path, `must be text between 1 and ${maxLength} characters`)
    return ''
  }
  const value = raw.trim()
  if (value.length === 0) issue(issues, path, `must be text between 1 and ${maxLength} characters`)
  return value
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: SemanticContractValidationIssue[]
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) issue(issues, `${path}.${key}`, 'is not allowed')
  }
}

function issue(issues: SemanticContractValidationIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function escapeMarkdown(value: string): string {
  return [...value]
    .map((character) => ('\\`*_[]()<>#'.includes(character) ? `\\${character}` : character))
    .join('')
}
