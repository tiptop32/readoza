CREATE TABLE IF NOT EXISTS accounts (
  nickname TEXT PRIMARY KEY NOT NULL CHECK(length(nickname) BETWEEN 3 AND 32),
  code_salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
