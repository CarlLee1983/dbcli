-- ---
-- name: Missing indexes (postgres)
-- description: User tables where seq scans dominate over index scans (>1k rows).
-- engine: postgres
-- intent: perf.index-usage
-- ---
SELECT schemaname     AS schema,
       relname        AS table,
       seq_scan,
       seq_tup_read,
       idx_scan,
       n_live_tup     AS estimated_rows
FROM   pg_stat_user_tables
WHERE  seq_scan > COALESCE(idx_scan, 0)
  AND  n_live_tup > 1000
ORDER  BY seq_tup_read DESC;
