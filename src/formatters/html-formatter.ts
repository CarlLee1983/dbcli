import { packageAssetPath } from '../utils/package-root'
import type { SavedQueryMeta } from '../core/saved-queries/types'
import type { AppliedLimitMetadata } from '../types/query'

export interface HtmlPayload {
  meta: SavedQueryMeta
  rows: Record<string, unknown>[]
  appliedLimit?: AppliedLimitMetadata
  securityNotification?: string
}

/**
 * Generates a standalone interactive HTML dashboard by injecting data
 * and metadata into the UI template.
 */
export async function generateHtmlReport(payload: HtmlPayload): Promise<string> {
  const templatePath = packageAssetPath('ui-template.html')
  const templateFile = Bun.file(templatePath)

  if (!(await templateFile.exists())) {
    throw new Error(`UI template not found at ${templatePath}. Please run 'bun run build' first.`)
  }

  let html = await templateFile.text()

  // Safely inject the payload as a JSON string
  // Escape '<' to prevent script injection if user data contains '</script>'
  const jsonPayload = JSON.stringify(payload).replace(/</g, '\\u003c')

  // Replace the placeholder in index.html
  const injection = `window.__DBCLI_PAYLOAD__ = ${jsonPayload};`

  // Ensure we replace the specific placeholder defined in Task 2's index.html
  html = html.replace('/*DBCLI_PAYLOAD*/', () => injection)

  return html
}
