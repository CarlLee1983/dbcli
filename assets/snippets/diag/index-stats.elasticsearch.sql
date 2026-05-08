-- ---
-- name: index-stats.elasticsearch
-- description: doc count + store size per index (top by store size)
-- engine: elasticsearch
-- index: '*'
-- intent: capacity.size
-- tags: [diag, elasticsearch, capacity]
-- ---
{
  "size": 0,
  "aggs": {
    "by_index": {
      "terms": { "field": "_index", "size": 50, "order": { "_count": "desc" } }
    }
  }
}
