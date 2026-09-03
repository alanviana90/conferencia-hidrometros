// @ts-check
import { configGet, configSet, dbCount, dbClear, STORES } from '../db.js';
import { topbarHTML, showToast, confirmDialog } from '../ui.js';
import { escapeHTML } from '../utils.js';

/** @param {HTMLElement} container */
export async function render(container) {
  const operador = await configGet('operador', '');
  const totalBase = await dbCount(STORES.HIDROMETROS);
  const totalConferencias = await dbCount(STORES.CONFERENCIAS);

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Configurações', '#/')}
      <div class="content stack">
        <div class="card">
          <div class="field" style="margin-bottom:0">
            <label for="operador-input">Nome do operador</label>
            <input type="text" id="operador-input" value="${escapeHTML(operador)}" placeholder="Seu nome" />
          </div>
        </div>
        <button class="btn btn-primary" id="btn-salvar">Salvar</button>

        <div class="section-title">Dados no aparelho</div>
        <div class="card">
          <div class="summary-line"><span>Hidrômetros na base</span><strong>${totalBase.toLocaleString('pt-BR')}</strong></div>
          <div class="summary-line"><span>Conferências registradas</span><strong>${totalConferencias.toLocaleString('pt-BR')}</strong></div>
        </div>

        <div class="section-title">Zona de risco</div>
        <button class="btn btn-danger btn-outline" id="btn-limpar-base">Apagar toda a base de hidrômetros</button>
      </div>
    </div>
  `;

  container.querySelector('#btn-salvar')?.addEventListener('click', async () => {
    const input = /** @type {HTMLInputElement} */ (container.querySelector('#operador-input'));
    await configSet('operador', input.value.trim());
    showToast('Salvo.');
    location.hash = '#/';
  });

  container.querySelector('#btn-limpar-base')?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Apagar toda a base?',
      message: `Isso remove os ${totalBase.toLocaleString('pt-BR')} hidrômetros importados. O histórico de conferências não será apagado. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Apagar base',
      danger: true,
    });
    if (!ok) return;
    await dbClear(STORES.HIDROMETROS);
    showToast('Base apagada.');
    location.hash = '#/';
  });
}
