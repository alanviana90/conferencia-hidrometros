// @ts-check
import { openDatabase, STORES, configGet } from '../db.js';
import { fetchHidrometros } from './hidrometros-service.js';
import { getConferencia, getItensDaConferencia, filtrosVazios } from './conferencia-service.js';
import { queueChange } from './sheets-write.js';
import { embalagemDoRegistro } from './embalagem.js';
import { normalizeText, uuid, nowISO, formatDateTimeBR } from '../utils.js';

const norm = value => normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function lerRelatorio(buffer) {
  const XLSX = window.XLSX;
  const book = XLSX.read(buffer, { type: 'array', raw: true });
  const sheet = book.Sheets['Conferência'] || book.Sheets[book.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!rows.length || !('Número de Série' in rows[0]) || !('Status' in rows[0]) || !('Lote / Lacre' in rows[0])) {
    throw new Error('Selecione um relatório de conferência exportado por este aplicativo.');
  }
  return rows.map(row => {
    const status = norm(row.Status);
    const positive = status === 'ENCONTRADO' || status.includes('EXCEDENTE') || status === 'FORA DO FILTRO';
    if (!positive && !['NAO ENCONTRADO', 'PENDENTE'].includes(status) && !status.startsWith('SERIE INEXISTENTE') && !status.startsWith('PENDENTE')) {
      throw new Error('Status desconhecido no relatório: ' + row.Status);
    }
    const capacity = String(row['Capacidade do saco'] ?? '');
    return { numeroSerie: String(row['Número de Série']).trim(), idDevolucao: String(row['ID Devolução'] || ''),
      ordemServico: String(row['Ordem de Serviço'] || ''), descricao: String(row['Descrição'] || ''),
      lote: String(row['Lote / Lacre'] || ''), positive,
      embalagem: capacity === '20' ? '3/4' : capacity === '10' ? '1' : capacity === '0' ? 'maior' : '',
      status: status.includes('EXCEDENTE') ? 'ADICIONADO' : status === 'FORA DO FILTRO' ? 'FORA_DO_FILTRO' : 'ENCONTRADO',
      dataOriginal: String(row['Data/Hora da Conferência'] || ''), observacoes: String(row.Observação || '') };
  });
}

export async function prepararRecuperacao({ conferenciaId = '', rows = null }) {
  const base = await fetchHidrometros({ force: true });
  if (!base.length) throw new Error('A base atual está vazia. Verifique a planilha antes de recuperar.');
  let source = null;
  if (conferenciaId) {
    source = await getConferencia(conferenciaId);
    if (!source) throw new Error('Conferência não encontrada.');
    const itens = await getItensDaConferencia(conferenciaId);
    rows = itens.filter(i => i.status !== 'CORRIGIDO').map(i => ({ ...i.hidrometroSnapshot,
      numeroSerie: i.hidrometroSnapshot?.numeroSerie || i.numeroSerieDigitado,
      lote: i.lote || '', positive: ['ENCONTRADO', 'ADICIONADO', 'FORA_DO_FILTRO'].includes(i.status),
      status: i.status, timestamp: i.timestamp, dataOriginal: i.dataOriginal || formatDateTimeBR(i.timestamp), embalagem: i.hidrometroSnapshot?.embalagem || '' }));
  }
  if (!rows?.length) throw new Error('O relatório não contém registros para recuperar.');
  const bySerie = new Map();
  for (const record of base) {
    const key = normalizeText(record.numeroSerie);
    bySerie.set(key, [...(bySerie.get(key) || []), record]);
  }
  const positivos = new Map();
  const identificar = new Map();
  for (const row of rows) {
    const key = normalizeText(row.numeroSerie);
    if (!key) throw new Error('O relatório contém uma série vazia.');
    const candidates = bySerie.get(key) || [];
    const exact = candidates.filter(r => normalizeText(r.idDevolucao) === normalizeText(row.idDevolucao) && normalizeText(r.ordemServico) === normalizeText(row.ordemServico));
    const record = candidates.length === 1 ? candidates[0] : exact.length === 1 ? exact[0] : null;
    if (row.positive) {
      if (candidates.length > 1 && !record) throw new Error(`Série ${row.numeroSerie} com mais de uma devolução. Ajuste a base para recuperar sem associar ao registro errado.`);
      const previous = positivos.get(key);
      if (previous && previous.row.lote !== row.lote) throw new Error(`Série ${row.numeroSerie} com lacres diferentes no relatório.`);
      positivos.set(key, { row, record: record || { ...row, id: 'recuperado:' + key, numeroSerieNorm: key } });
    } else if (!candidates.length) identificar.set(key, row);
  }
  for (const key of positivos.keys()) identificar.delete(key);
  const positivosIds = new Set([...positivos.values()].map(x => x.record.id));
  const pending = base.filter(r => !positivosIds.has(r.id));
  return { base, source, positivos: [...positivos.values()], identificar: [...identificar.values()], pending,
    stats: { encontrados: positivos.size, lacrados: [...positivos.values()].filter(x => x.row.lote).length,
      pendentes: pending.length, identificar: identificar.size, totalBase: base.length } };
}

/** Cria uma continuação; a conferência original permanece intacta no histórico. */
export async function salvarRecuperacao(plan, nome = 'Conferência recuperada') {
  const timestamp = nowISO();
  const id = uuid();
  const operador = plan.source?.operador || await configGet('operador', '');
  const records = new Map(plan.base.map(r => [r.id, r]));
  const items = plan.positivos.map(({ row, record }) => {
    records.set(record.id, record);
    return { id: uuid(), conferenciaId: id, hidrometroId: record.id, numeroSerieDigitado: row.numeroSerie,
      status: row.status === 'ADICIONADO' ? 'ADICIONADO' : 'ENCONTRADO', timestamp, originalTimestamp: row.timestamp || null,
      dataOriginal: row.dataOriginal || '', operador, lote: row.lote,
      hidrometroSnapshot: { ...record, lote: row.lote, embalagem: row.embalagem || record.embalagem },
      adicionadoNaConferencia: row.status === 'ADICIONADO' };
  });
  items.push(...plan.identificar.map(row => ({ id: uuid(), conferenciaId: id, hidrometroId: null,
    numeroSerieDigitado: row.numeroSerie, status: 'PENDENTE_IDENTIFICACAO', timestamp,
    operador, lote: '', hidrometroSnapshot: null, registroOriginal: row })));
  const conference = { id, nome: plan.source ? plan.source.nome + ' — continuação' : nome,
    status: 'em_andamento', operador, filtros: filtrosVazios(),
    expectedHidrometroIds: [...records.values()].filter(r => !items.some(i => i.status === 'ADICIONADO' && i.hidrometroId === r.id)).map(r => r.id),
    baseSnapshot: [...records.values()], loteAtual: '', createdAt: timestamp, updatedAt: timestamp, finalizedAt: null,
    recuperadaDe: plan.source?.id || 'relatorio-xlsx', recuperacaoStats: plan.stats };
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction([STORES.CONFERENCIAS, STORES.ITENS_CONFERIDOS], 'readwrite');
    tx.objectStore(STORES.CONFERENCIAS).put(conference);
    for (const item of items) tx.objectStore(STORES.ITENS_CONFERIDOS).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Recuperação cancelada.'));
  });
  // Retira a classificação anterior de faltante na próxima sincronização.
  if (await configGet('fonteBase', 'sheets') === 'sheets') {
    for (const record of plan.pending) await queueChange({ action: 'status', record, status: 'PENDENTE — CONFERÊNCIA RETOMADA', conferenciaId: id });
    const baseIds = new Set(plan.base.map(r => r.id));
    for (const item of items.filter(i => i.hidrometroId && baseIds.has(i.hidrometroId))) {
      const record = item.hidrometroSnapshot;
      await queueChange({ action: 'status', record, status: item.status === 'ADICIONADO' ? 'EXCEDENTE — ADICIONADO NA CONFERÊNCIA' : 'CONFERIDO FISICAMENTE', conferenciaId: id });
      const semLacre = embalagemDoRegistro(record) === 'maior';
      if (item.lote || semLacre) await queueChange({ action: 'lote', numeroSerie: record.numeroSerie, lote: item.lote, semLacre, conferenciaId: id });
    }
  }
  return conference;
}
