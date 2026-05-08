-- ---
-- name: pending-tasks.elasticsearch
-- description: Cluster pending tasks queue depth and ages
-- engine: elasticsearch
-- index: '_cluster/pending_tasks'
-- intent: monitor.cluster-health
-- tags: [diag, elasticsearch]
-- ---
{ "size": 0 }
