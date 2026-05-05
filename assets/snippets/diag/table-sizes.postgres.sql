-- ---
-- name: Table sizes (postgres)
-- description: Total / table / index size with estimated row count.
-- engine: postgres
-- ---
SELECT schemaname                                                           AS schema,
       tablename                                                            AS table,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))   AS total_size,
       pg_size_pretty(pg_relation_size(schemaname||'.'||tablename))         AS table_size,
       pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename))          AS index_size,
       n_live_tup                                                           AS estimated_rows
FROM   pg_stat_user_tables
ORDER  BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
