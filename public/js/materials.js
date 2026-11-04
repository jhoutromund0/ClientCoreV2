document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('material-form');
  if (!form) return;

  const selectTipo = document.getElementById('material-tipo-medida');
  const wrapperUnidade = document.getElementById('unidade-medida-wrapper');
  const medidaLabel = document.getElementById('medida-label');
  const busca = document.getElementById('buscar-material');
  const lista = document.getElementById('materiais-lista');
  const listaVazia = document.getElementById('lista-vazia');
  const totalItens = document.getElementById('total-itens');
  const totalMedida = document.getElementById('total-medida');
  const valorTotal = document.getElementById('valor-total');

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const numero = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function atualizarTipo() {
    const comprimento = selectTipo.value === 'comprimento';
    wrapperUnidade.hidden = !comprimento;
    medidaLabel.textContent = comprimento ? 'Comprimento' : 'Quantidade';
  }

  function atualizarLista() {
    const termo = (busca.value || '').trim().toLocaleLowerCase('pt-BR');
    const linhas = [...lista.querySelectorAll('tr')];
    let itens = 0;
    let medida = 0;
    let valor = 0;

    linhas.forEach((linha) => {
      const nome = (linha.dataset.name || '').toLocaleLowerCase('pt-BR');
      const tipo = linha.dataset.type === 'comprimento' ? 'comprimento' : 'quantidade';
      const visivel = !termo || nome.includes(termo) || tipo.includes(termo);
      linha.hidden = !visivel;
      if (!visivel) return;
      itens += 1;
      medida += Number(linha.dataset.measure || 0);
      valor += Number(linha.dataset.measure || 0) * Number(linha.dataset.value || 0);
    });

    totalItens.textContent = String(itens);
    totalMedida.textContent = numero.format(medida);
    valorTotal.textContent = moeda.format(valor);
    listaVazia.hidden = itens > 0;
    lista.closest('table').hidden = itens === 0;
    const titulo = listaVazia.querySelector('h2');
    const texto = listaVazia.querySelector('p');
    if (linhas.length && itens === 0) {
      titulo.textContent = 'Nenhum material encontrado';
      texto.textContent = 'Nenhum item corresponde à busca.';
    } else {
      titulo.textContent = 'Nenhum material encontrado';
      texto.textContent = 'Cadastre um novo item para iniciar o controle.';
    }
  }

  selectTipo.addEventListener('change', atualizarTipo);
  busca.addEventListener('input', atualizarLista);
  atualizarTipo();
  atualizarLista();
});
