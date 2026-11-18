CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 120),
    name_key TEXT GENERATED ALWAYS AS (lower(name)) STORED,
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 2000),
    price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 99999999),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT services_name_unique UNIQUE (name_key)
);

CREATE INDEX services_active_name_idx ON services(name_key) WHERE active;

CREATE TRIGGER services_audit AFTER INSERT OR UPDATE OR DELETE ON services
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
