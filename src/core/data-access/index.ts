import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { containsBlockedSemanticIdentifier, isCanonicalSemanticReference } from '@/core/semantic'

const DATA_ACCESS_MANIFEST_VERSION = 1 as const
const MAX_FILE_BYTES = 512 * 1024
const MAX_OPERATIONS = 500
const MAX_REFERENCES = 100
const MAX_NAME_LENGTH = 200

export const defaultDataAccessManifestFile = (workspaceRoot: string): string =>
  resolve(workspaceRoot, 'dbcli.data-access.json')

export type DataAccessOperationKind = 'read' | 'write'

export interface DataAccessOperation {
  name: string
  kind: DataAccessOperationKind
  /** Existing source file, normalized relative to the workspace; it is never read. */
  source: string
  references: readonly string[]
  coverage: 'declared'
}

export interface DataAccessManifestIssue {
  path: string
  message: string
}

/**
 * The issues that mean "the referenced entity is unavailable or protected".
 * A duplicate reference, an unbounded reference list, and an unusable source
 * path are malformed-manifest problems, so they are deliberately absent: the
 * substring test this replaced classified all three as reference failures.
 */
const PROTECTED_REFERENCE = 'must not contain a protected semantic reference'
const UNAVAILABLE_REFERENCE = 'must reference an available semantic entity'
const REFERENCE_MESSAGES: ReadonlySet<string> = new Set([
  PROTECTED_REFERENCE,
  UNAVAILABLE_REFERENCE,
])

/** True when a failure is about the referenced entity, not the manifest shape. */
export function hasDataAccessReferenceIssue(issues: readonly DataAccessManifestIssue[]): boolean {
  return issues.some(({ message }) => REFERENCE_MESSAGES.has(message))
}

export class DataAccessManifestValidationError extends Error {
  readonly issues: readonly DataAccessManifestIssue[]

  constructor(issues: readonly DataAccessManifestIssue[]) {
    super(
      `data-access manifest is invalid (${issues.length} issue${issues.length === 1 ? '' : 's'})`
    )
    this.name = 'DataAccessManifestValidationError'
    this.issues = issues
  }
}

export interface LoadDataAccessManifestInput {
  workspaceRoot: string
  filePath?: string
  references: ReadonlySet<string> | readonly string[]
  blockedTerms?: readonly string[]
  missingFile?: 'allow' | 'error'
}

export async function loadDataAccessManifest(
  input: LoadDataAccessManifestInput
): Promise<readonly DataAccessOperation[]> {
  const workspace = await safeWorkspace(input.workspaceRoot, [])
  const requested = resolve(workspace, input.filePath ?? defaultDataAccessManifestFile(workspace))
  if (!inside(workspace, requested)) {
    throw new DataAccessManifestValidationError([
      { path: '$', message: 'file must stay inside the workspace' },
    ])
  }
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(requested)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && input.missingFile !== 'error')
      return []
    throw new DataAccessManifestValidationError([{ path: '$', message: 'file not found' }])
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new DataAccessManifestValidationError([
      { path: '$', message: 'file must be a regular workspace file' },
    ])
  }
  try {
    if (!inside(workspace, await realpath(requested))) {
      throw new DataAccessManifestValidationError([
        { path: '$', message: 'file must stay inside the workspace' },
      ])
    }
  } catch (error) {
    if (error instanceof DataAccessManifestValidationError) throw error
    throw new DataAccessManifestValidationError([{ path: '$', message: 'file is unavailable' }])
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new DataAccessManifestValidationError([{ path: '$', message: 'file exceeds size limit' }])
  }
  let raw: unknown
  try {
    raw = JSON.parse(await Bun.file(requested).text())
    if (!inside(workspace, await realpath(requested))) {
      throw new DataAccessManifestValidationError([
        { path: '$', message: 'file must stay inside the workspace' },
      ])
    }
  } catch {
    throw new DataAccessManifestValidationError([{ path: '$', message: 'invalid JSON' }])
  }
  return normalizeDataAccessManifest(raw, input)
}

export async function normalizeDataAccessManifest(
  raw: unknown,
  input: Pick<LoadDataAccessManifestInput, 'workspaceRoot' | 'references' | 'blockedTerms'>
): Promise<readonly DataAccessOperation[]> {
  const issues: DataAccessManifestIssue[] = []
  const root = record(raw, '$', issues)
  rejectUnknownKeys(root, ['version', 'operations'], '$', issues)
  if (root.version !== DATA_ACCESS_MANIFEST_VERSION) issue(issues, '$.version', 'must equal 1')
  const values = array(root.operations, '$.operations', issues)
  if (values.length > MAX_OPERATIONS) issue(issues, '$.operations', 'exceeds operation limit')
  const names = new Set<string>()
  const registry = input.references instanceof Set ? input.references : new Set(input.references)
  const blocked = input.blockedTerms ?? []
  const operations = values.map((value, index) =>
    parseOperation(value, `$.operations[${index}]`, names, registry, blocked, issues)
  )
  const workspace = await safeWorkspace(input.workspaceRoot, issues)
  const normalized: DataAccessOperation[] = []
  for (const [index, operation] of operations.entries()) {
    normalized.push(await normalizeSource(operation, index, workspace, issues))
  }
  if (issues.length > 0) throw new DataAccessManifestValidationError(issues)
  return normalized
    .map((operation) => ({
      ...operation,
      references: [...operation.references].sort(codePointOrder),
    }))
    .sort((left, right) => codePointOrder(left.name, right.name))
}

function parseOperation(
  raw: unknown,
  path: string,
  names: Set<string>,
  registry: ReadonlySet<string>,
  blocked: readonly string[],
  issues: DataAccessManifestIssue[]
): DataAccessOperation {
  const value = record(raw, path, issues)
  rejectUnknownKeys(value, ['name', 'source', 'kind', 'references', 'coverage'], path, issues)
  const name = text(value.name, `${path}.name`, issues)
  if (names.has(name)) issue(issues, `${path}.name`, 'duplicate operation name')
  names.add(name)
  const source = text(value.source, `${path}.source`, issues)
  const kind = value.kind === 'read' || value.kind === 'write' ? value.kind : 'read'
  if (value.kind !== 'read' && value.kind !== 'write')
    issue(issues, `${path}.kind`, 'must be read or write')
  if (value.coverage !== 'declared') issue(issues, `${path}.coverage`, 'must equal declared')
  const references = parseReferences(
    value.references,
    `${path}.references`,
    registry,
    blocked,
    issues
  )
  return { name, source, kind, references, coverage: 'declared' }
}

function parseReferences(
  raw: unknown,
  path: string,
  registry: ReadonlySet<string>,
  blocked: readonly string[],
  issues: DataAccessManifestIssue[]
): string[] {
  const values = array(raw, path, issues)
  if (values.length === 0 || values.length > MAX_REFERENCES)
    issue(issues, path, 'must contain bounded references')
  const seen = new Set<string>()
  return values.map((value, index) => {
    const reference = text(value, `${path}[${index}]`, issues)
    if (seen.has(reference)) issue(issues, `${path}[${index}]`, 'duplicate reference')
    seen.add(reference)
    if (!isCanonicalSemanticReference(reference)) {
      issue(issues, `${path}[${index}]`, 'must be a canonical semantic reference')
    } else if (containsBlockedSemanticIdentifier(reference, blocked)) {
      issue(issues, `${path}[${index}]`, PROTECTED_REFERENCE)
    } else if (!registry.has(reference)) {
      issue(issues, `${path}[${index}]`, UNAVAILABLE_REFERENCE)
    }
    return reference
  })
}

async function safeWorkspace(
  workspaceRoot: string,
  issues: DataAccessManifestIssue[]
): Promise<string> {
  try {
    return await realpath(workspaceRoot)
  } catch {
    issue(issues, '$', 'workspace is unavailable')
    return resolve(workspaceRoot)
  }
}

async function normalizeSource(
  operation: DataAccessOperation,
  index: number,
  workspace: string,
  issues: DataAccessManifestIssue[]
): Promise<DataAccessOperation> {
  const path = `$.operations[${index}].source`
  if (
    operation.source.length === 0 ||
    operation.source.length > MAX_NAME_LENGTH ||
    /[\0\r\n]/.test(operation.source)
  ) {
    issue(issues, path, 'must be a bounded single-line source path')
    return operation
  }
  if (isAbsolute(operation.source)) {
    issue(issues, path, 'must be workspace-relative')
    return operation
  }
  const target = resolve(workspace, operation.source)
  if (!inside(workspace, target)) {
    issue(issues, path, 'must stay inside the workspace')
    return operation
  }
  try {
    const stats = await lstat(target)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      issue(issues, path, 'must reference a regular source file')
      return operation
    }
    const actual = await realpath(target)
    if (!inside(workspace, actual)) {
      issue(issues, path, 'must stay inside the workspace')
      return operation
    }
    return { ...operation, source: relative(workspace, actual).split(sep).join('/') }
  } catch {
    issue(issues, path, 'must reference an existing source file')
  }
  return operation
}

function inside(root: string, target: string): boolean {
  const value = relative(root, target)
  return (
    value !== '' &&
    !isAbsolute(value) &&
    !value.startsWith(`..${sep}`) &&
    value !== '..' &&
    !value.includes(`..${sep}`)
  )
}

function record(
  value: unknown,
  path: string,
  issues: DataAccessManifestIssue[]
): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value))
    return value as Record<string, unknown>
  issue(issues, path, 'must be an object')
  return {}
}

function array(value: unknown, path: string, issues: DataAccessManifestIssue[]): unknown[] {
  if (Array.isArray(value)) return value
  issue(issues, path, 'must be an array')
  return []
}

function text(value: unknown, path: string, issues: DataAccessManifestIssue[]): string {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    !/[\0\r\n]/.test(value)
  )
    return value
  issue(issues, path, 'must be a bounded non-empty single-line string')
  return ''
}

/**
 * Names the allowed properties rather than the rejected one: a rejected key is
 * manifest input, and these diagnostics reach `impact assess` output.
 */
function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: DataAccessManifestIssue[]
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    issue(issues, path, `must contain only these properties: ${allowed.join(', ')}`)
  }
}

function issue(issues: DataAccessManifestIssue[], path: string, message: string): void {
  issues.push({ path, message })
}

function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
