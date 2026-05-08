import type { ReportSection, ReportSnapshot } from './types'

export interface RenderOptions {
  brief?: boolean
}

export function renderJson(snap: ReportSnapshot, options: RenderOptions = {}): string {
  const out = options.brief ? toBrief(snap) : snap
  return JSON.stringify(out, null, 2)
}

function toBrief(snap: ReportSnapshot): ReportSnapshot {
  const sections: ReportSection[] = snap.sections.map((s) => ({
    id: s.id,
    evidence: s.evidence.map((ev) => ({ ...ev, rows: [] })),
  }))
  return { ...snap, sections, suggestedCommands: snap.suggestedCommands.slice(0, 3) }
}
