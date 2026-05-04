-- ---
-- name: Daily Active Users
-- description: shared version
-- engine: postgres
-- params:
--   days:
--     type: int
--     default: 7
-- ---
SELECT COUNT(*) FROM events WHERE created_at > NOW() - (:days || ' days')::interval;
