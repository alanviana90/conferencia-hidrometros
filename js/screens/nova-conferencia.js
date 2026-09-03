// @ts-check
import { dbGetAll, STORES, configGet, configSet } from '../db.js';
import { filterHidrometros, filtrosVazios, createConferencia } from '../services/conferencia-service.js';
import { topbarHTML, showToast } from '../ui.js';
import { debounce, dateShortcutRange, normalizeText, escapeHTML, formatDateBR } from '../utils.js';

/** @type {any[]} */
let base = [];
let filtros = filtrosVazios();
let devolucaoBusca = '';

/** @param {HTMLElement} container */
export async function render(container) {
  filtros = filtrosVazios();
  devolucaoBusca = '';
  base = await dbGetAll(STORES.HIDROMETROS);
  const operador = await configGet('operador', '');

  if (!base.length) {
    container.innerHTML = `
      <div class="screen">${topbarHTML('Nova Conferência', '#/')}
      <div class="content"><div class="card"><strong>A base está vazia.</strong><p class="muted">Importe a planilha antes de criar uma conferência.</p><a class="btn btn-primary" href="#/importar">Importar planilha</a></div></div></div>`;
    return;
  }

  const concessionarias = uniqueCounts(base, (r) => r.concessionaria);
  const devolucoes = uniqueCounts(base, (r) => r.idDevolucao).sort((a, b) => b.count - a.count);

  container.innerHTML = `
    <div class="screen">
      ${topbarHTML('Nova Conferência', '#/')}
      <div class="content stack" style="padding-bottom:110px">

        <div class="field">
          <label for="nome-conferencia">Nome da conferência</label>
          <input type="text" id="nome-conferencia" value="${escapeHTML(nomePadrao())}" />
        </div>

        <div class="field">
          <label for="operador-input">Operador</label>
          <input type="text" id="operador-input" value="${escapeHTML(operador)}" placeholder="Seu nome" />
        </div>

        <div class="section-title" style="margin-top:0">Data de recebimento</div>
        <div class="chip-group">
          ${['hoje', '7dias', '30dias', 'mesAtual', 'mesAnterior', 'todos']
            .map((s) => `<button type="button" class="chip" data-shortcut="${s}">${shortcutLabel(s)}</button>`)
            .join('')}
        </div>
        <div class="row" style="margin-top:10px">
          <div class="field" style="flex:1;margin-bottom:0"><label for="data-inicio">De</label><input type="date" id="data-inicio" /></div>
          <div class="field" style="flex:1;margin-bottom:0"><label for="data-fim">Até</label><input type="date" id="data-fim" /></div>
        </div>

        <div class="section-title">Concessionária</div>
        <div class="card" style="padding:6px 12px">
          ${concessionarias
            .map(
              (c) => `
            <div class="checkbox-row">
              <input type="checkbox" id="conc-${escapeHTML(c.value)}" value="${escapeHTML(c.value)}" data-role="concessionaria" />
              <label for="conc-${escapeHTML(c.value)}">${escapeHTML(c.value)} <span class="muted">(${c.count})</span></label>
            </div>`
            )
            .join('')}
        </div>

        <div class="section-title">ID de Devolução</div>
        <input type="search" id="devolucao-busca" placeholder="Pesquisar devolução…" />
        <div class="row" style="margin:8px 0">
          <button type="button" class="chip" id="dev-selecionar-todos">Selecionar todos</button>
          <button type="button" class="chip" id="dev-limpar">Limpar seleção</button>
        </div>
        <div class="card" id="devolucao-list" style="padding:6px 12px;max-height:260px;overflow-y:auto"></div>

        <div class="section-title">Outros filtros</div>
        <div class="field"><label for="f-os">Ordem de Serviço</label><input type="text" id="f-os" placeholder="Buscar OS…" /></div>
        <div class="field"><label for="f-codigo">Código Hidrômetro</label><input type="text" id="f-codigo" placeholder="Buscar código…" /></div>
        <div class="field"><label for="f-serie">Nº Série Hidrômetro</label><input type="text" id="f-serie" placeholder="Buscar série…" /></div>
        <div class="field"><label for="f-obs">Observações</label><input type="text" id="f-obs" placeholder="Buscar em observações…" /></div>
      </div>

      <div class="card" style="position:sticky;bottom:0;border-radius:0;border-left:none;border-right:none;border-bottom:none;margin:0">
        <div class="row" style="margin-bottom:10px">
          <div class="main"><div class="muted" style="font-size:.85rem">Registros encontrados</div><div style="font-size:1.5rem;font-weight:700" id="contador-resultado">${base.length}</div></div>
        </div>
        <button class="btn btn-primary btn-lg" id="btn-iniciar">Iniciar Conferência</button>
      </div>
    </div>
  `;

  renderDevolucaoList(container, devolucoes);
  wireEvents(container, devolucoes);
  updateContador(container);
}

/** @param {any[]} rows @param {(r:any)=>string} pick */
function uniqueCounts(rows, pick) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const r of rows) {
    const v = pick(r);
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count }));
}

function nomePadrao() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `Conferência ${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
}

/** @param {string} s */
function shortcutLabel(s) {
  return { hoje: 'Hoje', '7dias': 'Últimos 7 dias', '30dias': 'Últimos 30 dias', mesAtual: 'Este mês', mesAnterior: 'Mês anterior', todos: 'Todos' }[s] || s;
}

/** @param {HTMLElement} container @param {{value:string,count:number}[]} devolucoes */
function renderDevolucaoList(container, devolucoes) {
  const listEl = /** @type {HTMLElement} */ (container.querySelector('#devolucao-list'));
  const q = normalizeText(devolucaoBusca);
  const filtered = q ? devolucoes.filter((d) => normalizeText(d.value).includes(q)) : devolucoes;

  if (!filtered.length) {
    listEl.innerHTML = '<p class="muted" style="padding:8px 0;margin:0">Nenhuma devolução encontrada.</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map(
      (d) => `
    <div class="checkbox-row">
      <input type="checkbox" id="dev-${escapeHTML(d.value)}" value="${escapeHTML(d.value)}" data-role="devolucao" ${filtros.devolucoes.includes(d.value) ? 'checked' : ''} />
      <label for="dev-${escapeHTML(d.value)}">${escapeHTML(d.value)} <span class="muted">(${d.count})</span></label>
    </div>`
    )
    .join('');

  listEl.querySelectorAll('input[data-role="devolucao"]').forEach((el) => {
    el.addEventListener('change', () => onFiltersChanged(container));
  });
}

/** @param {HTMLElement} container @param {{value:string,count:number}[]} devolucoes */
function wireEvents(container, devolucoes) {
  container.querySelectorAll('.chip[data-shortcut]').forEach((chip) => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip[data-shortcut]').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const shortcut = /** @type {HTMLElement} */ (chip).dataset.shortcut;
      const { inicio, fim } = dateShortcutRange(/** @type {any} */ (shortcut));
      /** @type {HTMLInputElement} */ (container.querySelector('#data-inicio')).value = inicio || '';
      /** @type {HTMLInputElement} */ (container.querySelector('#data-fim')).value = fim || '';
      onFiltersChanged(container);
    });
  });

  container.querySelector('#data-inicio')?.addEventListener('change', () => onFiltersChanged(container));
  container.querySelector('#data-fim')?.addEventListener('change', () => onFiltersChanged(container));

  container.querySelectorAll('input[data-role="concessionaria"]').forEach((el) => {
    el.addEventListener('change', () => onFiltersChanged(container));
  });

  const buscaInput = /** @type {HTMLInputElement} */ (container.querySelector('#devolucao-busca'));
  buscaInput.addEventListener(
    'input',
    debounce(() => {
      devolucaoBusca = buscaInput.value;
      renderDevolucaoList(container, devolucoes);
    }, 200)
  );

  container.querySelector('#dev-selecionar-todos')?.addEventListener('click', () => {
    const q = normalizeText(devolucaoBusca);
    const visiveis = q ? devolucoes.filter((d) => normalizeText(d.value).includes(q)) : devolucoes;
    filtros.devolucoes = [...new Set([...filtros.devolucoes, ...visiveis.map((d) => d.value)])];
    renderDevolucaoList(container, devolucoes);
    onFiltersChanged(container);
  });
  container.querySelector('#dev-limpar')?.addEventListener('click', () => {
    filtros.devolucoes = [];
    renderDevolucaoList(container, devolucoes);
    onFiltersChanged(container);
  });

  const textFields = [
    ['#f-os', 'ordemServico'],
    ['#f-codigo', 'codigoHidrometro'],
    ['#f-serie', 'numeroSerie'],
    ['#f-obs', 'observacoes'],
  ];
  for (const [sel, key] of textFields) {
    const el = /** @type {HTMLInputElement} */ (container.querySelector(sel));
    el.addEventListener(
      'input',
      debounce(() => {
        // @ts-ignore
        filtros[key] = el.value;
        updateContador(container);
      }, 200)
    );
  }

  container.querySelector('#btn-iniciar')?.addEventListener('click', () => onIniciar(container));
}

/** @param {HTMLElement} container */
function onFiltersChanged(container) {
  filtros.dataInicio = /** @type {HTMLInputElement} */ (container.querySelector('#data-inicio')).value || null;
  filtros.dataFim = /** @type {HTMLInputElement} */ (container.querySelector('#data-fim')).value || null;
  filtros.concessionarias = [...container.querySelectorAll('input[data-role="concessionaria"]:checked')].map((el) => /** @type {HTMLInputElement} */ (el).value);
  filtros.devolucoes = [...container.querySelectorAll('input[data-role="devolucao"]:checked')].map((el) => /** @type {HTMLInputElement} */ (el).value);
  updateContador(container);
}

/** @param {HTMLElement} container */
function updateContador(container) {
  const resultado = filterHidrometros(base, filtros);
  const el = /** @type {HTMLElement} */ (container.querySelector('#contador-resultado'));
  el.textContent = resultado.length.toLocaleString('pt-BR');
}

/** @param {HTMLElement} container */
async function onIniciar(container) {
  const nome = /** @type {HTMLInputElement} */ (container.querySelector('#nome-conferencia')).value.trim() || nomePadrao();
  const operador = /** @type {HTMLInputElement} */ (container.querySelector('#operador-input')).value.trim();

  if (!operador) {
    showToast('Informe o nome do operador.');
    container.querySelector('#operador-input')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const resultado = filterHidrometros(base, filtros);
  if (!resultado.length) {
    showToast('Nenhum registro encontrado com esses filtros.');
    return;
  }

  await configSet('operador', operador);
  const conferencia = await createConferencia({ nome, operador, filtros, base });
  location.hash = `#/conferencia/${conferencia.id}`;
}
