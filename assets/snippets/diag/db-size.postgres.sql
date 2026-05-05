-- ---
-- name: Database size (postgres)
-- description: Each database with pretty-printed total size.
-- engine: postgres
-- ---
SELECT datname                                AS database,
       pg_size_pretty(pg_database_size(datname)) AS size
FROM   pg_database
ORDER  BY pg_database_size(datname) DESC;
