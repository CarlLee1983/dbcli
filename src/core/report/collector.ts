import { collectInspect } from '@/core/inspect/collector'
import { AdapterFactory, type ConnectionOptions } from '@/adapters'
import type { DatabaseAdapter } from '@/adapters/types'
import { configModule } from '@/core/config'
import {
  loadSnippets,
  mapSystemToEngine,
  resolveSnippetDirs,
  type EngineTag,
} from '@/core/saved-queries'
import { selectSnippets } from './select-snippets'
import { runDiagnostic } from './run-diagnostic'
import { BlacklistManager } from '@/core/blacklist-manager'
import { BlacklistValidator } from '@/core/blacklist-validator'
import { sectionForIntent } from './section-map'
import {
  ALLOWED_SECTIONS,
  REPORT_SCHEMA_VERSION,
  type ReportOptions,
  type ReportSection,
  type ReportSectionId,
  type ReportSnapshot,
  type ReportWarning,
  type EvidenceItem,
} from './types'

const DEFAULT_PER_SNIPPET_TIMEOUT_MS = 3000
const DEFAULT_MAX_ROWS_PER_EVIDENCE = 50

export async function collectReport(opts: ReportOptions): Promise<ReportSnapshot> {
  const generatedAt = new Date().toISOString()
  const sections = (opts.sections ?? ALLOWED_SECTIONS) as readonly ReportSectionId[]
  const warnings: ReportWarning[] = []

  const context = await collectInspect({
    workspace: opts.workspace,
    configPath: opts.configPath,
    noConnect: opts.noConnect,
    brief: opts.brief,
    probeTimeoutMs: opts.probeTimeoutMs,
  })
  for (const w of context.warnings) {
    warnings.push({ severity: 'warn', message: w, source: 'inspect' })
  }

  if (opts.noConnect) {
    warnings.push({ severity: 'info', message: 'diagnostics skipped (no-connect mode)' })
    return finalize({ context, sections: [], warnings, generatedAt })
  }
  if (!context.system) {
    warnings.push({ severity: 'warn', message: 'no configuration; cannot run diagnostics' })
    return finalize({ context, sections: [], warnings, generatedAt })
  }
  if (context.system === 'mongodb') {
    warnings.push({
      severity: 'info',
      message: 'mongodb has no built-in diagnostic snippets in v1.13.0',
    })
    return finalize({ context, sections: [], warnings, generatedAt })
  }

  const dirs = resolveSnippetDirs(opts.workspace)
  let snippetMap
  try {
    snippetMap = await loadSnippets(dirs)
  } catch (err) {
    warnings.push({ severity: 'warn', message: `snippets: ${(err as Error).message}` })
    return finalize({ context, sections: [], warnings, generatedAt })
  }
  const engine = mapSystemToEngine(context.system) as EngineTag
  const chosen = selectSnippets({ map: snippetMap, engine, sections })
  if (chosen.length === 0) {
    warnings.push({
      severity: 'info',
      message: `no diagnostic snippets matched sections [${sections.join(', ')}]`,
    })
    return finalize({ context, sections: [], warnings, generatedAt })
  }

  const config = await configModule.read(opts.configPath)
  if (!config.connection) {
    warnings.push({ severity: 'warn', message: 'connection config missing after probe' })
    return finalize({ context, sections: [], warnings, generatedAt })
  }
  const adapter = AdapterFactory.createAdapter(
    config.connection as ConnectionOptions
  ) as DatabaseAdapter

  // Report evidence is rendered into the output and the snippets come from
  // user-writable directories, so the blacklist has to reach this path.
  const blacklistValidator = new BlacklistValidator(new BlacklistManager(config))

  const sectionEvidence = new Map<ReportSectionId, EvidenceItem[]>()
  for (const id of sections) sectionEvidence.set(id, [])

  try {
    await adapter.connect()
    const timeout = opts.perSnippetTimeoutMs ?? DEFAULT_PER_SNIPPET_TIMEOUT_MS
    const maxRows = opts.maxRowsPerEvidence ?? DEFAULT_MAX_ROWS_PER_EVIDENCE
    for (const sn of chosen) {
      const ev = await runDiagnostic({
        snippet: sn,
        adapter,
        engine,
        timeoutMs: timeout,
        maxRows,
        blacklistValidator,
      })
      const sectionId = sectionForIntent(ev.intent)
      if (sectionId && sectionEvidence.has(sectionId)) {
        sectionEvidence.get(sectionId)!.push(ev)
      }
      if (ev.status === 'error' || ev.status === 'timeout') {
        warnings.push({
          severity: 'warn',
          message: `${ev.snippet}: ${ev.reason ?? ev.status}`,
          source: `snippet:${ev.snippet}`,
        })
      }
    }
  } catch (err) {
    warnings.push({ severity: 'error', message: `connect: ${(err as Error).message}` })
  } finally {
    try {
      await adapter.disconnect()
    } catch {
      /* ignore */
    }
  }

  const builtSections: ReportSection[] = []
  for (const id of sections) {
    const evidence = sectionEvidence.get(id) ?? []
    if (evidence.length > 0) builtSections.push({ id, evidence })
  }
  return finalize({ context, sections: builtSections, warnings, generatedAt })
}

function finalize(input: {
  context: ReportSnapshot['context']
  sections: ReportSection[]
  warnings: ReportWarning[]
  generatedAt: string
}): ReportSnapshot {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    context: input.context,
    sections: input.sections,
    warnings: input.warnings,
    suggestedCommands: buildSuggestedCommands(input.context, input.sections),
  }
}

function buildSuggestedCommands(
  context: ReportSnapshot['context'],
  sections: ReportSection[]
): string[] {
  if (!context.system) return ['dbcli init']
  const out: string[] = ['dbcli inspect --format json']
  if (sections.length === 0) {
    out.push('dbcli queries list --format json')
  } else {
    for (const s of sections) {
      for (const ev of s.evidence) {
        if (ev.status === 'ok') out.push(`dbcli q ${ev.snippet} --format json`)
      }
    }
  }
  out.push('dbcli doctor --format json')
  return Array.from(new Set(out)).slice(0, 8)
}
