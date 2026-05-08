-- ---
-- name: Long-running queries (mysql)
-- description: Non-sleep processes whose elapsed time exceeds min_seconds.
-- engine: mysql
-- intent: perf.slow-query
-- params:
--   min_seconds:
--     type: int
--     default: 30
-- ---
SELECT id, user, host, db, time AS duration_seconds, state, info AS query
FROM   information_schema.processlist
WHERE  command <> 'Sleep'
  AND  time > :min_seconds
ORDER  BY time DESC;
