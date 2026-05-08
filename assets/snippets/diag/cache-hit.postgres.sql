-- ---
-- name: Cache hit ratio (postgres)
-- description: Heap and index buffer cache hit ratios across user tables.
-- engine: postgres
-- intent: perf.cache-hit
-- ---
SELECT SUM(heap_blks_read)                                                       AS heap_read,
       SUM(heap_blks_hit)                                                        AS heap_hit,
       ROUND(
         SUM(heap_blks_hit)::numeric
         / NULLIF(SUM(heap_blks_hit) + SUM(heap_blks_read), 0)
       , 4)                                                                      AS heap_hit_ratio,
       SUM(idx_blks_read)                                                        AS idx_read,
       SUM(idx_blks_hit)                                                         AS idx_hit,
       ROUND(
         SUM(idx_blks_hit)::numeric
         / NULLIF(SUM(idx_blks_hit) + SUM(idx_blks_read), 0)
       , 4)                                                                      AS idx_hit_ratio
FROM   pg_statio_user_tables;
