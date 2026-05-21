export interface EsRequest {
  method: string
  path: string
  body?: unknown
}

/** Parse a Kibana Dev Tools block: first line "<METHOD> /<path>", remaining lines an optional JSON body. */
export function parseEsRequest(block: string): EsRequest {
  const lines = block.replace(/\r\n/g, '\n').split('\n')
  const firstIdx = lines.findIndex((l) => l.trim() !== '')
  if (firstIdx === -1) throw new Error('Empty request')

  const header = lines[firstIdx]!.trim()
  const spaceIdx = header.indexOf(' ')
  if (spaceIdx === -1) {
    throw new Error('Request requires a method and a path, e.g. "GET /index/_search"')
  }
  const method = header.slice(0, spaceIdx).toUpperCase()
  const path = header.slice(spaceIdx + 1).trim()
  if (!path) throw new Error('Request requires a path')

  const bodyText = lines
    .slice(firstIdx + 1)
    .join('\n')
    .trim()
  if (!bodyText) return { method, path }
  return { method, path, body: JSON.parse(bodyText) }
}

/** Return the index segment of a path, or undefined for non-index paths (leading "_"). */
export function extractIndexFromPath(path: string): string | undefined {
  const seg = path.replace(/^\//, '').split('/')[0] ?? ''
  if (seg === '' || seg.startsWith('_')) return undefined
  return seg.split('?')[0]
}
