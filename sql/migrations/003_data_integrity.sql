CREATE FUNCTION clientcore_cnpj(value TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT NULLIF(upper(regexp_replace(value, '[./[:space:]-]', '', 'g')), '');
$$;

CREATE FUNCTION clientcore_email(value TEXT) RETURNS TEXT
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT NULLIF(lower(btrim(value)), '');
$$;

ALTER TABLE clients
    ADD COLUMN name_key TEXT GENERATED ALWAYS AS (left(lower(btrim(COALESCE(data->>'name', ''))), 300)) STORED,
    ADD COLUMN cnpj_key TEXT GENERATED ALWAYS AS (clientcore_cnpj(data->>'cnpj')) STORED,
    ADD COLUMN email_key TEXT GENERATED ALWAYS AS (clientcore_email(data->>'email')) STORED,
    ADD COLUMN legacy_cnpj_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN legacy_email_duplicate BOOLEAN NOT NULL DEFAULT FALSE;

-- Duplicatas anteriores à migração mantêm seus dados e referências.
WITH ranked AS (
    SELECT id, cnpj_key, row_number() OVER (PARTITION BY cnpj_key ORDER BY id) AS position
    FROM clients
)
UPDATE clients SET legacy_cnpj_duplicate = TRUE FROM ranked
WHERE clients.id = ranked.id AND ranked.cnpj_key IS NOT NULL AND ranked.position > 1;

WITH ranked AS (
    SELECT id, email_key, row_number() OVER (PARTITION BY email_key ORDER BY id) AS position
    FROM clients
)
UPDATE clients SET legacy_email_duplicate = TRUE FROM ranked
WHERE clients.id = ranked.id AND ranked.email_key IS NOT NULL AND ranked.position > 1;

ALTER TABLE clients ADD CONSTRAINT clients_document_check CHECK (
    jsonb_typeof(data) = 'object'
    AND (jsonb_typeof(data->'name') = 'string' AND btrim(data->>'name') <> '') IS TRUE
    AND (clientcore_cnpj(data->>'cnpj') IS NULL OR clientcore_cnpj(data->>'cnpj') ~ '^[A-Z0-9]{12}[0-9]{2}$')
) NOT VALID;

CREATE UNIQUE INDEX clients_cnpj_unique ON clients(cnpj_key) WHERE NOT legacy_cnpj_duplicate;
CREATE UNIQUE INDEX clients_email_unique ON clients(email_key) WHERE NOT legacy_email_duplicate;
CREATE INDEX clients_legacy_cnpj_idx ON clients(cnpj_key) WHERE legacy_cnpj_duplicate;
CREATE INDEX clients_legacy_email_idx ON clients(email_key) WHERE legacy_email_duplicate;
CREATE INDEX clients_name_cursor_idx ON clients(name_key, id);

CREATE FUNCTION clientcore_client_identity() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    next_cnpj TEXT := clientcore_cnpj(NEW.data->>'cnpj');
    next_email TEXT := clientcore_email(NEW.data->>'email');
BEGIN
    IF TG_OP = 'UPDATE' AND next_cnpj IS NOT DISTINCT FROM OLD.cnpj_key THEN
        NEW.legacy_cnpj_duplicate := OLD.legacy_cnpj_duplicate;
    ELSE
        NEW.legacy_cnpj_duplicate := FALSE;
        IF EXISTS (SELECT FROM clients WHERE cnpj_key = next_cnpj AND legacy_cnpj_duplicate) THEN
            RAISE unique_violation USING CONSTRAINT = 'clients_cnpj_unique';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND next_email IS NOT DISTINCT FROM OLD.email_key THEN
        NEW.legacy_email_duplicate := OLD.legacy_email_duplicate;
    ELSE
        NEW.legacy_email_duplicate := FALSE;
        IF EXISTS (SELECT FROM clients WHERE email_key = next_email AND legacy_email_duplicate) THEN
            RAISE unique_violation USING CONSTRAINT = 'clients_email_unique';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER clients_identity_guard BEFORE INSERT OR UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION clientcore_client_identity();

ALTER TABLE materials
    ADD COLUMN name_key TEXT GENERATED ALWAYS AS (left(lower(btrim(COALESCE(data->>'name', ''))), 300)) STORED,
    ADD CONSTRAINT materials_document_check CHECK (
        (jsonb_typeof(data) = 'object'
        AND jsonb_typeof(data->'name') = 'string' AND btrim(data->>'name') <> ''
        AND jsonb_typeof(data->'measure') = 'number' AND data->'measure' > '0'::jsonb
        AND jsonb_typeof(data->'unitValue') = 'number' AND data->'unitValue' >= '0'::jsonb) IS TRUE
    ) NOT VALID;
CREATE INDEX materials_name_cursor_idx ON materials(name_key, id);

ALTER TABLE visits
    ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE RESTRICT,
    ADD COLUMN scheduled_day TEXT GENERATED ALWAYS AS (left(COALESCE(data->>'scheduledAt', ''), 10)) STORED NOT NULL;

CREATE FUNCTION clientcore_valid_day(day TEXT) RETURNS BOOLEAN
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
BEGIN
    IF day IS NULL OR day !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
        RETURN FALSE;
    END IF;
    PERFORM make_date(left(day, 4)::INTEGER, substr(day, 6, 2)::INTEGER, right(day, 2)::INTEGER);
    RETURN TRUE;
EXCEPTION WHEN datetime_field_overflow THEN
    RETURN FALSE;
END;
$$;

UPDATE visits SET client_id = clients.id FROM clients WHERE visits.data->>'clientId' = clients.id::text;

WITH aliases AS (
    SELECT alias, (array_agg(DISTINCT clients.id))[1] AS id
    FROM clients
    CROSS JOIN LATERAL (VALUES (clients.name_key), (lower(btrim(clients.data->>'company')))) AS labels(alias)
    WHERE alias IS NOT NULL AND alias <> ''
    GROUP BY alias
    HAVING count(DISTINCT clients.id) = 1
)
UPDATE visits SET client_id = aliases.id FROM aliases
WHERE visits.client_id IS NULL AND lower(btrim(visits.data->>'clientName')) = aliases.alias;

ALTER TABLE visits ADD CONSTRAINT visits_document_check CHECK (
    (jsonb_typeof(data) = 'object'
    AND client_id IS NOT NULL
    AND jsonb_typeof(data->'clientName') = 'string' AND btrim(data->>'clientName') <> ''
    AND jsonb_typeof(data->'scheduledAt') = 'string' AND clientcore_valid_day(scheduled_day)) IS TRUE
) NOT VALID;
CREATE INDEX visits_client_idx ON visits(client_id);
CREATE INDEX visits_schedule_cursor_idx ON visits(scheduled_day, id);
CREATE INDEX visits_without_date_idx ON visits(scheduled_day, id) WHERE NOT clientcore_valid_day(scheduled_day);

CREATE TABLE legacy_financial_records (
    id UUID PRIMARY KEY,
    data JSONB NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

WITH orphaned AS (
    DELETE FROM financial_records
    WHERE NOT EXISTS (SELECT FROM visits WHERE visits.id = financial_records.id)
    RETURNING id, data
)
INSERT INTO legacy_financial_records (id, data) SELECT id, data FROM orphaned;

CREATE FUNCTION clientcore_nonnegative_integer(value JSONB) RETURNS BOOLEAN
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN jsonb_typeof(value) = 'number'
        THEN (value::numeric >= 0 AND trunc(value::numeric) = value::numeric) ELSE FALSE END;
$$;

CREATE FUNCTION clientcore_finance_items(items JSONB) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE WHEN jsonb_typeof(items) = 'array' THEN jsonb_array_length(items) <= 25 AND NOT EXISTS (
        SELECT FROM jsonb_array_elements(items) AS records(item) WHERE (
            jsonb_typeof(item) = 'object'
            AND jsonb_typeof(item->'name') = 'string' AND btrim(item->>'name') <> ''
            AND item->>'unit' IN ('un', 'm', 'kg')
            AND item->>'origin' IN ('estoque', 'compra')
            AND clientcore_nonnegative_integer(item->'quantity') AND item->'quantity' > '0'::jsonb
            AND clientcore_nonnegative_integer(item->'cost')
            AND clientcore_nonnegative_integer(item->'price')
        ) IS NOT TRUE
    ) ELSE FALSE END;
$$;

ALTER TABLE financial_records
    ADD CONSTRAINT financial_records_visit_fk FOREIGN KEY (id) REFERENCES visits(id) ON DELETE RESTRICT,
    ADD CONSTRAINT financial_records_values_check CHECK (
        (jsonb_typeof(data) = 'object'
        AND data->>'status' IN ('pendente', 'aprovado', 'recusado', 'servico')
        AND clientcore_nonnegative_integer(data->'labor')
        AND clientcore_nonnegative_integer(data->'received')
        AND clientcore_nonnegative_integer(data->'charge')
        AND clientcore_nonnegative_integer(data->'cost')
        AND data->'received' <= data->'charge'
        AND (data->>'status' NOT IN ('pendente', 'recusado') OR data->'received' = '0'::jsonb)
        AND clientcore_finance_items(data->'items')) IS TRUE
    ) NOT VALID;

CREATE TABLE cnpj_lookup_cache (
    cnpj TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX cnpj_lookup_cache_expiry_idx ON cnpj_lookup_cache(expires_at);

CREATE TABLE cnpj_lookup_limits (
    key TEXT PRIMARY KEY,
    hits TIMESTAMPTZ[] NOT NULL DEFAULT '{}',
    cooldown_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX cnpj_lookup_limits_updated_idx ON cnpj_lookup_limits(updated_at);

CREATE TABLE audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id UUID,
    action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_data JSONB,
    after_data JSONB,
    ip TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_occurred_at_idx ON audit_log(occurred_at);
CREATE INDEX audit_log_entity_idx ON audit_log(entity, entity_id, occurred_at);

CREATE FUNCTION clientcore_audit_row() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    previous JSONB;
    current JSONB;
BEGIN
    IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN current := to_jsonb(NEW); END IF;
    IF TG_TABLE_NAME = 'users' THEN
        IF TG_OP <> 'INSERT' THEN
            previous := jsonb_build_object('id', OLD.id, 'name', OLD.name, 'email', OLD.email, 'role', OLD.role, 'active', OLD.active);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current := jsonb_build_object('id', NEW.id, 'name', NEW.name, 'email', NEW.email, 'role', NEW.role, 'active', NEW.active);
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
            current := current || '{"password_changed": true}'::jsonb;
        END IF;
    ELSIF TG_TABLE_NAME = 'clients' THEN
        IF jsonb_typeof(previous->'data') = 'object' THEN previous := previous #- '{data,travel}'; END IF;
        IF jsonb_typeof(current->'data') = 'object' THEN current := current #- '{data,travel}'; END IF;
    END IF;
    IF previous IS NOT DISTINCT FROM current THEN RETURN NULL; END IF;
    INSERT INTO audit_log (actor_id, action, entity, entity_id, before_data, after_data, ip)
    VALUES (NULLIF(current_setting('clientcore.actor_id', true), '')::uuid, lower(TG_OP), TG_TABLE_NAME,
        COALESCE(current->>'id', previous->>'id'), previous, current,
        NULLIF(current_setting('clientcore.actor_ip', true), ''));
    RETURN NULL;
END;
$$;

CREATE TRIGGER clients_audit AFTER INSERT OR UPDATE OR DELETE ON clients
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER visits_audit AFTER INSERT OR UPDATE OR DELETE ON visits
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER materials_audit AFTER INSERT OR UPDATE OR DELETE ON materials
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER finance_audit AFTER INSERT OR UPDATE OR DELETE ON financial_records
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER users_audit AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER transport_settings_audit AFTER INSERT OR UPDATE OR DELETE ON transport_settings
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
