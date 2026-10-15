// @ts-check
import { lerRelatorio, prepararRecuperacao, salvarRecuperacao } from '../services/recuperacao-service.js';
import { topbarHTML, showToast } from '../ui.js';

export async function render(container, params, search) {
  let plan = null;
  container.innerHTML = `<div class="screen">${topbarHTML('Retomar com base atualizada', '#/historico')}<div class="content stack">
    <div class="card"><p>Releia a planilha completa e continue o ensacamento. Os encontrados e seus lacres serão preservados. Os demais voltarão a pendentes em uma continuação da conferência.</p>
    <p>A conferência original permanece no histórico. Séries ainda ausentes na base ficam pendentes de identificação.</p>
    ${search.get('origem') ? '<button class="btn btn-primary" id="reler">Reler base e preparar continuação</button>' : '<label for="relatorio">Selecione o relatório original (.xlsx)</label><input id="relatorio" type="file" accept=".xlsx" />'}
    </div><div id="preview" class="card" hidden></div><button id="recuperar" class="btn btn-primary" hidden>Criar continuação e retomar</button></div></div>`;
  const preview = container.querySelector('#preview');
  const save = container.querySelector('#recuperar');
  const prepare = async rows => {
    save.hidden = true;
    plan = null;
    preview.hidden = false;
    preview.textContent = 'Relendo a planilha completa…';
    try {
      plan = await prepararRecuperacao({ conferenciaId: search.get('origem') || '', rows });
      const s = plan.stats;
      preview.innerHTML = `<p><strong>${s.totalBase}</strong> hidrômetros na base atual.</p><p><strong>${s.encontrados}</strong> encontrados preservados (${s.lacrados} com lacre).</p><p><strong>${s.pendentes}</strong> pendentes para conferir / ensacar.</p><p><strong>${s.identificar}</strong> séries do relatório ainda sem correspondência exata — pendentes de identificação.</p><p class="muted">A restauração não marca pendentes como encontrados. Após retomar, use “Enviar alterações à planilha” para atualizar os status no Sheets.</p>`;
      save.hidden = false;
    } catch (err) { preview.textContent = err instanceof Error ? err.message : String(err); }
  };
  container.querySelector('#reler')?.addEventListener('click', () => prepare(null));
  container.querySelector('#relatorio')?.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try { await prepare(lerRelatorio(await file.arrayBuffer())); }
    catch (err) { preview.hidden = false; preview.textContent = err.message; save.hidden = true; plan = null; }
  });
  save.addEventListener('click', async () => {
    if (!plan || save.disabled) return;
    save.disabled = true;
    try {
      const conference = await salvarRecuperacao(plan);
      showToast('Continuação criada. Encontrados e lacres preservados.');
      location.hash = '#/conferencia/' + conference.id;
    } catch (err) { showToast(err.message); save.disabled = false; }
  });
}
