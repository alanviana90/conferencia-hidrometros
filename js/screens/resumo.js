// @ts-check
import { dbGetAll, STORES } from '../db.js';
import { getConferencia, getItensDaConferencia, computeStats } from '../services/conferencia-service.js';
import { exportarConferenciaXLSX } from '../services/export-service.js';
import { topbarHTML, showToast } from '../ui.js';
import { escapeHTML, formatDateTimeBR } from '../utils.js';

/** @param {HTMLElement} container @param {{id:string}} params */
export async function render(container, params) {
  const conferencia = await getConferencia(params.id);
  if (!conferencia) {
    container.innerHTML = `<div class="screen">${topbarHTML('Resumo', '#/')}<div class="content"><div class="card">Conferência não encontrada.</div></div></div>`;
    return;
  }

  const [base, itens] = await Promise.all([dbGetAll(STORES.HIDROMETROS), getItensDaConferencia(conferencia.id)]);
  const baseById = new Map(base.map((r) => [r.id, r]));
  const stats = computeStats(conferencia, itens);

  const naoEncontrados = itens
    .filter((i) => i.status === 'NAO_ENCONTRADO')
    .map((i) => baseById.get(i.hidrometroId))
    .filter(Boolean)
    .sort((a, b) => a.numeroSerie.localeCompare(b.numeroSerie));

  const percentualEncontrado = stats.esperado > 0 ? ((stats.encontrados / stats.esperado) * 100).toFixed(2).replace('.', ',') : '0,00';

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML(conferencia.status === 'finalizada' ? 'Conferência Finalizada' : 'Resumo (em andamento)', `#/`)}
      <div class="content stack">
        <div class="card center">
          <div class="muted">${escapeHTML(conferencia.nome)}</div>
          <div style="font-size:2.2rem;font-weight:800;margin:6px 0">${percentualEncontrado}%</div>
          <div class="muted" style="font-size:.85rem">encontrado do total esperado</div>
        </div>

        <div class="card">
          <div class="summary-line"><span>Total esperado</span><strong>${stats.esperado.toLocaleString('pt-BR')}</strong></div>
          <div class="summary-line"><span>Encontrados</span><strong style="color:var(--success)">${stats.encontrados.toLocaleString('pt-BR')}</strong></div>
          <div class="summary-line"><span>Não encontrados</span><strong style="color:var(--danger)">${stats.naoEncontrados.toLocaleString('pt-BR')}</strong></div>
          ${stats.foraDoFiltro ? `<div class="summary-line"><span>Fora do filtro (registrados à parte)</span><strong>${stats.foraDoFiltro}</strong></div>` : ''}
          ${stats.serieInexistente ? `<div class="summary-line"><span>Séries digitadas sem correspondência</span><strong>${stats.serieInexistente}</strong></div>` : ''}
          <div class="summary-line"><span>Operador</span><strong>${escapeHTML(conferencia.operador)}</strong></div>
          <div class="summary-line"><span>Iniciada em</span><strong>${formatDateTimeBR(conferencia.createdAt)}</strong></div>
          ${conferencia.finalizedAt ? `<div class="summary-line"><span>Finalizada em</span><strong>${formatDateTimeBR(conferencia.finalizedAt)}</strong></div>` : ''}
        </div>

        ${
          naoEncontrados.length
            ? `
        <div class="section-title">Não encontrados</div>
        <div class="stack" style="gap:6px">
          ${naoEncontrados
            .slice(0, 12)
            .map((h) => `<div class="list-item"><div class="main"><div class="title">${escapeHTML(h.numeroSerie)}</div></div></div>`)
            .join('')}
        </div>
        ${naoEncontrados.length > 12 ? `<p class="muted">+ ${naoEncontrados.length - 12} outro(s). Veja a lista completa abaixo.</p>` : ''}
        `
            : ''
        }

        <div class="btn-grid" style="margin-top:6px">
          <a class="btn btn-outline" href="#/conferencia/${conferencia.id}/conferidos?status=NAO_ENCONTRADO">Ver Não Encontrados</a>
          <a class="btn btn-outline" href="#/conferencia/${conferencia.id}/conferidos">Ver Conferidos</a>
          <button class="btn btn-outline" id="btn-exportar">⬇️ Exportar Resultado (.xlsx)</button>
          <a class="btn btn-primary" href="#/nova">➕ Nova Conferência</a>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-exportar')?.addEventListener('click', async () => {
    try {
      await exportarConferenciaXLSX(conferencia.id);
    } catch (err) {
      showToast('Erro ao exportar: ' + (err instanceof Error ? err.message : String(err)));
    }
  });
}
