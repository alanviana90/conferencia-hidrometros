// @ts-check
import { configGet, configSet, dbCount, STORES } from '../db.js';
import { fetchHidrometros, invalidateBaseCache } from '../services/hidrometros-service.js';
import { fetchSheets } from '../services/sheets-source.js';
import { topbarHTML, showToast } from '../ui.js';
import { escapeHTML } from '../utils.js';
import { getChanges, syncChanges } from '../services/sheets-write.js';
import { DEFAULT_SHEETS_LINK, DEFAULT_SHEETS_ABA } from '../sheets-config.js';

export async function render(container) {
  const [operador, fonte, link, aba, total] = await Promise.all([
    configGet('operador', ''), configGet('fonteBase', 'sheets'), configGet('sheetsLink', DEFAULT_SHEETS_LINK),
    configGet('sheetsAba', DEFAULT_SHEETS_ABA), dbCount(STORES.CONFERENCIAS),
  ]);
  const endpoint = await configGet('sheetsEndpoint', '');
  const token = await configGet('sheetsToken', '');
  const pending = (await getChanges()).filter(op => !op.syncedAt).length;
  container.innerHTML = `<div class="screen">${topbarHTML('Configurações', '#/')}<div class="content stack">
    <div class="card">
      <div class="field"><label for="operador-input">Nome do operador</label><input id="operador-input" value="${escapeHTML(operador)}" /></div>
      <div class="field"><label for="fonte">Fonte da base</label><select id="fonte"><option value="sheets" ${fonte === 'sheets' ? 'selected' : ''}>Google Sheets</option><option value="supabase" ${fonte === 'supabase' ? 'selected' : ''}>Supabase (anterior)</option></select></div>
      <div id="sheets-fields">
        <div class="field"><label for="sheets-link">Link da planilha ou CSV publicado</label><input id="sheets-link" type="url" value="${escapeHTML(link)}" placeholder="https://docs.google.com/spreadsheets/d/…" /></div>
        <div class="field"><label for="sheets-aba">Nome da aba (opcional)</label><input id="sheets-aba" value="${escapeHTML(aba)}" placeholder="Usar a aba indicada no link" /></div>
        <div class="field"><label for="sheets-endpoint">URL do Apps Script (gravação)</label><input id="sheets-endpoint" type="url" value="${escapeHTML(endpoint)}" placeholder="https://script.google.com/macros/s/…/exec" /></div>
        <div class="field"><label for="sheets-token">Chave de acesso</label><input id="sheets-token" type="password" value="${escapeHTML(token)}" autocomplete="off" /></div>
        <p class="muted">Lotes e excedentes ficam salvos neste aparelho. Configure a integração para enviá-los ao Google Sheets. A consulta exige uma aba acessível pelo link ou publicada em CSV.</p>
        <a class="btn btn-outline" href="./google-apps-script/INSTRUCOES.md" target="_blank" rel="noopener">Como ativar a gravação</a>
        <button class="btn btn-outline" id="testar">Testar conexão</button>
      </div>
    </div>
    <button class="btn btn-primary" id="salvar">Salvar e atualizar base</button>
    <button class="btn btn-outline" id="sincronizar">Enviar alterações à planilha (${pending} pendentes)</button>
    <p id="status" class="muted" role="status"></p>
    <div class="card">Conferências neste aparelho: <strong>${total}</strong></div>
  </div></div>`;
  const input = id => container.querySelector(id);
  const toggle = () => { input('#sheets-fields').hidden = input('#fonte').value !== 'sheets'; };
  input('#fonte').addEventListener('change', toggle);
  toggle();
  const execute = async (save) => {
    input('#salvar').disabled = true;
    input('#testar').disabled = true;
    input('#status').textContent = 'Consultando a base…';
    try {
      const link = input('#sheets-link').value.trim();
      const aba = input('#sheets-aba').value.trim();
      let records;
      if (!save || input('#fonte').value === 'sheets') records = await fetchSheets(link, aba);
      if (save) {
        const endpointValue = input('#sheets-endpoint').value.trim();
        if (endpointValue && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpointValue)) throw new Error('URL do Apps Script inválida. Use a URL terminada em /exec.');
        await configSet('sheetsEndpoint', endpointValue);
        await configSet('sheetsToken', input('#sheets-token').value.trim());
        await configSet('operador', input('#operador-input').value.trim());
        await configSet('sheetsLink', link);
        await configSet('sheetsAba', aba);
        await configSet('fonteBase', input('#fonte').value);
        invalidateBaseCache();
        records = await fetchHidrometros({ force: true });
        showToast('Configuração salva.');
      }
      input('#status').textContent = `${records.length.toLocaleString('pt-BR')} hidrômetros encontrados.${save ? ' Base atualizada.' : ''}`;
    } catch (err) {
      input('#status').textContent = err instanceof Error ? err.message : String(err);
    } finally {
      input('#salvar').disabled = false;
      input('#testar').disabled = false;
    }
  };
  input('#sincronizar').addEventListener('click', async () => {
    input('#sincronizar').disabled = true;
    try {
      const count = await syncChanges();
      input('#status').textContent = count + ' alterações confirmadas no Google Sheets.';
      input('#sincronizar').textContent = 'Enviar alterações à planilha (0 pendentes)';
    } catch (err) { input('#status').textContent = err instanceof Error ? err.message : String(err); }
    finally { input('#sincronizar').disabled = false; }
  });
  input('#testar').addEventListener('click', () => execute(false));
  input('#salvar').addEventListener('click', () => execute(true));
}
