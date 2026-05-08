-- ---
-- name: unassigned-shards.elasticsearch
-- description: Shards stuck in UNASSIGNED state
-- engine: elasticsearch
-- index: '_cluster/allocation/explain'
-- intent: monitor.cluster-health
-- tags: [diag, elasticsearch, safety]
-- ---
{ "size": 0 }
