// @ts-check
import { dbGetAll, STORES } from '../db.js';
import { topbarHTML, openOverlay, closeOverlay } from '../ui.js';
import { debounce, normalizeText, escapeHTML, formatDateBR } from '../utils.js';

const LIMITE_RESULTADOS = 200;

/** @param {HTMLElement} container */
export async function render(container) {
  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Base de Hidrômetros', '#/')}
      <div class="content stack">
        <input type="search" id="busca" placeholder="Buscar por série, código, OS ou devolução…" />
        <div id="resultado" class="stack"></div>
      </div>
    </div>
  `;

  const base = await dbGetAll(STORES.HIDROMETROS);
  const resultado = /** @type {HTMLElement} */ (container.querySelector('#resultado'));
  resultado.innerHTML = `<div class="empty-state"><div class="icon">🔎</div>${base.length.toLocaleString('pt-BR')} hidrômetros na base. Digite para buscar.</div>`;

  container.querySelector('#busca')?.addEventListener(
    'input',
    debounce((e) => {
      const q = normalizeText(/** @type {HTMLInputElement} */ (e.target).value);
      if (!q) {
        resultado.innerHTML = `<div class="empty-state"><div class="icon">🔎</div>${base.length.toLocaleString('pt-BR')} hidrômetros na base. Digite para buscar.</div>`;
        return;
      }
      const encontrados = base.filter(
        (r) => r.numeroSerieNorm.includes(q) || normalizeText(r.codigoHidrometro).includes(q) || normalizeText(r.ordemServico).includes(q) || normalizeText(r.idDevolucao).includes(q)
      );
      renderResultado(resultado, encontrados);
    }, 200)
  );
}

/** @param {HTMLElement} resultado @param {any[]} encontrados */
function renderResultado(resultado, encontrados) {
  if (!encontrados.length) {
    resultado.innerHTML = '<div class="empty-state"><div class="icon">🚫</div>Nenhum registro encontrado.</div>';
    return;
  }

  const mostrados = encontrados.slice(0, LIMITE_RESULTADOS);
  resultado.innerHTML =
    mostrados
      .map(
        (h) => `
    <div class="list-item" data-id="${escapeHTML(h.id)}" role="button">
      <div class="main">
        <div class="title">${escapeHTML(h.numeroSerie)} ${h.temSerieDuplicada ? '<span class="badge warning">série duplicada</span>' : ''}</div>
      </div>
      <div class="chevron">›</div>
    </div>`
      )
      .join('') + (encontrados.length > LIMITE_RESULTADOS ? `<p class="muted">Mostrando ${LIMITE_RESULTADOS} de ${encontrados.length}. Refine a busca.</p>` : '');

  resultado.querySelectorAll('.list-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = /** @type {HTMLElement} */ (el).dataset.id;
      const h = mostrados.find((x) => x.id === id);
      if (h) abrirDetalhe(h);
    });
  });
}

/** @param {any} h */
function abrirDetalhe(h) {
  const { panel } = openOverlay(`
    <h2 style="margin-top:0">${escapeHTML(h.numeroSerie)}</h2>
    ${h.temSerieDuplicada ? '<div class="result-badge warning">⚠️ Este número de série se repete na base</div>' : ''}
    <div class="detail-grid">
      <div><div class="k">Código</div><div class="v">${escapeHTML(h.codigoHidrometro)}</div></div>
      <div><div class="k">Ordem de Serviço</div><div class="v">${escapeHTML(h.ordemServico)}</div></div>
      <div><div class="k">ID Devolução</div><div class="v">${escapeHTML(h.idDevolucao)}</div></div>
      <div><div class="k">Data de Recebimento</div><div class="v">${formatDateBR(h.dataRecebimento)}</div></div>
      <div class="full"><div class="k">Concessionária</div><div class="v">${escapeHTML(h.concessionaria)}</div></div>
      ${h.observacoes ? `<div class="full"><div class="k">Observações</div><div class="v">${escapeHTML(h.observacoes)}</div></div>` : ''}
    </div>
    <button class="btn btn-outline" id="btn-fechar">Fechar</button>
  `);
  panel.querySelector('#btn-fechar')?.addEventListener('click', closeOverlay);
}
