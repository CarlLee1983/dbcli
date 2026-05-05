-- ---
-- name: Lock waits (postgres)
-- description: Sessions blocked by other sessions with both queries shown.
-- engine: postgres
-- ---
SELECT blocked.pid       AS blocked_pid,
       blocked.usename   AS blocked_user,
       blocked.query     AS blocked_query,
       blocking.pid      AS blocking_pid,
       blocking.usename  AS blocking_user,
       blocking.query    AS blocking_query
FROM   pg_stat_activity AS blocked
JOIN   pg_stat_activity AS blocking
       ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE  blocked.pid <> blocking.pid;
