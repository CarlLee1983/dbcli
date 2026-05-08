-- ---
-- name: slow-shared
-- description: Shared example slow query view
-- engine: postgres
-- intent: perf.slow-query
-- tags: [diag, perf]
-- ---
SELECT pid, query FROM pg_stat_activity WHERE state <> 'idle';
