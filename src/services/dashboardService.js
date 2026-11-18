const Visit = require('../models/Visit');
const Client = require('../models/Client');
const FinancialRecord = require('../models/FinancialRecord');
const User = require('../models/User');
const TransportSettings = require('../models/TransportSettings');

const DAY_MS = 24 * 60 * 60 * 1000;
const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});
const dateLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
const monthLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const weekdayLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short' });
const dayLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit' });
const distanceLabel = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const text = (value) => typeof value === 'string' ? value.trim().replace(/[^\S\r\n]+/g, ' ') : '';
const key = (value) => text(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');

function bounds(period, now) {
    const parts = Object.fromEntries(localDate.formatToParts(now).map(({ type, value }) => [type, Number(value)]));
    const year = parts.year;
    const month = parts.month - 1;
    const today = Date.UTC(year, month, parts.day);
    const monthStart = Date.UTC(year, month, 1);
    const monthEnd = Date.UTC(year, month + 1, 1) - DAY_MS;
    const daysSinceMonday = (new Date(today).getUTCDay() + 6) % 7;
    const start = period === 'semana' ? today - daysSinceMonday * DAY_MS : monthStart;
    const end = period === 'semana' ? start + 6 * DAY_MS : monthEnd;
    return { today, monthStart, start, end };
}

function visitDay(scheduledAt) {
    // O calendário trata o prefixo ISO como a data civil, inclusive nos registros antigos com horário.
    const match = /^(\d{4}-\d{2}-\d{2})(?:$|T| )/.exec(scheduledAt);
    if (!match)
        return NaN;
    const day = new Date(match[1] + 'T00:00:00Z');
    return Number.isFinite(day.valueOf()) && day.toISOString().startsWith(match[1]) ? day.valueOf() : NaN;
}

function indexAliases(records, values) {
    const aliases = new Map();
    for (const record of records) {
        for (const value of values(record)) {
            const alias = key(value);
            if (!alias)
                continue;
            const previous = aliases.get(alias);
            aliases.set(alias, previous === undefined || previous === record ? record : null);
        }
    }
    return aliases;
}

const withoutEmail = (value) => text(text(value).replace(/<?[^\s<>,;()]+@[^\s<>,;()]+>?/g, '').replace(/\(\s*\)/g, ''));

function readTechnicians(value, userAliases) {
    const people = new Set();
    const labels = new Set();
    const identify = (label) => {
        const email = /<([^<>]+)>$/.exec(label)?.[1];
        return userAliases.get(key(label)) || (email ? userAliases.get(key(email)) : null);
    };
    for (const entry of text(value).split(/[,;|\r\n]+/)) {
        const exact = identify(entry.trim());
        const names = exact ? [entry] : entry.split(/\s*[/&]\s*|\s+(?:e|\+)\s+/i);
        for (const name of names) {
            const user = exact || identify(name.trim());
            if (user?.role === 'analista')
                people.add(user);
            const label = withoutEmail(user?.name || name);
            if (label)
                labels.add(label);
        }
    }
    return { people, label: [...labels].join(', ') };
}

function rankMaterials(visits, financialByVisit) {
    const totals = new Map();
    for (const visit of visits) {
        const record = financialByVisit.get(visit.id);
        if (key(visit.description) === 'orcamento' && ['pendente', 'recusado'].includes(record?.status))
            continue;
        // A vírgula entre dois dígitos pode fazer parte de uma medida.
        const listed = text(visit.materials).split(/[;\r\n]+|(?<!\d),|,(?!\d)/);
        const billed = Array.isArray(record?.items) ? record.items.map((item) => item?.name) : [];
        const seen = new Set();
        for (const name of [...billed, ...listed]) {
            const material = key(name);
            if (!material || seen.has(material))
                continue;
            seen.add(material);
            const entry = totals.get(material) ?? { name: text(name), visits: 0 };
            entry.visits++;
            totals.set(material, entry);
        }
    }
    return [...totals.values()].sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 5);
}

function routeMeters(client, originAddress) {
    const travel = client?.travel;
    if (typeof client?.address !== 'string' || !client.address.trim() || travel?.status !== 'ready'
        || travel.address !== client.address || travel.originAddress !== originAddress)
        return null;

    // A revisão pode ter mudado apenas por uma nova tarifa, mantendo a rota válida.
    if (Number.isFinite(travel.roundTripMeters) && travel.roundTripMeters >= 0)
        return travel.roundTripMeters;
    if (Number.isFinite(travel.outboundMeters) && Number.isFinite(travel.returnMeters)
        && travel.outboundMeters >= 0 && travel.returnMeters >= 0)
        return travel.outboundMeters + travel.returnMeters;
    return null;
}

function distanceLeader(totals) {
    if (!totals.size)
        return null;
    let longest = -1;
    const names = [];
    for (const [user, millimeters] of totals) {
        const name = withoutEmail(user.name);
        if (!name)
            continue;
        if (millimeters > longest) {
            longest = millimeters;
            names.length = 0;
        }
        if (millimeters === longest)
            names.push(name);
    }
    return names.length ? {
        names: names.sort((a, b) => a.localeCompare(b, 'pt-BR')),
        kilometers: `${distanceLabel.format(longest / 1000000)} km`
    } : null;
}

function attendanceBars(start, end, interval) {
    const days = (end - start) / DAY_MS + 1;
    return Array.from({ length: Math.ceil(days / interval) }, (_, index) => {
        const from = start + index * interval * DAY_MS;
        const to = Math.min(end, from + (interval - 1) * DAY_MS);
        const label = interval === 1 ? weekdayLabel.format(from) : `${dayLabel.format(from)}–${dayLabel.format(to)}`;
        return { label, count: 0 };
    });
}

async function load(requestedPeriod, now = new Date()) {
    const period = requestedPeriod === 'semana' ? 'semana' : 'mes';
    const barInterval = period === 'semana' ? 1 : 7;
    const dates = bounds(period, now);
    const [visits, clients, financial, users, settings] = await Promise.all([
        Visit.all(), Client.all(), FinancialRecord.all(), User.all(), TransportSettings.get()
    ]);
    const financialByVisit = new Map(financial.map((record) => [record.id, record]));
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const clientAliases = indexAliases(clients, (client) => [client.name, client.company]);
    const userAliases = indexAliases(users, (user) => [user.name, user.email]);
    const bars = attendanceBars(dates.start, dates.end, barInterval);
    const appointments = [];
    const monthlyVisits = [];
    const totals = new Map();

    for (const visit of visits) {
        const day = visitDay(visit.scheduledAt);
        if (!Number.isFinite(day))
            continue;
        if (day >= dates.monthStart && day <= dates.today)
            monthlyVisits.push(visit);
        if (day < dates.start || day > dates.end)
            continue;
        const technicians = readTechnicians(visit.technicians, userAliases);
        appointments.push({
            dateLabel: dateLabel.format(day), clientName: visit.clientName, description: visit.description,
            technicians: technicians.label
        });
        const dayIndex = (day - dates.start) / DAY_MS;
        bars[Math.floor(dayIndex / barInterval)].count++;

        if (day > dates.today || !technicians.people.size)
            continue;
        const client = visit.clientId ? clientsById.get(visit.clientId) : clientAliases.get(key(visit.clientName));
        const meters = routeMeters(client, settings.originAddress);
        if (meters === null)
            continue;
        const millimeters = Math.round(meters * 1000);
        for (const person of technicians.people)
            totals.set(person, (totals.get(person) || 0) + millimeters);
    }
    const currentMonth = monthLabel.format(dates.today);
    return {
        period,
        periodLabel: period === 'semana' ? `${dateLabel.format(dates.start)} a ${dateLabel.format(dates.end)}` : currentMonth,
        monthLabel: currentMonth,
        appointments,
        attendanceBars: bars,
        topMaterials: rankMaterials(monthlyVisits, financialByVisit),
        leader: distanceLeader(totals)
    };
}

module.exports = { load };
