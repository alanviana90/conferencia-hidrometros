// @ts-check
import { listConferencias, getItensDaConferencia, computeStats } from '../services/conferencia-service.js';
import { topbarHTML } from '../ui.js';
import { escapeHTML, formatDateTimeBR } from '../utils.js';

/** @param {HTMLElement} container */
export async function render(container) {
  const conferencias = await listConferencias();

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Histórico de Conferências', '#/')}
      <div class="content stack" id="lista">
        <div class="loading">Carregando…</div>
      </div>
    </div>
  `;

  const lista = /** @type {HTMLElement} */ (container.querySelector('#lista'));

  if (!conferencias.length) {
    lista.innerHTML = '<div class="empty-state"><div class="icon">🕘</div>Nenhuma conferência realizada ainda.</div>';
    return;
  }

  const linhas = await Promise.all(
    conferencias.map(async (c) => {
      const itens = await getItensDaConferencia(c.id);
      const stats = computeStats(c, itens);
      return { c, stats };
    })
  );

  lista.innerHTML = linhas
    .map(
      ({ c, stats }) => `
    <a class="list-item" href="${c.status === 'em_andamento' ? `#/conferencia/${c.id}` : `#/conferencia/${c.id}/resumo`}">
      <div class="main">
        <div class="title">${escapeHTML(c.nome)}</div>
        <div class="subtitle">${formatDateTimeBR(c.createdAt)} · ${stats.esperado} registros · ${stats.encontrados} encontrados · ${stats.naoEncontrados} não encontrados</div>
      </div>
      <span class="badge ${c.status === 'em_andamento' ? 'warning' : 'success'}">${c.status === 'em_andamento' ? 'Em andamento' : 'Finalizada'}</span>
    </a>`
    )
    .join('');
}
