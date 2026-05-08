-- ---
-- name: Active connections (postgres)
-- description: Active sessions excluding idle, ordered by query start.
-- engine: postgres
-- intent: safety.connections
-- ---
SELECT pid,
       usename                              AS user,
       application_name                     AS app,
       client_addr                          AS client,
       state,
       NOW() - query_start                  AS duration,
       query
FROM   pg_stat_activity
WHERE  state IS NOT NULL
  AND  state <> 'idle'
ORDER  BY query_start;
