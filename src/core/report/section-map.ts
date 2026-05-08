import type { ReportSectionId } from './types'

const SECTION_INTENTS: Record<ReportSectionId, readonly string[]> = {
  health: ['safety.connections', 'safety.locks', 'monitor.cluster-health'],
  capacity: ['capacity.size', 'capacity.memory'],
  perf: ['perf.slow-query', 'perf.index-usage', 'perf.cache-hit'],
}

export function intentsForSection(section: ReportSectionId): readonly string[] {
  return SECTION_INTENTS[section]
}

export function sectionForIntent(intent: string | undefined): ReportSectionId | null {
  if (!intent) return null
  for (const id of Object.keys(SECTION_INTENTS) as ReportSectionId[]) {
    if (SECTION_INTENTS[id].includes(intent)) return id
  }
  return null
}
