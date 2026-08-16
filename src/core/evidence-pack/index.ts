import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { sqlParser } from '@/core/sql-parser'

export const EVIDENCE_PACK_VERSION = 1 as const

export type VerificationEvidenceStatus = 'verified' | 'not_verified' | 'indeterminate' | 'blocked'

const MAX_CLAIMS = 100
const MAX_REFERENCES = 100
const MAX_TEXT_LENGTH = 2_000
const MAX_ID_LENGTH = 160
const MARKDOWN_ESCAPE_CHARACTERS = new Set('\\`*_{}[]<>()#+!|')
const SQL_FRAGMENT =
  /(?:^|\s)(?:select\s+.+\s+from|insert\s+into|update\s+\S+\s+set|delete\s+from|alter\s+(?:table|index)|create\s+(?:table|index)|drop\s+(?:table|index)|truncate\s+table|merge\s+into|grant\s+.+\s+on|revoke\s+.+\s+on|from\s+\S+\s+where)\b/i
const UNPARSED_SQL_PREFIX =
  /^\s*(?:(?:--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*)*(?:copy|vacuum|analyze|reindex|cluster|comment|do|prepare|execute|deallocate|lock|begin|start|commit|rollback|savepoint|release|declare|fetch|move|listen|notify|unlisten|load|attach|detach|pragma|replace|handler|kill|optimize|repair|check|flush|install|uninstall)\b/i

export type EvidenceReference =
  | {
      kind: 'verification-artifact'
      id: string
      createdAt: string
      status: VerificationEvidenceStatus
      subjectKind: string
    }
  | {
      kind: 'audit'
      id: string
      createdAt: string
      connectionName: string
      command: string
      success: boolean
      recoveryRef?: string
    }
  | {
      kind: 'receipt'
      id: string
      createdAt: string
      operation: 'assert' | 'verify'
      outcome: 'succeeded' | 'failed'
      digest: string
      path: string
    }

export interface EvidenceClaimInput {
  id: string
  text: string
}

export interface EvidencePackSubject {
  kind: string
  name?: string
}

export interface EvidenceClaimsInput {
  subject: EvidencePackSubject
  claims: EvidenceClaimInput[]
}

export interface EvidenceClaim extends EvidenceClaimInput {
  evidence: EvidenceReference[]
}

/**
 * The part of a pack the digest and the id are derived from.
 *
 * `createdAt` is deliberately outside it. Including it made two composes of the
 * same claims produce two unrelated digests, which left nothing to compare
 * across runs; the cost is that a restamped `createdAt` is not detectable,
 * which the render and the user documentation both say plainly.
 */
export interface EvidencePackContent {
  version: typeof EVIDENCE_PACK_VERSION
  subject: EvidencePackSubject
  claims: EvidenceClaim[]
}

export interface EvidencePack extends EvidencePackContent {
  id: string
  createdAt: string
  integrity: {
    algorithm: 'sha256'
    digest: string
  }
}

export class EvidencePackValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidencePackValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new EvidencePackValidationError(`${label} contains an unknown field`)
  }
}

function text(value: unknown, label: string, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new EvidencePackValidationError(`${label} must be a non-empty bounded string`)
  }
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0)!
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new EvidencePackValidationError(`${label} contains control characters`)
  }
  return value
}

function claimText(value: unknown): string {
  const parsed = text(value, 'claim.text')
  if (containsRawSql(parsed)) {
    throw new EvidencePackValidationError('claim text must not contain SQL')
  }
  if (
    /\b(?:password|secret|token|api[ _-]?key|authorization|credential)\s*[:=]|\bbearer\s+\S+|\b(?:error|exception)\s*:/i.test(
      parsed
    )
  ) {
    throw new EvidencePackValidationError(
      'claim text must not contain credentials or error content'
    )
  }
  if (/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|https?):\/\//i.test(parsed)) {
    throw new EvidencePackValidationError('claim text must not contain connection strings')
  }
  return parsed
}

function containsRawSql(value: string): boolean {
  try {
    sqlParser().astify(value)
    return true
  } catch {
    return (
      SQL_FRAGMENT.test(value) ||
      /\bwhere\s+\S+\s*(?:=|<>|!=|<=|>=|<|>)\s*\S+/i.test(value) ||
      UNPARSED_SQL_PREFIX.test(value)
    )
  }
}

function id(value: unknown, label: string): string {
  const parsed = text(value, label, MAX_ID_LENGTH)
  if (!/^[A-Za-z0-9._:-]+$/.test(parsed)) {
    throw new EvidencePackValidationError(`${label} contains unsupported characters`)
  }
  return parsed
}

function iso(value: unknown, label: string): string {
  const parsed = text(value, label, 64)
  if (Number.isNaN(Date.parse(parsed))) {
    throw new EvidencePackValidationError(`${label} must be an ISO date`)
  }
  return parsed
}

function parseSubject(value: unknown): EvidencePackSubject {
  if (!isRecord(value)) throw new EvidencePackValidationError('subject must be an object')
  requireExactKeys(value, ['kind', 'name'], 'subject')
  const kind = id(value.kind, 'subject.kind')
  const name = value.name === undefined ? undefined : text(value.name, 'subject.name')
  return name === undefined ? { kind } : { kind, name }
}

function compareReferences(a: EvidenceReference, b: EvidenceReference): number {
  return a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)
}

function parseReference(value: unknown): EvidenceReference {
  if (!isRecord(value))
    throw new EvidencePackValidationError('evidence reference must be an object')
  const kind = value.kind
  if (kind === 'verification-artifact') {
    requireExactKeys(
      value,
      ['kind', 'id', 'createdAt', 'status', 'subjectKind'],
      'verification evidence'
    )
    const status = value.status
    if (!['verified', 'not_verified', 'indeterminate', 'blocked'].includes(String(status))) {
      throw new EvidencePackValidationError('verification evidence has an invalid status')
    }
    return {
      kind,
      id: id(value.id, 'verification evidence.id'),
      createdAt: iso(value.createdAt, 'verification evidence.createdAt'),
      status: status as VerificationEvidenceStatus,
      subjectKind: id(value.subjectKind, 'verification evidence.subjectKind'),
    }
  }
  if (kind === 'audit') {
    requireExactKeys(
      value,
      ['kind', 'id', 'createdAt', 'connectionName', 'command', 'success', 'recoveryRef'],
      'audit evidence'
    )
    if (typeof value.success !== 'boolean') {
      throw new EvidencePackValidationError('audit evidence.success must be a boolean')
    }
    const recoveryRef =
      value.recoveryRef === undefined
        ? undefined
        : id(value.recoveryRef, 'audit evidence.recoveryRef')
    return {
      kind,
      id: id(value.id, 'audit evidence.id'),
      createdAt: iso(value.createdAt, 'audit evidence.createdAt'),
      connectionName: id(value.connectionName, 'audit evidence.connectionName'),
      command: id(value.command, 'audit evidence.command'),
      success: value.success,
      ...(recoveryRef === undefined ? {} : { recoveryRef }),
    }
  }
  if (kind === 'receipt') {
    requireExactKeys(
      value,
      ['kind', 'id', 'createdAt', 'operation', 'outcome', 'digest', 'path'],
      'receipt evidence'
    )
    if (
      !['assert', 'verify'].includes(String(value.operation)) ||
      !['succeeded', 'failed'].includes(String(value.outcome))
    ) {
      throw new EvidencePackValidationError('receipt evidence has an invalid operation or outcome')
    }
    const path = text(value.path, 'receipt evidence.path', 512)
    if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      throw new EvidencePackValidationError('receipt evidence.path must be workspace-relative')
    }
    const digest = text(value.digest, 'receipt evidence.digest', 80)
    if (!/^sha256:[a-f0-9]{64}$/.test(digest))
      throw new EvidencePackValidationError('receipt evidence.digest is invalid')
    return {
      kind,
      id: id(value.id, 'receipt evidence.id'),
      createdAt: iso(value.createdAt, 'receipt evidence.createdAt'),
      operation: value.operation as 'assert' | 'verify',
      outcome: value.outcome as 'succeeded' | 'failed',
      digest,
      path,
    }
  }
  throw new EvidencePackValidationError('evidence reference has an unsupported kind')
}

function parseClaims(value: unknown, requireEvidence: boolean): EvidenceClaim[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CLAIMS) {
    throw new EvidencePackValidationError(`claims must contain between 1 and ${MAX_CLAIMS} entries`)
  }
  const claimIds = new Set<string>()
  const claims = value.map((raw) => {
    if (!isRecord(raw)) throw new EvidencePackValidationError('claim must be an object')
    requireExactKeys(raw, requireEvidence ? ['id', 'text', 'evidence'] : ['id', 'text'], 'claim')
    const claimId = id(raw.id, 'claim.id')
    if (claimIds.has(claimId)) throw new EvidencePackValidationError('claim ids must be unique')
    claimIds.add(claimId)
    const parsedClaimText = claimText(raw.text)
    const evidenceRaw = requireEvidence ? raw.evidence : []
    if (
      !Array.isArray(evidenceRaw) ||
      evidenceRaw.length === 0 ||
      evidenceRaw.length > MAX_REFERENCES
    ) {
      throw new EvidencePackValidationError(
        `claim evidence must contain between 1 and ${MAX_REFERENCES} entries`
      )
    }
    const evidence = evidenceRaw.map(parseReference).sort(compareReferences)
    const refs = new Set(evidence.map((reference) => `${reference.kind}\u0000${reference.id}`))
    if (refs.size !== evidence.length)
      throw new EvidencePackValidationError('claim evidence references must be unique')
    return { id: claimId, text: parsedClaimText, evidence }
  })
  return claims.sort((a, b) => a.id.localeCompare(b.id))
}

function assertVerificationSubjects(subject: EvidencePackSubject, claims: EvidenceClaim[]): void {
  if (
    claims.some((claim) =>
      claim.evidence.some(
        (reference) =>
          reference.kind === 'verification-artifact' && reference.subjectKind !== subject.kind
      )
    )
  ) {
    throw new EvidencePackValidationError(
      'verification evidence must match the claims subject kind'
    )
  }
}

/**
 * Serialize with every object key sorted, at every depth.
 *
 * The previous implementation was a bare `JSON.stringify`, so "canonical" meant
 * "whatever order the build and parse paths happened to insert keys in". Any
 * edit to either one would have silently invalidated every stored digest.
 */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`)
  return `{${entries.join(',')}}`
}

function digest(content: EvidencePackContent): string {
  return createHash('sha256').update(canonicalize(content)).digest('hex')
}

/**
 * Content-addressed id, so equivalent packs are recognisably the same pack.
 */
function packId(contentDigest: string): string {
  return `evp_${contentDigest.slice(0, 32)}`
}

export function parseEvidenceClaimsInput(raw: unknown): EvidenceClaimsInput {
  if (!isRecord(raw)) throw new EvidencePackValidationError('claims input must be an object')
  requireExactKeys(raw, ['subject', 'claims'], 'claims input')
  const subject = parseSubject(raw.subject)
  if (!Array.isArray(raw.claims) || raw.claims.length === 0 || raw.claims.length > MAX_CLAIMS) {
    throw new EvidencePackValidationError(`claims must contain between 1 and ${MAX_CLAIMS} entries`)
  }
  const seen = new Set<string>()
  const claims = raw.claims
    .map((claim) => {
      if (!isRecord(claim)) throw new EvidencePackValidationError('claim must be an object')
      requireExactKeys(claim, ['id', 'text'], 'claim')
      const claimId = id(claim.id, 'claim.id')
      if (seen.has(claimId)) throw new EvidencePackValidationError('claim ids must be unique')
      seen.add(claimId)
      return { id: claimId, text: claimText(claim.text) }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return { subject, claims }
}

export function buildEvidencePack(
  input: EvidenceClaimsInput,
  references: EvidenceReference[],
  options: { now?: () => Date } = {}
): EvidencePack {
  if (references.length === 0 || references.length > MAX_REFERENCES) {
    throw new EvidencePackValidationError(
      `references must contain between 1 and ${MAX_REFERENCES} entries`
    )
  }
  const evidence = references.map(parseReference).sort(compareReferences)
  const refKeys = new Set(evidence.map((reference) => `${reference.kind}\u0000${reference.id}`))
  if (refKeys.size !== evidence.length)
    throw new EvidencePackValidationError('references must be unique')
  const normalized = parseEvidenceClaimsInput(input)
  if (
    evidence.some(
      (reference) =>
        reference.kind === 'verification-artifact' &&
        reference.subjectKind !== normalized.subject.kind
    )
  ) {
    throw new EvidencePackValidationError(
      'verification evidence must match the claims subject kind'
    )
  }
  const content: EvidencePackContent = {
    version: EVIDENCE_PACK_VERSION,
    subject: normalized.subject,
    claims: normalized.claims.map((claim) => ({ ...claim, evidence })),
  }
  const contentDigest = digest(content)
  return {
    ...content,
    id: packId(contentDigest),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    integrity: { algorithm: 'sha256', digest: contentDigest },
  }
}

export function parseEvidencePack(raw: unknown): EvidencePack {
  if (!isRecord(raw)) throw new EvidencePackValidationError('evidence pack must be an object')
  requireExactKeys(
    raw,
    ['version', 'id', 'createdAt', 'subject', 'claims', 'integrity'],
    'evidence pack'
  )
  if (raw.version !== EVIDENCE_PACK_VERSION) {
    throw new EvidencePackValidationError(`evidence pack version must be ${EVIDENCE_PACK_VERSION}`)
  }
  if (!isRecord(raw.integrity)) throw new EvidencePackValidationError('integrity must be an object')
  requireExactKeys(raw.integrity, ['algorithm', 'digest'], 'integrity')
  if (raw.integrity.algorithm !== 'sha256')
    throw new EvidencePackValidationError('integrity.algorithm must be sha256')
  const content: EvidencePackContent = {
    version: EVIDENCE_PACK_VERSION,
    subject: parseSubject(raw.subject),
    claims: parseClaims(raw.claims, true),
  }
  assertVerificationSubjects(content.subject, content.claims)
  const actualDigest = text(raw.integrity.digest, 'integrity.digest', 128)
  if (!/^[a-f0-9]{64}$/.test(actualDigest))
    throw new EvidencePackValidationError('integrity.digest must be sha256 hex')
  const expectedDigest = digest(content)
  if (actualDigest !== expectedDigest)
    throw new EvidencePackValidationError('evidence pack digest mismatch')
  const packIdentity = id(raw.id, 'pack.id')
  if (packIdentity !== packId(expectedDigest))
    throw new EvidencePackValidationError('evidence pack id does not match its content digest')
  return {
    ...content,
    id: packIdentity,
    createdAt: iso(raw.createdAt, 'pack.createdAt'),
    integrity: { algorithm: 'sha256', digest: actualDigest },
  }
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return (
    relativePath !== '' &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== '..' &&
    !relativePath.includes(`..${sep}`)
  )
}

async function realExistingAncestor(path: string): Promise<string> {
  let candidate = path
  while (true) {
    try {
      return await realpath(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(candidate)
      if (parent === candidate) throw error
      candidate = parent
    }
  }
}

export async function writeEvidencePack(
  workspaceRoot: string,
  outputPath: string,
  pack: EvidencePack
): Promise<string> {
  const workspace = await realpath(workspaceRoot)
  const requestedTarget = resolve(workspace, outputPath)
  if (!isInside(workspace, requestedTarget))
    throw new EvidencePackValidationError('output path must stay inside the workspace')
  const parent = dirname(requestedTarget)
  const existingAncestor = await realExistingAncestor(parent)
  if (!isInside(workspace, existingAncestor) && existingAncestor !== workspace) {
    throw new EvidencePackValidationError('output path resolves outside the workspace')
  }
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent)
  if (!isInside(workspace, realParent) && realParent !== workspace) {
    throw new EvidencePackValidationError('output path resolves outside the workspace')
  }
  const target = resolve(realParent, basename(requestedTarget))
  try {
    await lstat(target)
    throw new EvidencePackValidationError('evidence pack output already exists')
  } catch (error) {
    if (error instanceof EvidencePackValidationError) throw error
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temp = resolve(realParent, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
    try {
      await link(temp, target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new EvidencePackValidationError('evidence pack output already exists')
      }
      throw error
    }
  } finally {
    await unlink(temp).catch(() => {})
  }
  return target
}

export async function readEvidencePack(filePath: string): Promise<EvidencePack> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) throw new EvidencePackValidationError('evidence pack file not found')
  if (file.size > 256 * 1024)
    throw new EvidencePackValidationError('evidence pack file exceeds 256 KiB')
  try {
    return parseEvidencePack(JSON.parse(await file.text()))
  } catch (error) {
    if (error instanceof EvidencePackValidationError) throw error
    throw new EvidencePackValidationError('evidence pack must contain valid JSON')
  }
}

export function renderEvidencePackMarkdown(pack: EvidencePack): string {
  const markdown = (value: string): string =>
    [...value]
      .map((character) =>
        MARKDOWN_ESCAPE_CHARACTERS.has(character) ? `\\${character}` : character
      )
      .join('')
  const lines = [
    '# Evidence pack',
    '',
    `- Id: \`${markdown(pack.id)}\``,
    `- Created: ${pack.createdAt}`,
    `- Subject: \`${markdown(pack.subject.kind)}${pack.subject.name ? `:${markdown(pack.subject.name)}` : ''}\``,
    `- Integrity: \`sha256:${pack.integrity.digest}\``,
    '',
    '## Claims',
    '',
  ]
  for (const claim of pack.claims) {
    lines.push(
      `### ${markdown(claim.id)}`,
      '',
      `> External claim — not a dbcli verification verdict.`,
      '',
      markdown(claim.text),
      '',
      'Evidence:'
    )
    for (const reference of claim.evidence) {
      if (reference.kind === 'audit') {
        lines.push(
          `- audit \`${markdown(reference.id)}\` · ${markdown(reference.command)} · ${reference.success ? 'success' : 'failure'}`
        )
      } else if (reference.kind === 'verification-artifact') {
        lines.push(`- verification artifact \`${markdown(reference.id)}\` · ${reference.status}`)
      } else {
        lines.push(
          `- evidence receipt \`${markdown(reference.id)}\` · ${reference.operation} ${reference.outcome}`
        )
      }
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}
