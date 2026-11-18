ALTER TABLE visits
    ADD COLUMN service_id UUID REFERENCES services(id) ON DELETE RESTRICT,
    ADD CONSTRAINT visits_operational_check CHECK (
        (data->'status' IS NULL OR (data->>'status' IN ('agendada', 'concluida', 'cancelada')) IS TRUE)
        AND (service_id IS NULL OR (clientcore_nonnegative_integer(data->'servicePriceCents')
            AND data->'servicePriceCents' <= '99999999'::jsonb))
    ) NOT VALID;

CREATE INDEX visits_service_id_idx ON visits(service_id);
