-- ---
-- name: Index usage (postgres)
-- description: Indexes ordered by scan count (low scans = candidates to drop).
-- engine: postgres
-- ---
SELECT schemaname                              AS schema,
       relname                                 AS table,
       indexrelname                            AS index,
       idx_scan                                AS scans,
       idx_tup_read                            AS tuples_read,
       idx_tup_fetch                           AS tuples_fetched,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM   pg_stat_user_indexes
ORDER  BY idx_scan ASC;
