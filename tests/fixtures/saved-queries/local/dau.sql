-- ---
-- name: Daily Active Users (local)
-- description: local override
-- engine: postgres
-- ---
SELECT COUNT(DISTINCT user_id) FROM events;
