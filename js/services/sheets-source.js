// @ts-check
import { normalizeText, parseDateToISO } from '../utils.js';

/** Aceita o link da planilha ou o link CSV de uma aba publicada. */
export function sheetsCSVURL(link, aba = '') {
  const url = new URL(link);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') {
    throw new Error('Informe um link HTTPS do Google Sheets (docs.google.com).');
  }
  if (/^\/spreadsheets\/d\/e\/[^/]+\/pub$/.test(url.pathname)) {
    url.searchParams.set('output', 'csv');
    return url.href;
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
  if (!match || match[1] === 'e') throw new Error('Link de planilha inválido. Use o link da planilha ou da aba publicada em CSV.');
  const result = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/gviz/tq`);
  result.searchParams.set('tqx', 'out:csv');
  if (aba.trim()) result.searchParams.set('sheet', aba.trim());
  else result.searchParams.set('gid', url.searchParams.get('gid') || new URLSearchParams(url.hash.slice(1)).get('gid') || '0');
  return result.href;
}

function header(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Converte as células como texto e mantém IDs estáveis entre leituras. */
export function recordsFromRows(rows) {
  const aliases = {
    concessionaria: ['Concessionária'],
    dataRecebimento: ['Data de Recebimento', 'data_recebimento'],
    ordemServico: ['Ordem de Serviço', 'ordem_servico'],
    codigoHidrometro: ['Código Hidrômetro', 'codigo_hidrometro'],
    numeroSerie: ['Nº Série Hidrômetro', 'N° Série Hidrômetro', 'Série Hidrômetro', 'numero_serie_hidrometro', 'numeroSerie'],
    idDevolucao: ['ID DE DEVOLUÇÃO', 'id_devolucao'],
    observacoes: ['Observações'], lote: ['Lote'], ativo: ['Ativo'], id: ['ID'], origem: ['Origem'],
  };
  const headers = (rows[0] || []).map(header);
  const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(h => names.some(name => header(name) === h))]));
  for (const key of ['numeroSerie', 'idDevolucao', 'ordemServico']) {
    if (columns[key] < 0) throw new Error(`Coluna obrigatória ausente na planilha: ${aliases[key][0]}.`);
  }
  const seen = new Set();
  const ids = new Set();
  const records = [];
  for (const [index, cells] of rows.slice(1).entries()) {
    if (cells.every(cell => !String(cell).trim())) continue;
    const record = Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, column < 0 ? '' : String(cells[column] ?? '').trim()]));
    if (!record.numeroSerie) throw new Error(`Número de série vazio na linha ${index + 2}.`);
    record.numeroSerieNorm = normalizeText(record.numeroSerie);
    record.chaveComposta = [record.numeroSerieNorm, normalizeText(record.idDevolucao), normalizeText(record.ordemServico)].join('|');
    if (seen.has(record.chaveComposta)) continue;
    seen.add(record.chaveComposta);
    record.id = record.id || `sheets:${JSON.stringify([record.numeroSerieNorm, normalizeText(record.idDevolucao), normalizeText(record.ordemServico)])}`;
    if (ids.has(record.id)) throw new Error(`ID repetido na linha ${index + 2}.`);
    ids.add(record.id);
    record.dataRecebimento = parseDateToISO(record.dataRecebimento) || '';
    records.push({ ...record, ativo: !['false', 'não', 'nao', '0'].includes(record.ativo.toLowerCase()), temSerieDuplicada: false });
  }
  const counts = new Map();
  records.forEach(r => counts.set(r.numeroSerieNorm, (counts.get(r.numeroSerieNorm) || 0) + 1));
  records.forEach(r => { r.temSerieDuplicada = counts.get(r.numeroSerieNorm) > 1; });
  return records;
}

export async function fetchSheets(link, aba) {
  const url = new URL(sheetsCSVURL(link, aba));
  url.searchParams.set('_', String(Date.now()));
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Não foi possível acessar a planilha. Verifique as permissões e o link.');
  const csv = await response.text();
  if (/^\s*</.test(csv)) throw new Error('O Google retornou uma página de acesso. Publique a aba em CSV ou habilite a leitura pelo link.');
  // @ts-ignore — biblioteca local carregada pelo index.html.
  const XLSX = window.XLSX;
  const workbook = XLSX.read(csv, { type: 'string', raw: true });
  return recordsFromRows(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: '' }));
}
