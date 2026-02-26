DO $$ BEGIN
  CREATE TYPE game_status AS ENUM ('in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE game_result AS ENUM ('rouge', 'jaune', 'nul', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS games (
  id               BIGSERIAL PRIMARY KEY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  height           INT NOT NULL CHECK (height >= 4),
  width            INT NOT NULL CHECK (width  >= 4),
  starts_with      TEXT NOT NULL CHECK (starts_with IN ('rouge','jaune')),

  seq_str          TEXT NOT NULL,
  seq              INT[] NOT NULL,
  move_count       INT NOT NULL CHECK (move_count >= 0),

  status           game_status NOT NULL DEFAULT 'in_progress',
  result           game_result NOT NULL DEFAULT 'unknown',

  canonical_seq    TEXT NOT NULL,
  canonical_hash   TEXT NOT NULL,
  was_mirrored     BOOLEAN NOT NULL DEFAULT FALSE,

  UNIQUE (canonical_hash)
);

CREATE INDEX IF NOT EXISTS idx_games_status        ON games (status);
CREATE INDEX IF NOT EXISTS idx_games_result        ON games (result);
CREATE INDEX IF NOT EXISTS idx_games_move_count    ON games (move_count);
CREATE INDEX IF NOT EXISTS idx_games_width_height  ON games (width, height);

CREATE TABLE IF NOT EXISTS positions_index (
  id             BIGSERIAL PRIMARY KEY,
  game_id        BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply            INT NOT NULL CHECK (ply >= 0),
  position_hash  TEXT NOT NULL,
  mirrored       BOOLEAN NOT NULL DEFAULT FALSE,

  UNIQUE (game_id, ply),
  UNIQUE (position_hash, ply)
);

CREATE INDEX IF NOT EXISTS idx_positions_game ON positions_index (game_id, ply);
CREATE INDEX IF NOT EXISTS idx_positions_hash ON positions_index (position_hash);