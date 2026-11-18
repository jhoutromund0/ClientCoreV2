document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('material-form');
    if (!form)
        return;
    const selectTipo = document.getElementById('material-tipo-medida');
    const wrapperUnidade = document.getElementById('unidade-medida-wrapper');
    const medidaLabel = document.getElementById('medida-label');
    function atualizarTipo() {
        const comprimento = selectTipo.value === 'comprimento';
        wrapperUnidade.hidden = !comprimento;
        medidaLabel.textContent = comprimento ? 'Comprimento' : 'Quantidade';
    }
    selectTipo.addEventListener('change', atualizarTipo);
    atualizarTipo();
});
