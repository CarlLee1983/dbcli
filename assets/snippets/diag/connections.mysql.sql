-- ---
-- name: Active connections (mysql)
-- description: Non-sleep processes ordered by elapsed time.
-- engine: mysql
-- intent: safety.connections
-- ---
SELECT id,
       user,
       host,
       db,
       command,
       time AS duration_seconds,
       state,
       info AS query
FROM   information_schema.processlist
WHERE  command <> 'Sleep'
ORDER  BY time DESC;
