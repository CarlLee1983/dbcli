-- ---
-- name: top-orders-by-city
-- engine: mongodb
-- operation: aggregate
-- target: orders
-- description: Top order counts per city for a given status
-- params:
--   status:
--     type: string
--     required: true
--   limit:
--     type: int
--     default: 10
-- ---
[
  { "$match": { "status": {{status}} } },
  { "$group": { "_id": "$city", "n": { "$sum": 1 } } },
  { "$sort": { "n": -1 } },
  { "$limit": {{limit}} }
]
