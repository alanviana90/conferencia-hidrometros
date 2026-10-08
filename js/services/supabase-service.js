// @ts-check
/** Fonte remota da base de hidrômetros. As sessões de conferência continuam
 * locais para o operador poder consultar pendências e histórico no aparelho. */

import { supabase } from '../../admin/js/config.js';
import { normalizeText, nowISO } from '../utils.js';

/** @type {any[]|null} */
let baseCache = null;

/** Converte o formato SQL (snake_case) para o formato usado pelas telas. */
function toAppRecord(row) {
  return {
    id: row.id,
    concessionaria: row.concessionaria || '',
    dataRecebimento: row.data_recebimento || '',
    ordemServico: row.ordem_servico || '',
    codigoHidrometro: row.codigo_hidrometro || '',
    numeroSerie: row.numero_serie_hidrometro || '',
    numeroSerieNorm: row.numero_serie_norm || normalizeText(row.numero_serie_hidrometro),
    idDevolucao: row.id_devolucao || '',
    observacoes: row.observacoes || '',
    chaveComposta: row.chave_composta || '',
    lote: row.lote || '',
    ativo: row.ativo !== false,
    temSerieDuplicada: false,
  };
}

/** Busca todos os registros, mesmo quando a tabela tiver mais de mil linhas. */
export async function fetchHidrometros({ force = false } = {}) {
  if (baseCache && !force) return baseCache;
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('hidrometros').select('*').range(from, from + pageSize - 1);
    if (error) throw new Error(`Não foi possível carregar a base: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  const base = rows.map(toAppRecord);
  const countBySerie = new Map();
  base.forEach((h) => countBySerie.set(h.numeroSerieNorm, (countBySerie.get(h.numeroSerieNorm) || 0) + 1));
  base.forEach((h) => (h.temSerieDuplicada = (countBySerie.get(h.numeroSerieNorm) || 0) > 1));
  baseCache = base;
  return baseCache;
}

/** Atualiza o lote de todos os registros com a série física informada. */
export async function updateLoteByNumeroSerie(numeroSerie, lote) {
  const { data, error } = await supabase
    .from('hidrometros')
    .update({ lote: lote.trim() })
    .eq('numero_serie_hidrometro', numeroSerie)
    .select('*');
  if (error) throw new Error(`Não foi possível atualizar o lote: ${error.message}`);
  if (!data?.length) throw new Error('Nenhum hidrômetro foi atualizado para esta série.');
  const updated = data.map(toAppRecord);
  updated.forEach((next) => {
    const current = baseCache?.find((h) => h.id === next.id);
    if (current) Object.assign(current, next);
  });
  return updated;
}

/** Cadastra o hidrômetro localizado fisicamente e ausente da base. */
export async function createHidrometro({ numeroSerie, lote, idDevolucao, ordemServico, observacoes = '' }) {
  const serie = numeroSerie.trim();
  if (!serie) throw new Error('Informe o número de série.');
  const suffix = `${Date.now()}`;
  const devolucao = idDevolucao.trim() || `MANUAL-${suffix}`;
  const os = ordemServico.trim() || 'CADASTRO MANUAL';
  const row = {
    concessionaria: 'CAN',
    data_recebimento: new Date().toISOString().slice(0, 10),
    ordem_servico: os,
    codigo_hidrometro: '',
    numero_serie_hidrometro: serie,
    numero_serie_norm: normalizeText(serie),
    id_devolucao: devolucao,
    observacoes: observacoes.trim() || `Cadastrado na conferência em ${nowISO()}`,
    chave_composta: [normalizeText(serie), normalizeText(devolucao), normalizeText(os)].join('|'),
    lote: lote.trim(),
    ativo: true,
  };
  const { data, error } = await supabase.from('hidrometros').insert(row).select('*').single();
  if (error) throw new Error(`Não foi possível cadastrar o hidrômetro: ${error.message}`);
  const created = toAppRecord(data);
  if (baseCache) baseCache.push(created);
  return created;
}
