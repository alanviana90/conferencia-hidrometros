// @ts-check
import { configGet, configSet } from '../db.js';
import { DEFAULT_SHEETS_LINK } from '../sheets-config.js';
import { normalizeText, uuid, nowISO } from '../utils.js';

async function storageKey() {
  const link = await configGet('sheetsLink', DEFAULT_SHEETS_LINK);
  const id = new URL(link).pathname.match(/\/d\/(?:e\/)?([^/]+)/)?.[1];
  return `sheetsChanges:${id}:${await configGet('sheetsAba', '')}`;
}
export async function getChanges() { return configGet(await storageKey(), []); }
let writing = Promise.resolve();
export function queueChange(change) {
  const next = writing.then(async () => {
    const key = await storageKey();
    const changes = await configGet(key, []);
    const op = { ...change, operationId: uuid(), timestamp: nowISO() };
    changes.push(op);
    await configSet(key, changes);
    return op;
  });
  writing = next.catch(() => {});
  return next;
}
export async function overlayChanges(base) {
  const result = base.map(r => ({ ...r }));
  for (const op of await getChanges()) {
    if (op.syncedAt) continue;
    if (op.action === 'create' && !result.some(r => r.id === op.record.id)) result.push({ ...op.record });
    if (op.action === 'lote') result.filter(r => r.numeroSerieNorm === normalizeText(op.numeroSerie)).forEach(r => { r.lote = op.lote; });
  }
  const counts = new Map();
  result.forEach(r => counts.set(r.numeroSerieNorm, (counts.get(r.numeroSerieNorm) || 0) + 1));
  result.forEach(r => { r.temSerieDuplicada = counts.get(r.numeroSerieNorm) > 1; });
  return result;
}
let syncing = null;
export function syncChanges() {
  if (syncing) return syncing;
  syncing = runSync().finally(() => { syncing = null; });
  return syncing;
}
async function runSync() {
  const endpoint = await configGet('sheetsEndpoint', '');
  const token = await configGet('sheetsToken', '');
  if (!endpoint || !token) throw new Error('Configure a URL do Apps Script e a chave de acesso para enviar as alterações à planilha.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint)) throw new Error('A URL do Apps Script precisa terminar em /exec.');
  const changes = (await getChanges()).filter(op => !op.syncedAt);
  for (const op of changes) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token, ...op, sheetLink: await configGet('sheetsLink', DEFAULT_SHEETS_LINK), sheetName: await configGet('sheetsAba', '') }),
      signal: AbortSignal.timeout(45000), redirect: 'follow' });
    if (!response.ok) throw new Error('Falha ao enviar dados ao Google Sheets. As alterações continuam no aparelho.');
    let result;
    try { result = await response.json(); } catch { throw new Error('O Apps Script não retornou JSON. Verifique a implantação e as permissões.'); }
    if (!result.ok) throw new Error(result.error || 'O Google Sheets não confirmou a gravação.');
    await writing;
    await queueAck(op.operationId);
  }
  return changes.length;
}
function queueAck(id) {
  const next = writing.then(async () => {
    const key = await storageKey();
    const changes = await configGet(key, []);
    const op = changes.find(item => item.operationId === id);
    if (op) op.syncedAt = nowISO();
    await configSet(key, changes);
  });
  writing = next.catch(() => {});
  return next;
}
