BEGIN;

SELECT pg_advisory_xact_lock(hashtext('clientcore.schema.transport_settings'));

CREATE TABLE IF NOT EXISTS transport_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    origin_address TEXT NOT NULL,
    rate_cents_per_km INTEGER CHECK (rate_cents_per_km >= 0),
    revision UUID NOT NULL
);

COMMIT;
