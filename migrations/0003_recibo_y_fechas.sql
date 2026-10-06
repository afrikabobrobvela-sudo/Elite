-- Etapa "Recibo de muestra" (antes del VoBo) y fecha de llegada de la orden de compra.

-- La tabla de muestras tenía la lista de etapas fija en un CHECK; se reconstruye sin él
-- (la API ya valida las etapas). stage_events apunta a samples con ON DELETE CASCADE,
-- así que se respalda antes de borrar la tabla vieja y se restaura después.
CREATE TABLE stage_events_respaldo AS SELECT * FROM stage_events;

CREATE TABLE samples_nueva (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL DEFAULT '',
  quote              TEXT NOT NULL DEFAULT '',
  client             TEXT NOT NULL DEFAULT '',
  test               TEXT NOT NULL DEFAULT '',
  standard           TEXT NOT NULL DEFAULT '',
  consultant         TEXT NOT NULL DEFAULT '',
  sales_rep          TEXT NOT NULL DEFAULT '',
  received_at        TEXT,
  business_days      INTEGER,
  due_on             TEXT,
  stage              TEXT NOT NULL,
  stage_since        TEXT,
  delivered_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  quote_id           TEXT,
  admin_by_me        INTEGER NOT NULL DEFAULT 1,
  test_by_me         INTEGER NOT NULL DEFAULT 1,
  conditioning_start TEXT,
  conditioning_end   TEXT
);
INSERT INTO samples_nueva (
  id, code, quote, client, test, standard, consultant, sales_rep, received_at, business_days, due_on,
  stage, stage_since, delivered_at, created_at, updated_at, quote_id, admin_by_me, test_by_me,
  conditioning_start, conditioning_end)
SELECT
  id, code, quote, client, test, standard, consultant, sales_rep, received_at, business_days, due_on,
  stage, stage_since, delivered_at, created_at, updated_at, quote_id, admin_by_me, test_by_me,
  conditioning_start, conditioning_end
FROM samples;
DROP TABLE samples;
ALTER TABLE samples_nueva RENAME TO samples;
CREATE INDEX samples_stage ON samples (stage);
CREATE INDEX samples_quote ON samples (quote_id);

DELETE FROM stage_events;
INSERT INTO stage_events (id, sample_id, stage, at, note, recorded_at)
SELECT id, sample_id, stage, at, note, recorded_at FROM stage_events_respaldo;
DROP TABLE stage_events_respaldo;

ALTER TABLE quotes ADD COLUMN po_received_at TEXT;   -- ISO 8601, llegada de la orden de compra

UPDATE meta SET value = value + 1 WHERE key = 'board_version';
