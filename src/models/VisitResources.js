const database = require('../config/database');
const { isUuid } = require('../utils/pagination');
const Material = require('./Material');

const assigneeLimit = 20;
const materialLimit = 25;
const quantityPattern = /^(\d{1,7})(?:[.,](\d{1,3}))?$/;
const moneyPattern = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

class ValidationError extends Error {}

function decimal(value, pattern, scale) {
    if (value === undefined || value === '')
        return 0;
    if (!['number', 'string'].includes(typeof value))
        return NaN;
    const match = pattern.exec(String(value).trim());
    return match ? Number(match[1]) * 10 ** scale + Number((match[2] || '').padEnd(scale, '0')) : NaN;
}

function uniqueIds(values, limit, message) {
    if (!Array.isArray(values) || values.length > limit || !values.every(isUuid))
        throw new ValidationError(message);
    const ids = values.map((id) => id.toLowerCase());
    if (new Set(ids).size !== ids.length)
        throw new ValidationError(message);
    return ids;
}

function formatMaterial(row) {
    return {
        materialId: row.material_id,
        name: row.name_snapshot,
        unit: row.unit_snapshot,
        plannedQuantity: row.planned_quantity_milli / 1000,
        usedQuantity: row.used_quantity_milli / 1000,
        consumedQuantity: row.consumed_quantity_milli / 1000,
        unitCostCents: Number(row.unit_cost_cents),
        unitPriceCents: Number(row.unit_price_cents)
    };
}

async function getMany(visitIds, runner = database) {
    const ids = visitIds.filter(isUuid).map((id) => id.toLowerCase());
    const resources = new Map(ids.map((id) => [id, { assignees: [], materials: [], travelPayeeId: null }]));
    if (!ids.length)
        return resources;
    const [assignees, materials] = await Promise.all([
        runner.query(`SELECT assignment.visit_id, assignment.is_travel_payee, users.id, users.name, users.role, users.active,
            users.mileage_rate_cents_per_km AS "mileageRateCentsPerKm"
            FROM visit_assignees AS assignment JOIN users ON users.id = assignment.user_id
            WHERE assignment.visit_id = ANY($1::uuid[]) ORDER BY users.name, users.id`, [ids]),
        runner.query(`SELECT * FROM visit_materials WHERE visit_id = ANY($1::uuid[])
            ORDER BY name_snapshot, material_id`, [ids])
    ]);
    for (const { visit_id: visitId, is_travel_payee: isTravelPayee, ...user } of assignees.rows) {
        const visit = resources.get(visitId);
        visit.assignees.push(user);
        if (isTravelPayee)
            visit.travelPayeeId = user.id;
    }
    for (const row of materials.rows)
        resources.get(row.visit_id).materials.push(formatMaterial(row));
    return resources;
}

async function get(visitId, runner = database) {
    const resources = await getMany([visitId], runner);
    return resources.get(String(visitId).toLowerCase()) || { assignees: [], materials: [], travelPayeeId: null };
}

async function searchAssignees(search = '') {
    const { rows } = await database.query(`SELECT id, name, role FROM users
        WHERE active AND btrim(name) <> '' AND ($1 = '' OR strpos(lower(name), lower($1)) > 0)
        ORDER BY name, id LIMIT 30`, [search]);
    return rows;
}

async function findAssignees(ids) {
    const valid = ids.filter(isUuid);
    if (!valid.length)
        return [];
    const { rows } = await database.query('SELECT id, name, role, active FROM users WHERE id = ANY($1::uuid[]) ORDER BY name, id', [valid]);
    return rows;
}

const materialOptions = (items) => items.filter((item) => item.name).map(({ id, name, unit, measure }) => ({ id, name, unit, measure }));

async function searchMaterials(search = '') {
    return materialOptions(await Material.catalog(search));
}

async function findMaterials(ids) {
    const valid = ids.filter(isUuid);
    if (!valid.length)
        return [];
    const { rows } = await database.query('SELECT id, data FROM materials WHERE id = ANY($1::uuid[]) ORDER BY name_key, id', [valid]);
    return materialOptions(rows.map(({ id, data }) => Material.format({ ...data, id })));
}

async function saveAssignees(client, visitId, ids, travelPayeeId) {
    if (ids.length) {
        const { rows } = await client.query(`SELECT users.id, users.name, users.active, assignment.id AS assignment_id
            FROM users
            LEFT JOIN visit_assignees AS assignment ON assignment.user_id = users.id AND assignment.visit_id = $2
            WHERE users.id = ANY($1::uuid[]) ORDER BY users.id FOR SHARE OF users`, [ids, visitId]);
        if (rows.length !== ids.length || rows.some((user) => !user.assignment_id && (!user.active || !user.name.trim())))
            throw new ValidationError('Selecione responsáveis ativos já cadastrados.');
        await client.query(`INSERT INTO visit_assignees (visit_id, user_id, name_snapshot)
            SELECT $1, id, name FROM users WHERE id = ANY($2::uuid[])
            ON CONFLICT (visit_id, user_id) DO NOTHING`, [visitId, ids]);
    }
    await client.query('DELETE FROM visit_assignees WHERE visit_id = $1 AND NOT (user_id = ANY($2::uuid[]))', [visitId, ids]);
    if (travelPayeeId === undefined)
        return;

    await client.query(`UPDATE visit_assignees SET is_travel_payee = FALSE
        WHERE visit_id = $1 AND is_travel_payee AND user_id IS DISTINCT FROM $2::uuid`, [visitId, travelPayeeId]);
    if (travelPayeeId) {
        await client.query(`UPDATE visit_assignees SET is_travel_payee = TRUE
            WHERE visit_id = $1 AND user_id = $2 AND NOT is_travel_payee`, [visitId, travelPayeeId]);
    }
}

function plannedMaterial(input, material, previous, consume) {
    const id = material.id;
    const name = previous?.name_snapshot || material.name;
    const unit = previous?.unit_snapshot || material.unit;
    if (!name || unit !== material.unit)
        throw new ValidationError('Revise o material cadastrado e sua unidade antes de continuar.');
    const planned = decimal(input.plannedQuantity, quantityPattern, 3);
    const used = decimal(input.usedQuantity, quantityPattern, 3);
    const validQuantity = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000
        && (unit !== 'un' || value % 1000 === 0);
    if (!validQuantity(planned) || !validQuantity(used) || (!planned && !used))
        throw new ValidationError(`Confira as quantidades de ${name}. Use números inteiros para materiais em unidades.`);
    const cost = Number(previous?.unit_cost_cents ?? material.costCents);
    const price = input.unitPrice === undefined
        ? Number(previous?.unit_price_cents ?? material.priceCents)
        : decimal(input.unitPrice, moneyPattern, 2);
    if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(price) || price < 0 || price > 10000000000)
        throw new ValidationError(`Confira os valores unitários de ${name}.`);
    return {
        material_id: id, name_snapshot: name, unit_snapshot: unit,
        planned_quantity_milli: planned, used_quantity_milli: used, consumed_quantity_milli: consume ? used : 0,
        unit_cost_cents: cost, unit_price_cents: price
    };
}

async function updateStock(client, ids, materialById, previous, next) {
    const deltas = ids.map((id) => ({
        id, change: (next.get(id)?.consumed_quantity_milli || 0) - (previous.get(id)?.consumed_quantity_milli || 0)
    })).filter(({ change }) => change);
    if (!deltas.length)
        return;
    const { rows } = await client.query(`UPDATE materials
        SET data = jsonb_set(data, '{measure}', to_jsonb((data->>'measure')::numeric - stock.change::numeric / 1000))
        FROM unnest($1::uuid[], $2::integer[]) AS stock(material_id, change)
        WHERE materials.id = stock.material_id AND jsonb_typeof(data->'measure') = 'number'
            AND (data->>'measure')::numeric >= stock.change::numeric / 1000
        RETURNING materials.id`, [deltas.map(({ id }) => id), deltas.map(({ change }) => change)]);
    if (rows.length !== deltas.length) {
        const updated = new Set(rows.map(({ id }) => id));
        const missing = deltas.find(({ id }) => !updated.has(id));
        throw new ValidationError(`Estoque insuficiente ou indisponível para ${materialById.get(missing.id).name}.`);
    }
}

async function saveMaterials(client, visitId, inputs, ids, consume) {
    const { rows: existing } = await client.query('SELECT * FROM visit_materials WHERE visit_id = $1', [visitId]);
    const previous = new Map(existing.map((row) => [row.material_id, row]));
    const allIds = [...new Set([...ids, ...previous.keys()])];
    if (!allIds.length)
        return;

    // Todas as alterações de estoque adquirem os bloqueios na mesma ordem.
    const { rows } = await client.query(`SELECT id, data,
        CASE WHEN jsonb_typeof(data->'unitValue') = 'number' THEN round((data->>'unitValue')::numeric * 100) END AS cost_cents,
        CASE WHEN jsonb_typeof(data->'unitPrice') = 'number' THEN round((data->>'unitPrice')::numeric * 100) ELSE 0 END AS price_cents
        FROM materials WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [allIds]);
    if (rows.length !== allIds.length)
        throw new ValidationError('Selecione materiais já cadastrados.');
    const materialById = new Map(rows.map(({ id, data, cost_cents, price_cents }) => [id, {
        ...Material.format({ ...data, id }), costCents: cost_cents ?? NaN, priceCents: price_cents
    }]));
    const items = inputs.map((input, index) => plannedMaterial(input, materialById.get(ids[index]), previous.get(ids[index]), consume));
    await updateStock(client, allIds, materialById, previous, new Map(items.map((item) => [item.material_id, item])));

    if (items.length) {
        await client.query(`INSERT INTO visit_materials (
            visit_id, material_id, name_snapshot, unit_snapshot,
            planned_quantity_milli, used_quantity_milli, consumed_quantity_milli, unit_cost_cents, unit_price_cents
        ) SELECT $1, item.* FROM jsonb_to_recordset($2::jsonb) AS item(
            material_id uuid, name_snapshot text, unit_snapshot text, planned_quantity_milli integer,
            used_quantity_milli integer, consumed_quantity_milli integer, unit_cost_cents bigint, unit_price_cents bigint
        ) ON CONFLICT (visit_id, material_id) DO UPDATE SET planned_quantity_milli = EXCLUDED.planned_quantity_milli,
            used_quantity_milli = EXCLUDED.used_quantity_milli, consumed_quantity_milli = EXCLUDED.consumed_quantity_milli,
            unit_price_cents = EXCLUDED.unit_price_cents
        WHERE (visit_materials.planned_quantity_milli, visit_materials.used_quantity_milli,
            visit_materials.consumed_quantity_milli, visit_materials.unit_price_cents) IS DISTINCT FROM
            (EXCLUDED.planned_quantity_milli, EXCLUDED.used_quantity_milli, EXCLUDED.consumed_quantity_milli, EXCLUDED.unit_price_cents)
        `, [visitId, JSON.stringify(items)]);
    }
    await client.query('DELETE FROM visit_materials WHERE visit_id = $1 AND NOT (material_id = ANY($2::uuid[]))', [visitId, ids]);
}

async function sync(client, visitId, { assigneeIds = [], materials = [], consume = false, travelPayeeId }) {
    const ids = uniqueIds(assigneeIds, assigneeLimit, 'Selecione até 20 responsáveis diferentes.');
    if (travelPayeeId != null && (!isUuid(travelPayeeId) || !ids.includes(travelPayeeId.toLowerCase())))
        throw new ValidationError('Escolha um responsável da visita para receber o deslocamento.');
    const materialIds = uniqueIds(Array.isArray(materials) ? materials.map((line) => line?.materialId) : null,
        materialLimit, 'Selecione até 25 materiais diferentes.');
    // O atendimento deve estar bloqueado pela mesma transação que aplica os recursos.
    await saveAssignees(client, visitId, ids, travelPayeeId?.toLowerCase() ?? travelPayeeId);
    await saveMaterials(client, visitId, materials, materialIds, consume);
}

async function hasConsumption(visitId, runner = database) {
    const { rowCount } = await runner.query('SELECT 1 FROM visit_materials WHERE visit_id = $1 AND consumed_quantity_milli > 0 LIMIT 1', [visitId]);
    return rowCount > 0;
}

module.exports = { sync, get, getMany, searchAssignees, findAssignees, searchMaterials, findMaterials, hasConsumption, ValidationError };
