// @ts-check
import { dbGetAll, dbPut, STORES } from '../db.js';
import {
  getConferencia,
  getItensDaConferencia,
  buildBaseMaps,
  computeStats,
  avaliarSerie,
  escolherDuplicata,
  confirmarForaDoFiltro,
  confirmarSerieInexistente,
  finalizarConferencia,
  registrarAdicionado,
  salvarLoteDoItem,
} from '../services/conferencia-service.js';
import { topbarHTML, showToast, confirmDialog, openOverlay, closeOverlay } from '../ui.js';
import { escapeHTML, formatDateTimeBR } from '../utils.js';
import { syncChanges } from '../services/sheets-write.js';
import { createHidrometro, updateLoteByNumeroSerie } from '../services/hidrometros-service.js';

/** @type {any} */
let conferencia = null;
/** @type {ReturnType<typeof buildBaseMaps>} */
let maps;
/** @type {any[]} */
let itens = [];
/** @type {HTMLElement} */
let containerRef;
let overlayAutoCloseTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

/** @param {HTMLElement} container @param {{id:string}} params */
export async function render(container, params) {
  containerRef = container;
  conferencia = await getConferencia(params.id);

  if (!conferencia) {
    container.innerHTML = `<div class="screen">${topbarHTML('Conferência', '#/')}<div class="content"><div class="card">Conferência não encontrada.</div></div></div>`;
    return;
  }

  if (conferencia.status === 'finalizada') {
    location.hash = `#/conferencia/${conferencia.id}/resumo`;
    return;
  }

  const base = await dbGetAll(STORES.HIDROMETROS);
  maps = buildBaseMaps(base);
  itens = await getItensDaConferencia(conferencia.id);

  const scannerSuportado = 'BarcodeDetector' in window;

  container.innerHTML = `
    <div class="screen">
      <div class="topbar">
        <a class="back" href="#/" aria-label="Voltar">←</a>
        <h1>${escapeHTML(conferencia.nome)}</h1>
        <button class="back" id="btn-finalizar" aria-label="Finalizar" title="Finalizar conferência">✔️</button>
      </div>
      <div class="content stack">
        <div class="card">
          <strong id="st-esperado">0</strong> <span class="muted">hidrômetros esperados</span>
          <div class="progress-bar" style="margin:12px 0"><div id="progress-fill" style="width:0%"></div></div>
          <div class="stat-grid">
            <div class="stat-tile success"><div class="value" id="st-encontrados">0</div><div class="label">Encontrados</div></div>
            <div class="stat-tile danger"><div class="value" id="st-naoencontrados">0</div><div class="label">Não encontrados</div></div>
            <div class="stat-tile primary"><div class="value" id="st-conferidos">0</div><div class="label">Conferidos</div></div>
            <div class="stat-tile warning"><div class="value" id="st-pendentes">0</div><div class="label">Pendentes</div></div>
          </div>
          <div class="muted" id="st-extra" style="font-size:.8rem;margin-top:10px"></div>
        </div>

        <div class="row">
          <a class="btn btn-sm btn-outline" href="#/conferencia/${conferencia.id}/pendentes">📋 Pendentes</a>
          <a class="btn btn-sm btn-outline" href="#/conferencia/${conferencia.id}/conferidos">✅ Conferidos</a>
        </div>

        <div class="card">
          <div class="field"><label for="lacre-atual">Lote / número do lacre do saco (3/4)</label><input type="text" id="lacre-atual" value="${escapeHTML(conferencia.loteAtual || '')}" placeholder="Ex.: 000123" autocomplete="off" /></div>
          <p class="muted" id="saco-contagem"></p>
          <form id="scan-form">
            <label for="serie-input">Digite ou escaneie o número de série</label>
            <input type="text" id="serie-input" class="scan-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Nº de série" />
            <div class="stack" style="margin-top:14px">
              <button type="submit" class="btn btn-primary btn-lg" id="btn-confirmar">Confirmar</button>
              ${scannerSuportado ? '<button type="button" class="btn btn-outline" id="btn-scan">📷 Escanear</button>' : ''}
            </div>
          </form>
        </div>

        <p class="muted">As alterações ficam no aparelho até o envio à planilha ser confirmado.</p><button class="btn btn-outline" id="btn-sync">Enviar alterações à planilha</button>
        <button class="btn btn-outline" id="btn-finalizar-2" style="margin-top:4px">Finalizar Conferência</button>
      </div>
    </div>
  `;

  updateStats();

  const form = /** @type {HTMLFormElement} */ (container.querySelector('#scan-form'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmitSerie();
  });

  container.querySelector('#btn-scan')?.addEventListener('click', abrirScanner);
  container.querySelector('#btn-finalizar')?.addEventListener('click', onFinalizar);
  container.querySelector('#btn-finalizar-2')?.addEventListener('click', onFinalizar);

  container.querySelector('#lacre-atual')?.addEventListener('change', async event => {
    conferencia.loteAtual = event.target.value.trim();
    await dbPut(STORES.CONFERENCIAS, conferencia);
    updateSaco();
  });
  container.querySelector('#btn-sync')?.addEventListener('click', async event => {
    const btn = event.currentTarget;
    btn.disabled = true;
    try { showToast((await syncChanges()) + ' alterações enviadas ao Google Sheets.'); }
    catch (err) { showToast(err instanceof Error ? err.message : String(err)); }
    finally { btn.disabled = false; }
  });
  updateSaco();
  focusInput();
}

function sacoCount(lacre, excludingSerie = '') {
  return new Set(itens.filter(i => ['ENCONTRADO', 'ADICIONADO', 'FORA_DO_FILTRO'].includes(i.status) && i.lote === lacre)
    .map(i => i.hidrometroSnapshot?.numeroSerieNorm || i.numeroSerieDigitado.trim().toUpperCase())
    .filter(serie => serie !== excludingSerie)).size;
}
function updateSaco() {
  const el = containerRef.querySelector('#saco-contagem');
  if (!el) return;
  const lacre = conferencia.loteAtual;
  const count = lacre ? sacoCount(lacre) : 0;
  el.textContent = lacre ? `Lacre ${lacre}: ${count}/20 hidrômetros${count >= 20 ? ' — saco completo, informe o próximo lacre.' : ''}` : 'Informe o lacre do saco antes de atribuir os hidrômetros.';
}
function focusInput() {
  const input = /** @type {HTMLInputElement|null} */ (containerRef?.querySelector('#serie-input'));
  if (input) {
    input.value = '';
    input.focus();
  }
}

function updateStats() {
  const stats = computeStats(conferencia, itens);
  const set = (id, val) => {
    const el = containerRef.querySelector('#' + id);
    if (el) el.textContent = String(val);
  };
  set('st-esperado', stats.esperado.toLocaleString('pt-BR'));
  set('st-encontrados', stats.encontrados.toLocaleString('pt-BR'));
  set('st-naoencontrados', stats.naoEncontrados.toLocaleString('pt-BR'));
  set('st-conferidos', stats.conferidos.toLocaleString('pt-BR'));
  set('st-pendentes', stats.pendentes.toLocaleString('pt-BR'));

  const fill = containerRef.querySelector('#progress-fill');
  if (fill) /** @type {HTMLElement} */ (fill).style.width = stats.percentual + '%';

  const extra = containerRef.querySelector('#st-extra');
  if (extra) {
    const partes = [];
    if (stats.excedentes) partes.push(`${stats.excedentes} excedentes adicionados`);
    if (stats.foraDoFiltro) partes.push(`${stats.foraDoFiltro} fora do filtro`);
    if (stats.serieInexistente) partes.push(`${stats.serieInexistente} série inexistente digitada`);
    extra.textContent = partes.join(' · ');
  }
}

async function onSubmitSerie() {
  const input = /** @type {HTMLInputElement} */ (containerRef.querySelector('#serie-input'));
  const serie = input.value.trim();
  if (!serie) return;

  const btn = containerRef.querySelector('#btn-confirmar');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const decision = await avaliarSerie(serie, maps, itens, conferencia, conferencia.operador);
    await handleDecision(decision, serie);
  } catch (err) { showToast(err instanceof Error ? err.message : String(err)); }
  finally { btn.disabled = false; }
}

/**
 * @param {import('../services/conferencia-service.js').ScanDecision} decision
 * @param {string} serieDigitada
 */
async function handleDecision(decision, serieDigitada) {
  if (decision.tipo === 'VAZIO') return;

  if (decision.tipo === 'ENCONTRADO') {
    itens.push(decision.item);
    updateStats();
    await showResultadoEncontrado(decision.hidrometro);
    return;
  }

  if (decision.tipo === 'JA_CONFERIDO') {
    await showResultadoEncontrado(decision.hidrometro);
    return;
  }

  if (decision.tipo === 'FORA_DO_FILTRO') {
    const { panel } = openOverlay(`
      <div class="result-badge warning">🟠 FORA DESTA CONFERÊNCIA</div>
      <div class="result-serie">${escapeHTML(decision.hidrometro.numeroSerie)}</div>
      <p class="muted" style="text-align:center;margin-top:0">Pertence à devolução <strong>${escapeHTML(decision.hidrometro.idDevolucao)}</strong></p>
      <p>Você deseja registrar esta série mesmo assim?</p>
      <div class="stack">
        <button class="btn btn-primary" id="ov-registrar">Registrar</button>
        <button class="btn btn-outline" id="ov-cancelar">Cancelar</button>
      </div>
    `);
    panel.querySelector('#ov-registrar')?.addEventListener('click', async () => {
      const item = await confirmarForaDoFiltro(conferencia.id, decision.hidrometro, serieDigitada, conferencia.operador);
      itens.push(item);
      updateStats();
      closeOverlay();
      showToast('Registrado como fora do filtro.');
      await showResultadoEncontrado(decision.hidrometro);
    });
    panel.querySelector('#ov-cancelar')?.addEventListener('click', () => {
      closeOverlay();
      focusInput();
    });
    return;
  }

  if (decision.tipo === 'SERIE_INEXISTENTE') {
    const { panel } = openOverlay(`
      <div class="result-badge danger">🔴 NÃO ENCONTRADO NA BASE</div>
      <div class="result-serie">${escapeHTML(serieDigitada)}</div>
      <p>Esta série não foi localizada na base de dados.</p>
      <div class="stack">
        <button class="btn btn-outline" id="ov-digitar">Digitar novamente</button>
        <button class="btn btn-primary" id="ov-novo">➕ Adicionar excedente</button>
        <button class="btn btn-danger" id="ov-registrar">Registrar como não encontrada</button>
      </div>
    `);
    panel.querySelector('#ov-digitar')?.addEventListener('click', () => {
      closeOverlay();
      focusInput();
    });
    panel.querySelector('#ov-novo')?.addEventListener('click', () => abrirNovoHidrometro(serieDigitada));
    panel.querySelector('#ov-registrar')?.addEventListener('click', async () => {
      const item = await confirmarSerieInexistente(conferencia.id, serieDigitada, conferencia.operador);
      itens.push(item);
      updateStats();
      closeOverlay();
      showToast('Registrado.');
      focusInput();
    });
    return;
  }

  if (decision.tipo === 'AMBIGUO') {
    const { panel } = openOverlay(`
      <div class="result-badge warning">🟠 SÉRIE COM MAIS DE UM REGISTRO</div>
      <div class="result-serie">${escapeHTML(serieDigitada)}</div>
      <p class="muted" style="text-align:center">Encontramos ${decision.matches.length} registros. Selecione a devolução correta:</p>
      <div class="stack" id="ov-matches"></div>
    `);
    const list = /** @type {HTMLElement} */ (panel.querySelector('#ov-matches'));
    decision.matches.forEach((m, i) => {
      const dentro = conferencia.expectedHidrometroIds.includes(m.id);
      const btn = document.createElement('button');
      btn.className = 'btn btn-outline';
      btn.style.textAlign = 'left';
      btn.style.display = 'block';
      btn.innerHTML = `<strong>${i + 1}. Devolução ${escapeHTML(m.idDevolucao)}</strong><br><span class="muted" style="font-size:.85rem">${dentro ? 'dentro desta conferência' : 'fora desta conferência'}</span>`;
      btn.addEventListener('click', async () => {
        closeOverlay();
        const next = await escolherDuplicata(m, serieDigitada, maps, itens, conferencia, conferencia.operador);
        await handleDecision(next, serieDigitada);
      });
      list.appendChild(btn);
    });
    return;
  }
}

/** Resultado com lacre atribuído e preservado no registro desta conferência. */
async function showResultadoEncontrado(hidrometro) {
  const { panel } = openOverlay(`
    <div class="result-badge success">${itens.some(i => i.hidrometroId === hidrometro.id && i.status === 'ADICIONADO') ? '🟠 EXCEDENTE ADICIONADO' : '🟢 ENCONTRADO / CONFERIDO'}</div>
    <div class="result-serie">${escapeHTML(hidrometro.numeroSerie)}</div>
    <div class="field">
      <label for="lote-input">Lote / número do lacre</label>
      <input type="text" id="lote-input" value="${escapeHTML(itens.find(i => i.hidrometroId === hidrometro.id)?.lote || conferencia.loteAtual || hidrometro.lote || '')}" placeholder="Informe ou altere o lote" />
    </div>
    <div class="stack">
      <button class="btn btn-primary" id="ov-salvar-lote">Salvar lote</button>
      <button class="btn btn-outline" id="ov-proximo">Próximo</button>
    </div>
  `);
  panel.querySelector('#ov-proximo')?.addEventListener('click', () => {
    closeOverlay();
    focusInput();
  });
  panel.querySelector('#ov-salvar-lote')?.addEventListener('click', async (event) => {
    const btn = /** @type {HTMLButtonElement} */ (event.currentTarget);
    const lote = /** @type {HTMLInputElement} */ (panel.querySelector('#lote-input'));
    btn.disabled = true;
    try {
      const lacre = lote.value.trim();
      if (!lacre) throw new Error('Informe o número do lacre.');
      if (sacoCount(lacre, hidrometro.numeroSerieNorm) >= 20) throw new Error('Este saco já tem 20 hidrômetros. Informe outro lacre.');
      const updated = await updateLoteByNumeroSerie(hidrometro.numeroSerie, lacre);
      const item = itens.find(i => i.hidrometroId === hidrometro.id);
      if (item) {
        const next = await salvarLoteDoItem(item.id, lacre, { ...hidrometro, lote: lacre });
        Object.assign(item, next);
      }
      conferencia.loteAtual = lacre;
      await dbPut(STORES.CONFERENCIAS, conferencia);
      containerRef.querySelector('#lacre-atual').value = lacre;
      updateSaco();
      applyUpdatedHidrometros(updated);
      showToast('Lacre salvo no aparelho. Envie as alterações à planilha para sincronizar.');
      closeOverlay();
      focusInput();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar o lote.');
      btn.disabled = false;
    }
  });
}

/** Modal para a inclusão direta de um hidrômetro ausente. */
async function abrirNovoHidrometro(numeroSerie) {
  const { panel } = openOverlay(`
    <h2 style="margin-top:0">Novo Hidrômetro</h2>
    <p class="muted">O equipamento será registrado como EXCEDENTE, com destaque no relatório e na planilha após o envio.</p>
    <div class="field"><label for="novo-serie">Número de série</label><input id="novo-serie" type="text" value="${escapeHTML(numeroSerie)}" required /></div>
    <div class="field"><label for="novo-lote">Lote</label><input id="novo-lote" type="text" value="${escapeHTML(conferencia.loteAtual || '')}" placeholder="Número do lacre" /></div>
    <div class="field"><label for="novo-devolucao">ID de devolução (opcional)</label><input id="novo-devolucao" type="text" /></div>
    <div class="field"><label for="novo-os">Ordem de serviço (opcional)</label><input id="novo-os" type="text" /></div>
    <div class="field"><label for="novo-obs">Observações (opcional)</label><textarea id="novo-obs" rows="2"></textarea></div>
    <div class="stack"><button class="btn btn-primary" id="novo-salvar">Salvar hidrômetro</button><button class="btn btn-outline" id="novo-cancelar">Cancelar</button></div>
  `);
  panel.querySelector('#novo-cancelar')?.addEventListener('click', () => {
    closeOverlay();
    focusInput();
  });
  panel.querySelector('#novo-salvar')?.addEventListener('click', async (event) => {
    const btn = /** @type {HTMLButtonElement} */ (event.currentTarget);
    btn.disabled = true;
    try {
      const lacre = panel.querySelector('#novo-lote').value.trim();
      if (!lacre) throw new Error('Informe o número do lacre.');
      if (sacoCount(lacre) >= 20) throw new Error('Este saco já tem 20 hidrômetros. Informe outro lacre.');
      const h = await createHidrometro({
        numeroSerie: /** @type {HTMLInputElement} */ (panel.querySelector('#novo-serie')).value,
        lote: /** @type {HTMLInputElement} */ (panel.querySelector('#novo-lote')).value,
        idDevolucao: /** @type {HTMLInputElement} */ (panel.querySelector('#novo-devolucao')).value,
        ordemServico: /** @type {HTMLInputElement} */ (panel.querySelector('#novo-os')).value,
        observacoes: /** @type {HTMLTextAreaElement} */ (panel.querySelector('#novo-obs')).value,
      });
      maps.byId.set(h.id, h);
      maps.bySerieNorm.set(h.numeroSerieNorm, [...(maps.bySerieNorm.get(h.numeroSerieNorm) || []), h]);
      const saved = await registrarAdicionado(conferencia.id, h, conferencia.operador);
      const item = await salvarLoteDoItem(saved.id, lacre, h);
      conferencia.loteAtual = lacre;
      await dbPut(STORES.CONFERENCIAS, conferencia);
      containerRef.querySelector('#lacre-atual').value = lacre;
      itens.push(item);
      updateStats();
      closeOverlay();
      updateSaco();
      showToast('Excedente salvo no aparelho e destacado no relatório. Envie as alterações à planilha.');
      focusInput();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao cadastrar o hidrômetro.');
      btn.disabled = false;
    }
  });
}

/** Mantém os índices em memória coerentes após um UPDATE remoto. */
function applyUpdatedHidrometros(updated) {
  updated.forEach((next) => {
    const current = maps.byId.get(next.id);
    if (current) Object.assign(current, next);
  });
}

/**
 * @param {{tone:string, badge:string, serie:string, lines:string[], autoClose?:boolean}} opts
 */
function showResultado(opts) {
  if (overlayAutoCloseTimer) clearTimeout(overlayAutoCloseTimer);
  const { panel } = openOverlay(`
    <div class="result-badge ${opts.tone}">${opts.badge}</div>
    <div class="result-serie">${escapeHTML(opts.serie)}</div>
    ${opts.lines.map((l) => `<p class="muted" style="text-align:center;margin:4px 0">${escapeHTML(l)}</p>`).join('')}
    <button class="btn btn-outline" id="ov-proximo">Próximo</button>
  `);
  panel.querySelector('#ov-proximo')?.addEventListener('click', () => {
    if (overlayAutoCloseTimer) clearTimeout(overlayAutoCloseTimer);
    closeOverlay();
    focusInput();
  });
  if (opts.autoClose) {
    overlayAutoCloseTimer = setTimeout(() => {
      closeOverlay();
      focusInput();
    }, 1400);
  }
}

/** @param {string} status */
function statusLabel(status) {
  return (
    { ENCONTRADO: 'Encontrado', NAO_ENCONTRADO: 'Não encontrado', FORA_DO_FILTRO: 'Fora do filtro', SERIE_INEXISTENTE: 'Série inexistente' }[status] ||
    status
  );
}

async function onFinalizar() {
  const stats = computeStats(conferencia, itens);
  const ok = await confirmDialog({
    title: 'Finalizar conferência?',
    message:
      stats.pendentes > 0
        ? `Ainda há ${stats.pendentes} registro(s) pendente(s). Ao finalizar, eles serão marcados como NÃO ENCONTRADOS. Esta ação não pode ser desfeita.`
        : 'Todos os registros esperados já foram resolvidos. Deseja finalizar a conferência?',
    confirmLabel: 'Finalizar',
    danger: stats.pendentes > 0,
  });
  if (!ok) return;

  await finalizarConferencia(conferencia.id);
  location.hash = `#/conferencia/${conferencia.id}/resumo`;
}

// ---------------- Scanner (BarcodeDetector nativo, opcional) ----------------

async function abrirScanner() {
  // @ts-ignore
  const BarcodeDetectorCtor = window.BarcodeDetector;
  if (!BarcodeDetectorCtor) {
    showToast('Scanner não suportado neste navegador. Digite a série manualmente.');
    return;
  }

  const { panel, close } = openOverlay(`
    <div class="result-badge info">📷 ESCANEAR</div>
    <div style="position:relative;border-radius:12px;overflow:hidden;background:#000">
      <video id="scanner-video" style="width:100%;display:block" playsinline muted></video>
    </div>
    <p class="muted">Aponte a câmera para o código de barras/QR do hidrômetro.</p>
    <button class="btn btn-outline" id="ov-cancelar-scan">Cancelar</button>
  `);

  const video = /** @type {HTMLVideoElement} */ (panel.querySelector('#scanner-video'));
  /** @type {MediaStream|null} */
  let stream = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };

  panel.querySelector('#ov-cancelar-scan')?.addEventListener('click', () => {
    stop();
    close();
    focusInput();
  });

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = stream;
    await video.play();

    const detector = new BarcodeDetectorCtor({
      formats: ['code_128', 'ean_13', 'ean_8', 'qr_code', 'code_39', 'codabar', 'upc_a', 'upc_e'],
    });

    const loop = async () => {
      if (stopped) return;
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const valor = codes[0].rawValue;
          stop();
          close();
          const input = /** @type {HTMLInputElement} */ (containerRef.querySelector('#serie-input'));
          input.value = valor;
          input.focus();
          showToast('Código lido — confira e toque em Confirmar.');
          return;
        }
      } catch (err) {
        // ignora falhas pontuais de detecção em um frame
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  } catch (err) {
    stop();
    close();
    showToast('Não foi possível acessar a câmera.');
    focusInput();
  }
}
