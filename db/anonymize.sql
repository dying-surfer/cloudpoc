-- Anonymisiert eine KOPIE der Datenbank, bevor ein Dump sie verlässt (make db-dump-anon).
-- Nie auf die echte Prod-DB anwenden: Die Daten werden überschrieben.
--
-- Ziel: realistische Daten für Dev und Staging (Mengen, Verteilungen, Längen, Datumswerte)
-- ohne personenbezogene Inhalte. Alles läuft in einer Transaktion: ganz oder gar nicht.

\set ON_ERROR_STOP on
BEGIN;

-- 1. Schutz vor neuen Spalten -----------------------------------------------------------
-- Jede Spalte muss hier eingeordnet sein. Kommt per Migration eine neue hinzu (z. B. eine
-- E-Mail-Adresse), bricht das Skript ab, statt sie unbemerkt im Klartext durchzulassen.
DO $$
DECLARE
    known text[] := ARRAY[
        -- unverändert: keine personenbezogenen Daten
        'ticket.id', 'ticket.status', 'ticket.priority', 'ticket.due_date',
        'ticket.created_at', 'ticket.updated_at', 'ticket.version',
        -- anonymisiert (siehe unten)
        'ticket.assignee', 'ticket.title', 'ticket.description',
        -- technisch (Doctrine Migrations)
        'doctrine_migration_versions.version', 'doctrine_migration_versions.executed_at',
        'doctrine_migration_versions.execution_time'
    ];
    unknown text;
BEGIN
    SELECT string_agg(table_name || '.' || column_name, ', ' ORDER BY table_name, column_name)
      INTO unknown
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND NOT (table_name || '.' || column_name) = ANY (known);

    IF unknown IS NOT NULL THEN
        RAISE EXCEPTION 'Nicht eingeordnete Spalten: %. Bitte in db/anonymize.sql ergänzen.', unknown;
    END IF;
END $$;

-- 2. Bearbeiter: Pseudonyme ---------------------------------------------------------------
-- Gleicher Name → gleiches Pseudonym, damit Filter und Gruppierung realistisch bleiben.
-- Nummeriert in zufälliger Reihenfolge, damit person001 nicht der alphabetisch Erste ist.
CREATE TEMP TABLE assignee_map AS
SELECT original, 'person' || lpad(row_number() OVER (ORDER BY random())::text, 3, '0') AS pseudonym
  FROM (SELECT DISTINCT assignee AS original FROM ticket WHERE assignee IS NOT NULL) a;

UPDATE ticket t
   SET assignee = m.pseudonym
  FROM assignee_map m
 WHERE t.assignee = m.original;

-- 3. Freitexte ersetzen ------------------------------------------------------------------
-- Titel: kurz und praktisch eindeutig. Die hinteren Zeichen der ID, weil bei UUIDv7 vorne
-- ein Zeitstempel steht (gleich für Tickets aus derselben Millisekunde), hinten Zufall.
-- Beschreibung: Platzhaltertext mit derselben Länge, damit die Oberfläche mit
-- realistischen Textlängen getestet werden kann. NULL bleibt NULL.
UPDATE ticket
   SET title = 'Ticket ' || right(id::text, 8),
       description = left(repeat('Lorem ipsum dolor sit amet. ', length(description) / 28 + 1),
                          length(description));

COMMIT;
