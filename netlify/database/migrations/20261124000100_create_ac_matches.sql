-- Lịch sử lượt chơi AGENCY COMBAT (mỗi dòng = một trận của một người chơi)
CREATE TABLE ac_matches (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  player_id   TEXT        NOT NULL,          -- mã ngẫu nhiên lưu trên máy người chơi, không phải thông tin cá nhân
  player_name TEXT        NOT NULL,
  player_ch   SMALLINT    NOT NULL,
  opp_name    TEXT        NOT NULL,
  opp_ch      SMALLINT    NOT NULL,
  mode        TEXT        NOT NULL,          -- 'ai0' | 'ai1' | 'ai2' | 'pvp'
  result      CHAR(1)     NOT NULL,          -- 'w' thắng | 'l' thua | 'd' hoà
  dur         INTEGER     NOT NULL,
  hp_me       SMALLINT    NOT NULL,
  hp_op       SMALLINT    NOT NULL,
  hits        INTEGER     NOT NULL,
  dealt       INTEGER     NOT NULL,
  taken       INTEGER     NOT NULL,
  blocks      INTEGER     NOT NULL,
  skills      INTEGER     NOT NULL,
  ults        INTEGER     NOT NULL,
  combo       INTEGER     NOT NULL
);
CREATE INDEX ac_matches_player_idx ON ac_matches (player_id, created_at DESC);
