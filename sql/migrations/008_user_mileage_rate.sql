ALTER TABLE users
    ADD COLUMN mileage_rate_cents_per_km INTEGER
    CHECK (mileage_rate_cents_per_km BETWEEN 0 AND 99999999);

CREATE OR REPLACE FUNCTION clientcore_audit_row() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    previous JSONB;
    current JSONB;
BEGIN
    IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
    IF TG_OP <> 'DELETE' THEN current := to_jsonb(NEW); END IF;
    IF TG_TABLE_NAME = 'users' THEN
        IF TG_OP <> 'INSERT' THEN
            previous := jsonb_build_object('id', OLD.id, 'name', OLD.name, 'email', OLD.email, 'role', OLD.role,
                'active', OLD.active, 'mileage_rate_cents_per_km', OLD.mileage_rate_cents_per_km);
        END IF;
        IF TG_OP <> 'DELETE' THEN
            current := jsonb_build_object('id', NEW.id, 'name', NEW.name, 'email', NEW.email, 'role', NEW.role,
                'active', NEW.active, 'mileage_rate_cents_per_km', NEW.mileage_rate_cents_per_km);
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
