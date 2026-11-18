const { createHmac } = require('node:crypto');
const { query } = require('../config/database');

function bucket(kind, value) {
    const digest = createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
    return `${kind}:${digest}`;
}

async function reserve(key, threshold) {
    const { rows } = await query(`
        INSERT INTO login_attempts(bucket_key, window_started_at, attempts, next_attempt_at)
        VALUES ($1, NOW(), 1, NOW())
        ON CONFLICT (bucket_key) DO UPDATE SET
            window_started_at = CASE WHEN login_attempts.window_started_at <= NOW() - INTERVAL '15 minutes'
                THEN NOW() ELSE login_attempts.window_started_at END,
            attempts = CASE WHEN login_attempts.window_started_at <= NOW() - INTERVAL '15 minutes'
                THEN 1 ELSE login_attempts.attempts + 1 END,
            next_attempt_at = CASE
                WHEN login_attempts.window_started_at <= NOW() - INTERVAL '15 minutes'
                    OR login_attempts.attempts + 1 < $2 THEN NOW()
                ELSE LEAST(
                    NOW() + INTERVAL '30 seconds' * power(2, LEAST(login_attempts.attempts + 1 - $2, 3)),
                    login_attempts.window_started_at + INTERVAL '15 minutes'
                )
            END
        WHERE login_attempts.next_attempt_at <= NOW()
        RETURNING attempts
    `, [key, threshold]);
    if (rows.length) return 0;

    const { rows: blocked } = await query(`
        SELECT CEIL(EXTRACT(EPOCH FROM (next_attempt_at - NOW())))::int AS seconds
        FROM login_attempts WHERE bucket_key = $1
    `, [key]);
    return Math.max(1, blocked[0]?.seconds || 0);
}

async function start(req, kind, account) {
    const ipWait = await reserve(bucket(`${kind}:ip`, req.ip || ''), 50);
    if (ipWait) return ipWait;
    return reserve(bucket(`${kind}:account`, account), 5);
}

async function success(kind, account) {
    await query('DELETE FROM login_attempts WHERE bucket_key = $1', [bucket(`${kind}:account`, account)]);
}

function report(req, event) {
    console.warn(JSON.stringify({
        event,
        ip: req.ip,
        fetchSite: req.get('sec-fetch-site'),
        userAgent: req.get('user-agent')?.slice(0, 512)
    }));
}

module.exports = { start, success, report };
