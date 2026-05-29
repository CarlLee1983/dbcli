import type { InspectSnapshot } from './types'

export interface RenderOptions {
  brief?: boolean
}

export function renderJson(snap: InspectSnapshot, options: RenderOptions = {}): string {
  const out: InspectSnapshot = options.brief ? toBrief(snap) : snap
  return JSON.stringify(out, null, 2)
}

function toBrief(snap: InspectSnapshot): InspectSnapshot {
  const objects = { ...snap.objects }
  delete (objects as { sample?: string[] }).sample
  return {
    ...snap,
    objects,
    snippets: { ...snap.snippets, intents: [] },
    suggestedCommands: snap.suggestedCommands.slice(0, 3),
    hints: snap.hints.slice(0, 3),
  }
}
