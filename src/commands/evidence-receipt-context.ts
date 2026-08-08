import { createHash } from 'node:crypto'
import type { RuntimeDbcliConfig } from '@/core/config'
import { compactVisibleSchema } from '@/core/context/context'
import { defaultSemanticFile, loadSemanticContext } from '@/core/semantic'
import { listSnippetKeys, resolveSnippetDirs } from '@/core/saved-queries'
import type { EvidenceReceipt } from '@/core/evidence-receipt'

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    )
  })
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}

/**
 * Builds the filtered, deterministic context projection permitted in a receipt.
 * No adapter is opened here; semantic validation consumes only the filtered cache.
 */
export async function buildEvidenceReceiptContext(
  config: RuntimeDbcliConfig,
  workspaceRoot: string
): Promise<EvidenceReceipt['context']> {
  const visibleSchema = compactVisibleSchema(config)
  const semanticPath = defaultSemanticFile(workspaceRoot)
  const snippets = await listSnippetKeys(resolveSnippetDirs(workspaceRoot))
  const semantic = (await Bun.file(semanticPath).exists())
    ? await loadSemanticContext({
        workspaceRoot,
        schema: Object.fromEntries(
          Object.entries(visibleSchema).map(([table, value]) => [
            table,
            { columns: value.columns.map((column) => ({ name: column.name })) },
          ])
        ),
        snippets: snippets.map((key) => ({ key })),
        missingFile: 'error',
      })
    : null

  return {
    engine: config.connection?.system ?? 'unknown',
    connectionName: config.effectiveConnectionName ?? 'default',
    environment: config.effectiveEnvironment ?? 'default',
    schemaFingerprint: fingerprint(visibleSchema),
    semanticFingerprint: semantic === null ? null : fingerprint(semantic),
  }
}
