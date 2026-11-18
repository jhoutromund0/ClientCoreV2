const { randomUUID } = require('node:crypto');
const database = require('../config/database');
const { isUuid, readCursor, pageFrom } = require('../utils/pagination');
const { preservedData } = require('../config/store');
const VisitResources = require('./VisitResources');
const Service = require('./Service');

const statuses = Object.freeze({ agendada: 'Agendada', concluida: 'Concluída', cancelada: 'Cancelada' });
const text = value => typeof value === 'string' ? value.trim() : '';
const addressSql = "COALESCE(NULLIF(btrim(visits.data->>'address'), ''), clients.data->>'address', '')";
const billedSql = "COALESCE(financial_records.data->'billingFinalized' = 'true'::jsonb, FALSE)";
const columnList = `visits.id, visits.data, visits.client_id, visits.service_id, visits.scheduled_day AS sort_key,
    ${addressSql} AS address, ${billedSql} AS billing_finalized`;
const base = `FROM visits LEFT JOIN clients ON clients.id = visits.client_id
    LEFT JOIN financial_records ON financial_records.id = visits.id`;

class ValidationError extends Error {}
class ConflictError extends Error {}

function format(row, resources = {}) {
    const raw = row.data || {};
    const hasOperationalStatus = Object.hasOwn(statuses, raw.status);
    const { assignees = [], materials = [] } = resources;
    return {
        ...raw,
        id: row.id,
        clientId: row.client_id || '',
        clientName: text(raw.clientName),
        description: text(raw.description),
        serviceId: row.service_id || null,
        servicePriceCents: Number.isSafeInteger(raw.servicePriceCents) ? raw.servicePriceCents : null,
        scheduledAt: text(raw.scheduledAt),
        address: text(row.address),
        status: hasOperationalStatus ? raw.status : 'agendada',
        hasOperationalStatus,
        billingFinalized: row.billing_finalized === true,
        technicians: assignees.length ? assignees.map(assignee => assignee.name).join(', ') : text(raw.technicians),
        materials: text(raw.materials),
        assignees,
        materialsUsed: materials
    };
}

async function rowsWithResources(rows, runner = database) {
    if (!rows.length)
        return [];
    const byVisit = await VisitResources.getMany(rows.map(row => row.id), runner);
    return rows.map(row => format(row, byVisit.get(row.id)));
}

async function find(id, runner = database) {
    if (!isUuid(id))
        return null;
    const { rows } = await runner.query(`SELECT ${columnList} ${base} WHERE visits.id = $1`, [id]);
    if (!rows.length)
        return null;
    return format(rows[0], await VisitResources.get(id, runner));
}

async function lock(runner, id) {
    // Todas as alterações de visita e de faturamento usam o mesmo bloqueio de linha.
    const { rowCount } = await runner.query('SELECT id FROM visits WHERE id = $1 FOR UPDATE', [id]);
    return rowCount ? find(id, runner) : null;
}

async function prepare(runner, input, previous) {
    const { rows: [client] } = await runner.query(`
        SELECT id, COALESCE(NULLIF(btrim(data->>'company'), ''), NULLIF(btrim(data->>'name'), '')) AS name,
            data->>'address' AS address
        FROM clients WHERE id = $1 FOR SHARE
    `, [input.clientId]);
    if (!client?.name)
        throw new ValidationError('Selecione um cliente cadastrado.');

    const serviceId = input.serviceId || previous?.serviceId;
    let service;
    if (serviceId && serviceId !== previous?.serviceId) {
        service = await Service.find(serviceId, runner);
        if (!service?.active)
            throw new ValidationError('Selecione um serviço ativo.');
    } else if (!serviceId && input.description && input.description !== previous?.description) {
        // Compatibilidade com formulários antigos durante a atualização da aplicação.
        const { rows: [selected] } = await runner.query(
            'SELECT id, name, price_cents AS "priceCents" FROM services WHERE lower(name) = lower($1) AND active FOR SHARE',
            [input.description]
        );
        service = selected;
    }
    if (!service && !previous?.description && !previous?.serviceId)
        throw new ValidationError('Selecione um serviço ativo para agendar a visita.');

    const oldAddress = previous?.clientId === client.id ? previous.address : '';
    const address = input.address !== undefined ? input.address || text(client.address) : oldAddress || text(client.address);
    if (input.requireAddress && !address)
        throw new ValidationError('Informe o endereço do atendimento.');
    const servicePriceCents = input.servicePriceCents ?? service?.priceCents ?? previous?.servicePriceCents ?? null;
    const status = input.status || previous?.status || 'agendada';
    if (previous?.status === 'concluida' && status !== 'concluida')
        throw new ConflictError('Uma visita concluída mantém o consumo confirmado. Corrija as quantidades na edição, se necessário.');
    if (status === 'concluida' && (!previous || previous.status !== status || input.resources) && !input.confirmed)
        throw new ValidationError('Confirme o consumo informado para concluir a visita.');

    return {
        clientId: client.id,
        clientName: client.name,
        description: service?.name || previous?.description,
        serviceId: service?.id || serviceId || null,
        servicePriceCents,
        scheduledAt: input.scheduledAt,
        address,
        status,
        materials: text(previous?.materials || input.materials),
        technicians: text(previous?.assignees?.length ? '' : previous?.technicians || input.technicians)
    };
}

async function syncResources(runner, visit, input, previous) {
    const consume = visit.status === 'concluida';
    if (input.resources)
        return VisitResources.sync(runner, visit.id, { ...input.resources, consume });
    if (consume && previous && previous.status !== 'concluida') {
        return VisitResources.sync(runner, visit.id, {
            assigneeIds: previous.assignees.map(({ id }) => id),
            materials: previous.materialsUsed.map(line => ({
                materialId: line.materialId,
                plannedQuantity: String(line.plannedQuantity),
                usedQuantity: String(line.usedQuantity)
            })),
            consume
        });
    }
}

async function create(input) {
    return database.withTransaction(async runner => {
        const id = randomUUID();
        const now = new Date().toISOString();
        const visit = { ...await prepare(runner, input), id, createdAt: now, updatedAt: now, revision: randomUUID() };
        await runner.query('INSERT INTO visits (id, client_id, service_id, data) VALUES ($1, $2, $3, $4::jsonb)',
            [id, visit.clientId, visit.serviceId, JSON.stringify(visit)]);
        await syncResources(runner, visit, input);
        return find(id, runner);
    });
}

function checkRevision(visit, revision) {
    if (revision !== undefined && (visit.revision || '') !== revision)
        throw new ConflictError('A visita foi alterada em outra tela. Abra o registro atualizado antes de salvar.');
    if (visit.billingFinalized)
        throw new ConflictError('O lançamento financeiro desta visita precisa ser removido por um administrador antes da edição.');
}

async function update(id, input) {
    if (!isUuid(id))
        return null;
    return database.withTransaction(async runner => {
        const previous = await lock(runner, id);
        if (!previous)
            return null;
        checkRevision(previous, input.revision);
        const visit = { ...await prepare(runner, input, previous), id, updatedAt: new Date().toISOString(), revision: randomUUID() };
        await runner.query(`
            UPDATE visits SET client_id = $2, service_id = $3, data = (${preservedData('data')}) || $4::jsonb WHERE id = $1
        `, [id, visit.clientId, visit.serviceId, JSON.stringify(visit)]);
        await syncResources(runner, visit, input, previous);
        return find(id, runner);
    });
}

async function cancel(id, revision) {
    if (!isUuid(id))
        return null;
    return database.withTransaction(async runner => {
        const visit = await lock(runner, id);
        if (!visit)
            return null;
        checkRevision(visit, revision);
        if (visit.status === 'concluida')
            throw new ConflictError('Uma visita concluída mantém o consumo confirmado e não pode ser cancelada.');
        if (visit.status === 'cancelada')
            return visit;
        const { rows: [valid] } = await runner.query(
            'SELECT client_id IS NOT NULL AND clientcore_valid_day(scheduled_day) AS ok FROM visits WHERE id = $1', [id]
        );
        if (!valid.ok)
            throw new ConflictError('Corrija a data e o cliente deste registro antes de cancelar a visita.');
        await runner.query(`
            UPDATE visits SET data = data || $2::jsonb WHERE id = $1
        `, [id, JSON.stringify({ status: 'cancelada', updatedAt: new Date().toISOString(), revision: randomUUID() })]);
        return find(id, runner);
    });
}

async function remove(id) {
    if (!isUuid(id))
        return false;
    return database.withTransaction(async runner => {
        const visit = await lock(runner, id);
        if (!visit)
            return false;
        checkRevision(visit);
        if (visit.status === 'concluida' || await VisitResources.hasConsumption(id, runner))
            throw new ConflictError('O registro de uma visita concluída preserva o histórico do atendimento.');
        const { rowCount } = await runner.query('DELETE FROM visits WHERE id = $1', [id]);
        return rowCount > 0;
    });
}

async function financePage(after, limit = 40) {
    const [sort, id] = readCursor(after);
    const { rows } = await database.query(`
        SELECT ${columnList}, financial_records.data AS record ${base}
        WHERE ($1::text IS NULL OR (visits.scheduled_day, visits.id) > ($1, $2::uuid))
        ORDER BY visits.scheduled_day, visits.id LIMIT $3
    `, [sort, id, limit + 1]);
    const page = pageFrom(rows, limit);
    const visits = await rowsWithResources(page.items);
    return { ...page, items: page.items.map((row, index) => ({ visit: visits[index], record: row.record })) };
}

const clientFilter = "($3 = '' OR strpos(lower(COALESCE(visits.data->>'clientName', '')), lower($3)) > 0)";
const monthWhere = `visits.scheduled_day >= $1 AND visits.scheduled_day < $2
    AND clientcore_valid_day(visits.scheduled_day) AND ${clientFilter}`;

async function formatPage(rows, limit) {
    const page = pageFrom(rows, limit);
    return { ...page, items: await rowsWithResources(page.items) };
}

async function calendarPage(start, end, search, after, limit = 40) {
    const [sort, id] = readCursor(after);
    const params = [start, end, search];
    const [pageResult, summaryResult] = await Promise.all([
        database.query(`
            SELECT ${columnList} ${base}
            WHERE ${monthWhere} AND ($4::text IS NULL OR (visits.scheduled_day, visits.id) > ($4, $5::uuid))
            ORDER BY visits.scheduled_day, visits.id LIMIT $6
        `, [...params, sort, id, limit + 1]),
        database.query(`
            WITH ranked AS (
                SELECT visits.scheduled_day AS day, visits.data,
                    count(*) OVER (PARTITION BY visits.scheduled_day) AS count,
                    row_number() OVER (PARTITION BY visits.scheduled_day ORDER BY visits.data->>'scheduledAt', visits.id) AS position
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
    return { ...await formatPage(pageResult.rows, limit), days };
}

async function undatedPage(search, after, limit = 40) {
    const [sort, id] = readCursor(after);
    const { rows } = await database.query(`
        SELECT ${columnList} ${base}
        WHERE NOT clientcore_valid_day(visits.scheduled_day)
            AND ($1::text IS NULL OR (visits.scheduled_day, visits.id) > ($1, $2::uuid)) AND ${clientFilter}
        ORDER BY visits.scheduled_day, visits.id LIMIT $4
    `, [sort, id, search, limit + 1]);
    return { ...await formatPage(rows, limit), days: {} };
}

async function hasUndated() {
    const { rows } = await database.query('SELECT 1 FROM visits WHERE NOT clientcore_valid_day(scheduled_day) LIMIT 1');
    return rows.length > 0;
}

async function operationalPage(search, status, after, limit = 40) {
    const [sort, id] = readCursor(after);
    const { rows } = await database.query(`
        SELECT ${columnList} ${base}
        WHERE ($1::text IS NULL OR (visits.scheduled_day, visits.id) < ($1, $2::uuid)) AND ${clientFilter}
            AND ($4::text = '' OR COALESCE(visits.data->>'status', 'agendada') = $4)
        ORDER BY visits.scheduled_day DESC, visits.id DESC LIMIT $5
    `, [sort, id, search, status, limit + 1]);
    return formatPage(rows, limit);
}

async function dashboardData(start, end) {
    const { rows } = await database.query(`
        SELECT ${columnList}, financial_records.data AS record,
            clients.data->'address' AS client_address, clients.data->'travel' AS client_travel ${base}
        WHERE visits.scheduled_day >= $1 AND visits.scheduled_day <= $2
        ORDER BY visits.scheduled_day, visits.id
    `, [start, end]);
    const visits = await rowsWithResources(rows);
    return rows.map((row, index) => ({
        visit: visits[index], record: row.record, client: { address: row.client_address, travel: row.client_travel }
    }));
}

module.exports = {
    find, create, update, cancel, delete: remove, statuses, ValidationError, ConflictError,
    financePage, calendarPage, dashboardData, undatedPage, hasUndated, operationalPage
};
