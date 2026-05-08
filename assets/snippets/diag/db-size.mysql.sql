-- ---
-- name: Database size (mysql)
-- description: Total data + index size per schema in MB.
-- engine: mysql
-- intent: capacity.size
-- ---
SELECT table_schema                                          AS `database`,
       ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM   information_schema.tables
GROUP  BY table_schema
ORDER  BY size_mb DESC;
