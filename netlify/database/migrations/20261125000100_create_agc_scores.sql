-- Bảng điểm Tournament của /agcCombat/ (mỗi dòng = một lượt chơi giải của một người chơi)
CREATE TABLE agc_scores (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  player_id   TEXT        NOT NULL,          -- mã ngẫu nhiên lưu trên máy người chơi, không phải thông tin cá nhân
  name        TEXT        NOT NULL,
  ch          SMALLINT    NOT NULL,          -- số thứ tự nhân vật trong mảng CH
  score       INTEGER     NOT NULL,
  wins        SMALLINT    NOT NULL,          -- số trận thắng trong lượt đó
  champ       SMALLINT    NOT NULL,          -- 1 = vô địch
  dur         INTEGER     NOT NULL           -- giây
);
CREATE INDEX agc_scores_player_idx ON agc_scores (player_id, score DESC);
