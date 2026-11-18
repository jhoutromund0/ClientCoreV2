const { query, write } = require('../config/database');
const { isUuid, pageFrom, readCursor } = require('../utils/pagination');

const columns = 'id, name, description, price_cents AS "priceCents", active';
const filter = `($1 = '' OR strpos(name_key, lower($1)) > 0 OR strpos(lower(description), lower($1)) > 0)`;

class Service {
    static async page(after, search = '') {
        const [name, id] = readCursor(after);
        const limit = 30;
        const { rows } = await query(`
            SELECT ${columns}, name_key AS sort_key FROM services
            WHERE ${filter} AND ($2::text IS NULL OR (name_key, id) > ($2, $3::uuid))
            ORDER BY name_key, id LIMIT $4
        `, [search, name, id, limit + 1]);
        return { ...pageFrom(rows, limit), after: name !== null ? after : null };
    }

    static async catalog(search = '') {
        const { rows } = await query(`
            SELECT ${columns} FROM services WHERE active AND ${filter}
            ORDER BY name_key, id LIMIT 30
        `, [search]);
        return rows;
    }

    static async find(id, transaction) {
        if (!isUuid(id))
            return null;
        // A reserva mantém o preço e o estado disponíveis até gravar o atendimento.
        const { rows } = transaction
            ? await transaction.query(`SELECT ${columns} FROM services WHERE id = $1 FOR SHARE`, [id])
            : await query(`SELECT ${columns} FROM services WHERE id = $1`, [id]);
        return rows[0] || null;
    }

    static async create({ name, description, priceCents }) {
        const { rows } = await write(`
            INSERT INTO services (name, description, price_cents) VALUES ($1, $2, $3) RETURNING ${columns}
        `, [name, description, priceCents]);
        return rows[0];
    }

    static async update(id, { name, description, priceCents }) {
        if (!isUuid(id))
            return null;
        const { rows } = await write(`
            UPDATE services SET name = $2, description = $3, price_cents = $4, updated_at = NOW()
            WHERE id = $1 RETURNING ${columns}
        `, [id, name, description, priceCents]);
        return rows[0] || null;
    }

    static async setActive(id, active) {
        if (!isUuid(id))
            return null;
        const { rows } = await write(`
            UPDATE services SET active = $2, updated_at = CASE WHEN active = $2 THEN updated_at ELSE NOW() END
            WHERE id = $1 RETURNING ${columns}
        `, [id, active]);
        return rows[0] || null;
    }
}

module.exports = Service;
