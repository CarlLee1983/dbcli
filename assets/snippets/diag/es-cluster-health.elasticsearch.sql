-- ---
-- name: es-cluster-health
-- description: Document counts per index across the cluster
-- engine: elasticsearch
-- intent: monitor.cluster-health
-- index: '*'
-- tags: [diag, elasticsearch]
-- ---
{
  "size": 0,
  "aggs": {
    "by_index": {
      "terms": { "field": "_index", "size": 50 }
    }
  }
}
