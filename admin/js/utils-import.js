// Utilitários compartilhados — portados de js/utils.js (mesma lógica do app mobile)

export function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ').toUpperCase();
}

export function displayText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function parseDateToISO(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return toISODate(value);
  }

  if (typeof value === 'number' && isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400000);
    if (!isNaN(d.getTime())) return toISODate(d);
    return null;
  }

  const str = String(value).trim();
  if (!str) return null;

  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

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

function toISODate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function escapeHTML(value) {
  const str = value === null || value === undefined ? '' : String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

export function buildChaveComposta(numeroSerie, idDevolucao, ordemServico) {
  return [normalizeText(numeroSerie), normalizeText(idDevolucao), normalizeText(ordemServico)].join('|');
}

export function recordFieldsEqual(a, b) {
  return (
    displayText(a.concessionaria) === displayText(b.concessionaria) &&
    a.data_recebimento === b.data_recebimento &&
    displayText(a.ordem_servico) === displayText(b.ordem_servico) &&
    displayText(a.codigo_hidrometro) === displayText(b.codigo_hidrometro) &&
    displayText(a.numero_serie_hidrometro) === displayText(b.numero_serie_hidrometro) &&
    displayText(a.id_devolucao) === displayText(b.id_devolucao) &&
    displayText(a.observacoes) === displayText(b.observacoes)
  );
}
