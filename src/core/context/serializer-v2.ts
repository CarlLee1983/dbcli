import type { ContextV2Payload } from './context-v2'

export function serializeContextV2Json(payload: ContextV2Payload): string {
  return JSON.stringify(payload, null, 2)
}

export function serializeContextV2Xml(payload: ContextV2Payload): string {
  return renderXml('database_context', payload, 0)
}

export function serializeContextV2Markdown(payload: ContextV2Payload): string {
  const fence = String.fromCharCode(96).repeat(3)
  const json = serializeContextV2Json(payload).replace(/\x60/g, '\\u0060')
  return ['# Database Context', '', fence + 'json', json, fence].join('\n')
}

function renderXml(name: string, value: unknown, depth: number): string {
  const indent = '  '.repeat(depth)
  if (Array.isArray(value)) {
    if (value.length === 0) return indent + '<' + name + ' />'
    return [
      indent + '<' + name + '>',
      ...value.map((item) => renderXml('item', item, depth + 1)),
      indent + '</' + name + '>',
    ].join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return indent + '<' + name + ' />'
    return [
      indent + '<' + name + '>',
      ...entries.map(([key, item]) => renderXml(key, item, depth + 1)),
      indent + '</' + name + '>',
    ].join('\n')
  }
  return indent + '<' + name + '>' + escapeXml(String(value)) + '</' + name + '>'
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
