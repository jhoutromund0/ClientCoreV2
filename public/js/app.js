document.addEventListener('DOMContentLoaded', () => {
    for (const bar of document.querySelectorAll('[data-bar-height]'))
        bar.style.height = `${Number(bar.dataset.barHeight)}%`;
    for (const bar of document.querySelectorAll('[data-bar-width]'))
        bar.style.width = `${Number(bar.dataset.barWidth)}%`;

    const toggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.main-nav');
    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const open = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
        });
    }
});
document.addEventListener('submit', (event) => {
    const form = event.target;
    const button = event.submitter;
    const ignoresNewPassword = button?.formNoValidate && form.hasAttribute('data-user-actions');
    if (ignoresNewPassword && !form.elements.currentPassword.reportValidity()) {
        event.preventDefault();
        return;
    }

    const message = button?.dataset.confirm || form.dataset.confirm;
    if (message && !window.confirm(message)) {
        event.preventDefault();
        return;
    }

    if (ignoresNewPassword)
        form.addEventListener('formdata', event => event.formData.delete('password'), { once: true });
});

const optionSearch = (() => {
    const pending = new WeakMap();

    function cancel(input) {
        const search = pending.get(input);
        if (!search)
            return;
        clearTimeout(search.timer);
        search.controller.abort();
        pending.delete(input);
    }

    function start(input, path, onResult, onError) {
        cancel(input);
        const controller = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const query = new URLSearchParams({ busca: input.value.trim() });
                const response = await fetch(`${path}?${query}`, { signal: controller.signal });
                if (!response.ok)
                    throw new Error('Consulta indisponível.');
                const result = await response.json();
                if (!controller.signal.aborted)
                    onResult(result);
            } catch {
                if (!controller.signal.aborted)
                    onError();
            } finally {
                if (pending.get(input)?.controller === controller)
                    pending.delete(input);
            }
        }, 250);
        pending.set(input, { controller, timer });
    }

    return { start, cancel };
})();

document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('.client-form');
    if (!form)
        return;

    const cnpj = form.elements.cnpj;
    const submit = form.querySelector('button[type="submit"]');
    const status = form.querySelector('#cnpj-status');
    const fields = ['company', 'email', 'phone', 'address', 'establishmentType'].map((name) => form.elements[name]);
    const initialValues = new Map(fields.map((field) => [field, field.value]));
    const autofilled = new Map();
    const normalizeCnpj = (value) => value.replace(/[^a-z\d]/gi, '').toUpperCase().slice(0, 14);
    const formatCnpj = (value) => value
        .replace(/^([A-Z\d]{2})([A-Z\d])/, '$1.$2')
        .replace(/^([A-Z\d]{2}\.[A-Z\d]{3})([A-Z\d])/, '$1.$2')
        .replace(/\.([A-Z\d]{3})([A-Z\d])/, '.$1/$2')
        .replace(/([A-Z\d]{4})([A-Z\d])/, '$1-$2');
    const setStatus = (message, kind = '') => {
        status.textContent = message;
        status.dataset.kind = kind;
    };
    const initialCnpj = normalizeCnpj(cnpj.value);
    let currentCnpj = initialCnpj;
    let activeLookup;

    form.addEventListener('submit', (event) => {
        if (activeLookup)
            event.preventDefault();
    });

    cnpj.addEventListener('input', async () => {
        const identifier = normalizeCnpj(cnpj.value);
        const formatted = formatCnpj(identifier);
        if (cnpj.value !== formatted)
            cnpj.value = formatted;
        if (identifier === currentCnpj)
            return;

        currentCnpj = identifier;
        activeLookup?.abort();
        activeLookup = null;
        for (const [field, value] of autofilled) {
            if (field.value === value)
                field.value = '';
        }
        autofilled.clear();

        if (identifier.length !== 14) {
            submit.disabled = false;
            setStatus('');
            return;
        }

        const request = new AbortController();
        activeLookup = request;
        const beforeLookup = new Map(fields.map((field) => [field, field.value]));
        submit.disabled = true;
        setStatus('Consultando CNPJ…', 'loading');
        try {
            const response = await fetch('/clientes/consulta-cnpj/' + identifier, {
                headers: { Accept: 'application/json' },
                signal: request.signal
            });
            const body = await response.json().catch(() => null);
            if (activeLookup !== request)
                return;
            if (!response.ok || !body?.data)
                return setStatus(body?.error || 'Não foi possível consultar o CNPJ.', 'error');

            const data = body.data;
            const changedCnpj = initialCnpj.length === 14 && identifier !== initialCnpj;
            for (const field of fields) {
                if (field.value !== beforeLookup.get(field))
                    continue;
                const value = data[field.name] || '';
                const fromPreviousCnpj = changedCnpj && field.value === initialValues.get(field);
                if (fromPreviousCnpj || (value && (field.name === 'company' || !field.value.trim()))) {
                    field.value = value;
                    autofilled.set(field, field.value);
                }
            }
            const situation = data.status ? ` (situação: ${data.status})` : '';
            setStatus(`Dados carregados${situation}. Revise antes de salvar.`, 'ok');
        }
        catch {
            if (activeLookup === request)
                setStatus('Falha de conexão ao consultar o CNPJ.', 'error');
        }
        finally {
            if (activeLookup === request) {
                activeLookup = null;
                submit.disabled = false;
            }
        }
    });
});
