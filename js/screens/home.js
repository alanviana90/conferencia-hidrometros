// @ts-check
import { dbGetAll, STORES, configGet } from '../db.js';
import { getGlobalStats, listConferencias } from '../services/conferencia-service.js';
import { formatDateTimeBR, escapeHTML } from '../utils.js';

/** @param {HTMLElement} container */
export async function render(container) {
  const [stats, conferencias, operador] = await Promise.all([
    getGlobalStats(),
    listConferencias(),
    configGet('operador', ''),
  ]);

  const emAndamento = conferencias.filter((c) => c.status === 'em_andamento');
  const ultima = conferencias[0];

  const continuarHref = emAndamento.length === 1 ? `#/conferencia/${emAndamento[0].id}` : '#/historico';

  container.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <h1>Conferência de Hidrômetros</h1>
        <a class="back" href="#/config" aria-label="Configurações" title="Operador: ${escapeHTML(operador || 'não definido')}">⚙️</a>
      </div>
      <div class="content stack">
        ${stats.totalBase === 0 ? emptyBaseCard() : ''}

        <div class="stat-grid">
          <div class="stat-tile primary"><div class="value">${stats.totalBase.toLocaleString('pt-BR')}</div><div class="label">Total na base</div></div>
          <div class="stat-tile success"><div class="value">${stats.conferidos.toLocaleString('pt-BR')}</div><div class="label">Total conferido</div></div>
          <div class="stat-tile warning"><div class="value">${stats.pendentes.toLocaleString('pt-BR')}</div><div class="label">Total pendente</div></div>
          <div class="stat-tile"><div class="value">${stats.conferidosHoje.toLocaleString('pt-BR')}</div><div class="label">Conferidos hoje</div></div>
        </div>

        <div class="card">
          <div class="section-title" style="margin-top:0">Última conferência</div>
          ${
            ultima
              ? `<div class="row"><div class="main"><strong>${escapeHTML(ultima.nome)}</strong><div class="muted" style="font-size:.85rem">${formatDateTimeBR(ultima.updatedAt)} · ${statusLabel(ultima.status)}</div></div></div>`
              : '<p class="muted" style="margin:0">Nenhuma conferência realizada ainda.</p>'
          }
        </div>

        <div class="btn-grid" style="margin-top:6px">
          <a class="btn btn-primary btn-lg" href="#/nova">➕ Nova Conferência</a>
          <a class="btn btn-lg ${emAndamento.length ? '' : 'btn-outline'}" href="${emAndamento.length ? continuarHref : '#'}" ${emAndamento.length ? '' : 'aria-disabled="true" onclick="return false;"'}>
            ▶️ Continuar Conferência ${emAndamento.length ? `(${emAndamento.length})` : ''}
          </a>
          <a class="btn btn-outline btn-lg" href="#/historico">🕘 Histórico</a>
          <a class="btn btn-outline btn-lg" href="#/base">📋 Base de Hidrômetros</a>
        </div>

        <a class="btn btn-sm" style="margin-top:8px" href="#/importar">⬆️ Atualizar Base (importar planilha)</a>
      </div>
    </div>
  `;
}

function emptyBaseCard() {
  return `
    <div class="card" style="border-color:var(--warning)">
      <strong>A base de hidrômetros está vazia.</strong>
      <p class="muted">Importe a planilha antes de iniciar uma conferência.</p>
      <a class="btn btn-primary" href="#/importar">Importar planilha agora</a>
    </div>
  `;
}

/** @param {string} status */
function statusLabel(status) {
  return status === 'em_andamento' ? 'Em andamento' : 'Finalizada';
}
