// @ts-check
/** Funções utilitárias pequenas, usadas em vários módulos. */

/** Gera um id único (usa crypto.randomUUID quando disponível). @returns {string} */
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Normaliza texto para comparação/indexação: maiúsculas, sem espaços nas pontas,
 * espaços internos colapsados. NUNCA converte para número — série/OS/código
 * são sempre tratados como texto (zeros à esquerda, letras, etc. importam).
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Versão "para exibição": mantém o texto original só com trim.
 * @param {unknown} value
 * @returns {string}
 */
export function displayText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/**
 * Converte um valor de célula de data (string dd/mm/aaaa, ISO, ou serial do Excel)
 * para uma string ISO (yyyy-mm-dd). Retorna null se não for possível interpretar.
 * @param {unknown} value
 * @returns {string|null}
 */
export function parseDateToISO(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return toISODate(value);
  }

  // Serial de data do Excel (número de dias desde 1899-12-30)
  if (typeof value === 'number' && isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400000);
    if (!isNaN(d.getTime())) return toISODate(d);
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  // yyyy-mm-dd ou yyyy-mm-ddTHH:mm:ss
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // dd/mm/yyyy ou dd-mm-yyyy
  m = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return toISODate(d);

  return null;
}

/** @param {Date} d @returns {string} */
function toISODate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formata uma data ISO (yyyy-mm-dd) para exibição dd/mm/aaaa.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
export function formatDateBR(iso) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Formata um timestamp ISO completo (data+hora) para exibição.
 * @param {string|null|undefined} isoDateTime
 * @returns {string}
 */
export function formatDateTimeBR(isoDateTime) {
  if (!isoDateTime) return '—';
  const d = new Date(isoDateTime);
  if (isNaN(d.getTime())) return isoDateTime;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yy} ${hh}:${min}`;
}

/** @returns {string} data/hora atual em ISO local (com timezone do dispositivo preservado como instante UTC) */
export function nowISO() {
  return new Date().toISOString();
}

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} wait
 * @returns {F}
 */
export function debounce(fn, wait) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let t = null;
  // @ts-ignore
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Escapa texto para uso seguro em innerHTML.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHTML(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Calcula início/fim (ISO date) para os atalhos de período de data.
 * @param {'hoje'|'7dias'|'30dias'|'mesAtual'|'mesAnterior'|'todos'} shortcut
 * @returns {{inicio: string|null, fim: string|null}}
 */
export function dateShortcutRange(shortcut) {
  const today = new Date();
  const todayISO = toISODate(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));

  switch (shortcut) {
    case 'hoje':
      return { inicio: todayISO, fim: todayISO };
    case '7dias': {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);
      return { inicio: toISODate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))), fim: todayISO };
    }
    case '30dias': {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return { inicio: toISODate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))), fim: todayISO };
    }
    case 'mesAtual': {
      const inicio = toISODate(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)));
      return { inicio, fim: todayISO };
    }
    case 'mesAnterior': {
      const inicio = new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 1));
      const fim = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 0));
      return { inicio: toISODate(inicio), fim: toISODate(fim) };
    }
    case 'todos':
    default:
      return { inicio: null, fim: null };
  }
}
