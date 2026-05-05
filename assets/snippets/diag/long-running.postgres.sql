-- ---
-- name: Long-running queries (postgres)
-- description: Queries running longer than min_seconds.
-- engine: postgres
-- params:
--   min_seconds:
--     type: int
--     default: 30
-- ---
SELECT pid,
       usename                              AS user,
       NOW() - query_start                  AS duration,
       state,
       query
FROM   pg_stat_activity
WHERE  state IS NOT NULL
  AND  state <> 'idle'
  AND  NOW() - query_start > make_interval(secs => :min_seconds)
ORDER  BY duration DESC;
