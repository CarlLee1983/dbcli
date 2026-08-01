import type { ConnectionQueryOutcome } from '@/core/query-fanout'
import { QueryResultFormatter, toPublicQueryResult } from './query-result-formatter'

export class MultiQueryResultFormatter {
  format(
    outcomes: readonly ConnectionQueryOutcome[],
    options: { format: 'table' | 'json'; truncate?: number | false }
  ): string {
    if (options.format === 'json') {
      return JSON.stringify(
        {
          results: outcomes.map((outcome) =>
            outcome.status === 'ok'
              ? {
                  connection: outcome.connection,
                  status: outcome.status,
                  ...toPublicQueryResult(outcome.result),
                }
              : outcome
          ),
        },
        null,
        2
      )
    }

    const formatter = new QueryResultFormatter()
    return outcomes
      .map((outcome) => {
        const heading = `Connection: ${outcome.connection} [${outcome.status}]`
        if (outcome.status === 'ok') {
          return `${heading}\n${formatter.format(outcome.result, {
            format: 'table',
            truncate: options.truncate,
          })}`
        }

        const prefix = outcome.error.code ? `${outcome.error.code}: ` : ''
        const hints = outcome.error.hints.map((hint) => `Hint: ${hint}`)
        return [heading, `${prefix}${outcome.error.message}`, ...hints].join('\n')
      })
      .join('\n\n')
  }
}
