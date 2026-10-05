-- Muestras del laboratorio y su historial de etapas.
CREATE TABLE samples (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL DEFAULT '',          -- número de muestra (M26.666)
  quote         TEXT NOT NULL DEFAULT '',          -- cotización (C26.609)
  client        TEXT NOT NULL DEFAULT '',
  test          TEXT NOT NULL DEFAULT '',          -- FTIR, Flamabilidad, Color, Brillo...
  standard      TEXT NOT NULL DEFAULT '',          -- norma
  consultant    TEXT NOT NULL DEFAULT '',
  sales_rep     TEXT NOT NULL DEFAULT '',
  received_on   TEXT,                               -- YYYY-MM-DD, recepción de probetas
  business_days INTEGER,                            -- días hábiles comprometidos
  due_on        TEXT,                               -- YYYY-MM-DD, fecha compromiso
  stage         TEXT NOT NULL CHECK (stage IN (
                  'recibido','vobo','maquinado','probetas','acondicionando',
                  'prueba','reporte','revision','entregado')),
  stage_since   TEXT,                               -- ISO 8601; NULL si no se registró
  delivered_at  TEXT,                               -- ISO 8601
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX samples_stage ON samples (stage);

CREATE TABLE stage_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_id   TEXT NOT NULL REFERENCES samples (id) ON DELETE CASCADE,
  stage       TEXT NOT NULL,
  at          TEXT,                                 -- cuándo entró a la etapa; NULL si no se registró
  note        TEXT NOT NULL DEFAULT '',
  recorded_at TEXT NOT NULL                         -- cuándo se capturó en el sistema
);
CREATE INDEX stage_events_sample ON stage_events (sample_id, id);

-- Intentos fallidos de inicio de sesión, para frenar ataques de fuerza bruta.
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL                               -- epoch ms
);
CREATE INDEX login_failures_ip ON login_failures (ip, at);

-- Versión del tablero: sube con cada cambio, para que la página sepa si hay novedades.
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO meta (key, value) VALUES ('board_version', 1);
