// @ts-check
/** Pequenos helpers de UI reutilizados pelas telas: topbar, toast, overlay e confirmação. */

import { escapeHTML } from './utils.js';

/**
 * @param {string} title
 * @param {string|null} backHref
 */
export function topbarHTML(title, backHref = null) {
  const back = backHref
    ? `<a class="back" href="${backHref}" aria-label="Voltar">←</a>`
    : '';
  return `<div class="topbar">${back}<h1>${escapeHTML(title)}</h1></div>`;
}

let toastTimer = /** @type {ReturnType<typeof setTimeout>|null} */ (null);

/** @param {string} message @param {number} [ms] */
export function showToast(message, ms = 2600) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (el) el.style.display = 'none';
  }, ms);
}

/**
 * Abre um painel deslizando de baixo pra cima, cobrindo a tela (usado para os
 * resultados da conferência e diálogos de confirmação).
 * @param {string} innerHTML
 * @param {{closeOnBackdrop?: boolean}} [opts]
 * @returns {{ panel: HTMLElement, close: () => void }}
 */
export function openOverlay(innerHTML, opts = {}) {
  closeOverlay();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'active-overlay';
  overlay.innerHTML = `<div class="overlay-panel">${innerHTML}</div>`;
  document.body.appendChild(overlay);

  if (opts.closeOnBackdrop) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeOverlay();
    });
  }

  return { panel: /** @type {HTMLElement} */ (overlay.querySelector('.overlay-panel')), close: closeOverlay };
}

export function closeOverlay() {
  const existing = document.getElementById('active-overlay');
  if (existing) existing.remove();
}

/**
 * Diálogo de confirmação estilizado (substitui o confirm() nativo, feio no mobile).
 * @param {{title: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} params
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const { panel, close } = openOverlay(`
      <h2 style="margin-top:0">${escapeHTML(title)}</h2>
      <p class="muted">${escapeHTML(message)}</p>
      <div class="stack" style="margin-top:18px">
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${escapeHTML(confirmLabel)}</button>
        <button class="btn btn-outline" data-act="cancel">${escapeHTML(cancelLabel)}</button>
      </div>
    `);
    panel.querySelector('[data-act="ok"]')?.addEventListener('click', () => {
      close();
      resolve(true);
    });
    panel.querySelector('[data-act="cancel"]')?.addEventListener('click', () => {
      close();
      resolve(false);
    });
  });
}
