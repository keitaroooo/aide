-- Transfer ownership from the shared dev:local user to a Google-login user.
-- Replace TARGET_USER_ID with e.g. google:1234567890 (from SELECT id, email FROM users).
--
-- Usage (dry-run first):
--   npx wrangler d1 execute aide --remote --command \
--     "SELECT id, email, name FROM users"
--   npx wrangler d1 execute aide --remote --file scripts/transfer_dev_user.sql
--
-- After editing TARGET below, run the UPDATEs. Keep the SELECT counts for verification.

-- === edit ===
-- TARGET_USER_ID = 'google:REPLACE_ME'

-- Preview
SELECT 'tasks' AS t, COUNT(*) AS n FROM tasks WHERE user_id = 'dev:local'
UNION ALL SELECT 'events', COUNT(*) FROM events WHERE user_id = 'dev:local'
UNION ALL SELECT 'chat_messages', COUNT(*) FROM chat_messages WHERE user_id = 'dev:local'
UNION ALL SELECT 'push_subscriptions', COUNT(*) FROM push_subscriptions WHERE user_id = 'dev:local'
UNION ALL SELECT 'oauth_tokens', COUNT(*) FROM oauth_tokens WHERE user_id = 'dev:local'
UNION ALL SELECT 'sessions', COUNT(*) FROM sessions WHERE user_id = 'dev:local';

-- Uncomment after setting TARGET_USER_ID:
-- UPDATE tasks SET user_id = 'TARGET_USER_ID' WHERE user_id = 'dev:local';
-- UPDATE events SET user_id = 'TARGET_USER_ID' WHERE user_id = 'dev:local';
-- UPDATE chat_messages SET user_id = 'TARGET_USER_ID' WHERE user_id = 'dev:local';
-- UPDATE push_subscriptions SET user_id = 'TARGET_USER_ID' WHERE user_id = 'dev:local';
-- UPDATE oauth_tokens SET user_id = 'TARGET_USER_ID' WHERE user_id = 'dev:local';
-- DELETE FROM sessions WHERE user_id = 'dev:local';
