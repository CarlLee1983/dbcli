-- ---
-- name: Missing indexes (mysql)
-- description: Tables with significant full-scan I/O and no index used.
-- engine: mysql
-- intent: perf.index-usage
-- ---
SELECT object_schema  AS `schema`,
       object_name    AS `table`,
       count_read     AS full_scan_reads
FROM   performance_schema.table_io_waits_summary_by_index_usage
WHERE  index_name IS NULL
  AND  object_schema NOT IN ('mysql','performance_schema','sys')
  AND  count_read > 1000
ORDER  BY count_read DESC;
