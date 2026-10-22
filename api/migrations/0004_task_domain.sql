-- GitHub label 相当。UI の TODO / WANT を絞る。
ALTER TABLE tasks ADD COLUMN domain TEXT;
CREATE INDEX tasks_user_domain ON tasks(user_id, domain);
