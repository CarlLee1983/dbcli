import { join, relative, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Command } from 'commander'

import { getGlobalConnectionName, configModule } from '@/core/config'
import { resolveConfigStoragePath } from '@/core/config-binding'
import {
  buildEvidencePack,
  EvidencePackValidationError,
  parseEvidenceClaimsInput,
  readEvidencePack,
  renderEvidencePackMarkdown,
  writeEvidencePack,
  type EvidencePack,
  type EvidenceReference,
} from '@/core/evidence-pack'
import {
  findVerificationArtifact,
  readVerificationArtifacts,
  VerificationArtifactSelectionError,
} from '@/core/verification'
import { readEntries } from '@/core/audit/reader'
import type { AuditEntry } from '@/core/audit/types'
import { resolveConfigPath } from '@/utils/config-path'
import { validateFormat } from '@/utils/validation'
import { readEvidenceReceipt } from '@/core/evidence-receipt'

const FORMATS = ['json', 'markdown'] as const
const MAX_INPUT_BYTES = 256 * 1024
const AUDIT_PREFIX_MIN = 4

type EvidenceFormat = (typeof FORMATS)[number]

type EvidenceConfig = {
  audit?: { enabled?: boolean }
  blacklist?: { tables?: string[]; columns?: Record<string, string[]> }
  effectiveConnectionName?: string
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Evidence command failed'
}

async function readClaimsInput(filePath: string): Promise<unknown> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) throw new EvidencePackValidationError('claims input file not found')
  if (file.size > MAX_INPUT_BYTES)
    throw new EvidencePackValidationError('claims input exceeds 256 KiB')
  try {
    return JSON.parse(await file.text())
  } catch {
    throw new EvidencePackValidationError('claims input must contain valid JSON')
  }
}

function blockedTerms(config: EvidenceConfig): string[] {
  return [
    ...(config.blacklist?.tables ?? []),
    ...Object.values(config.blacklist?.columns ?? {}).flat(),
  ]
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

function assertNoBlockedText(value: string | undefined, terms: readonly string[]): void {
  if (!value) return
  const normalized = value.toLowerCase()
  if (terms.some((term) => normalized.includes(term))) {
    throw new EvidencePackValidationError('evidence content contains a blocked identifier')
  }
}

function assertClaimsSafe(raw: unknown, terms: readonly string[]): void {
  const input = parseEvidenceClaimsInput(raw)
  assertNoBlockedText(input.subject.kind, terms)
  assertNoBlockedText(input.subject.name, terms)
  for (const claim of input.claims) {
    assertNoBlockedText(claim.id, terms)
    assertNoBlockedText(claim.text, terms)
  }
}

function sameReference(left: EvidenceReference, right: EvidenceReference): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertReferencesMatchSubject(
  claims: ReturnType<typeof parseEvidenceClaimsInput>,
  references: EvidenceReference[]
): void {
  if (
    references.some(
      (reference) =>
        reference.kind === 'verification-artifact' && reference.subjectKind !== claims.subject.kind
    )
  ) {
    throw new EvidencePackValidationError(
      'verification evidence does not match the claims subject kind'
    )
  }
}

async function readConfig(
  command: Command
): Promise<{ configPath: string; config: EvidenceConfig }> {
  const configPath = resolveConfigPath(command, command.opts<{ config?: string }>())
  return { configPath, config: (await configModule.read(configPath)) as EvidenceConfig }
}

async function resolveVerification(selector: string): Promise<EvidenceReference> {
  try {
    const records = await readVerificationArtifacts(process.cwd())
    const record = findVerificationArtifact(records, selector)
    return {
      kind: 'verification-artifact',
      id: record.artifact.id,
      createdAt: record.artifact.createdAt,
      status: record.artifact.status,
      subjectKind: record.artifact.subject.kind,
    }
  } catch (error) {
    if (error instanceof VerificationArtifactSelectionError) {
      throw new EvidencePackValidationError('verification evidence reference was not found')
    }
    throw error
  }
}

async function auditEntries(
  configPath: string,
  config: EvidenceConfig
): Promise<{
  connectionName: string
  entries: AuditEntry[]
}> {
  if (config.audit?.enabled === false)
    throw new EvidencePackValidationError('audit evidence is disabled')
  const storagePath = await resolveConfigStoragePath(configPath)
  const connectionName = config.effectiveConnectionName || getGlobalConnectionName() || 'default'
  const file = join(storagePath, '.dbcli', 'audit', `${connectionName}.jsonl`)
  return { connectionName, entries: await readEntries(file, { include_rotated: true }) }
}

function auditReference(entry: AuditEntry, connectionName: string): EvidenceReference {
  return {
    kind: 'audit',
    id: entry.id,
    createdAt: entry.ts,
    connectionName,
    command: entry.command,
    success: entry.success,
    ...(entry.recovery_ref ? { recoveryRef: entry.recovery_ref } : {}),
  }
}

function selectAudit(entries: AuditEntry[], selector: string): AuditEntry {
  if (selector.length < AUDIT_PREFIX_MIN) {
    throw new EvidencePackValidationError(
      'audit evidence selector must contain at least four characters'
    )
  }
  const matches = entries.filter((entry) => entry.id === selector || entry.id.startsWith(selector))
  if (matches.length === 0)
    throw new EvidencePackValidationError('audit evidence reference was not found')
  if (matches.length > 1)
    throw new EvidencePackValidationError('audit evidence selector is ambiguous')
  return matches[0]!
}

async function resolveReferences(
  verificationSelectors: readonly string[],
  auditSelectors: readonly string[],
  receiptPaths: readonly string[],
  configPath: string,
  config: EvidenceConfig
): Promise<EvidenceReference[]> {
  const references = await Promise.all(verificationSelectors.map(resolveVerification))
  if (auditSelectors.length > 0) {
    const { entries, connectionName } = await auditEntries(configPath, config)
    for (const selector of auditSelectors) {
      references.push(auditReference(selectAudit(entries, selector), connectionName))
    }
  }
  for (const receiptPath of receiptPaths) {
    const workspace = await realpath(process.cwd())
    const requested = resolve(workspace, receiptPath)
    const path = relative(workspace, requested)
    if (path === '' || path.startsWith(`..${sep}`) || path === '..' || path.includes(`..${sep}`))
      throw new EvidencePackValidationError('receipt evidence path must be workspace-relative')
    const resolved = await realpath(requested)
    const safePath = relative(workspace, resolved)
    if (safePath.startsWith(`..${sep}`) || safePath === '..' || safePath.includes(`..${sep}`))
      throw new EvidencePackValidationError('receipt evidence path must stay inside the workspace')
    const receipt = await readEvidenceReceipt(resolved)
    references.push({
      kind: 'receipt',
      id: receipt.id,
      createdAt: receipt.createdAt,
      operation: receipt.operation,
      outcome: receipt.outcome,
      digest: `sha256:${createHash('sha256').update(JSON.stringify(receipt)).digest('hex')}`,
      path: safePath,
    })
  }
  return references
}

async function expiredReferences(
  pack: EvidencePack,
  configPath: string,
  config: EvidenceConfig
): Promise<Array<{ kind: string; id: string }>> {
  const references = new Map<string, EvidenceReference>()
  for (const claim of pack.claims) {
    for (const reference of claim.evidence)
      references.set(`${reference.kind}\u0000${reference.id}`, reference)
  }
  const expired: Array<{ kind: string; id: string }> = []
  let audits: { connectionName: string; entries: AuditEntry[] } | null = null
  for (const reference of references.values()) {
    try {
      if (reference.kind === 'verification-artifact') {
        const found = await resolveVerification(reference.id)
        if (!sameReference(reference, found)) throw new Error('mismatch')
      } else if (reference.kind === 'audit') {
        audits ??= await auditEntries(configPath, config)
        const found = audits.entries.find((entry) => entry.id === reference.id)
        if (
          !found ||
          audits.connectionName !== reference.connectionName ||
          !sameReference(reference, auditReference(found, audits.connectionName))
        ) {
          throw new Error('missing')
        }
      } else {
        const workspace = await realpath(process.cwd())
        const target = await realpath(resolve(workspace, reference.path))
        const safePath = relative(workspace, target)
        if (safePath.startsWith(`..${sep}`) || safePath === '..' || safePath.includes(`..${sep}`))
          throw new Error('outside')
        const receipt = await readEvidenceReceipt(target)
        const digest = `sha256:${createHash('sha256').update(JSON.stringify(receipt)).digest('hex')}`
        if (receipt.id !== reference.id || digest !== reference.digest) throw new Error('mismatch')
      }
    } catch {
      expired.push({ kind: reference.kind, id: reference.id })
    }
  }
  return expired.sort((a, b) =>
    a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)
  )
}

function printCompose(pack: EvidencePack, path: string, format: EvidenceFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify({ path, id: pack.id, digest: pack.integrity.digest }, null, 2))
    return
  }
  console.log(
    `Evidence pack written: ${path}\nId: ${pack.id}\nDigest: sha256:${pack.integrity.digest}`
  )
}

function render(pack: EvidencePack, format: EvidenceFormat): void {
  if (format === 'json') console.log(JSON.stringify(pack, null, 2))
  else console.log(renderEvidencePackMarkdown(pack))
}

export const evidenceCommand = new Command('evidence').description(
  'Compose and review offline provenance packs for database work'
)

evidenceCommand
  .command('compose')
  .description('Compose a canonical evidence pack from existing safe references')
  .requiredOption('--claims <file>', 'JSON file containing a subject and external claims')
  .option('--verification <selector...>', 'Verification artifact id, prefix, filename, or path')
  .option('--audit <selector...>', 'Audit entry id or prefix from the active connection')
  .option('--receipt <paths...>', 'Explicit workspace-relative evidence receipt path')
  .requiredOption('--output <path>', 'Workspace-contained JSON evidence-pack output path')
  .option('--format <format>', `stdout format: ${FORMATS.join(' | ')}`, 'json')
  .action(async (options: Record<string, unknown>, command: Command) => {
    try {
      const format = options.format as EvidenceFormat
      validateFormat(format, FORMATS, 'evidence compose')
      const verification = (options.verification as string[] | undefined) ?? []
      const audit = (options.audit as string[] | undefined) ?? []
      const receipt = (options.receipt as string[] | undefined) ?? []
      if (verification.length + audit.length + receipt.length === 0) {
        throw new EvidencePackValidationError(
          'at least one --verification, --audit, or --receipt reference is required'
        )
      }
      const { configPath, config } = await readConfig(command)
      const claimsRaw = await readClaimsInput(String(options.claims))
      assertClaimsSafe(claimsRaw, blockedTerms(config))
      const claims = parseEvidenceClaimsInput(claimsRaw)
      const references = await resolveReferences(verification, audit, receipt, configPath, config)
      assertReferencesMatchSubject(claims, references)
      const pack = buildEvidencePack(claims, references)
      const path = await writeEvidencePack(process.cwd(), String(options.output), pack)
      printCompose(pack, path, format)
    } catch (error) {
      console.error(safeMessage(error))
      process.exitCode = 1
    }
  })

evidenceCommand
  .command('validate')
  .description('Validate evidence-pack integrity and referenced evidence availability')
  .requiredOption('--file <path>', 'Evidence-pack JSON file')
  .option('--format <format>', `output format: ${FORMATS.join(' | ')}`, 'json')
  .action(async (options: Record<string, unknown>, command: Command) => {
    try {
      const format = options.format as EvidenceFormat
      validateFormat(format, FORMATS, 'evidence validate')
      const { configPath, config } = await readConfig(command)
      const pack = await readEvidencePack(String(options.file))
      assertClaimsSafe(
        { subject: pack.subject, claims: pack.claims.map(({ id, text }) => ({ id, text })) },
        blockedTerms(config)
      )
      const expired = await expiredReferences(pack, configPath, config)
      const result = {
        integrity: 'valid',
        references: expired.length === 0 ? 'valid' : 'source-expired',
        expired,
      }
      if (format === 'json') console.log(JSON.stringify(result, null, 2))
      else
        console.log(
          expired.length === 0
            ? 'Evidence pack is valid.'
            : `Evidence references expired: ${expired.map((item) => `${item.kind}:${item.id}`).join(', ')}`
        )
      if (expired.length > 0) process.exitCode = 1
    } catch (error) {
      console.error(safeMessage(error))
      process.exitCode = 1
    }
  })

evidenceCommand
  .command('render')
  .description('Render an evidence pack without resolving its referenced evidence')
  .requiredOption('--file <path>', 'Evidence-pack JSON file')
  .option('--format <format>', `output format: ${FORMATS.join(' | ')}`, 'markdown')
  .action(async (options: Record<string, unknown>, command: Command) => {
    try {
      const format = options.format as EvidenceFormat
      validateFormat(format, FORMATS, 'evidence render')
      const { config } = await readConfig(command)
      const pack = await readEvidencePack(String(options.file))
      assertClaimsSafe(
        { subject: pack.subject, claims: pack.claims.map(({ id, text }) => ({ id, text })) },
        blockedTerms(config)
      )
      render(pack, format)
    } catch (error) {
      console.error(safeMessage(error))
      process.exitCode = 1
    }
  })
