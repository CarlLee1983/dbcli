import { containsBlockedSemanticIdentifier } from '@/core/semantic'
import type { SemanticContext, SemanticField, SemanticModel } from '@/core/semantic'
import type { SemanticContract } from '@/core/contracts'
import type { NormalizedChange, NormalizedChangeScope, NormalizedChangeSet } from '@/core/orm-drift/change-set'
import type { VerificationStatus, VerificationSubject } from '@/core/verification/types'

export type ImpactEvidenceState = 'available' | 'absent' | 'invalid' | 'unavailable'
export type ImpactEvidenceReason = 'missing' | 'invalid' | 'unavailable'

export type ImpactEvidenceSource<T> =
  | { state: 'available'; origin: string; value: T; redacted?: boolean }
  | { state: Exclude<ImpactEvidenceState, 'available'>; origin: string; reason: ImpactEvidenceReason }

export interface SafeVerificationMetadata {
  id: string
  createdAt: string
  status: VerificationStatus
  subject: Pick<VerificationSubject, 'kind' | 'name'>
  /** A logical anchor, not an artifact path. */
  location: string
}

export interface ImpactAssessmentInput {
  changes: NormalizedChangeSet
  semantic: ImpactEvidenceSource<SemanticContext>
  contracts: ImpactEvidenceSource<readonly SemanticContract[]>
  /** Saved-query keys only; the assessment never receives query bodies. */
  savedQueries: ImpactEvidenceSource<readonly string[]>
  verifications: ImpactEvidenceSource<readonly SafeVerificationMetadata[]>
  blockedIdentifiers: readonly string[]
}

export type ImpactFindingCode =
  | 'AFFECTED_SEMANTIC_MODEL'
  | 'AFFECTED_SEMANTIC_FIELD'
  | 'AFFECTED_SEMANTIC_RELATIONSHIP'
  | 'AFFECTED_SEMANTIC_CONTRACT'
  | 'AFFECTED_SAVED_QUERY'
  | 'AFFECTED_VERIFICATION'

export interface ImpactLocation {
  artifact: string
  selector: string
}

export interface ImpactFinding {
  id: string
  code: ImpactFindingCode
  severity: 'info' | 'warn' | 'error'
  changeId: string
  location: ImpactLocation
}

export interface VerificationRecommendation {
  changeId: string
  policy: SemanticContract['evidencePolicy']
  source: ImpactLocation
}

export type ImpactCoverageCode =
  | 'NORMALIZATION_PARTIAL'
  | 'SEMANTIC_ABSENT'
  | 'SEMANTIC_INVALID'
  | 'SEMANTIC_UNAVAILABLE'
  | 'CONTRACTS_ABSENT'
  | 'CONTRACTS_INVALID'
  | 'CONTRACTS_UNAVAILABLE'
  | 'SAVED_QUERIES_ABSENT'
  | 'SAVED_QUERIES_INVALID'
  | 'SAVED_QUERIES_UNAVAILABLE'
  | 'VERIFICATIONS_ABSENT'
  | 'VERIFICATIONS_INVALID'
  | 'VERIFICATIONS_UNAVAILABLE'
  | 'SAVED_QUERY_REFERENCE_UNAVAILABLE'
  | 'REDACTED_PROTECTED_SUBJECT'

export interface ImpactCoverageGap {
  code: ImpactCoverageCode
  severity: 'warn'
}

export interface ImpactReport {
  scope: NormalizedChangeScope
  findings: ImpactFinding[]
  recommendedVerification: VerificationRecommendation[]
  coverage: { level: 'declared' | 'partial'; gaps: ImpactCoverageGap[] }
  summary: { errors: number; warns: number; infos: number }
}

interface SemanticNode {
  reference: string
  kind: 'model' | 'field' | 'relationship' | 'metric'
  model?: SemanticModel
  field?: { model: SemanticModel; field: SemanticField }
}

/**
 * Produces deterministic, declared dependency findings from caller-supplied
 * local metadata. It intentionally has no filesystem, database, or SQL seam.
 */
export function assessImpact(input: ImpactAssessmentInput): ImpactReport {
  const gaps = coverageGaps(input)
  const findings: ImpactFinding[] = []
  const recommendations: VerificationRecommendation[] = []

  for (const change of input.changes.changes) {
    if (!isSafeChange(change, input.blockedIdentifiers)) {
      addGap(gaps, 'REDACTED_PROTECTED_SUBJECT')
      continue
    }
    if (input.verifications.state === 'available') {
      findings.push(...verificationFindings(change, input.verifications.value, input.blockedIdentifiers))
    }
    if (input.semantic.state !== 'available') continue

    const nodes = traverseSemantic(change, input.semantic.value, input.blockedIdentifiers)
    for (const node of nodes) {
      const finding = findingForSemanticNode(change, node, input.semantic.origin, input.blockedIdentifiers)
      if (finding) findings.push(finding)
    }

    const contractResult = traverseContracts(
      change,
      nodes,
      input.semantic.value,
      input.contracts,
      input.blockedIdentifiers
    )
    findings.push(...contractResult.findings)
    recommendations.push(...contractResult.recommendations)
    for (const metric of contractResult.metrics) {
      if (input.savedQueries.state !== 'available') continue
      if (input.savedQueries.value.includes(metric.query) && isSafe(metric.query, input.blockedIdentifiers)) {
        findings.push(
          finding(change, 'AFFECTED_SAVED_QUERY', severityFor(change), {
            artifact: logicalArtifact(input.savedQueries.origin, input.blockedIdentifiers),
            selector: `saved-query:${metric.query}`,
          })
        )
      } else {
        addGap(gaps, 'SAVED_QUERY_REFERENCE_UNAVAILABLE')
      }
    }
  }

  findings.sort((left, right) => codePointOrder(left.id, right.id))
  recommendations.sort((left, right) =>
    codePointOrder(
      JSON.stringify([left.changeId, left.policy, left.source.artifact, left.source.selector]),
      JSON.stringify([right.changeId, right.policy, right.source.artifact, right.source.selector])
    )
  )
  const normalizedGaps = [...gaps.values()].sort((left, right) =>
    codePointOrder(left.code, right.code)
  )
  return {
    scope: redactScope(input.changes.scope, input.blockedIdentifiers),
    findings,
    recommendedVerification: deduplicateRecommendations(recommendations),
    coverage: {
      level: normalizedGaps.length > 0 ? 'partial' : 'declared',
      gaps: normalizedGaps,
    },
    summary: {
      errors: findings.filter((finding) => finding.severity === 'error').length,
      warns: findings.filter((finding) => finding.severity === 'warn').length,
      infos: findings.filter((finding) => finding.severity === 'info').length,
    },
  }
}

function redactScope(scope: NormalizedChangeScope, blocked: readonly string[]): NormalizedChangeScope {
  const redact = (value: string): string => (isSafe(value, blocked) ? value : '[redacted]')
  return {
    key: redact(scope.key),
    system: redact(scope.system),
    ...(scope.connection !== undefined && { connection: redact(scope.connection) }),
    ...(scope.environment !== undefined && { environment: redact(scope.environment) }),
    ...(scope.catalog !== undefined && { catalog: redact(scope.catalog) }),
  }
}

function coverageGaps(input: ImpactAssessmentInput): Map<ImpactCoverageCode, ImpactCoverageGap> {
  const gaps = new Map<ImpactCoverageCode, ImpactCoverageGap>()
  if (input.changes.coverage.level === 'partial') addGap(gaps, 'NORMALIZATION_PARTIAL')
  addEvidenceGap(gaps, 'SEMANTIC', input.semantic)
  addEvidenceGap(gaps, 'CONTRACTS', input.contracts)
  addEvidenceGap(gaps, 'SAVED_QUERIES', input.savedQueries)
  addEvidenceGap(gaps, 'VERIFICATIONS', input.verifications)
  return gaps
}

function addEvidenceGap<T>(
  gaps: Map<ImpactCoverageCode, ImpactCoverageGap>,
  prefix: 'SEMANTIC' | 'CONTRACTS' | 'SAVED_QUERIES' | 'VERIFICATIONS',
  source: ImpactEvidenceSource<T>
): void {
  if (source.state === 'available') {
    if (source.redacted) addGap(gaps, 'REDACTED_PROTECTED_SUBJECT')
    return
  }
  addGap(gaps, `${prefix}_${source.state.toUpperCase()}` as ImpactCoverageCode)
}

function addGap(gaps: Map<ImpactCoverageCode, ImpactCoverageGap>, code: ImpactCoverageCode): void {
  gaps.set(code, { code, severity: 'warn' })
}

function traverseSemantic(
  change: NormalizedChange,
  context: SemanticContext,
  blocked: readonly string[]
): SemanticNode[] {
  const models = new Map(context.models.map((model) => [model.name, model]))
  const nodes = new Map<string, SemanticNode>()
  const queue: string[] = []
  const enqueue = (reference: string) => {
    if (nodes.has(reference)) return
    const node = semanticNode(reference, context, models)
    if (!node || !isSafe(reference, blocked)) return
    nodes.set(reference, node)
    queue.push(reference)
  }

  for (const model of context.models) {
    if (model.table !== change.subject.table) continue
    if (change.objectKind === 'table' || change.objectKind === 'index' || change.objectKind === 'foreign-key') {
      enqueue(`model:${model.name}`)
    }
    else if (change.subject.column) {
      for (const field of model.fields) {
        if (field.column === change.subject.column) enqueue(`field:${model.name}.${field.column}`)
      }
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const reference = queue[index]!
    const node = nodes.get(reference)!
    if (node.kind === 'model' && node.model) {
      for (const field of node.model.fields) enqueue(`field:${node.model.name}.${field.column}`)
    } else if (node.kind === 'field' && node.field) {
      for (const relationship of context.relationships) {
        const from = `field:${relationship.from.model}.${relationship.from.field}`
        const to = `field:${relationship.to.model}.${relationship.to.field}`
        if (reference === from || reference === to) enqueue(`relationship:${relationship.name}`)
      }
    } else if (node.kind === 'relationship') {
      const relationship = context.relationships.find(
        (candidate) => `relationship:${candidate.name}` === reference
      )
      if (relationship) {
        enqueue(`field:${relationship.from.model}.${relationship.from.field}`)
        enqueue(`field:${relationship.to.model}.${relationship.to.field}`)
      }
    }
  }
  return [...nodes.values()].sort((left, right) => codePointOrder(left.reference, right.reference))
}

function semanticNode(
  reference: string,
  context: SemanticContext,
  models: Map<string, SemanticModel>
): SemanticNode | undefined {
  if (reference.startsWith('model:')) {
    const model = models.get(reference.slice('model:'.length))
    return model ? { reference, kind: 'model', model } : undefined
  }
  if (reference.startsWith('field:')) {
    const raw = reference.slice('field:'.length)
    const divider = raw.indexOf('.')
    const model = divider === -1 ? undefined : models.get(raw.slice(0, divider))
    const field = model?.fields.find((candidate) => candidate.column === raw.slice(divider + 1))
    return model && field ? { reference, kind: 'field', field: { model, field } } : undefined
  }
  if (reference.startsWith('relationship:')) {
    return context.relationships.some((relationship) => reference === `relationship:${relationship.name}`)
      ? { reference, kind: 'relationship' }
      : undefined
  }
  if (reference.startsWith('metric:')) {
    return context.metrics.some((metric) => reference === `metric:${metric.name}`)
      ? { reference, kind: 'metric' }
      : undefined
  }
  return undefined
}

function findingForSemanticNode(
  change: NormalizedChange,
  node: SemanticNode,
  origin: string,
  blocked: readonly string[]
): ImpactFinding | undefined {
  const code: Partial<Record<SemanticNode['kind'], ImpactFindingCode>> = {
    model: 'AFFECTED_SEMANTIC_MODEL',
    field: 'AFFECTED_SEMANTIC_FIELD',
    relationship: 'AFFECTED_SEMANTIC_RELATIONSHIP',
  }
  const findingCode = code[node.kind]
  return findingCode
    ? finding(change, findingCode, severityFor(change), {
        artifact: logicalArtifact(origin, blocked),
        selector: node.reference,
      })
    : undefined
}

function traverseContracts(
  change: NormalizedChange,
  seedNodes: SemanticNode[],
  context: SemanticContext,
  source: ImpactEvidenceSource<readonly SemanticContract[]>,
  blocked: readonly string[]
): { findings: ImpactFinding[]; recommendations: VerificationRecommendation[]; metrics: SemanticContext['metrics'] } {
  if (source.state !== 'available') return { findings: [], recommendations: [], metrics: [] }
  const known = new Set(seedNodes.map((node) => node.reference))
  const contracts = source.value.filter((contract) => contract.status === 'approved')
  const findings: ImpactFinding[] = []
  const recommendations: VerificationRecommendation[] = []
  const metrics: SemanticContext['metrics'] = []
  let changed = true
  while (changed) {
    changed = false
    for (const contract of contracts) {
      if (!isSafe(contract.name, blocked) || contract.subjects.some((subject) => !isSafe(subject, blocked)))
        continue
      if (!contract.subjects.some((subject) => known.has(subject))) continue
      const contractSelector = `contract:${contract.name}`
      if (!known.has(contractSelector)) {
        known.add(contractSelector)
        changed = true
        findings.push(
          finding(change, 'AFFECTED_SEMANTIC_CONTRACT', severityFor(change), {
            artifact: logicalArtifact(source.origin, blocked),
            selector: contractSelector,
          })
        )
        if (contract.evidencePolicy !== 'none') {
          recommendations.push({
            changeId: change.id,
            policy: contract.evidencePolicy,
            source: { artifact: logicalArtifact(source.origin, blocked), selector: contractSelector },
          })
        }
      }
      for (const subject of contract.subjects) {
        if (known.has(subject)) continue
        known.add(subject)
        changed = true
      }
    }
  }
  for (const metric of context.metrics) {
    if (known.has(`metric:${metric.name}`) && isSafe(metric.name, blocked)) metrics.push(metric)
  }
  return { findings, recommendations, metrics }
}

function verificationFindings(
  change: NormalizedChange,
  verifications: readonly SafeVerificationMetadata[],
  blocked: readonly string[]
): ImpactFinding[] {
  const qualified = change.subject.schema
    ? `${change.subject.schema}.${change.subject.table}`
    : change.subject.table
  return verifications
    .filter(
      (verification) =>
        verification.subject.kind === 'table' &&
        (verification.subject.name === qualified || verification.subject.name === change.subject.table) &&
        isSafe(verification.id, blocked) &&
        isSafe(verification.location, blocked)
    )
    .map((verification) =>
      finding(change, 'AFFECTED_VERIFICATION', 'info', {
        artifact: 'verification-artifact',
        selector: `verification:${verification.id}`,
      })
    )
}

function finding(
  change: NormalizedChange,
  code: ImpactFindingCode,
  severity: ImpactFinding['severity'],
  location: ImpactLocation
): ImpactFinding {
  const priority: Record<ImpactFindingCode, string> = {
    AFFECTED_SEMANTIC_FIELD: '0',
    AFFECTED_SEMANTIC_MODEL: '1',
    AFFECTED_SEMANTIC_RELATIONSHIP: '2',
    AFFECTED_SEMANTIC_CONTRACT: '3',
    AFFECTED_SAVED_QUERY: '4',
    AFFECTED_VERIFICATION: '5',
  }
  return {
    id: JSON.stringify([change.id, priority[code], code, location.artifact, location.selector]),
    code,
    severity,
    changeId: change.id,
    location,
  }
}

function severityFor(change: NormalizedChange): ImpactFinding['severity'] {
  return change.operation === 'add' ? 'info' : 'warn'
}

function isSafeChange(change: NormalizedChange, blocked: readonly string[]): boolean {
  return isSafe(
    [change.subject.scopeKey, change.subject.system, change.subject.connection, change.subject.catalog, change.subject.schema, change.subject.table, change.subject.column, change.subject.objectKey]
      .filter((value): value is string => value !== undefined)
      .join('.'),
    blocked
  )
}

function isSafe(value: string, blocked: readonly string[]): boolean {
  return !containsBlockedSemanticIdentifier(value, blocked)
}

function logicalArtifact(origin: string, blocked: readonly string[]): string {
  return origin.includes('/') || origin.includes('\\') || !isSafe(origin, blocked)
    ? 'local-artifact'
    : origin
}

function deduplicateRecommendations(
  recommendations: VerificationRecommendation[]
): VerificationRecommendation[] {
  const unique = new Map<string, VerificationRecommendation>()
  for (const recommendation of recommendations) {
    const key = JSON.stringify([
      recommendation.changeId,
      recommendation.policy,
      recommendation.source.artifact,
      recommendation.source.selector,
    ])
    unique.set(key, recommendation)
  }
  return [...unique.values()]
}

function codePointOrder(left: string, right: string): number {
  const leftPoints = [...left]
  const rightPoints = [...right]
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return leftPoints.length - rightPoints.length
}
