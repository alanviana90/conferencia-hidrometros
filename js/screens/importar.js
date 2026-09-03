// @ts-check
import { topbarHTML, showToast, confirmDialog } from '../ui.js';
import { parseAndValidateWorkbook, confirmImport } from '../services/import-service.js';
import { escapeHTML } from '../utils.js';

/** @type {import('../services/import-service.js').ParsedImportResult|null} */
let parsedResult = null;
let parsedFileName = '';

/** @param {HTMLElement} container */
export async function render(container) {
  parsedResult = null;
  parsedFileName = '';

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Atualizar Base', '#/')}
      <div class="content stack">
        <div class="card">
          <p style="margin-top:0">Selecione a planilha Excel (.xlsx) com as colunas: Concessionária, Data de Recebimento, Ordem de Serviço, Código Hidrômetro, Nº Série Hidrômetro, ID DE DEVOLUÇÃO, Observações.</p>
          <p class="muted" style="margin-bottom:0">A base atual <strong>nunca é apagada automaticamente</strong> — registros existentes são atualizados e novos são adicionados. Você confirma antes de gravar.</p>
        </div>

        <label for="file-input">Arquivo da planilha</label>
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv" />

        <div id="result-area"></div>
      </div>
    </div>
  `;

  const input = /** @type {HTMLInputElement} */ (container.querySelector('#file-input'));
  input.addEventListener('change', () => onFileSelected(container, input.files?.[0] || null));
}

/** @param {HTMLElement} container @param {File|null} file */
async function onFileSelected(container, file) {
  const resultArea = /** @type {HTMLElement} */ (container.querySelector('#result-area'));
  if (!file) return;

  resultArea.innerHTML = '<div class="loading">Lendo planilha…</div>';
  parsedFileName = file.name;

  try {
    const buffer = await file.arrayBuffer();
    parsedResult = await parseAndValidateWorkbook(buffer);
  } catch (err) {
    resultArea.innerHTML = `<div class="card" style="border-color:var(--danger)"><strong>Não foi possível ler o arquivo.</strong><p class="muted">${escapeHTML(err instanceof Error ? err.message : String(err))}</p></div>`;
    return;
  }

  renderResult(resultArea);
}

/** @param {HTMLElement} resultArea */
function renderResult(resultArea) {
  const r = parsedResult;
  if (!r) return;

  if (!r.headerOk) {
    resultArea.innerHTML = `
      <div class="card" style="border-color:var(--danger)">
        <strong>A planilha não tem o formato esperado.</strong>
        <ul>${r.headerErrors.map((e) => `<li>${escapeHTML(e)}</li>`).join('')}</ul>
      </div>
    `;
    return;
  }

  const encontrados = r.novos.length + r.atualizados.length + r.duplicados;
  const duplicadasSerie = [...r.novos, ...r.atualizados].filter((x) => x.temSerieDuplicada).length;

  resultArea.innerHTML = `
    <div class="card">
      <div class="section-title" style="margin-top:0">Resumo da importação</div>
      <div class="summary-line"><span>Registros encontrados</span><strong>${r.totalLinhas.toLocaleString('pt-BR')}</strong></div>
      <div class="summary-line"><span>Novos</span><strong style="color:var(--success)">${r.novos.length.toLocaleString('pt-BR')}</strong></div>
      <div class="summary-line"><span>Atualizados</span><strong style="color:var(--primary)">${r.atualizados.length.toLocaleString('pt-BR')}</strong></div>
      <div class="summary-line"><span>Duplicados na planilha</span><strong style="color:var(--warning)">${r.duplicados.toLocaleString('pt-BR')}</strong></div>
      <div class="summary-line"><span>Erros</span><strong style="color:var(--danger)">${r.erros.length.toLocaleString('pt-BR')}</strong></div>
      ${duplicadasSerie ? `<p class="muted" style="margin-bottom:0">⚠️ ${duplicadasSerie} registro(s) têm número de série repetido na base (pertencem a devoluções/OS diferentes) — o app vai pedir para escolher o correto durante a conferência.</p>` : ''}
    </div>

    ${r.erros.length ? errosCard(r.erros) : ''}

    <div class="btn-grid">
      <button class="btn btn-primary btn-lg" id="btn-confirmar" ${r.novos.length + r.atualizados.length === 0 ? 'disabled' : ''}>Confirmar Importação</button>
      <button class="btn btn-outline" id="btn-cancelar">Cancelar</button>
    </div>
  `;

  resultArea.querySelector('#btn-confirmar')?.addEventListener('click', onConfirm);
  resultArea.querySelector('#btn-cancelar')?.addEventListener('click', () => {
    parsedResult = null;
    location.reload();
  });
}

/** @param {ImportRowError[]} erros
 * @typedef {import('../services/import-service.js').ImportRowError} ImportRowError
 */
function errosCard(erros) {
  const primeiros = erros.slice(0, 30);
  return `
    <div class="card" style="border-color:var(--danger)">
      <div class="section-title" style="margin-top:0">Linhas com erro (não serão importadas)</div>
      <div class="stack" style="gap:6px">
        ${primeiros.map((e) => `<div style="font-size:.88rem"><strong>Linha ${e.linha}:</strong> ${escapeHTML(e.motivo)}</div>`).join('')}
      </div>
      ${erros.length > primeiros.length ? `<p class="muted">+ ${erros.length - primeiros.length} outra(s) linha(s) com erro.</p>` : ''}
    </div>
  `;
}

async function onConfirm() {
  if (!parsedResult) return;
  const ok = await confirmDialog({
    title: 'Confirmar importação',
    message: `${parsedResult.novos.length} novo(s) e ${parsedResult.atualizados.length} atualizado(s) serão gravados na base local. Nenhum registro existente será apagado.`,
    confirmLabel: 'Gravar na base',
  });
  if (!ok) return;

  try {
    await confirmImport(parsedResult, parsedFileName);
    showToast('Base atualizada com sucesso.');
    location.hash = '#/';
  } catch (err) {
    showToast('Erro ao gravar a importação: ' + (err instanceof Error ? err.message : String(err)));
  }
}
