-- ---
-- name: cache-shared
-- description: Buffer cache hit ratio (shared variant)
-- engine: postgres
-- intent: perf.cache-hit
-- tags: [diag, perf]
-- ---
SELECT 100.0 * SUM(blks_hit) / NULLIF(SUM(blks_hit + blks_read), 0) AS hit_ratio FROM pg_stat_database;
