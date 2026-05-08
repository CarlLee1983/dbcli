-- ---
-- name: Index usage (mysql)
-- description: Index I/O wait counts ordered by total uses.
-- engine: mysql
-- intent: perf.index-usage
-- ---
SELECT object_schema  AS `schema`,
       object_name    AS `table`,
       index_name,
       count_star     AS uses,
       count_read     AS reads,
       count_write    AS writes
FROM   performance_schema.table_io_waits_summary_by_index_usage
WHERE  object_schema NOT IN ('mysql','performance_schema','sys')
  AND  index_name IS NOT NULL
ORDER  BY count_star ASC;
