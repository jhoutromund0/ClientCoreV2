document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('finance-form');
    if (!form)
        return;

    const items = document.getElementById('finance-items');
    const template = document.getElementById('finance-item-template');
    const add = document.getElementById('finance-add');
    const preview = document.getElementById('finance-preview');
    const maxMaterials = Number(form.dataset.maxMaterials);
    const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const moneyPattern = /^(\d{1,6})(?:[.,](\d{1,2}))?$/;
    const quantityPattern = /^(\d{1,4})(?:[.,](\d{1,3}))?$/;
    const searches = new WeakMap();

    function decimal(value, pattern, scale) {
        const match = pattern.exec(value.trim());
        return match ? Number(match[1]) * 10 ** scale + Number((match[2] || '').padEnd(scale, '0')) : NaN;
    }

    function updatePreview() {
        let cost = Number(form.dataset.stockCost) + Number(form.dataset.travelCost) + decimal(form.elements.otherCost.value, moneyPattern, 2);
        let charge = Number(form.dataset.stockCharge) + decimal(form.elements.labor.value, moneyPattern, 2) + decimal(form.elements.travelCharge.value, moneyPattern, 2);
        const received = decimal(form.elements.received.value, moneyPattern, 2);
        for (const row of items.querySelectorAll('[data-material-row]')) {
            const quantity = decimal(row.querySelector('[name=quantity]').value, quantityPattern, 3);
            const unit = row.querySelector('[name=unit]').value;
            if (!(quantity > 0) || (unit === 'un' && quantity % 1000 !== 0)) {
                preview.textContent = 'Confira as quantidades para calcular os totais.';
                return;
            }
            cost += Math.round(quantity * decimal(row.querySelector('[name=cost]').value, moneyPattern, 2) / 1000);
            charge += Math.round(quantity * decimal(row.querySelector('[name=price]').value, moneyPattern, 2) / 1000);
        }

        if (![cost, charge, received].every(Number.isSafeInteger)) {
            preview.textContent = 'Preencha os valores para calcular os totais.';
            return;
        }
        if (received > charge) {
            preview.textContent = 'O valor recebido deve ser menor ou igual ao total a cobrar.';
            return;
        }
        preview.textContent = `Despesas ${money.format(cost / 100)} · Total a cobrar ${money.format(charge / 100)} · A receber ${money.format((charge - received) / 100)} · Saldo após despesas ${money.format((received - cost) / 100)}`;
    }

    function update() {
        add.disabled = items.children.length >= maxMaterials;
        updatePreview();
    }

    function cancelSearch(row) {
        const search = searches.get(row);
        if (search) {
            clearTimeout(search.timer);
            search.request.abort();
            searches.delete(row);
        }
    }

    function searchCatalog(input) {
        const row = input.closest('[data-material-row]');
        const select = row.querySelector('[data-catalog]');
        const status = row.querySelector('[data-catalog-status]');
        cancelSearch(row);
        const request = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const query = new URLSearchParams({ busca: input.value.trim() });
                const response = await fetch(`/financeiro/materiais?${query}`, { signal: request.signal });
                if (!response.ok)
                    throw new Error('Consulta ao catálogo indisponível.');
                const { materials } = await response.json();
                if (request.signal.aborted)
                    return;
                const placeholder = new Option(materials.length ? 'Selecione um material' : 'Nenhum material encontrado', '');
                const options = materials.map(({ id, name, unit, unitValue, unitPrice }) => {
                    const option = new Option(name, id);
                    Object.assign(option.dataset, { name, unit, cost: unitValue.toFixed(2), price: unitPrice.toFixed(2) });
                    return option;
                });
                select.replaceChildren(placeholder, ...options);
                status.textContent = materials.length ? `${materials.length} opções no catálogo.` : 'Nenhum material encontrado.';
            } catch {
                if (!request.signal.aborted)
                    status.textContent = 'Não foi possível consultar o catálogo.';
            } finally {
                if (searches.get(row)?.request === request)
                    searches.delete(row);
            }
        }, 250);
        searches.set(row, { request, timer });
    }

    add.addEventListener('click', () => {
        if (items.children.length >= maxMaterials)
            return;
        const row = template.content.firstElementChild.cloneNode(true);
        items.append(row);
        row.querySelector('[name=name]').focus();
        update();
    });

    items.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-material]');
        if (!button)
            return;
        const row = button.closest('[data-material-row]');
        cancelSearch(row);
        row.remove();
        update();
        add.focus();
    });

    form.addEventListener('input', (event) => {
        if (event.target.matches('[data-catalog-search]'))
            searchCatalog(event.target);
        else
            updatePreview();
    });
    form.addEventListener('change', (event) => {
        const select = event.target;
        if (select.matches('[data-catalog]') && select.value) {
            const row = select.closest('[data-material-row]');
            const { name, unit, cost, price } = select.selectedOptions[0].dataset;
            row.querySelector('[name=name]').value = name;
            row.querySelector('[name=unit]').value = unit;
            row.querySelector('[name=cost]').value = cost;
            row.querySelector('[name=price]').value = price;
            row.querySelector('[name=origin]').value = 'estoque';
        }
        updatePreview();
    });

    add.hidden = false;
    update();
});
