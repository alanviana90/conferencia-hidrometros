/**
 * Parser e comparação de Excel — portado de js/services/import-service.js
 * Adaptado para Supabase: inclui inalterados, possíveis removidos e erros com campo.
 */

import {
  normalizeText,
  displayText,
  parseDateToISO,
  buildChaveComposta,
  recordFieldsEqual,
} from './utils-import.js';

export const EXPECTED_COLUMNS = [
  { key: 'concessionaria', header: 'Concessionária' },
  { key: 'dataRecebimento', header: 'Data de Recebimento' },
  { key: 'ordemServico', header: 'Ordem de Serviço' },
  { key: 'codigoHidrometro', header: 'Código Hidrômetro' },
  { key: 'numeroSerie', header: 'Nº Série Hidrômetro' },
  { key: 'idDevolucao', header: 'ID DE DEVOLUÇÃO' },
  { key: 'observacoes', header: 'Observações' },
];

function normalizeHeader(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[°ºn]\.?\s*/gi, (m) => (/^n/i.test(m) ? 'n' : ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const EXPECTED_HEADER_NORM = new Map(EXPECTED_COLUMNS.map((c) => [normalizeHeader(c.header), c.key]));
EXPECTED_HEADER_NORM.set(normalizeHeader('Serie Hidrometro'), 'numeroSerie');

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {object[]} existentes — registros do Supabase (snake_case)
 */
export function parseAndCompareWorkbook(arrayBuffer, existentes = []) {
  const XLSX = window.XLSX;
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  /** @type {any} */
  const result = {
    headerOk: true,
    headerErrors: [],
    totalLinhas: 0,
    registrosValidos: 0,
    novos: [],
    atualizados: [],
    inalterados: [],
    removidos: [],
    duplicados: 0,
    duplicadosDetalhe: [],
    erros: [],
    chavesNoArquivo: new Set(),
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

  const existentesPorChave = new Map(existentes.map((r) => [r.chave_composta, r]));
  /** @type {Map<string, object>} */
  const vistosNestaImportacao = new Map();

  dataRows.forEach((row, idx) => {
    const linha = idx + 2;
    const isBlank = row.every((c) => displayText(c) === '');
    if (isBlank) return;

    const concessionaria = displayText(row[colIndex.concessionaria]);
    const cellRef = XLSX.utils.encode_cell({ r: idx + 1, c: colIndex.dataRecebimento });
    const cell = sheet[cellRef];
    const dataRecebimentoRaw = cell && cell.v instanceof Date ? cell.v : row[colIndex.dataRecebimento];
    const ordemServico = displayText(row[colIndex.ordemServico]);
    const codigoHidrometro = displayText(row[colIndex.codigoHidrometro]);
    const numeroSerie = displayText(row[colIndex.numeroSerie]);
    const idDevolucao = displayText(row[colIndex.idDevolucao]);
    const observacoes = displayText(row[colIndex.observacoes]);

    if (!numeroSerie) {
      result.erros.push({ linha, campo: 'Nº Série Hidrômetro', problema: 'Campo vazio.' });
      return;
    }
    const dataRecebimento = parseDateToISO(dataRecebimentoRaw);
    if (!dataRecebimento) {
      result.erros.push({
        linha,
        campo: 'Data de Recebimento',
        problema: `Data inválida: "${displayText(dataRecebimentoRaw)}".`,
      });
      return;
    }
    if (!idDevolucao) {
      result.erros.push({ linha, campo: 'ID DE DEVOLUÇÃO', problema: 'Campo vazio.' });
      return;
    }
    if (!ordemServico) {
      result.erros.push({ linha, campo: 'Ordem de Serviço', problema: 'Campo vazio.' });
      return;
    }

    const chaveComposta = buildChaveComposta(numeroSerie, idDevolucao, ordemServico);

    if (vistosNestaImportacao.has(chaveComposta)) {
      result.duplicados++;
      result.duplicadosDetalhe.push({ linha, chave: chaveComposta });
      return;
    }

    /** @type {object} */
    const record = {
      concessionaria,
      data_recebimento: dataRecebimento,
      ordem_servico: ordemServico,
      codigo_hidrometro: codigoHidrometro,
      numero_serie_hidrometro: numeroSerie,
      numero_serie_norm: normalizeText(numeroSerie),
      id_devolucao: idDevolucao,
      observacoes,
      chave_composta: chaveComposta,
    };

    vistosNestaImportacao.set(chaveComposta, record);
    result.chavesNoArquivo.add(chaveComposta);
    result.registrosValidos++;

    const existente = existentesPorChave.get(chaveComposta);
    if (!existente) {
      result.novos.push({ ...record, acao: 'novo' });
    } else if (recordFieldsEqual(record, existente) && existente.ativo !== false) {
      result.inalterados.push({ ...record, acao: 'inalterado' });
    } else {
      result.atualizados.push({ ...record, acao: 'atualizado' });
    }
  });

  // Possíveis removidos: ativos no banco mas ausentes no Excel
  result.removidos = existentes.filter((r) => r.ativo !== false && !result.chavesNoArquivo.has(r.chave_composta));

  delete result.chavesNoArquivo;
  return result;
}

/** Payload para RPC confirmar_importacao */
export function buildConfirmPayload(parsed, nomeArquivo) {
  const registros = [...parsed.novos, ...parsed.atualizados, ...parsed.inalterados];
  return {
    p_nome_arquivo: nomeArquivo,
    p_total_linhas: parsed.totalLinhas,
    p_registros: registros,
    p_chaves_remover: parsed.removidos.map((r) => r.chave_composta),
    p_quantidade_erros: parsed.erros.length,
    p_detalhes_erros: parsed.erros,
  };
}
