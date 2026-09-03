// @ts-check
import { dbGetAll, STORES } from '../db.js';
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
} from '../services/conferencia-service.js';
import { topbarHTML, showToast, confirmDialog, openOverlay, closeOverlay } from '../ui.js';
import { escapeHTML, formatDateTimeBR } from '../utils.js';

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
          <form id="scan-form">
            <label for="serie-input">Digite ou escaneie o número de série</label>
            <input type="text" id="serie-input" class="scan-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Nº de série" />
            <div class="stack" style="margin-top:14px">
              <button type="submit" class="btn btn-primary btn-lg" id="btn-confirmar">Confirmar</button>
              ${scannerSuportado ? '<button type="button" class="btn btn-outline" id="btn-scan">📷 Escanear</button>' : ''}
            </div>
          </form>
        </div>

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

  focusInput();
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
    if (stats.foraDoFiltro) partes.push(`${stats.foraDoFiltro} fora do filtro`);
    if (stats.serieInexistente) partes.push(`${stats.serieInexistente} série inexistente digitada`);
    extra.textContent = partes.join(' · ');
  }
}

async function onSubmitSerie() {
  const input = /** @type {HTMLInputElement} */ (containerRef.querySelector('#serie-input'));
  const serie = input.value.trim();
  if (!serie) return;

  const decision = await avaliarSerie(serie, maps, itens, conferencia, conferencia.operador);
  await handleDecision(decision, serie);
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
    showResultado({
      tone: 'success',
      badge: '🟢 ENCONTRADO',
      serie: decision.hidrometro.numeroSerie,
      lines: [],
      autoClose: true,
    });
    return;
  }

  if (decision.tipo === 'JA_CONFERIDO') {
    showResultado({
      tone: 'warning',
      badge: '🟡 JÁ CONFERIDO',
      serie: decision.hidrometro.numeroSerie,
      lines: [`Já registrado nesta conferência em ${formatDateTimeBR(decision.item.timestamp)} (${statusLabel(decision.item.status)}).`],
      autoClose: true,
    });
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
      focusInput();
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
        <button class="btn btn-danger" id="ov-registrar">Registrar como não encontrada</button>
      </div>
    `);
    panel.querySelector('#ov-digitar')?.addEventListener('click', () => {
      closeOverlay();
      focusInput();
    });
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
