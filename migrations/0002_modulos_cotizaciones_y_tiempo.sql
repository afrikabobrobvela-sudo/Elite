-- Módulo de cotizaciones, registro de tiempo por actividad y más datos por muestra.

-- La recepción de probetas ahora guarda fecha y hora (ISO 8601).
ALTER TABLE samples RENAME COLUMN received_on TO received_at;

ALTER TABLE samples ADD COLUMN quote_id TEXT;                          -- cotización de origen (opcional)
ALTER TABLE samples ADD COLUMN admin_by_me INTEGER NOT NULL DEFAULT 1; -- la parte administrativa la hace Rodrigo
ALTER TABLE samples ADD COLUMN test_by_me INTEGER NOT NULL DEFAULT 1;  -- las pruebas las hace Rodrigo
ALTER TABLE samples ADD COLUMN conditioning_start TEXT;                -- ISO 8601
ALTER TABLE samples ADD COLUMN conditioning_end TEXT;                  -- ISO 8601
CREATE INDEX samples_quote ON samples (quote_id);

CREATE TABLE quotes (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL DEFAULT '',          -- C26.609
  client       TEXT NOT NULL DEFAULT '',
  sales_rep    TEXT NOT NULL DEFAULT '',
  tests        TEXT NOT NULL DEFAULT '',          -- pruebas solicitadas, texto libre
  notes        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('elaboracion','enviada','seguimiento','comprada','perdida')),
  status_since TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE quote_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id    TEXT NOT NULL,
  status      TEXT NOT NULL,
  at          TEXT,
  note        TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL
);
CREATE INDEX quote_events_quote ON quote_events (quote_id, id);

-- Tiempo invertido: cada renglón es un bloque de trabajo. ended_at NULL = en curso.
CREATE TABLE activities (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  note       TEXT NOT NULL DEFAULT '',
  quote_id   TEXT,
  sample_id  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX activities_started ON activities (started_at);

UPDATE meta SET value = value + 1 WHERE key = 'board_version';
