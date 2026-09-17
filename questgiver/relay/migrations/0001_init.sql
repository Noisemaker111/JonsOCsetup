CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  picture TEXT,
  created INTEGER NOT NULL
);

-- The cookie holds the session id; only its SHA-256 is stored.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- public_key is the machine's raw Ed25519 key, base64url. Nothing here can impersonate the machine.
CREATE TABLE machines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_key TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE INDEX machines_user ON machines(user_id);

CREATE TABLE links (
  code_hash TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  machine_id TEXT
);
