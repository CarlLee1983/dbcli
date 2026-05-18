-- ---
-- key: active-users
-- engine: mongodb
-- operation: find
-- target: users
-- description: Active users matching the given status
-- params:
--   - name: status
--     type: string
--     required: true
-- ---
{
  "status": {{status}}
}
