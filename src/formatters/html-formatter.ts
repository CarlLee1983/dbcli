import { packageAssetPath } from '../utils/package-root'
import type { SavedQueryMeta } from '../core/saved-queries/types'
import type { AppliedLimitMetadata } from '../types/query'
import { buildDashboardDisplay, type DashboardDisplay } from '../core/dashboard/display'
import {
  validateDashboardProvenance,
  DashboardProvenanceError,
  type DashboardProvenance,
} from '../core/dashboard/provenance'

/** The only saved-query metadata a dashboard renders. */
export type DashboardDisplayInput = Pick<SavedQueryMeta, 'name' | 'description' | 'visual'>

export interface HtmlPayload {
  meta: DashboardDisplayInput
  rows: Record<string, unknown>[]
  appliedLimit?: AppliedLimitMetadata
  securityNotification?: string
  /** Saved-query dashboards only; validated, never inferred. */
  provenance?: unknown
}

/** Exactly what the standalone HTML file carries. Nothing reaches it by accident. */
interface ShareablePayload {
  display: DashboardDisplay
  rows: Record<string, unknown>[]
  appliedLimit?: AppliedLimitMetadata
  securityNotification?: string
  provenance?: DashboardProvenance
}

/**
 * The applied-limit provenance and the truncation warning describe the same
 * execution. If they disagree, the shared file would show a warning its own
 * traceability section contradicts — refuse rather than publish both.
 */
function assertLimitAgreement(
  provenance: DashboardProvenance,
  appliedLimit: AppliedLimitMetadata | undefined
): void {
  const limit = provenance.limit
  if (appliedLimit === undefined) {
    if (limit.state !== 'not-applied') {
      throw new DashboardProvenanceError(
        'Dashboard provenance reports an applied limit but the execution applied none'
      )
    }
    return
  }
  if (limit.state !== 'applied') {
    throw new DashboardProvenanceError(
      'Dashboard provenance reports no applied limit but the execution applied one'
    )
  }
  if (
    limit.limitApplied !== appliedLimit.limitApplied ||
    limit.truncated !== appliedLimit.truncated
  ) {
    throw new DashboardProvenanceError(
      'Dashboard provenance limit disagrees with the applied-limit metadata shown to the reader'
    )
  }
}

/**
 * Generates a standalone interactive HTML dashboard by injecting an
 * allowlisted payload into the UI template.
 *
 * Validation runs before the file is written, so an unsafe or inconsistent
 * payload produces no partial artifact.
 */
export async function generateHtmlReport(payload: HtmlPayload): Promise<string> {
  const rows = payload.rows ?? []
  const display = buildDashboardDisplay(payload.meta, rows)

  let provenance: DashboardProvenance | undefined
  if (payload.provenance !== undefined) {
    provenance = validateDashboardProvenance(payload.provenance)
    assertLimitAgreement(provenance, payload.appliedLimit)
  }

  const templatePath = packageAssetPath('ui-template.html')
  const templateFile = Bun.file(templatePath)

  if (!(await templateFile.exists())) {
    throw new Error(`UI template not found at ${templatePath}. Please run 'bun run build' first.`)
  }

  let html = await templateFile.text()

  const shareable: ShareablePayload = {
    display,
    rows,
    ...(payload.appliedLimit ? { appliedLimit: payload.appliedLimit } : {}),
    ...(payload.securityNotification ? { securityNotification: payload.securityNotification } : {}),
    ...(provenance ? { provenance } : {}),
  }

  // Safely inject the payload as a JSON string
  // Escape '<' to prevent script injection if user data contains '</script>'
  const jsonPayload = JSON.stringify(shareable).replace(/</g, '\\u003c')

  // Replace the placeholder in index.html
  const injection = `window.__DBCLI_PAYLOAD__ = ${jsonPayload};`

  // Ensure we replace the specific placeholder defined in Task 2's index.html
  html = html.replace('/*DBCLI_PAYLOAD*/', () => injection)

  return html
}
