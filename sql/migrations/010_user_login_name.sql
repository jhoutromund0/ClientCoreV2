ALTER TABLE users
    ALTER COLUMN email DROP NOT NULL,
    ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET name = btrim(regexp_replace(name, '[\x01-\x1f\x7f]+', ' ', 'g'))
WHERE name ~ '[\x01-\x1f\x7f]';

DO $$
DECLARE
    duplicate RECORD;
    suffix_position BIGINT;
    suffix TEXT;
    candidate TEXT;
BEGIN
    -- A conta mais antiga mantém o nome quando há mais de uma com o mesmo login.
    FOR duplicate IN
        WITH ranked AS (
            SELECT id, btrim(name) AS base_name,
                row_number() OVER (PARTITION BY lower(btrim(name)) ORDER BY created_at, id) AS position
            FROM users
        )
        SELECT id, COALESCE(NULLIF(base_name, ''), 'Usuário') AS base_name, position
        FROM ranked
        WHERE position > 1 OR base_name = ''
        ORDER BY lower(base_name), position, id
    LOOP
        suffix_position := duplicate.position;
        LOOP
            suffix := ' (' || suffix_position || ')';
            candidate := rtrim(left(duplicate.base_name, 120 - length(suffix))) || suffix;
            EXIT WHEN NOT EXISTS (SELECT FROM users WHERE lower(btrim(name)) = lower(candidate));
            suffix_position := suffix_position + 1;
        END LOOP;
        UPDATE users SET name = candidate WHERE id = duplicate.id;
    END LOOP;
END;
$$;

CREATE UNIQUE INDEX users_login_name_unique ON users (lower(btrim(name)));
