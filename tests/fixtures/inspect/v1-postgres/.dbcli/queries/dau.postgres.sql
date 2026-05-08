-- ---
-- name: dau
-- description: Daily active users
-- intent: perf.slow-query
-- engine: postgres
-- ---
SELECT count(*) FROM users WHERE last_seen > now() - interval '1 day';
