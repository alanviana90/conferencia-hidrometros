// @ts-check
/**
 * Regras de negócio da conferência: filtros, criação de sessão, algoritmo de
 * resolução de cada série digitada/escaneada, e fechamento da conferência.
 *
 * Nenhuma função aqui manipula o DOM — só dados. As telas (js/screens/*) chamam
 * estas funções e desenham o resultado.
 */

import { dbGetAll, dbGetAllByIndex, dbPut, dbBulkPut, STORES } from '../db.js';
import { uuid, normalizeText, nowISO } from '../utils.js';

/**
 * @typedef {import('./import-service.js').HidrometroRecord} HidrometroRecord
 */

/**
 * @typedef {Object} Filtros
 * @property {string|null} dataInicio  // ISO yyyy-mm-dd
 * @property {string|null} dataFim
 * @property {string[]} concessionarias
 * @property {string[]} devolucoes
 * @property {string} ordemServico
 * @property {string} codigoHidrometro
 * @property {string} numeroSerie
 * @property {string} observacoes
 */

/** @returns {Filtros} */
export function filtrosVazios() {
  return {
    dataInicio: null,
    dataFim: null,
    concessionarias: [],
    devolucoes: [],
    ordemServico: '',
    codigoHidrometro: '',
    numeroSerie: '',
    observacoes: '',
  };
}

/**
 * Aplica os filtros sobre a base carregada. Sem nenhum filtro = base inteira
 * ("Conferir tudo" é uma operação válida).
 * @param {HidrometroRecord[]} base
 * @param {Filtros} filtros
 * @returns {HidrometroRecord[]}
 */
export function filterHidrometros(base, filtros) {
  const concSet = new Set((filtros.concessionarias || []).map(normalizeText));
  const devSet = new Set((filtros.devolucoes || []).map(normalizeText));
  const osQ = normalizeText(filtros.ordemServico);
  const codQ = normalizeText(filtros.codigoHidrometro);
  const serieQ = normalizeText(filtros.numeroSerie);
  const obsQ = normalizeText(filtros.observacoes);

  return base.filter((r) => {
    if (filtros.dataInicio && r.dataRecebimento < filtros.dataInicio) return false;
    if (filtros.dataFim && r.dataRecebimento > filtros.dataFim) return false;
    if (concSet.size && !concSet.has(normalizeText(r.concessionaria))) return false;
    if (devSet.size && !devSet.has(normalizeText(r.idDevolucao))) return false;
    if (osQ && !normalizeText(r.ordemServico).includes(osQ)) return false;
    if (codQ && !normalizeText(r.codigoHidrometro).includes(codQ)) return false;
    if (serieQ && !r.numeroSerieNorm.includes(serieQ)) return false;
    if (obsQ && !normalizeText(r.observacoes).includes(obsQ)) return false;
    return true;
  });
}

/**
 * Monta os índices em memória usados durante a conferência para busca instantânea.
 * @param {HidrometroRecord[]} base
 */
export function buildBaseMaps(base) {
  /** @type {Map<string, HidrometroRecord>} */
  const byId = new Map();
  /** @type {Map<string, HidrometroRecord[]>} */
  const bySerieNorm = new Map();

  for (const r of base) {
    byId.set(r.id, r);
    const list = bySerieNorm.get(r.numeroSerieNorm);
    if (list) list.push(r);
    else bySerieNorm.set(r.numeroSerieNorm, [r]);
  }

  return { byId, bySerieNorm };
}

/**
 * @param {{nome: string, operador: string, filtros: Filtros, base: HidrometroRecord[]}} params
 */
export async function createConferencia({ nome, operador, filtros, base }) {
  const expectedHidrometroIds = filterHidrometros(base, filtros).map((r) => r.id);
  const now = nowISO();
  const record = {
    id: uuid(),
    nome,
    status: /** @type {'em_andamento'} */ ('em_andamento'),
    operador,
    filtros,
    expectedHidrometroIds,
    createdAt: now,
    updatedAt: now,
    finalizedAt: /** @type {string|null} */ (null),
  };
  await dbPut(STORES.CONFERENCIAS, record);
  return record;
}

export async function getConferencia(id) {
  const rows = await dbGetAll(STORES.CONFERENCIAS);
  return rows.find((r) => r.id === id) || null;
}

export async function listConferencias() {
  const rows = await dbGetAll(STORES.CONFERENCIAS);
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getItensDaConferencia(conferenciaId) {
  return dbGetAllByIndex(STORES.ITENS_CONFERIDOS, 'conferenciaId', conferenciaId);
}

/**
 * Estatísticas ao vivo de uma conferência.
 * "Pendente" = item esperado sem nenhum registro ainda.
 * "Encontrado"/"Não encontrado" só contam itens dentro do conjunto esperado.
 * "Fora do filtro" e "Série inexistente" são contadores informativos à parte.
 * @param {any} conferencia
 * @param {any[]} itens
 */
export function computeStats(conferencia, itens) {
  const esperado = conferencia.expectedHidrometroIds.length;

  /** @type {Map<string, any>} última resolução por hidrometroId dentro do esperado */
  const porHidrometro = new Map();
  let foraDoFiltro = 0;
  let serieInexistente = 0;

  for (const item of itens) {
    if (item.status === 'FORA_DO_FILTRO') {
      foraDoFiltro++;
      continue;
    }
    if (item.status === 'SERIE_INEXISTENTE') {
      serieInexistente++;
      continue;
    }
    if (item.hidrometroId) porHidrometro.set(item.hidrometroId, item);
  }

  let encontrados = 0;
  let naoEncontrados = 0;
  for (const item of porHidrometro.values()) {
    if (item.status === 'ENCONTRADO') encontrados++;
    else if (item.status === 'NAO_ENCONTRADO') naoEncontrados++;
  }

  const conferidos = encontrados + naoEncontrados;
  const pendentes = esperado - conferidos;
  const percentual = esperado > 0 ? Math.round((conferidos / esperado) * 100) : 0;

  return { esperado, encontrados, naoEncontrados, conferidos, pendentes, foraDoFiltro, serieInexistente, percentual };
}

/**
 * @typedef {{tipo:'VAZIO'}
 *  | {tipo:'ENCONTRADO', hidrometro: HidrometroRecord, item: any}
 *  | {tipo:'JA_CONFERIDO', hidrometro: HidrometroRecord, item: any}
 *  | {tipo:'FORA_DO_FILTRO', hidrometro: HidrometroRecord}
 *  | {tipo:'SERIE_INEXISTENTE', serieDigitada: string}
 *  | {tipo:'AMBIGUO', matches: HidrometroRecord[], serieDigitada: string}
 * } ScanDecision
 */

/**
 * @param {ReturnType<typeof buildBaseMaps>} maps
 * @param {Map<string, any>} itensPorHidrometroId  // último item por hidrometroId nesta conferência
 * @param {HidrometroRecord} hidrometro
 * @param {any} conferencia
 * @returns {ScanDecision}
 */
function resolveChosen(maps, itensPorHidrometroId, hidrometro, conferencia) {
  const existente = itensPorHidrometroId.get(hidrometro.id);
  if (existente) return { tipo: 'JA_CONFERIDO', hidrometro, item: existente };

  const dentroDoFiltro = conferencia.expectedHidrometroIds.includes(hidrometro.id);
  if (dentroDoFiltro) return { tipo: 'ENCONTRADO', hidrometro, item: null };
  return { tipo: 'FORA_DO_FILTRO', hidrometro };
}

/**
 * Avalia (sem gravar, exceto no caso ENCONTRADO) o que fazer com uma série digitada.
 * ENCONTRADO grava na hora, pois não precisa de confirmação extra do operador.
 * Os demais casos exigem uma ação explícita (ver confirmarRegistro/escolherDuplicata).
 * @param {string} serieDigitada
 * @param {ReturnType<typeof buildBaseMaps>} maps
 * @param {any[]} itensExistentes
 * @param {any} conferencia
 * @param {string} operador
 * @returns {Promise<ScanDecision>}
 */
export async function avaliarSerie(serieDigitada, maps, itensExistentes, conferencia, operador) {
  const norm = normalizeText(serieDigitada);
  if (!norm) return { tipo: 'VAZIO' };

  const itensPorHidrometroId = new Map(itensExistentes.filter((i) => i.hidrometroId).map((i) => [i.hidrometroId, i]));

  const matches = maps.bySerieNorm.get(norm) || [];
  if (matches.length === 0) return { tipo: 'SERIE_INEXISTENTE', serieDigitada };

  if (matches.length > 1) {
    return { tipo: 'AMBIGUO', matches, serieDigitada };
  }

  const decision = resolveChosen(maps, itensPorHidrometroId, matches[0], conferencia);
  if (decision.tipo === 'ENCONTRADO') {
    const item = await registrarItem(conferencia.id, decision.hidrometro.id, serieDigitada, 'ENCONTRADO', operador);
    return { tipo: 'ENCONTRADO', hidrometro: decision.hidrometro, item };
  }
  return decision;
}

/**
 * Chamado quando o operador escolhe um registro específico na tela de série duplicada.
 * @param {HidrometroRecord} hidrometroEscolhido
 * @param {string} serieDigitada
 * @param {ReturnType<typeof buildBaseMaps>} maps
 * @param {any[]} itensExistentes
 * @param {any} conferencia
 * @param {string} operador
 * @returns {Promise<ScanDecision>}
 */
export async function escolherDuplicata(hidrometroEscolhido, serieDigitada, maps, itensExistentes, conferencia, operador) {
  const itensPorHidrometroId = new Map(itensExistentes.filter((i) => i.hidrometroId).map((i) => [i.hidrometroId, i]));
  const decision = resolveChosen(maps, itensPorHidrometroId, hidrometroEscolhido, conferencia);
  if (decision.tipo === 'ENCONTRADO') {
    const item = await registrarItem(conferencia.id, decision.hidrometro.id, serieDigitada, 'ENCONTRADO', operador);
    return { tipo: 'ENCONTRADO', hidrometro: decision.hidrometro, item };
  }
  return decision;
}

/** Confirma o registro de uma série "fora do filtro" (usuário respondeu [Registrar]). */
export async function confirmarForaDoFiltro(conferenciaId, hidrometro, serieDigitada, operador) {
  return registrarItem(conferenciaId, hidrometro.id, serieDigitada, 'FORA_DO_FILTRO', operador);
}

/** Confirma o registro de uma série que não existe em lugar nenhum da base. */
export async function confirmarSerieInexistente(conferenciaId, serieDigitada, operador) {
  return registrarItem(conferenciaId, null, serieDigitada, 'SERIE_INEXISTENTE', operador);
}

/** Marca manualmente um item pendente (esperado) como não encontrado, a partir da lista de pendentes. */
export async function marcarComoNaoEncontrado(conferenciaId, hidrometro, operador) {
  return registrarItem(conferenciaId, hidrometro.id, hidrometro.numeroSerie, 'NAO_ENCONTRADO', operador);
}

/**
 * @param {string} conferenciaId
 * @param {string|null} hidrometroId
 * @param {string} numeroSerieDigitado
 * @param {'ENCONTRADO'|'FORA_DO_FILTRO'|'NAO_ENCONTRADO'|'SERIE_INEXISTENTE'} status
 * @param {string} operador
 */
async function registrarItem(conferenciaId, hidrometroId, numeroSerieDigitado, status, operador) {
  const item = {
    id: uuid(),
    conferenciaId,
    hidrometroId,
    numeroSerieDigitado,
    status,
    timestamp: nowISO(),
    operador,
  };
  await dbPut(STORES.ITENS_CONFERIDOS, item);
  await dbPut(STORES.CONFERENCIAS, { ...(await getConferencia(conferenciaId)), updatedAt: nowISO() });
  return item;
}

/**
 * Estatísticas globais para o dashboard da tela inicial: cruza a base inteira
 * com o histórico de TODAS as conferências (um hidrômetro pode ter sido
 * resolvido em mais de uma conferência ao longo do tempo — vale a resolução mais recente).
 */
export async function getGlobalStats() {
  const [base, todosItens] = await Promise.all([dbGetAll(STORES.HIDROMETROS), dbGetAll(STORES.ITENS_CONFERIDOS)]);

  /** @type {Map<string, any>} */
  const latestByHidrometro = new Map();
  const hojeISO = new Date().toISOString().slice(0, 10);
  let conferidosHoje = 0;

  for (const item of todosItens) {
    if (item.status !== 'ENCONTRADO' && item.status !== 'NAO_ENCONTRADO') continue;
    if (item.timestamp && item.timestamp.slice(0, 10) === hojeISO) conferidosHoje++;
    if (!item.hidrometroId) continue;
    const prev = latestByHidrometro.get(item.hidrometroId);
    if (!prev || item.timestamp > prev.timestamp) latestByHidrometro.set(item.hidrometroId, item);
  }

  let encontrados = 0;
  let naoEncontrados = 0;
  for (const item of latestByHidrometro.values()) {
    if (item.status === 'ENCONTRADO') encontrados++;
    else naoEncontrados++;
  }

  const totalBase = base.length;
  const conferidos = encontrados + naoEncontrados;
  return { totalBase, conferidos, encontrados, naoEncontrados, pendentes: totalBase - conferidos, conferidosHoje };
}

/**
 * Finaliza a conferência: tudo que ainda está pendente vira NÃO ENCONTRADO,
 * de forma explícita e irreversível (o operador já confirmou isso na tela).
 * @param {string} conferenciaId
 */
export async function finalizarConferencia(conferenciaId) {
  const conferencia = await getConferencia(conferenciaId);
  if (!conferencia) throw new Error('Conferência não encontrada.');

  const itens = await getItensDaConferencia(conferenciaId);
  const resolvidos = new Set(itens.filter((i) => i.hidrometroId && i.status !== 'FORA_DO_FILTRO').map((i) => i.hidrometroId));

  const base = await dbGetAll(STORES.HIDROMETROS);
  const byId = new Map(base.map((r) => [r.id, r]));
  const now = nowISO();

  const novosItens = [];
  for (const hid of conferencia.expectedHidrometroIds) {
    if (resolvidos.has(hid)) continue;
    const hidrometro = byId.get(hid);
    novosItens.push({
      id: uuid(),
      conferenciaId,
      hidrometroId: hid,
      numeroSerieDigitado: hidrometro ? hidrometro.numeroSerie : '',
      status: 'NAO_ENCONTRADO',
      timestamp: now,
      operador: conferencia.operador,
    });
  }
  if (novosItens.length) await dbBulkPut(STORES.ITENS_CONFERIDOS, novosItens);

  await dbPut(STORES.CONFERENCIAS, { ...conferencia, status: 'finalizada', finalizedAt: now, updatedAt: now });

  return getConferencia(conferenciaId);
}
