ALTER TABLE materials DROP CONSTRAINT materials_document_check;
ALTER TABLE materials
    ADD COLUMN inventory_revision UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD CONSTRAINT materials_document_check CHECK (
        (jsonb_typeof(data) = 'object'
        AND jsonb_typeof(data->'name') = 'string' AND btrim(data->>'name') <> ''
        AND jsonb_typeof(data->'measure') = 'number' AND data->'measure' >= '0'::jsonb
        AND jsonb_typeof(data->'unitValue') = 'number' AND data->'unitValue' >= '0'::jsonb
        AND (NOT (data ? 'unitPrice') OR
            (jsonb_typeof(data->'unitPrice') = 'number' AND data->'unitPrice' >= '0'::jsonb))) IS TRUE
    ) NOT VALID;

CREATE FUNCTION clientcore_inventory_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.data IS DISTINCT FROM OLD.data THEN
        NEW.inventory_revision := gen_random_uuid();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER materials_revision BEFORE UPDATE ON materials
    FOR EACH ROW EXECUTE FUNCTION clientcore_inventory_revision();

CREATE TABLE visit_assignees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name_snapshot TEXT NOT NULL CHECK (btrim(name_snapshot) <> ''),
    UNIQUE (visit_id, user_id)
);

CREATE TABLE visit_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    material_id UUID NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    name_snapshot TEXT NOT NULL CHECK (btrim(name_snapshot) <> ''),
    unit_snapshot TEXT NOT NULL CHECK (unit_snapshot IN ('un', 'm', 'kg')),
    planned_quantity_milli INTEGER NOT NULL CHECK (planned_quantity_milli BETWEEN 0 AND 1000000000),
    used_quantity_milli INTEGER NOT NULL CHECK (used_quantity_milli BETWEEN 0 AND 1000000000),
    consumed_quantity_milli INTEGER NOT NULL CHECK (consumed_quantity_milli IN (0, used_quantity_milli)),
    unit_cost_cents BIGINT NOT NULL CHECK (unit_cost_cents >= 0),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    CHECK (planned_quantity_milli > 0 OR used_quantity_milli > 0),
    CHECK (unit_snapshot <> 'un' OR (planned_quantity_milli % 1000 = 0 AND used_quantity_milli % 1000 = 0)),
    UNIQUE (visit_id, material_id)
);

CREATE INDEX visit_assignees_user_idx ON visit_assignees(user_id);
CREATE INDEX visit_materials_material_idx ON visit_materials(material_id);

CREATE FUNCTION clientcore_keep_consumed_visit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM visit_materials WHERE visit_id = OLD.id AND consumed_quantity_milli > 0) THEN
        RAISE foreign_key_violation USING MESSAGE = 'A visita possui consumo de estoque confirmado.';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER visits_keep_consumption BEFORE DELETE ON visits
    FOR EACH ROW EXECUTE FUNCTION clientcore_keep_consumed_visit();

CREATE TRIGGER visit_assignees_audit AFTER INSERT OR UPDATE OR DELETE ON visit_assignees
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER visit_materials_audit AFTER INSERT OR UPDATE OR DELETE ON visit_materials
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
