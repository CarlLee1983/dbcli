import { analyzeEvents, type AnalysisReport, type AnalyzeOptions } from '@/proxy/analyze'
import type {
  ProxyEvent,
  QueryCompletedEvent,
  QueryErroredEvent,
  QueryObservedEvent,
} from '@/proxy/events'
import { redactLiterals } from '@/proxy/sql-metadata'

export const QUERYLENS_VERSION = '0.1.0'

export interface QuerylensReport extends AnalysisReport {
  querylens: {
    name: 'querylens'
    version: string
  }
}

type SqlEvent = QueryObservedEvent | QueryCompletedEvent | QueryErroredEvent

function hasSql(event: ProxyEvent): event is SqlEvent {
  return (
    event.type === 'query_observed' ||
    event.type === 'query_completed' ||
    event.type === 'query_errored'
  )
}

/**
 * Querylens always analyzes a copy with SQL literals removed. This keeps raw
 * proxy logs untouched while ensuring every SQL-bearing report field is safe
 * to place in a local artifact or pull-request comment.
 */
export function redactEventsForAnalysis(events: readonly ProxyEvent[]): ProxyEvent[] {
  return events.map((event) => {
    if (event.type === 'query_errored') {
      return {
        ...event,
        sql: redactLiterals(event.sql),
        error: { ...event.error, message: redactLiterals(event.error.message) },
      }
    }
    if (hasSql(event)) return { ...event, sql: redactLiterals(event.sql) }
    return event
  })
}

export function analyzeQuerylensEvents(
  events: readonly ProxyEvent[],
  opts: AnalyzeOptions
): QuerylensReport {
  return {
    ...analyzeEvents(redactEventsForAnalysis(events), opts),
    querylens: { name: 'querylens', version: QUERYLENS_VERSION },
  }
}
