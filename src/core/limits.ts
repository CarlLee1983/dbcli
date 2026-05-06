/**
 * Shared execution limit constants.
 *
 * `DEFAULT_QUERY_ONLY_LIMIT` is applied by the query path when the connection
 * permission is `query-only` and the user neither passed `--limit` nor `--no-limit`.
 * The same value is used by the SQL `QueryExecutor` auto-LIMIT rewriting and by
 * the MongoDB query branch's result-cardinality cap.
 */
export const DEFAULT_QUERY_ONLY_LIMIT = 1000
