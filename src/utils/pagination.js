const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return typeof value === 'string' && uuidPattern.test(value);
}

function readCursor(value) {
    if (typeof value !== 'string' || value.length > 2000 || !/^[a-z0-9_-]+$/i.test(value))
        return [null, null];
    try {
        const [sort, id] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        if (typeof sort === 'string' && Array.from(sort).length <= 300 && isUuid(id))
            return [sort, id];
    } catch {
        // Um cursor inválido retorna à primeira página.
    }
    return [null, null];
}

function pageFrom(rows, limit) {
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    const next = rows.length > limit
        ? Buffer.from(JSON.stringify([last.sort_key, last.id])).toString('base64url')
        : null;
    return { items, next };
}

module.exports = { isUuid, readCursor, pageFrom };
