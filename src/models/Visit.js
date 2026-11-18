const { randomUUID } = require('node:crypto');
const { query, write } = require('../config/database');
const { isUuid, readCursor, pageFrom } = require('../utils/pagination');
const store = require('../config/store');

const fields = ['clientId', 'clientName', 'description', 'materials', 'technicians', 'scheduledAt'];
const clean = (value) => Object.fromEntries(fields.map(field => [
    field, typeof value[field] === 'string' ? value[field].trim() : ''
]));
const format = (row) => row ? {
    ...row.data, ...clean(row.data || {}), id: row.id, clientId: row.client_id || ''
} : null;
const columnList = 'visits.id, visits.data, visits.client_id, visits.scheduled_day AS sort_key';

async function find(id) {
    if (!isUuid(id))
        return null;
    const { rows } = await query(`SELECT ${columnList} FROM visits WHERE id = $1`, [id]);
    return format(rows[0]);
}

async function create(data) {
    const id = randomUUID();
    const now = new Date().toISOString();
    const visit = { ...clean(data), id, createdAt: now, updatedAt: now };
    await write('INSERT INTO visits (id, client_id, data) VALUES ($1, $2, $3::jsonb)',
        [id, visit.clientId, JSON.stringify(visit)]);
    return visit;
}

async function update(id, data) {
    if (!isUuid(id))
        return null;
    const visit = { ...clean(data), id, updatedAt: new Date().toISOString() };
    const { rows } = await write(`
        UPDATE visits SET client_id = $2, data = (${store.preservedData('data')}) || $3::jsonb WHERE id = $1
        RETURNING ${columnList}
    `, [id, visit.clientId, JSON.stringify(visit)]);
    return format(rows[0]);
}

async function financePage(after, limit = 40) {
    const [sort, id] = readCursor(after);
    const { rows } = await query(`
        SELECT ${columnList}, financial_records.data AS record
        FROM visits LEFT JOIN financial_records ON financial_records.id = visits.id
        WHERE ($1::text IS NULL OR (visits.scheduled_day, visits.id) > ($1, $2::uuid))
        ORDER BY visits.scheduled_day, visits.id LIMIT $3
    `, [sort, id, limit + 1]);
    const page = pageFrom(rows, limit);
    return { ...page, items: page.items.map(row => ({ visit: format(row), record: row.record })) };
}

const clientFilter = "($3 = '' OR strpos(lower(COALESCE(data->>'clientName', '')), lower($3)) > 0)";
const monthWhere = `scheduled_day >= $1 AND scheduled_day < $2 AND clientcore_valid_day(scheduled_day) AND ${clientFilter}`;

async function calendarPage(start, end, search, after, limit = 40) {
    const [sort, id] = readCursor(after);
    const params = [start, end, search];
    const [pageResult, summaryResult] = await Promise.all([
        query(`
            SELECT ${columnList} FROM visits
            WHERE ${monthWhere} AND ($4::text IS NULL OR (scheduled_day, id) > ($4, $5::uuid))
            ORDER BY scheduled_day, id LIMIT $6
        `, [...params, sort, id, limit + 1]),
        query(`
            WITH ranked AS (
                SELECT scheduled_day AS day, data, id,
                    count(*) OVER (PARTITION BY scheduled_day) AS count,
                    row_number() OVER (PARTITION BY scheduled_day ORDER BY id) AS position
                FROM visits WHERE ${monthWhere}
            )
            SELECT day, count, data->>'clientName' AS "clientName", data->>'description' AS description
            FROM ranked WHERE position <= 2 ORDER BY day, position
        `, params)
    ]);
    const days = {};
    for (const { day, count, clientName, description } of summaryResult.rows) {
        const summary = days[day] ??= { count: Number(count), preview: [] };
        summary.preview.push({ clientName, description });
    }
    return { ...formatPage(pageResult.rows, limit), days };
}

async function undatedPage(search, after, limit = 40) {
    const [sort, id] = readCursor(after);
    const { rows } = await query(`
        SELECT ${columnList} FROM visits
        WHERE NOT clientcore_valid_day(scheduled_day)
            AND ($1::text IS NULL OR (scheduled_day, id) > ($1, $2::uuid)) AND ${clientFilter}
        ORDER BY scheduled_day, id LIMIT $4
    `, [sort, id, search, limit + 1]);
    return { ...formatPage(rows, limit), days: {} };
}

async function hasUndated() {
    const { rows } = await query('SELECT 1 FROM visits WHERE NOT clientcore_valid_day(scheduled_day) LIMIT 1');
    return rows.length > 0;
}

function formatPage(rows, limit) {
    const page = pageFrom(rows, limit);
    return { ...page, items: page.items.map(format) };
}

async function dashboardData(start, end) {
    const { rows } = await query(`
        SELECT ${columnList}, financial_records.data AS record,
            clients.data->'address' AS address, clients.data->'travel' AS travel
        FROM visits
        LEFT JOIN financial_records ON financial_records.id = visits.id
        LEFT JOIN clients ON clients.id = visits.client_id
        WHERE visits.scheduled_day >= $1 AND visits.scheduled_day <= $2
        ORDER BY visits.scheduled_day, visits.id
    `, [start, end]);
    return rows.map(row => ({ visit: format(row), record: row.record, client: { address: row.address, travel: row.travel } }));
}

module.exports = {
    find, create, update, delete: (id) => store.delete('visits', id),
    financePage, calendarPage, dashboardData, undatedPage, hasUndated
};
