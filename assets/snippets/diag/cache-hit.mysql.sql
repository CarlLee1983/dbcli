-- ---
-- name: InnoDB buffer pool hit ratio (mysql)
-- description: Reads from disk vs. read requests from the buffer pool.
-- engine: mysql
-- ---
SELECT
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status
    WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads')          AS pool_reads,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status
    WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests')  AS pool_read_requests,
  ROUND(
    1 -
    (SELECT VARIABLE_VALUE FROM performance_schema.global_status
       WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads')
    /
    NULLIF(
      (SELECT VARIABLE_VALUE FROM performance_schema.global_status
         WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests'), 0)
  , 4) AS hit_ratio;
