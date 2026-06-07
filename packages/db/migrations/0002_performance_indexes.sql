CREATE INDEX IF NOT EXISTS website_event_website_type_created_idx
  ON website_event(website_id, event_type, created_at);

CREATE INDEX IF NOT EXISTS event_data_website_key_created_idx
  ON event_data(website_id, data_key, created_at);

CREATE INDEX IF NOT EXISTS session_data_website_key_created_idx
  ON session_data(website_id, data_key, created_at);

CREATE INDEX IF NOT EXISTS session_replay_website_visit_chunk_idx
  ON session_replay(website_id, visit_id, chunk_index);
