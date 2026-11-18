document.addEventListener('DOMContentLoaded', () => {
    const dataNode = document.getElementById('calendar-data');
    const grid = document.getElementById('calendario-grid');
    if (!dataNode || !grid)
        return;
    const payload = JSON.parse(dataNode.textContent);
    const visitas = payload.visits || [];
    const totalVisitasMes = document.getElementById('total-visitas-mes');
    const mesAno = document.getElementById('mes-ano');
    const lista = document.getElementById('visitas-do-dia');
    const modal = document.getElementById('modal-agendar');
    const form = document.getElementById('form-visita');
    const csrfToken = form.querySelector('input[name="_csrf"]')?.value || '';
    const titulo = document.getElementById('modal-title');
    const modalData = document.getElementById('modal-data');
    const campoData = document.getElementById('visita-data');
    const campoCliente = document.getElementById('visita-cliente');
    const clienteId = document.getElementById('visita-cliente-id');
    const opcoesClientes = document.getElementById('clientes-list');
    const campoTipo = document.getElementById('visita-tipo');
    const campoMateriais = document.getElementById('visita-materiais');
    const campoTecnicos = document.getElementById('visita-tecnicos');
    const [year, month] = payload.month.split('-').map(Number);
    const hoje = new Date();
    const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[char]));
    }
    function iso(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    function parseIso(value) {
        const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return iso(date) === String(value).slice(0, 10) ? date : null;
    }
    function rotuloData(value) {
        const date = parseIso(value);
        return date ? fmtData.format(date) : 'Data inválida';
    }
    function abrirModal(date, visita) {
        form.action = visita ? `/calendario/${visita.id}` : '/calendario';
        titulo.textContent = visita ? 'Editar visita' : 'Agendar visita';
        modalData.textContent = visita
            ? `Editando visita de ${visita.clientName}`
            : `Data selecionada: ${fmtData.format(date)}`;
        campoData.value = visita ? visita.scheduledAt.slice(0, 10) : iso(date);
        campoCliente.value = visita ? visita.clientName : '';
        clienteId.value = visita ? visita.clientId : '';
        campoTipo.value = visita ? visita.description : '';
        campoMateriais.value = visita ? (visita.materials || '') : '';
        campoTecnicos.value = visita ? (visita.technicians || '') : '';
        modal.hidden = false;
        campoCliente.focus();
    }
    function fecharModal() {
        modal.hidden = true;
    }
    function renderMonth() {
        mesAno.textContent = fmtMes.format(new Date(year, month - 1, 1));
        totalVisitasMes.textContent = String(Object.values(payload.days).reduce((total, day) => total + day.count, 0));
        const firstDay = new Date(year, month - 1, 1).getDay();
        const days = new Date(year, month, 0).getDate();
        grid.innerHTML = '';
        for (let blank = 0; blank < firstDay; blank += 1) {
            const placeholder = document.createElement('div');
            placeholder.className = 'day-cell blank';
            grid.appendChild(placeholder);
        }
        for (let day = 1; day <= days; day += 1) {
            const date = new Date(year, month - 1, day);
            const doDia = payload.days[iso(date)];
            const isToday = iso(hoje) === iso(date);
            const cell = document.createElement('div');
            cell.className = `day-cell${isToday ? ' today' : ''}`;
            cell.innerHTML = `
        <div class="day-top">
          <span>${day}</span>
          <button type="button" class="agendar-dia" data-day="${day}" aria-label="Agendar visita no dia ${day}">+</button>
        </div>
        <div class="day-visits">
          ${doDia ? `<span class="visit-count">${doDia.count} visita${doDia.count > 1 ? 's' : ''}</span>` : ''}
          ${doDia ? doDia.preview.map((visita) => `<div class="day-chip"><strong>${esc(visita.clientName)}</strong><span>${esc(visita.description)}</span></div>`).join('') : ''}
        </div>
      `;
            grid.appendChild(cell);
        }
    }
    function renderVisits() {
        if (!visitas.length) {
            lista.innerHTML = '<div class="empty-state compact"><span class="empty-icon">◷</span><h2>Nenhuma visita nesta página</h2></div>';
            return;
        }
        lista.innerHTML = visitas.map((visita) => `
      <article class="visit-card">
        <p class="visit-date">${esc(rotuloData(visita.scheduledAt))}</p>
        <h3>${esc(visita.clientName)}</h3>
        <p>${esc(visita.description)}</p>
        <p><strong>Materiais</strong><span>${esc(visita.materials || 'Não informado')}</span></p>
        <p><strong>Técnicos</strong><span>${esc(visita.technicians || 'Não informado')}</span></p>
        <div class="actions">
          <button type="button" class="text-button editar-visita" data-id="${esc(visita.id)}">Editar</button>
          <form action="/calendario/${esc(visita.id)}/excluir" method="post" data-confirm="Excluir esta visita?">
            <input type="hidden" name="_csrf" value="${esc(csrfToken)}">
            <button class="text-button danger" type="submit">Excluir</button>
          </form>
        </div>
      </article>
    `).join('');
    }
    function mudarMes(value) {
        const url = new URL(window.location.href);
        url.pathname = '/calendario';
        url.searchParams.set('mes', value);
        url.searchParams.delete('apos');
        window.location.assign(url);
    }
    const mesVizinho = (offset) => iso(new Date(year, month - 1 + offset, 1)).slice(0, 7);
    document.getElementById('hoje-button').addEventListener('click', () => mudarMes(payload.currentMonth));
    document.getElementById('prev-month').addEventListener('click', () => mudarMes(mesVizinho(-1)));
    document.getElementById('next-month').addEventListener('click', () => mudarMes(mesVizinho(1)));

    let clientSearch;
    let searchTimer;
    campoCliente.addEventListener('input', () => {
        clearTimeout(searchTimer);
        clientSearch?.abort();
        const query = campoCliente.value.trim();
        const matches = [...opcoesClientes.options].filter(option => option.value === query);
        clienteId.value = matches.length === 1 ? matches[0].dataset.clientId : '';
        if (clienteId.value || query.length < 2)
            return;
        searchTimer = setTimeout(async () => {
            const request = new AbortController();
            clientSearch = request;
            try {
                const response = await fetch('/calendario/clientes?' + new URLSearchParams({ busca: query }), { signal: request.signal });
                if (!response.ok || campoCliente.value.trim() !== query)
                    return;
                const { clients } = await response.json();
                if (campoCliente.value.trim() !== query)
                    return;
                opcoesClientes.replaceChildren(...clients.map(client => {
                    const option = document.createElement('option');
                    option.value = client.label;
                    option.label = client.cnpj || client.label;
                    option.dataset.clientId = client.id;
                    return option;
                }));
            } catch {
                // O servidor também valida a escolha ao salvar.
            }
        }, 200);
    });
    grid.addEventListener('click', (event) => {
        const botao = event.target.closest('button.agendar-dia');
        if (!botao)
            return;
        abrirModal(new Date(year, month - 1, Number(botao.dataset.day)));
    });
    lista.addEventListener('click', (event) => {
        const botao = event.target.closest('button.editar-visita');
        if (!botao)
            return;
        const visita = visitas.find((item) => item.id === botao.dataset.id);
        if (visita)
            abrirModal(parseIso(visita.scheduledAt), visita);
    });
    document.getElementById('fechar-modal').addEventListener('click', fecharModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal)
            fecharModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden)
            fecharModal();
    });
    if (!payload.undated)
        renderMonth();
    renderVisits();
});
