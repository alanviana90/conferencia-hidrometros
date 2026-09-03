// @ts-check
/**
 * Geração do relatório de uma conferência em .xlsx, para compartilhar/arquivar.
 */

import { dbGetAll, STORES } from '../db.js';
import { getConferencia, getItensDaConferencia } from './conferencia-service.js';
import { formatDateBR, formatDateTimeBR } from '../utils.js';

const STATUS_LABEL = {
  ENCONTRADO: 'ENCONTRADO',
  NAO_ENCONTRADO: 'NÃO ENCONTRADO',
  FORA_DO_FILTRO: 'FORA DO FILTRO',
  SERIE_INEXISTENTE: 'SÉRIE INEXISTENTE (não consta na base)',
  PENDENTE: 'PENDENTE',
};

/**
 * Monta as linhas do relatório de uma conferência: todo item esperado (encontrado,
 * não encontrado ou ainda pendente) + itens extras (fora do filtro / série inexistente).
 * @param {string} conferenciaId
 */
export async function buildRelatorioLinhas(conferenciaId) {
  const conferencia = await getConferencia(conferenciaId);
  if (!conferencia) throw new Error('Conferência não encontrada.');

  const [itens, base] = await Promise.all([getItensDaConferencia(conferenciaId), dbGetAll(STORES.HIDROMETROS)]);
  const baseById = new Map(base.map((r) => [r.id, r]));

  const itemPorHidrometroId = new Map();
  const itensExtras = [];
  for (const item of itens) {
    if (item.status === 'FORA_DO_FILTRO' || item.status === 'SERIE_INEXISTENTE') {
      itensExtras.push(item);
    } else if (item.hidrometroId) {
      itemPorHidrometroId.set(item.hidrometroId, item);
    }
  }

  const linhas = [];

  for (const hid of conferencia.expectedHidrometroIds) {
    const hidrometro = baseById.get(hid);
    if (!hidrometro) continue;
    const item = itemPorHidrometroId.get(hid);
    linhas.push({
      'Número de Série': hidrometro.numeroSerie,
      Código: hidrometro.codigoHidrometro,
      'Ordem de Serviço': hidrometro.ordemServico,
      'ID Devolução': hidrometro.idDevolucao,
      'Data de Recebimento': formatDateBR(hidrometro.dataRecebimento),
      Status: item ? STATUS_LABEL[item.status] || item.status : STATUS_LABEL.PENDENTE,
      Duplicado: hidrometro.temSerieDuplicada ? 'Sim' : 'Não',
      'Data/Hora da Conferência': item ? formatDateTimeBR(item.timestamp) : '',
      Observação: hidrometro.observacoes || '',
    });
  }

  for (const item of itensExtras) {
    const hidrometro = item.hidrometroId ? baseById.get(item.hidrometroId) : null;
    linhas.push({
      'Número de Série': item.numeroSerieDigitado,
      Código: hidrometro ? hidrometro.codigoHidrometro : '',
      'Ordem de Serviço': hidrometro ? hidrometro.ordemServico : '',
      'ID Devolução': hidrometro ? hidrometro.idDevolucao : '',
      'Data de Recebimento': hidrometro ? formatDateBR(hidrometro.dataRecebimento) : '',
      Status: STATUS_LABEL[item.status] || item.status,
      Duplicado: hidrometro && hidrometro.temSerieDuplicada ? 'Sim' : 'Não',
      'Data/Hora da Conferência': formatDateTimeBR(item.timestamp),
      Observação: hidrometro ? hidrometro.observacoes || '' : '',
    });
  }

  return { conferencia, linhas };
}

/**
 * Gera e dispara o download de um .xlsx com o relatório da conferência.
 * @param {string} conferenciaId
 */
export async function exportarConferenciaXLSX(conferenciaId) {
  const { conferencia, linhas } = await buildRelatorioLinhas(conferenciaId);
  // @ts-ignore
  const XLSX = window.XLSX;

  const sheet = XLSX.utils.json_to_sheet(linhas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Conferência');

  const nomeArquivo = `conferencia_${slug(conferencia.nome)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, nomeArquivo);
}

/** @param {string} s */
function slug(s) {
  return String(s || 'conferencia')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}
