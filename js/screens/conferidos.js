// @ts-check
import { dbGetAll, STORES } from '../db.js';
import { getConferencia, getItensDaConferencia } from '../services/conferencia-service.js';
import { topbarHTML, openOverlay, closeOverlay } from '../ui.js';
import { escapeHTML, formatDateBR, formatDateTimeBR } from '../utils.js';

let filtroAtual = 'TODOS';

/** @param {HTMLElement} container @param {{id:string}} params @param {URLSearchParams} search */
export async function render(container, params, search) {
  const conferencia = await getConferencia(params.id);
  if (!conferencia) {
    container.innerHTML = `<div class="screen">${topbarHTML('Conferidos', '#/')}<div class="content"><div class="card">Conferência não encontrada.</div></div></div>`;
    return;
  }

  filtroAtual = search?.get('status') === 'NAO_ENCONTRADO' ? 'NAO_ENCONTRADO' : 'TODOS';

  const [base, itens] = await Promise.all([dbGetAll(STORES.HIDROMETROS), getItensDaConferencia(conferencia.id)]);
  const baseById = new Map(base.map((r) => [r.id, r]));

  const resolvidos = itens
    .filter((i) => i.status === 'ENCONTRADO' || i.status === 'NAO_ENCONTRADO')
    .map((i) => ({ item: i, hidrometro: baseById.get(i.hidrometroId) }))
    .filter((x) => x.hidrometro)
    .sort((a, b) => (a.item.timestamp < b.item.timestamp ? 1 : -1));

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Conferidos', `#/conferencia/${conferencia.id}`)}
      <div class="content stack">
        <div class="chip-group">
          <button type="button" class="chip ${filtroAtual === 'TODOS' ? 'active' : ''}" data-f="TODOS">Todos</button>
          <button type="button" class="chip ${filtroAtual === 'ENCONTRADO' ? 'active' : ''}" data-f="ENCONTRADO">Encontrados</button>
          <button type="button" class="chip ${filtroAtual === 'NAO_ENCONTRADO' ? 'active' : ''}" data-f="NAO_ENCONTRADO">Não encontrados</button>
        </div>
        <div id="lista" class="stack"></div>
      </div>
    </div>
  `;

  container.querySelectorAll('.chip[data-f]').forEach((chip) => {
    chip.addEventListener('click', () => {
      filtroAtual = /** @type {HTMLElement} */ (chip).dataset.f || 'TODOS';
      container.querySelectorAll('.chip[data-f]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      renderLista(container, resolvidos);
    });
  });

  renderLista(container, resolvidos);
}

/** @param {HTMLElement} container @param {{item:any, hidrometro:any}[]} resolvidos */
function renderLista(container, resolvidos) {
  const filtrados = filtroAtual === 'TODOS' ? resolvidos : resolvidos.filter((x) => x.item.status === filtroAtual);
  const lista = /** @type {HTMLElement} */ (container.querySelector('#lista'));

  if (!filtrados.length) {
    lista.innerHTML = '<div class="empty-state"><div class="icon">📭</div>Nada por aqui ainda.</div>';
    return;
  }

  lista.innerHTML = filtrados
    .map(
      ({ item, hidrometro }) => `
    <div class="list-item" data-id="${escapeHTML(item.id)}" role="button">
      <div class="main">
        <div class="title">${escapeHTML(hidrometro.numeroSerie)}</div>
        <div class="subtitle">${formatDateTimeBR(item.timestamp)}</div>
      </div>
      <span class="badge ${item.status === 'ENCONTRADO' ? 'success' : 'danger'}">${item.status === 'ENCONTRADO' ? 'Encontrado' : 'Não encontrado'}</span>
    </div>`
    )
    .join('');

  lista.querySelectorAll('.list-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = /** @type {HTMLElement} */ (el).dataset.id;
      const found = filtrados.find((x) => x.item.id === id);
      if (found) abrirDetalhe(found);
    });
  });
}

/** @param {{item:any, hidrometro:any}} x */
function abrirDetalhe({ item, hidrometro }) {
  const { panel } = openOverlay(`
    <h2 style="margin-top:0">${escapeHTML(hidrometro.numeroSerie)}</h2>
    <div class="detail-grid">
      <div><div class="k">Código</div><div class="v">${escapeHTML(hidrometro.codigoHidrometro)}</div></div>
      <div><div class="k">Ordem de Serviço</div><div class="v">${escapeHTML(hidrometro.ordemServico)}</div></div>
      <div><div class="k">ID Devolução</div><div class="v">${escapeHTML(hidrometro.idDevolucao)}</div></div>
      <div><div class="k">Data de Recebimento</div><div class="v">${formatDateBR(hidrometro.dataRecebimento)}</div></div>
      <div><div class="k">Status</div><div class="v">${item.status === 'ENCONTRADO' ? 'Encontrado' : 'Não encontrado'}</div></div>
      <div><div class="k">Registrado em</div><div class="v">${formatDateTimeBR(item.timestamp)}</div></div>
    </div>
    <button class="btn btn-outline" id="btn-fechar">Fechar</button>
  `);
  panel.querySelector('#btn-fechar')?.addEventListener('click', closeOverlay);
}
