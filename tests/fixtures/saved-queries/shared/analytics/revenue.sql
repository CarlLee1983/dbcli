-- ---
-- name: Revenue by month
-- engine: postgres
-- params:
--   month:
--     type: string
--     required: true
-- ---
SELECT SUM(amount) FROM payments WHERE month = :month;
