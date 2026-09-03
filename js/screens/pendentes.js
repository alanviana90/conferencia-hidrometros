// @ts-check
import { dbGetAll, STORES } from '../db.js';
import { getConferencia, getItensDaConferencia, marcarComoNaoEncontrado } from '../services/conferencia-service.js';
import { topbarHTML, showToast, confirmDialog, openOverlay, closeOverlay } from '../ui.js';
import { debounce, normalizeText, escapeHTML, formatDateBR } from '../utils.js';

/** @type {any} */
let conferencia = null;
/** @type {any[]} */
let pendentes = [];
let busca = '';
let ordenacao = 'serie';

/** @param {HTMLElement} container @param {{id:string}} params */
export async function render(container, params) {
  conferencia = await getConferencia(params.id);
  if (!conferencia) {
    container.innerHTML = `<div class="screen">${topbarHTML('Pendentes', '#/')}<div class="content"><div class="card">Conferência não encontrada.</div></div></div>`;
    return;
  }

  const [base, itens] = await Promise.all([dbGetAll(STORES.HIDROMETROS), getItensDaConferencia(conferencia.id)]);
  const baseById = new Map(base.map((r) => [r.id, r]));
  const resolvedIds = new Set(itens.filter((i) => i.status === 'ENCONTRADO' || i.status === 'NAO_ENCONTRADO').map((i) => i.hidrometroId));

  pendentes = conferencia.expectedHidrometroIds
    .filter((id) => !resolvedIds.has(id))
    .map((id) => baseById.get(id))
    .filter(Boolean);

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Ainda não conferidos', `#/conferencia/${conferencia.id}`)}
      <div class="content stack">
        <input type="search" id="busca" placeholder="Buscar por série, OS, código, devolução…" />
        <div class="row">
          <select id="ordenacao" style="flex:1">
            <option value="serie">Ordenar por série</option>
            <option value="devolucao">Ordenar por devolução</option>
            <option value="data">Ordenar por data</option>
          </select>
          <span class="badge muted" id="contador">${pendentes.length}</span>
        </div>
        <div id="lista" class="stack"></div>
      </div>
    </div>
  `;

  container.querySelector('#busca')?.addEventListener(
    'input',
    debounce((e) => {
      busca = /** @type {HTMLInputElement} */ (e.target).value;
      renderLista(container);
    }, 200)
  );
  container.querySelector('#ordenacao')?.addEventListener('change', (e) => {
    ordenacao = /** @type {HTMLSelectElement} */ (e.target).value;
    renderLista(container);
  });

  renderLista(container);
}

/** @param {HTMLElement} container */
function renderLista(container) {
  const q = normalizeText(busca);
  let filtrados = pendentes.filter((h) => {
    if (!q) return true;
    return (
      h.numeroSerieNorm.includes(q) ||
      normalizeText(h.ordemServico).includes(q) ||
      normalizeText(h.codigoHidrometro).includes(q) ||
      normalizeText(h.idDevolucao).includes(q)
    );
  });

  filtrados = filtrados.slice().sort((a, b) => {
    if (ordenacao === 'devolucao') return a.idDevolucao.localeCompare(b.idDevolucao);
    if (ordenacao === 'data') return a.dataRecebimento.localeCompare(b.dataRecebimento);
    return a.numeroSerie.localeCompare(b.numeroSerie);
  });

  const contador = container.querySelector('#contador');
  if (contador) contador.textContent = String(filtrados.length);

  const lista = /** @type {HTMLElement} */ (container.querySelector('#lista'));
  if (!filtrados.length) {
    lista.innerHTML = '<div class="empty-state"><div class="icon">🎉</div>Nenhum pendente encontrado.</div>';
    return;
  }

  lista.innerHTML = filtrados
    .map(
      (h) => `
    <div class="list-item" data-id="${escapeHTML(h.id)}" role="button">
      <div class="main">
        <div class="title">${escapeHTML(h.numeroSerie)}</div>
      </div>
      <div class="chevron">›</div>
    </div>`
    )
    .join('');

  lista.querySelectorAll('.list-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = /** @type {HTMLElement} */ (el).dataset.id;
      const hidrometro = pendentes.find((h) => h.id === id);
      if (hidrometro) abrirDetalhe(container, hidrometro);
    });
  });
}

/** @param {HTMLElement} container @param {any} h */
function abrirDetalhe(container, h) {
  const { panel } = openOverlay(`
    <h2 style="margin-top:0">${escapeHTML(h.numeroSerie)}</h2>
    <div class="detail-grid">
      <div><div class="k">Código</div><div class="v">${escapeHTML(h.codigoHidrometro)}</div></div>
      <div><div class="k">Ordem de Serviço</div><div class="v">${escapeHTML(h.ordemServico)}</div></div>
      <div><div class="k">ID Devolução</div><div class="v">${escapeHTML(h.idDevolucao)}</div></div>
      <div><div class="k">Data de Recebimento</div><div class="v">${formatDateBR(h.dataRecebimento)}</div></div>
      <div class="full"><div class="k">Concessionária</div><div class="v">${escapeHTML(h.concessionaria)}</div></div>
      ${h.observacoes ? `<div class="full"><div class="k">Observações</div><div class="v">${escapeHTML(h.observacoes)}</div></div>` : ''}
    </div>
    <div class="stack">
      <button class="btn btn-danger" id="btn-nao-encontrado">Marcar como não encontrado</button>
      <button class="btn btn-outline" id="btn-fechar">Fechar</button>
    </div>
  `);

  panel.querySelector('#btn-fechar')?.addEventListener('click', closeOverlay);
  panel.querySelector('#btn-nao-encontrado')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Marcar como não encontrado?',
      message: `A série ${h.numeroSerie} será registrada como não encontrada nesta conferência.`,
      confirmLabel: 'Marcar como não encontrado',
      danger: true,
    });
    if (!ok) return;
    await marcarComoNaoEncontrado(conferencia.id, h, conferencia.operador);
    closeOverlay();
    showToast('Registrado.');
    pendentes = pendentes.filter((p) => p.id !== h.id);
    renderLista(container);
  });
}
