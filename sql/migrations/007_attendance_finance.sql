ALTER TABLE financial_records ADD CONSTRAINT financial_records_components_check CHECK (
    CASE
        WHEN NOT (data ? 'billingFinalized') THEN TRUE
        WHEN jsonb_typeof(data->'billingFinalized') = 'boolean'
            AND clientcore_finance_items(data->'inventoryItems')
            AND clientcore_nonnegative_integer(data->'labor')
            AND clientcore_nonnegative_integer(data->'materialCost')
            AND clientcore_nonnegative_integer(data->'materialCharge')
            AND clientcore_nonnegative_integer(data->'travelCost')
            AND clientcore_nonnegative_integer(data->'travelCharge')
            AND clientcore_nonnegative_integer(data->'otherCost')
            AND clientcore_nonnegative_integer(data->'cost')
            AND clientcore_nonnegative_integer(data->'charge')
        THEN (data->>'charge')::numeric = (data->>'labor')::numeric + (data->>'materialCharge')::numeric + (data->>'travelCharge')::numeric
            AND (data->>'cost')::numeric = (data->>'materialCost')::numeric + (data->>'travelCost')::numeric + (data->>'otherCost')::numeric
            AND (data->'billingFinalized' = 'true'::jsonb OR data->'received' = '0'::jsonb)
        ELSE FALSE
    END
) NOT VALID;

-- O recálculo de rota não representa uma alteração operacional feita pelo usuário.
DROP TRIGGER visits_audit ON visits;
CREATE TRIGGER visits_audit AFTER INSERT OR DELETE ON visits
    FOR EACH ROW EXECUTE FUNCTION clientcore_audit_row();
CREATE TRIGGER visits_update_audit AFTER UPDATE ON visits
    FOR EACH ROW WHEN (
        OLD.client_id IS DISTINCT FROM NEW.client_id OR OLD.service_id IS DISTINCT FROM NEW.service_id
        OR (CASE WHEN jsonb_typeof(OLD.data) = 'object' THEN OLD.data - 'travel' ELSE OLD.data END)
            IS DISTINCT FROM (CASE WHEN jsonb_typeof(NEW.data) = 'object' THEN NEW.data - 'travel' ELSE NEW.data END)
    ) EXECUTE FUNCTION clientcore_audit_row();
