import { collectInspect } from '@/core/inspect/collector'
import {
  loadSnippets,
  mapSystemToEngine,
  resolveSnippetDirs,
  type EngineTag,
  type ResolvedSnippet,
} from '@/core/saved-queries'
import { buildPlan } from './build-plan'
import {
  GUIDE_SCHEMA_VERSION,
  type GuideOptions,
  type GuideSnapshot,
  type GuideWarning,
} from './types'

export async function collectGuide(opts: GuideOptions): Promise<GuideSnapshot> {
  const generatedAt = new Date().toISOString()
  const warnings: GuideWarning[] = []

  const context = await collectInspect({
    workspace: opts.workspace,
    configPath: opts.configPath,
    noConnect: opts.probe !== true,
    brief: opts.brief,
    probeTimeoutMs: opts.probeTimeoutMs,
  })
  for (const w of context.warnings) {
    warnings.push({ severity: 'warn', message: w, source: 'inspect' })
  }

  let snippets = new Map<string, ResolvedSnippet[]>()
  try {
    snippets = await loadSnippets(resolveSnippetDirs(opts.workspace))
  } catch (err) {
    warnings.push({
      severity: 'warn',
      message: `snippets: ${(err as Error).message}`,
      source: 'snippets',
    })
  }

  const engine = engineForContext(context.system, warnings, opts.goal)
  const steps = buildPlan({ context, snippets, engine, goal: opts.goal })

  return {
    schemaVersion: GUIDE_SCHEMA_VERSION,
    generatedAt,
    goal: opts.goal,
    context,
    steps,
    warnings,
  }
}

function engineForContext(
  system: GuideSnapshot['context']['system'],
  warnings: GuideWarning[],
  goal: GuideOptions['goal']
): EngineTag | 'mongodb' | null {
  if (!system) return null
  try {
    return mapSystemToEngine(system) as EngineTag | 'mongodb'
  } catch (err) {
    warnings.push({
      severity: 'info',
      message: `engine: ${(err as Error).message}`,
      source: `goal:${goal}`,
    })
    return null
  }
}
