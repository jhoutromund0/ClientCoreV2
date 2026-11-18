document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('[data-visit-form]');
    if (!form)
        return;

    const rows = form.querySelector('[data-visit-materials]');
    const template = form.querySelector('[data-visit-material-template]');
    const add = form.querySelector('[data-visit-material-add]');
    const address = form.elements.address;
    const clients = form.elements.clientId;
    const assignees = form.elements.assigneeId;
    const travelPayee = form.elements.travelPayeeId;
    const lookups = new WeakMap();
    let lastAddress = clients.selectedOptions[0]?.dataset.address || '';

    function updateMaterialLimit() {
        add.disabled = rows.children.length >= 25;
    }

    function updateTravelPayees() {
        const previous = travelPayee.value;
        const options = [...assignees.selectedOptions].map(option => new Option(option.textContent.trim(), option.value));
        travelPayee.replaceChildren(travelPayee.options[0], ...options);
        travelPayee.value = options.some(option => option.value === previous) ? previous : '';
    }

    function stopLookup(input) {
        const lookup = lookups.get(input);
        if (lookup) {
            clearTimeout(lookup.timer);
            lookup.request.abort();
            lookups.delete(input);
        }
    }

    function updateOptions(select, options) {
        const selected = [...select.selectedOptions].filter(option => option.value);
        const initial = select.multiple ? [] : [select.options[0]];
        const byId = new Map(selected.map(option => [option.value, option]));
        for (const entry of options) {
            if (byId.has(entry.id))
                continue;
            const title = entry.label || (entry.unit ? `${entry.name} (${entry.unit})` : entry.name);
            const option = new Option(title, entry.id);
            if (typeof entry.address === 'string')
                option.dataset.address = entry.address;
            byId.set(entry.id, option);
        }
        select.replaceChildren(...initial, ...byId.values());
        for (const option of selected)
            option.selected = true;
    }

    function lookupOptions(input) {
        const group = input.closest('[data-visit-lookup-group]');
        const select = group.querySelector('select');
        const status = group.querySelector('[role=status]');
        stopLookup(input);
        const request = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const params = new URLSearchParams({ busca: input.value.trim() });
                const response = await fetch(`${input.dataset.visitLookup}?${params}`, { signal: request.signal });
                if (!response.ok)
                    throw new Error('Consulta indisponível.');
                const result = await response.json();
                const options = result.options || result.clients;
                if (request.signal.aborted)
                    return;
                updateOptions(select, options);
                status.textContent = options.length ? '' : 'Nenhum resultado para a busca.';
            } catch {
                if (!request.signal.aborted)
                    status.textContent = 'Não foi possível consultar os registros. Tente novamente.';
            } finally {
                if (lookups.get(input)?.request === request)
                    lookups.delete(input);
            }
        }, 250);
        lookups.set(input, { timer, request });
    }

    form.addEventListener('input', event => {
        if (event.target.matches('[data-visit-lookup]'))
            lookupOptions(event.target);
    });

    clients.addEventListener('change', () => {
        const current = clients.selectedOptions[0]?.dataset.address || '';
        if (!address.value.trim() || address.value === lastAddress)
            address.value = current;
        lastAddress = current;
    });
    assignees.addEventListener('change', updateTravelPayees);

    add.addEventListener('click', () => {
        if (rows.children.length >= 25)
            return;
        const material = template.content.firstElementChild.cloneNode(true);
        rows.append(material);
        material.querySelector('[data-visit-lookup]').focus();
        updateMaterialLimit();
    });

    rows.addEventListener('click', event => {
        if (!event.target.closest('[data-visit-material-remove]'))
            return;
        const row = event.target.closest('[data-visit-material-row]');
        stopLookup(row.querySelector('[data-visit-lookup]'));
        row.remove();
        updateMaterialLimit();
        add.focus();
    });

    updateMaterialLimit();
});
