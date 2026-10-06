-- Número de recibo de la muestra (lo asigna el laboratorio al recibir el material).
ALTER TABLE samples ADD COLUMN receipt TEXT NOT NULL DEFAULT '';

UPDATE meta SET value = value + 1 WHERE key = 'board_version';
