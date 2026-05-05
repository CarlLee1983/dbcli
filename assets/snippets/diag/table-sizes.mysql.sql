-- ---
-- name: Table sizes (mysql)
-- description: Data + index size in MB with estimated row count.
-- engine: mysql
-- ---
SELECT table_schema                                              AS `schema`,
       table_name                                                AS `table`,
       ROUND((data_length + index_length) / 1024 / 1024, 2)      AS total_mb,
       ROUND(data_length / 1024 / 1024, 2)                       AS data_mb,
       ROUND(index_length / 1024 / 1024, 2)                      AS index_mb,
       table_rows                                                AS estimated_rows
FROM   information_schema.tables
WHERE  table_schema NOT IN ('mysql','information_schema','performance_schema','sys')
ORDER  BY data_length + index_length DESC;
