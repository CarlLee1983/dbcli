import type { InspectSnapshot } from '@/core/inspect/types'
import type { EngineTag, ResolvedSnippet } from '@/core/saved-queries'
import { intentsForGoal } from './goal-map'
import type { GuideGoalId, GuideStep } from './types'

/** Hard cap on emitted steps; prevents the plan from drowning the agent. */
export const MAX_STEPS = 8

const ANCHOR_STEP: Omit<GuideStep, 'order'> = {
  command: 'dbcli inspect --for-agent',
  rationale: 'Capture the current connection, permission, and snippet inventory context.',
  risk: 'readonly',
  expects:
    'Bounded JSON snapshot with system, permission, blacklist, snippets, and suggested commands.',
}

const DOCTOR_STEP: Omit<GuideStep, 'order'> = {
  command: 'dbcli doctor --format json',
  rationale: 'Sanity-check configuration and environment after the focused steps.',
  risk: 'readonly',
  expects: 'Doctor report with config validation, env presence, and connection reachability.',
}

export interface BuildPlanInput {
  context: InspectSnapshot
  snippets: Map<string, ResolvedSnippet[]>
  engine: EngineTag | 'mongodb' | null
  goal: GuideGoalId
}

export function buildPlan(input: BuildPlanInput): GuideStep[] {
  if (!input.context.system || input.engine === null) {
    return [
      reorder(
        {
          command: 'dbcli init',
          rationale: 'No dbcli configuration detected; initialize the workspace first.',
          risk: 'readonly',
          expects: 'Init wizard prompts for system, connection name, and credentials.',
        },
        1
      ),
    ]
  }

  const raw: Array<Omit<GuideStep, 'order'>> = []
  raw.push(ANCHOR_STEP)

  if (input.goal === 'permissions') {
    raw.push({
      command: 'dbcli blacklist list --format json',
      rationale: 'Confirm which tables and columns are off-limits before deeper inspection.',
      risk: 'readonly',
      expects: 'Blacklist entries grouped by table and column.',
    })
    raw.push({
      command: 'dbcli queries list --format json',
      rationale: 'Inventory the snippets the current permission level is allowed to invoke.',
      risk: 'readonly',
      expects: 'Snippet inventory with engine, source, and intent metadata.',
    })
    raw.push(DOCTOR_STEP)
    return cap(raw)
  }

  if (input.goal === 'schema-overview') {
    raw.push({
      command: 'dbcli list --format json',
      rationale: 'Enumerate available tables / collections / indices / keys for the active engine.',
      risk: 'readonly',
      expects: 'Object list keyed by engine kind (tables, collections, indices, keys).',
    })
    if (!input.context.schemaCache.available || input.context.schemaCache.stale === true) {
      raw.push({
        command: 'dbcli schema --refresh',
        rationale:
          'Schema cache missing or stale; refresh before relying on cached column metadata.',
        risk: 'readonly',
        expects: 'Updated `.dbcli/schemas/index.json` with current table → column mapping.',
      })
    }
    raw.push({
      command: 'dbcli queries suggest capacity --format json',
      rationale: 'Surface size-related snippets to estimate footprint of the new database.',
      risk: 'readonly',
      expects: 'Snippets with intent prefix `capacity.*`.',
    })
    return cap(raw)
  }

  // Intent-driven goals.
  const wantIntents = intentsForGoal(input.goal)
  for (const intent of wantIntents) {
    const picked = pickSnippetForIntent(input.snippets, input.engine, intent)
    if (!picked) continue
    raw.push({
      command: `dbcli q ${picked.query.meta.key} --format json`,
      rationale: snippetRationale(picked, intent),
      risk: 'readonly',
      expects: 'JSON rows from the saved query; empty array if the condition is not present.',
      snippet: picked.query.meta.key,
      intent,
    })
  }

  const broadenPrefix = primaryPrefix(input.goal)
  if (broadenPrefix) {
    raw.push({
      command: `dbcli queries suggest ${broadenPrefix} --format json`,
      rationale: `Broaden the search beyond curated diagnostics for the \`${broadenPrefix}.*\` intent prefix.`,
      risk: 'readonly',
      expects: `Snippets with intent prefix \`${broadenPrefix}.*\`.`,
    })
  }

  raw.push(DOCTOR_STEP)
  return cap(raw)
}

function pickSnippetForIntent(
  map: Map<string, ResolvedSnippet[]>,
  engine: EngineTag | 'mongodb',
  intent: string
): ResolvedSnippet | null {
  if (engine === 'mongodb') return null
  let best: ResolvedSnippet | null = null
  for (const variants of map.values()) {
    for (const v of variants) {
      if (v.query.meta.intent !== intent) continue
      if (!engineMatches(v.query.meta.engine, engine)) continue
      if (hasUnboundRequiredParam(v)) continue
      if (!best || sourceRank(v.query.source) > sourceRank(best.query.source)) {
        best = v
      }
    }
  }
  return best
}

function engineMatches(declared: EngineTag[] | undefined, current: EngineTag): boolean {
  if (!declared || declared.length === 0) return true
  return declared.includes(current)
}

function hasUnboundRequiredParam(v: ResolvedSnippet): boolean {
  for (const p of v.query.meta.params) {
    if (p.required && (p.default === undefined || p.default === null)) return true
  }
  return false
}

function sourceRank(source: 'builtin' | 'shared' | 'local'): number {
  return source === 'local' ? 2 : source === 'shared' ? 1 : 0
}

function snippetRationale(snippet: ResolvedSnippet, intent: string): string {
  const desc = snippet.query.meta.description?.trim()
  if (desc && desc.length > 0) return `${desc} (intent: ${intent}).`
  return `Run the curated \`${intent}\` snippet for this engine.`
}

function primaryPrefix(goal: GuideGoalId): string | null {
  switch (goal) {
    case 'slow-query':
    case 'index-usage':
      return 'perf'
    case 'capacity':
      return 'capacity'
    case 'health':
      return 'safety'
    default:
      return null
  }
}

function reorder(step: Omit<GuideStep, 'order'>, order: number): GuideStep {
  return { ...step, order }
}

function cap(raw: Array<Omit<GuideStep, 'order'>>): GuideStep[] {
  return raw.slice(0, MAX_STEPS).map((s, i) => reorder(s, i + 1))
}
