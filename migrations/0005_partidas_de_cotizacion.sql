-- Partidas de cada cotización: lista JSON de { test, quantity } (prueba y cuántas son).
ALTER TABLE quotes ADD COLUMN items TEXT NOT NULL DEFAULT '[]';

UPDATE meta SET value = value + 1 WHERE key = 'board_version';
