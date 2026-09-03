// @ts-check
/**
 * Importação da planilha Excel (.xlsx/.csv) para a base de hidrômetros.
 *
 * Fluxo em duas etapas, para nunca apagar/sobrescrever dados sem confirmação:
 *   1) parseAndValidateWorkbook() — só lê o arquivo e compara com o banco atual (read-only).
 *   2) confirmImport() — grava de fato (upsert seguro) o resultado retornado pela etapa 1.
 *
 * Identidade de um registro (o que define "é o mesmo hidrômetro" entre importações):
 * combinação normalizada de (Nº Série + ID Devolução + Ordem de Serviço). Ver análise
 * da planilha original: número de série sozinho NÃO é único (16 séries repetidas).
 */

import { dbGetAll, dbBulkPut, dbPut, STORES } from '../db.js';
import { uuid, normalizeText, displayText, parseDateToISO, nowISO } from '../utils.js';

/** Cabeçalhos esperados na planilha (comparação tolera acento/maiúsculas/espaço). */
const EXPECTED_COLUMNS = [
  { key: 'concessionaria', header: 'Concessionária' },
  { key: 'dataRecebimento', header: 'Data de Recebimento' },
  { key: 'ordemServico', header: 'Ordem de Serviço' },
  { key: 'codigoHidrometro', header: 'Código Hidrômetro' },
  { key: 'numeroSerie', header: 'Nº Série Hidrômetro' },
  { key: 'idDevolucao', header: 'ID DE DEVOLUÇÃO' },
  { key: 'observacoes', header: 'Observações' },
];

/** @param {string} s */
function normalizeHeader(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[°ºn]\.?\s*/gi, (m) => (/^n/i.test(m) ? 'n' : '')) // "Nº"/"N°" -> "n"
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const EXPECTED_HEADER_NORM = new Map(EXPECTED_COLUMNS.map((c) => [normalizeHeader(c.header), c.key]));
// variação comum sem "nº": "serie hidrometro"
EXPECTED_HEADER_NORM.set(normalizeHeader('Serie Hidrometro'), 'numeroSerie');

/**
 * @typedef {Object} HidrometroRecord
 * @property {string} id
 * @property {string} concessionaria
 * @property {string} dataRecebimento  // ISO yyyy-mm-dd
 * @property {string} ordemServico
 * @property {string} codigoHidrometro
 * @property {string} numeroSerie
 * @property {string} numeroSerieNorm
 * @property {string} idDevolucao
 * @property {string} observacoes
 * @property {string} chaveComposta
 * @property {boolean} temSerieDuplicada
 * @property {string} importId
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} ImportRowError
 * @property {number} linha
 * @property {string} motivo
 */

/**
 * @typedef {Object} ParsedImportResult
 * @property {boolean} headerOk
 * @property {string[]} headerErrors
 * @property {number} totalLinhas
 * @property {HidrometroRecord[]} novos
 * @property {HidrometroRecord[]} atualizados
 * @property {number} duplicados
 * @property {{linha:number, chave:string}[]} duplicadosDetalhe
 * @property {ImportRowError[]} erros
 */

/**
 * Lê e valida um arquivo de planilha, comparando com a base atual, SEM gravar nada.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<ParsedImportResult>}
 */
export async function parseAndValidateWorkbook(arrayBuffer) {
  // @ts-ignore - XLSX é carregado via <script> global (js/lib/xlsx.full.min.js)
  const XLSX = window.XLSX;
  // cellDates:true faz células de data virarem Date reais (evita ambiguidade dd/mm x mm/dd
  // que existiria se dependêssemos só do texto formatado da célula).
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  /** @type {string[][]} */
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  /** @type {ParsedImportResult} */
  const result = {
    headerOk: true,
    headerErrors: [],
    totalLinhas: 0,
    novos: [],
    atualizados: [],
    duplicados: 0,
    duplicadosDetalhe: [],
    erros: [],
  };

  if (!rows.length) {
    result.headerOk = false;
    result.headerErrors.push('A planilha está vazia.');
    return result;
  }

  const headerRow = rows[0];
  /** @type {Record<string, number>} */
  const colIndex = {};
  headerRow.forEach((h, i) => {
    const key = EXPECTED_HEADER_NORM.get(normalizeHeader(h));
    if (key) colIndex[key] = i;
  });

  for (const col of EXPECTED_COLUMNS) {
    if (!(col.key in colIndex)) {
      result.headerOk = false;
      result.headerErrors.push(`Coluna obrigatória não encontrada: "${col.header}"`);
    }
  }
  if (!result.headerOk) return result;

  const dataRows = rows.slice(1);
  result.totalLinhas = dataRows.length;

  // Base atual, indexada por chave composta, para saber o que é novo/atualizado.
  const existentes = /** @type {HidrometroRecord[]} */ (await dbGetAll(STORES.HIDROMETROS));
  const existentesPorChave = new Map(existentes.map((r) => [r.chaveComposta, r]));

  const importId = uuid();
  const now = nowISO();

  /** @type {Map<string, HidrometroRecord>} */
  const vistosNestaImportacao = new Map();

  dataRows.forEach((row, idx) => {
    const linha = idx + 2; // +1 header, +1 base 1
    const isBlank = row.every((c) => displayText(c) === '');
    if (isBlank) return;

    const concessionaria = displayText(row[colIndex.concessionaria]);
    // Prefere o valor bruto da célula (Date real, graças a cellDates:true) para evitar
    // ambiguidade dd/mm x mm/dd; só cai para o texto formatado se a célula não tiver Date.
    const cellRef = XLSX.utils.encode_cell({ r: idx + 1, c: colIndex.dataRecebimento });
    const cell = sheet[cellRef];
    const dataRecebimentoRaw = cell && cell.v instanceof Date ? cell.v : row[colIndex.dataRecebimento];
    const ordemServico = displayText(row[colIndex.ordemServico]);
    const codigoHidrometro = displayText(row[colIndex.codigoHidrometro]);
    const numeroSerie = displayText(row[colIndex.numeroSerie]);
    const idDevolucao = displayText(row[colIndex.idDevolucao]);
    const observacoes = displayText(row[colIndex.observacoes]);

    if (!numeroSerie) {
      result.erros.push({ linha, motivo: 'Nº Série Hidrômetro vazio.' });
      return;
    }
    const dataRecebimento = parseDateToISO(dataRecebimentoRaw);
    if (!dataRecebimento) {
      result.erros.push({ linha, motivo: `Data de Recebimento inválida: "${displayText(dataRecebimentoRaw)}".` });
      return;
    }
    if (!idDevolucao) {
      result.erros.push({ linha, motivo: 'ID DE DEVOLUÇÃO vazio.' });
      return;
    }
    if (!ordemServico) {
      result.erros.push({ linha, motivo: 'Ordem de Serviço vazia.' });
      return;
    }

    const chaveComposta = [normalizeText(numeroSerie), normalizeText(idDevolucao), normalizeText(ordemServico)].join('|');

    if (vistosNestaImportacao.has(chaveComposta)) {
      result.duplicados++;
      result.duplicadosDetalhe.push({ linha, chave: chaveComposta });
      return;
    }

    const existente = existentesPorChave.get(chaveComposta);

    /** @type {HidrometroRecord} */
    const record = {
      id: existente ? existente.id : uuid(),
      concessionaria,
      dataRecebimento,
      ordemServico,
      codigoHidrometro,
      numeroSerie,
      numeroSerieNorm: normalizeText(numeroSerie),
      idDevolucao,
      observacoes,
      chaveComposta,
      temSerieDuplicada: false, // calculado depois, considerando toda a base final
      importId,
      createdAt: existente ? existente.createdAt : now,
      updatedAt: now,
    };

    vistosNestaImportacao.set(chaveComposta, record);
    if (existente) result.atualizados.push(record);
    else result.novos.push(record);
  });

  // Marca duplicidade de série considerando a base final (existentes não tocados + novos/atualizados desta importação).
  /** @type {Map<string, number>} */
  const contagemPorSerie = new Map();
  const contaSerie = (norm) => contagemPorSerie.set(norm, (contagemPorSerie.get(norm) || 0) + 1);
  const chavesTocadas = new Set(vistosNestaImportacao.keys());
  for (const r of existentes) if (!chavesTocadas.has(r.chaveComposta)) contaSerie(r.numeroSerieNorm);
  for (const r of vistosNestaImportacao.values()) contaSerie(r.numeroSerieNorm);

  const marcaDuplicada = (r) => {
    r.temSerieDuplicada = (contagemPorSerie.get(r.numeroSerieNorm) || 0) > 1;
  };
  result.novos.forEach(marcaDuplicada);
  result.atualizados.forEach(marcaDuplicada);

  return result;
}

/**
 * Grava de fato o resultado de parseAndValidateWorkbook — upsert seguro,
 * nunca remove registros existentes que não vieram nesta planilha.
 * @param {ParsedImportResult} parsed
 * @param {string} nomeArquivo
 */
export async function confirmImport(parsed, nomeArquivo) {
  const todos = [...parsed.novos, ...parsed.atualizados];

  // Recalcula a flag de duplicidade para TODA a base (registros não tocados também
  // podem passar a ser duplicados, ou deixar de ser, por causa desta importação).
  const existentes = await dbGetAll(STORES.HIDROMETROS);
  const tocadosIds = new Set(todos.map((r) => r.id));
  const naoTocados = existentes.filter((r) => !tocadosIds.has(r.id));

  /** @type {Map<string, number>} */
  const contagem = new Map();
  const inc = (norm) => contagem.set(norm, (contagem.get(norm) || 0) + 1);
  for (const r of naoTocados) inc(r.numeroSerieNorm);
  for (const r of todos) inc(r.numeroSerieNorm);

  for (const r of naoTocados) r.temSerieDuplicada = (contagem.get(r.numeroSerieNorm) || 0) > 1;
  for (const r of todos) r.temSerieDuplicada = (contagem.get(r.numeroSerieNorm) || 0) > 1;

  if (naoTocados.length) await dbBulkPut(STORES.HIDROMETROS, naoTocados);
  if (todos.length) await dbBulkPut(STORES.HIDROMETROS, todos);

  const importLog = {
    id: uuid(),
    arquivo: nomeArquivo,
    totalLinhas: parsed.totalLinhas,
    novos: parsed.novos.length,
    atualizados: parsed.atualizados.length,
    duplicados: parsed.duplicados,
    erros: parsed.erros.length,
    createdAt: nowISO(),
  };
  await dbPut(STORES.IMPORTS, importLog);

  return importLog;
}

export { EXPECTED_COLUMNS };
