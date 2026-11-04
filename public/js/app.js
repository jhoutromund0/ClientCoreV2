document.addEventListener('DOMContentLoaded', () => {
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

// Confirmação de ações destrutivas (substitui onsubmit inline, bloqueado pelo CSP do helmet).
document.addEventListener('submit', (event) => {
  const message = event.target.dataset && event.target.dataset.confirm;
  if (message && !window.confirm(message)) event.preventDefault();
});

// Preenchimento automático por CNPJ (consulta via servidor -> CNPJá).
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('.client-form');
  const button = form && form.querySelector('[data-cnpj-lookup]');
  if (!button) return;
  const status = form.querySelector('[data-cnpj-status]');
  const field = (name) => form.elements[name];
  const setStatus = (message, kind) => { status.textContent = message; status.dataset.kind = kind || ''; };
  const formatCnpj = (v) => v.replace(/\D/g, '').slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');

  field('cnpj').addEventListener('input', (e) => { e.target.value = formatCnpj(e.target.value); });

  async function lookup() {
    const digits = field('cnpj').value.replace(/\D/g, '');
    if (digits.length !== 14) return setStatus('Digite os 14 dígitos do CNPJ para buscar.', 'error');
    button.disabled = true;
    setStatus('Consultando CNPJ…', 'loading');
    try {
      const response = await fetch('/clientes/consulta-cnpj/' + digits, { headers: { Accept: 'application/json' } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setStatus(body.error || 'Não foi possível consultar o CNPJ.', 'error');
      const d = body.data;
      if (d.company) field('company').value = d.company;
      if (d.email && !field('email').value) field('email').value = d.email;
      if (d.phone && !field('phone').value) field('phone').value = d.phone;
      field('cnpj').value = d.cnpj || field('cnpj').value;
      setStatus('Dados carregados' + (d.status ? ' (situação: ' + d.status + ')' : '') + '. Revise antes de salvar.', 'ok');
    } catch (err) {
      setStatus('Falha de conexão ao consultar o CNPJ.', 'error');
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener('click', lookup);
});
