import { encodeEsIndexExpression } from '../identifier-quote'

interface RequestCapable {
  request<T>(method: string, path: string, body?: unknown): Promise<T>
}

interface ScrollResponse {
  _scroll_id?: string
  hits?: { hits?: { _id: string; _source?: Record<string, unknown> }[] }
}

/** Pull up to `cap` documents from `index` via the ES scroll API. Rows are { _id, ...source }. */
export async function scrollAll(
  adapter: RequestCapable,
  index: string,
  cap: number,
  batchSize = 500
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let resp = await adapter.request<ScrollResponse>(
    'POST',
    `/${encodeEsIndexExpression(index)}/_search?scroll=1m`,
    {
      size: Math.min(batchSize, cap),
      query: { match_all: {} },
    }
  )
  let scrollId = resp._scroll_id
  let hits = resp.hits?.hits ?? []

  while (hits.length > 0 && rows.length < cap) {
    for (const h of hits) {
      if (rows.length >= cap) break
      rows.push({ _id: h._id, ...(h._source ?? {}) })
    }
    if (rows.length >= cap) break
    resp = await adapter.request<ScrollResponse>('POST', '/_search/scroll', {
      scroll: '1m',
      scroll_id: scrollId,
    })
    scrollId = resp._scroll_id
    hits = resp.hits?.hits ?? []
  }

  if (scrollId) {
    try {
      await adapter.request('DELETE', '/_search/scroll', { scroll_id: scrollId })
    } catch {
      // best-effort scroll-context cleanup; ignore failures
    }
  }
  return rows
}
