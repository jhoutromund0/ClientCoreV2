document.addEventListener('DOMContentLoaded', () => {
  const dataNode = document.getElementById('calendar-data');
  const grid = document.getElementById('calendario-grid');
  if (!dataNode || !grid) return;

  const payload = JSON.parse(dataNode.textContent);
  const visitas = payload.visits || [];
  const busca = document.getElementById('buscar-cliente');
  const totalVisitas = document.getElementById('total-visitas');
  const totalVisitasMes = document.getElementById('total-visitas-mes');
  const mesAno = document.getElementById('mes-ano');
  const lista = document.getElementById('visitas-do-dia');
  const modal = document.getElementById('modal-agendar');
  const form = document.getElementById('form-visita');
  const titulo = document.getElementById('modal-title');
  const modalData = document.getElementById('modal-data');
  const campoData = document.getElementById('visita-data');
  const campoCliente = document.getElementById('visita-cliente');
  const campoTipo = document.getElementById('visita-tipo');
  const campoMateriais = document.getElementById('visita-materiais');
  const campoTecnicos = document.getElementById('visita-tecnicos');

  const hoje = new Date();
  const state = { year: hoje.getFullYear(), month: hoje.getMonth(), filtro: '' };

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
    return new Date(y, m - 1, d);
  }

  function mesmoDia(isoDate, date) {
    return isoDate.slice(0, 10) === iso(date);
  }

  function filtradas() {
    const termo = state.filtro.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return visitas;
    return visitas.filter((visita) => visita.clientName.toLocaleLowerCase('pt-BR').includes(termo));
  }

  function abrirModal(date, visita) {
    form.action = visita ? `/calendario/${visita.id}` : '/calendario';
    titulo.textContent = visita ? 'Editar visita' : 'Agendar visita';
    modalData.textContent = visita
      ? `Editando visita de ${visita.clientName}`
      : `Data selecionada: ${fmtData.format(date)}`;
    campoData.value = visita ? visita.scheduledAt.slice(0, 10) : iso(date);
    campoCliente.value = visita ? visita.clientName : '';
    campoTipo.value = visita ? visita.description : '';
    campoMateriais.value = visita ? (visita.materials || '') : '';
    campoTecnicos.value = visita ? (visita.technicians || '') : '';
    modal.hidden = false;
    campoCliente.focus();
  }

  function fecharModal() {
    modal.hidden = true;
  }

  function render() {
    const listaVisitas = filtradas();
    mesAno.textContent = fmtMes.format(new Date(state.year, state.month, 1));
    totalVisitas.textContent = String(listaVisitas.length);
    totalVisitasMes.textContent = String(listaVisitas.filter((visita) => {
      const data = parseIso(visita.scheduledAt);
      return data.getMonth() === state.month && data.getFullYear() === state.year;
    }).length);

    const firstDay = new Date(state.year, state.month, 1).getDay();
    const days = new Date(state.year, state.month + 1, 0).getDate();
    grid.innerHTML = '';

    for (let blank = 0; blank < firstDay; blank += 1) {
      const placeholder = document.createElement('div');
      placeholder.className = 'day-cell blank';
      grid.appendChild(placeholder);
    }

    for (let day = 1; day <= days; day += 1) {
      const date = new Date(state.year, state.month, day);
      const doDia = listaVisitas.filter((visita) => mesmoDia(visita.scheduledAt, date));
      const isToday = mesmoDia(iso(hoje), date);
      const mostra = !state.filtro || doDia.length > 0;
      const cell = document.createElement('div');
      cell.className = `day-cell${isToday ? ' today' : ''}${mostra ? '' : ' dim'}`;
      cell.innerHTML = `
        <div class="day-top">
          <span>${day}</span>
          <button type="button" class="agendar-dia" data-day="${day}" aria-label="Agendar visita no dia ${day}">+</button>
        </div>
        <div class="day-visits">
          ${doDia.length ? `<span class="visit-count">${doDia.length} visita${doDia.length > 1 ? 's' : ''}</span>` : ''}
          ${doDia.slice(0, 2).map((visita) => `<div class="day-chip"><strong>${esc(visita.clientName)}</strong><span>${esc(visita.description)}</span></div>`).join('')}
        </div>
        ${mostra ? '' : '<span class="no-visit">Sem visitas</span>'}
      `;
      grid.appendChild(cell);
    }

    if (!listaVisitas.length) {
      lista.innerHTML = '<div class="empty-state compact"><span class="empty-icon">◷</span><h2>Nenhuma visita cadastrada</h2><p>Use o + em um dia do calendário para agendar o primeiro atendimento.</p></div>';
      return;
    }

    lista.innerHTML = listaVisitas.map((visita) => `
      <article class="visit-card">
        <p class="visit-date">${esc(fmtData.format(parseIso(visita.scheduledAt)))}</p>
        <h3>${esc(visita.clientName)}</h3>
        <p>${esc(visita.description)}</p>
        <p><strong>Materiais</strong><span>${esc(visita.materials || 'Não informado')}</span></p>
        <p><strong>Técnicos</strong><span>${esc(visita.technicians || 'Não informado')}</span></p>
        <div class="actions">
          <button type="button" class="text-button editar-visita" data-id="${esc(visita.id)}">Editar</button>
          <form action="/calendario/${esc(visita.id)}/excluir" method="post" data-confirm="Excluir esta visita?">
            <button class="text-button danger" type="submit">Excluir</button>
          </form>
        </div>
      </article>
    `).join('');
  }

  document.getElementById('hoje-button').addEventListener('click', () => {
    state.year = hoje.getFullYear();
    state.month = hoje.getMonth();
    render();
  });
  document.getElementById('prev-month').addEventListener('click', () => {
    state.month -= 1;
    if (state.month < 0) { state.month = 11; state.year -= 1; }
    render();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    state.month += 1;
    if (state.month > 11) { state.month = 0; state.year += 1; }
    render();
  });
  document.getElementById('limpar-filtro').addEventListener('click', () => {
    busca.value = '';
    state.filtro = '';
    render();
  });
  busca.addEventListener('input', () => {
    state.filtro = busca.value.trim();
    render();
  });
  grid.addEventListener('click', (event) => {
    const botao = event.target.closest('button.agendar-dia');
    if (!botao) return;
    abrirModal(new Date(state.year, state.month, Number(botao.dataset.day)));
  });
  lista.addEventListener('click', (event) => {
    const botao = event.target.closest('button.editar-visita');
    if (!botao) return;
    const visita = visitas.find((item) => item.id === botao.dataset.id);
    if (visita) abrirModal(parseIso(visita.scheduledAt), visita);
  });
  document.getElementById('fechar-modal').addEventListener('click', fecharModal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) fecharModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) fecharModal();
  });

  const rascunho = campoData.value;
  if (rascunho) {
    const data = parseIso(rascunho);
    if (!Number.isNaN(data.getTime())) {
      state.year = data.getFullYear();
      state.month = data.getMonth();
    }
  }
  render();
});
