import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { isVerificationStatus, type VerificationStatus } from '@/core/verification'

export const EVIDENCE_RECEIPT_VERSION = 1 as const

const SHA256 = /^sha256:[a-f0-9]{64}$/
const SAFE_TEXT = /^[A-Za-z0-9_.:@<>= -]+$/
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/
const MAX_RECEIPT_BYTES = 64 * 1024

export interface EvidenceReceipt {
  version: typeof EVIDENCE_RECEIPT_VERSION
  id: string
  createdAt: string
  operation: 'assert' | 'verify'
  outcome: 'succeeded' | 'failed'
  context: {
    engine: string
    connectionName: string
    environment: string
    schemaFingerprint: string
    semanticFingerprint: string | null
  }
  provenance: {
    command: string
    commandHash: string
    auditRef: string | null
    verificationArtifactRef: string | null
  }
  replay: { status: 'context-required' }
  observation: { kind: 'assert-verdict' | 'verify-outcome'; fingerprint: string }
}

interface BuildEvidenceReceiptBase {
  command: string
  context: EvidenceReceipt['context']
  auditRef?: string | null
  verificationArtifactRef?: string | null
}

type AssertVerdictBits = { pass: boolean; checks: ReadonlyArray<{ pass: boolean }> }

export type BuildEvidenceReceiptInput =
  | (BuildEvidenceReceiptBase & {
      operation?: 'assert'
      /** Only bounded pass bits may enter an assert receipt. */
      verdict: AssertVerdictBits
    })
  | (BuildEvidenceReceiptBase & {
      operation: 'verify'
      /** Kept distinct from the receipt's coarse outcome. */
      verificationStatus: VerificationStatus
      /** Whether the linked verification artifact persisted. */
      verificationArtifactPersisted: boolean
    })

export class EvidenceReceiptValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceReceiptValidationError'
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new EvidenceReceiptValidationError(`${label} contains an unknown field`)
  }
}

function bounded(value: unknown, label: string, max = 2_000): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    !SAFE_TEXT.test(value)
  ) {
    throw new EvidenceReceiptValidationError(`${label} must be safe bounded text`)
  }
  return value
}

function boundedCommandSource(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_000) {
    throw new EvidenceReceiptValidationError('command must be bounded text')
  }
  return value
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new EvidenceReceiptValidationError(`${label} must be a safe identifier`)
  }
  return value
}

function nullableId(value: unknown, label: string): string | null {
  if (value === null) return null
  return safeId(value, label)
}

function fingerprint(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new EvidenceReceiptValidationError(`${label} must be a sha256 fingerprint`)
  }
  return value
}

function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    !/^\d{4}-\d{2}-\d{2}T/.test(value)
  ) {
    throw new EvidenceReceiptValidationError('createdAt must be an ISO timestamp')
  }
  return value
}

/** Remove runtime executable/source prefixes; retain only already-redacted command provenance. */
export function canonicalizeEvidenceReceiptCommand(
  command: string,
  operation: EvidenceReceipt['operation'] = 'assert'
): string {
  // Runtime argv includes absolute executable/source paths. Discard that prefix first;
  // only the already-redacted operation segment is allowed into the receipt.
  const source = boundedCommandSource(command)
  const match = new RegExp(`(?:^|\\s)${operation}(?:\\s|$)`).exec(source)
  if (!match) throw new EvidenceReceiptValidationError(`command must contain ${operation}`)
  const args = source.slice(match.index + match[0].indexOf(operation) + operation.length).trim()
  const canonical = `dbcli ${operation}${args ? ` ${args}` : ''}`
  if (
    !SAFE_TEXT.test(canonical) ||
    /\b(?:select|insert|update|delete|from|password|secret|token|error|exception)\b/i.test(
      canonical
    )
  ) {
    throw new EvidenceReceiptValidationError('command is not safe redacted provenance')
  }
  return canonical
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function verdictFingerprint(verdict: AssertVerdictBits): string {
  if (
    !record(verdict) ||
    typeof verdict.pass !== 'boolean' ||
    !Array.isArray(verdict.checks) ||
    verdict.checks.length > 1_000
  ) {
    throw new EvidenceReceiptValidationError('verdict must contain bounded pass bits')
  }
  const bits = verdict.checks.map((check) => {
    if (
      !record(check) ||
      Object.keys(check).some((key) => key !== 'pass') ||
      typeof check.pass !== 'boolean'
    ) {
      throw new EvidenceReceiptValidationError('verdict checks must contain only pass bits')
    }
    return check.pass
  })
  return sha256(JSON.stringify({ pass: verdict.pass, checks: bits }))
}

function verificationOutcomeFingerprint(
  status: VerificationStatus,
  artifactPersisted: boolean
): string {
  if (!isVerificationStatus(status)) {
    throw new EvidenceReceiptValidationError('verificationStatus must be a verification status')
  }
  if (typeof artifactPersisted !== 'boolean') {
    throw new EvidenceReceiptValidationError('verificationArtifactPersisted must be a boolean')
  }
  return sha256(JSON.stringify({ status, artifactPersisted }))
}

export function buildEvidenceReceipt(
  input: BuildEvidenceReceiptInput,
  options: { now?: () => Date; idFactory?: () => string } = {}
): EvidenceReceipt {
  const operation: EvidenceReceipt['operation'] = input.operation === 'verify' ? 'verify' : 'assert'
  const command = canonicalizeEvidenceReceiptCommand(input.command, operation)
  const context = parseContext(input.context)
  const { observationFingerprint, outcome } =
    input.operation === 'verify'
      ? {
          observationFingerprint: verificationOutcomeFingerprint(
            input.verificationStatus,
            input.verificationArtifactPersisted
          ),
          outcome:
            input.verificationStatus === 'verified' && input.verificationArtifactPersisted
              ? ('succeeded' as const)
              : ('failed' as const),
        }
      : {
          observationFingerprint: verdictFingerprint(input.verdict),
          outcome: input.verdict.pass ? ('succeeded' as const) : ('failed' as const),
        }
  const receipt: EvidenceReceipt = {
    version: EVIDENCE_RECEIPT_VERSION,
    id: safeId(options.idFactory?.() ?? `evr_${randomUUID()}`, 'id'),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    operation,
    outcome,
    context,
    provenance: {
      command,
      commandHash: sha256(command),
      auditRef: input.auditRef === undefined ? null : nullableId(input.auditRef, 'auditRef'),
      verificationArtifactRef:
        input.verificationArtifactRef === undefined
          ? null
          : nullableId(input.verificationArtifactRef, 'verificationArtifactRef'),
    },
    replay: { status: 'context-required' },
    observation: {
      kind: operation === 'assert' ? 'assert-verdict' : 'verify-outcome',
      fingerprint: observationFingerprint,
    },
  }
  return receipt
}

function parseContext(value: unknown): EvidenceReceipt['context'] {
  if (!record(value)) throw new EvidenceReceiptValidationError('context must be an object')
  exact(
    value,
    ['engine', 'connectionName', 'environment', 'schemaFingerprint', 'semanticFingerprint'],
    'context'
  )
  return {
    engine: bounded(value.engine, 'context.engine', 100),
    connectionName: bounded(value.connectionName, 'context.connectionName', 160),
    environment: bounded(value.environment, 'context.environment', 160),
    schemaFingerprint: fingerprint(value.schemaFingerprint, 'context.schemaFingerprint'),
    semanticFingerprint:
      value.semanticFingerprint === null
        ? null
        : fingerprint(value.semanticFingerprint, 'context.semanticFingerprint'),
  }
}

export function parseEvidenceReceipt(raw: unknown): EvidenceReceipt {
  if (!record(raw)) throw new EvidenceReceiptValidationError('evidence receipt must be an object')
  exact(
    raw,
    [
      'version',
      'id',
      'createdAt',
      'operation',
      'outcome',
      'context',
      'provenance',
      'replay',
      'observation',
    ],
    'evidence receipt'
  )
  if (raw.version !== EVIDENCE_RECEIPT_VERSION)
    throw new EvidenceReceiptValidationError('evidence receipt version must be 1')
  if (raw.operation !== 'assert' && raw.operation !== 'verify')
    throw new EvidenceReceiptValidationError('operation is invalid')
  const operation: EvidenceReceipt['operation'] = raw.operation
  if (raw.outcome !== 'succeeded' && raw.outcome !== 'failed')
    throw new EvidenceReceiptValidationError('outcome is invalid')
  if (!record(raw.provenance))
    throw new EvidenceReceiptValidationError('provenance must be an object')
  exact(
    raw.provenance,
    ['command', 'commandHash', 'auditRef', 'verificationArtifactRef'],
    'provenance'
  )
  const command = canonicalizeEvidenceReceiptCommand(
    bounded(raw.provenance.command, 'provenance.command'),
    operation
  )
  if (
    command !== raw.provenance.command ||
    fingerprint(raw.provenance.commandHash, 'provenance.commandHash') !== sha256(command)
  )
    throw new EvidenceReceiptValidationError('command provenance hash mismatch')
  if (
    !record(raw.replay) ||
    raw.replay.status !== 'context-required' ||
    Object.keys(raw.replay).length !== 1
  )
    throw new EvidenceReceiptValidationError('replay must be context-required')
  if (
    !record(raw.observation) ||
    raw.observation.kind !== (operation === 'assert' ? 'assert-verdict' : 'verify-outcome') ||
    Object.keys(raw.observation).length !== 2
  )
    throw new EvidenceReceiptValidationError('observation must match receipt operation')
  const observationKind: EvidenceReceipt['observation']['kind'] =
    operation === 'assert' ? 'assert-verdict' : 'verify-outcome'
  return {
    version: EVIDENCE_RECEIPT_VERSION,
    id: safeId(raw.id, 'id'),
    createdAt: timestamp(raw.createdAt),
    operation,
    outcome: raw.outcome,
    context: parseContext(raw.context),
    provenance: {
      command,
      commandHash: fingerprint(raw.provenance.commandHash, 'provenance.commandHash'),
      auditRef: nullableId(raw.provenance.auditRef, 'provenance.auditRef'),
      verificationArtifactRef: nullableId(
        raw.provenance.verificationArtifactRef,
        'provenance.verificationArtifactRef'
      ),
    },
    replay: { status: 'context-required' },
    observation: {
      kind: observationKind,
      fingerprint: fingerprint(raw.observation.fingerprint, 'observation.fingerprint'),
    },
  }
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !rel.includes(`..${sep}`))
}
async function existingAncestor(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      return await realpath(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

export async function writeEvidenceReceipt(
  workspaceRoot: string,
  outputPath: string,
  receipt: EvidenceReceipt
): Promise<string> {
  parseEvidenceReceipt(receipt)
  const workspace = await realpath(workspaceRoot)
  const requested = resolve(workspace, outputPath)
  if (!inside(workspace, requested))
    throw new EvidenceReceiptValidationError('output path must stay inside the workspace')
  const parent = dirname(requested)
  if (!inside(workspace, await existingAncestor(parent)))
    throw new EvidenceReceiptValidationError('output path resolves outside the workspace')
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent)
  if (!inside(workspace, realParent))
    throw new EvidenceReceiptValidationError('output path resolves outside the workspace')
  const target = resolve(realParent, basename(requested))
  try {
    await lstat(target)
    throw new EvidenceReceiptValidationError('evidence receipt output already exists')
  } catch (error) {
    if (error instanceof EvidenceReceiptValidationError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temp = resolve(realParent, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    try {
      await link(temp, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new EvidenceReceiptValidationError('evidence receipt output already exists')
      throw error
    }
  } finally {
    await unlink(temp).catch(() => {})
  }
  return target
}

export async function readEvidenceReceipt(filePath: string): Promise<EvidenceReceipt> {
  const stats = await lstat(filePath).catch(() => {
    throw new EvidenceReceiptValidationError('evidence receipt file not found')
  })
  if (!stats.isFile())
    throw new EvidenceReceiptValidationError('evidence receipt must be a regular file')
  if (stats.size > MAX_RECEIPT_BYTES)
    throw new EvidenceReceiptValidationError('evidence receipt file exceeds 64 KiB')
  try {
    return parseEvidenceReceipt(JSON.parse(await readFile(filePath, 'utf8')))
  } catch (error) {
    if (error instanceof EvidenceReceiptValidationError) throw error
    throw new EvidenceReceiptValidationError('evidence receipt must contain valid JSON')
  }
}
