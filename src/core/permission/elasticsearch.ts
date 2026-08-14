import type { Permission } from '@/types'
import {
  PermissionError,
  minimumPermissionFor,
  permitsOperation,
  type StatementClassification,
  type StatementType,
} from '@/core/permission-guard'
import { t_vars } from '@/i18n/message-loader'

// ============================================================================
// ELASTICSEARCH CLASSIFICATION
// ============================================================================

export interface ElasticsearchRequest {
  method: string
  apiPath: string
  body?: string
}

/**
 * Classify an Elasticsearch REST request into a SQL-like statement type and risk.
 */
export function classifyElasticsearchRequest(
  request: ElasticsearchRequest
): StatementClassification {
  const method = request.method.toUpperCase()
  const path = request.apiPath.toLowerCase()

  // 1. Special case: _bulk NDJSON parsing
  if (path.includes('_bulk')) {
    return classifyElasticsearchBulk(request.body ?? '')
  }

  // 2. Read operations
  if (
    path.includes('_search') ||
    path.includes('_count') ||
    path.includes('_mapping') ||
    path.includes('_settings') ||
    path.includes('_alias') ||
    (method === 'GET' && (path.includes('_doc') || path.includes('_source')))
  ) {
    return {
      type: 'SELECT',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 3. Write operations
  if (path.includes('_update') || (method === 'POST' && path.includes('_doc'))) {
    return {
      type: 'UPDATE',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  if (method === 'PUT' && (path.includes('_doc') || path.includes('_create'))) {
    return {
      type: 'INSERT',
      isDangerous: false,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 4. Destructive operations
  if (method === 'DELETE') {
    return {
      type: 'DELETE',
      isDangerous: true,
      keywords: [method, path],
      isComposite: false,
      confidence: 'HIGH',
    }
  }

  // 5. Schema/Cluster operations (default to admin)
  return {
    type: 'DROP',
    isDangerous: true,
    keywords: [method, path],
    isComposite: false,
    confidence: 'LOW',
  }
}

/**
 * Parse Elasticsearch _bulk body (NDJSON) and find the highest required permission.
 */
function classifyElasticsearchBulk(body: string): StatementClassification {
  const lines = body.split('\n').filter((l) => l.trim().length > 0)
  let highestType: StatementType = 'SELECT'
  let isDangerous = false

  for (const line of lines) {
    try {
      const action = JSON.parse(line)
      const op = Object.keys(action)[0]

      if (op === 'delete') {
        highestType = 'DELETE'
        isDangerous = true
        break // DELETE is highest for DML
      }
      if (op === 'update' && highestType !== 'DELETE') {
        highestType = 'UPDATE'
      }
      if ((op === 'index' || op === 'create') && !['DELETE', 'UPDATE'].includes(highestType)) {
        highestType = 'INSERT'
      }
    } catch {
      // Ignore invalid JSON lines in bulk (usually data lines)
    }
  }

  return {
    type: highestType,
    isDangerous,
    keywords: ['BULK'],
    isComposite: true,
    confidence: 'HIGH',
  }
}

/**
 * Throw PermissionError if the Elasticsearch request is not allowed under the
 * given permission tier.
 */
export function enforceElasticsearchPermission(
  request: ElasticsearchRequest,
  permission: Permission
): StatementClassification {
  const classification = classifyElasticsearchRequest(request)

  const result = checkElasticsearchPermission(classification, permission)

  if (!result.allowed) {
    throw new PermissionError(result.reason, classification, result.requiredPermission ?? 'admin')
  }

  return classification
}

function checkElasticsearchPermission(
  classification: StatementClassification,
  permission: Permission
): { allowed: boolean; reason: string; requiredPermission?: Permission } {
  // The tiers are the SQL tiers. This used to restate them — a third copy of a
  // table that had already drifted twice — and the two agree on every type this
  // classifier can produce: SELECT, INSERT, UPDATE, DELETE and DROP. Reusing
  // the shared rule keeps them agreeing by construction rather than by luck.
  if (permitsOperation(classification.type, permission)) {
    return { allowed: true, reason: `${classification.type} allowed in ${permission} mode` }
  }

  const minimum = minimumPermissionFor(classification.type)
  return {
    allowed: false,
    // Names the level that would work. It used to say "requires higher
    // permission tier", which is true of every refusal and tells nobody what
    // to change.
    reason: t_vars('errors.elasticsearch_requires_level', {
      type: classification.type,
      minimum,
      permission,
    }),
    requiredPermission: minimum,
  }
}
