-- ---
-- name: blocking-queries.postgres
-- description: Top queries blocking others, with blocker/blocked PIDs
-- engine: postgres
-- intent: safety.locks
-- tags: [diag, postgres, safety]
-- ---
SELECT blocked.pid       AS blocked_pid,
       blocked.usename   AS blocked_user,
       blocking.pid      AS blocking_pid,
       blocking.usename  AS blocking_user,
       blocked.query     AS blocked_query,
       blocking.query    AS blocking_query
FROM   pg_stat_activity blocked
JOIN   pg_stat_activity blocking
  ON   blocking.pid = ANY(pg_blocking_pids(blocked.pid))
WHERE  blocked.wait_event_type IS NOT NULL;
