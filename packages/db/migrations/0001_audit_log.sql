CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(user_id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity_type, entity_id);
