ALTER TABLE visit_assignees ADD COLUMN is_travel_payee BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX visit_assignees_one_travel_payee
    ON visit_assignees (visit_id) WHERE is_travel_payee;

ALTER TABLE visits ADD CONSTRAINT visits_manual_mileage_check CHECK (
    CASE jsonb_typeof(data->'manualTravel')
        WHEN 'null' THEN TRUE
        WHEN 'object' THEN (
            clientcore_nonnegative_integer(data#>'{manualTravel,outboundMeters}')
            AND clientcore_nonnegative_integer(data#>'{manualTravel,roundTripMeters}')
            AND data#>'{manualTravel,outboundMeters}' <= data#>'{manualTravel,roundTripMeters}'
            AND data#>'{manualTravel,roundTripMeters}' <= '999999999'::jsonb
        ) IS TRUE
        ELSE data->'manualTravel' IS NULL
    END
) NOT VALID;
