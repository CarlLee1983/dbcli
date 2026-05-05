-- ---
-- name: Lock waits (mysql)
-- description: InnoDB lock waits with waiting and blocking transactions.
-- engine: mysql
-- ---
SELECT waiting.trx_mysql_thread_id  AS waiting_thread,
       waiting.trx_query            AS waiting_query,
       blocking.trx_mysql_thread_id AS blocking_thread,
       blocking.trx_query           AS blocking_query
FROM   performance_schema.data_lock_waits AS w
JOIN   information_schema.innodb_trx AS waiting
       ON w.requesting_engine_transaction_id = waiting.trx_id
JOIN   information_schema.innodb_trx AS blocking
       ON w.blocking_engine_transaction_id = blocking.trx_id;
