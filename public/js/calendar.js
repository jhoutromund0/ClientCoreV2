document.addEventListener('DOMContentLoaded', () => {
    for (const details of document.querySelectorAll('.day-visits')) {
        const cell = details.closest('.day-cell');
        const preview = details.querySelector('.day-visit-preview');
        let openedByPointer = false;
        details.addEventListener('toggle', () => {
            if (!details.open)
                return;
            preview.style.translate = '';
            const { left, right } = preview.getBoundingClientRect();
            const shift = Math.max(8 - left, 0) - Math.max(right - document.documentElement.clientWidth + 8, 0);
            if (shift)
                preview.style.translate = `${shift}px`;
        });
        cell.addEventListener('pointerenter', event => {
            if (event.pointerType === 'mouse' && !details.open) {
                openedByPointer = true;
                details.open = true;
            }
        });
        cell.addEventListener('pointerleave', event => {
            if (event.pointerType === 'mouse' && openedByPointer) {
                details.open = false;
                openedByPointer = false;
            }
        });
        details.addEventListener('keydown', event => {
            if (event.key === 'Escape' && details.open) {
                details.open = false;
                openedByPointer = false;
            }
        });
    }

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
        optionSearch.start(input, input.dataset.visitLookup, result => {
            const options = result.options || result.clients;
            updateOptions(select, options);
            status.textContent = options.length ? '' : 'Nenhum resultado para a busca.';
        }, () => {
            status.textContent = 'Não foi possível consultar os registros. Tente novamente.';
        });
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
        optionSearch.cancel(row.querySelector('[data-visit-lookup]'));
        row.remove();
        updateMaterialLimit();
        add.focus();
    });

    updateMaterialLimit();
});
