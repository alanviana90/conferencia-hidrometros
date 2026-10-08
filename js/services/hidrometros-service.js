// @ts-check
import { configGet } from '../db.js';
import { fetchSheets } from './sheets-source.js';
import { DEFAULT_SHEETS_LINK, DEFAULT_SHEETS_ABA } from '../sheets-config.js';
import { overlayChanges, queueChange } from './sheets-write.js';
import { normalizeText, uuid, nowISO } from '../utils.js';
let baseCache = null;
let cacheKey = '';
export async function canEditBase() {
  return true;
}
export function invalidateBaseCache() { baseCache = null; cacheKey = ''; }
export async function fetchHidrometros({ force = false } = {}) {
  if ((await configGet('fonteBase', 'sheets')) === 'supabase') return (await import('./supabase-service.js')).fetchHidrometros({ force });
  const link = await configGet('sheetsLink', DEFAULT_SHEETS_LINK);
  const aba = await configGet('sheetsAba', DEFAULT_SHEETS_ABA);
  if (!link) throw new Error('Configure o link do Google Sheets em Configurações.');
  const key = JSON.stringify([link, aba]);
  if (baseCache && cacheKey === key && !force) return baseCache;
  const records = await overlayChanges(await fetchSheets(link, aba));
  baseCache = records;
  cacheKey = key;
  return records;
}
export async function updateLoteByNumeroSerie(numeroSerie, lote) {
  if ((await configGet('fonteBase', 'sheets')) === 'supabase') return (await import('./supabase-service.js')).updateLoteByNumeroSerie(numeroSerie, lote);
  const base = await fetchHidrometros();
  const updated = base.filter(r => r.numeroSerieNorm === normalizeText(numeroSerie));
  if (!updated.length) throw new Error('Série não encontrada.');
  await queueChange({ action: 'lote', numeroSerie, lote: lote.trim() });
  updated.forEach(r => { r.lote = lote.trim(); });
  return updated;
}
export async function createHidrometro(record) {
  if ((await configGet('fonteBase', 'sheets')) === 'supabase') return (await import('./supabase-service.js')).createHidrometro(record);
  const numeroSerie = record.numeroSerie.trim();
  if (!numeroSerie) throw new Error('Informe o número de série.');
  const base = await fetchHidrometros();
  if (base.some(r => r.numeroSerieNorm === normalizeText(numeroSerie))) throw new Error('Esta série já está na base. Confira o registro existente.');
  const created = { ...record, id: uuid(), numeroSerie, numeroSerieNorm: normalizeText(numeroSerie),
    idDevolucao: record.idDevolucao?.trim() || '', ordemServico: record.ordemServico?.trim() || '',
    dataRecebimento: nowISO().slice(0, 10), concessionaria: '', codigoHidrometro: '',
    origem: 'ADICIONADO NA CONFERÊNCIA', ativo: true, temSerieDuplicada: false };
  created.chaveComposta = [created.numeroSerieNorm, normalizeText(created.idDevolucao), normalizeText(created.ordemServico)].join('|');
  await queueChange({ action: 'create', record: created });
  base.push(created);
  return created;
}
