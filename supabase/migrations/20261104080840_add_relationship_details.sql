-- Additive: new optional columns only. Existing connections and app versions are unaffected.
BEGIN;
ALTER TABLE public.connections
 ADD COLUMN met_on date,
 ADD COLUMN met_where text NOT NULL DEFAULT '',
 ADD COLUMN met_how text NOT NULL DEFAULT '',
 ADD COLUMN introduced_by text NOT NULL DEFAULT '',
 ADD CONSTRAINT connections_relationship_lengths CHECK (length(met_where) <= 200 AND length(met_how) <= 200 AND length(introduced_by) <= 120);
COMMIT;
