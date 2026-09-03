// @ts-check
/**
 * Camada de acesso ao IndexedDB. Banco local do app — tudo roda offline.
 * Nenhuma outra parte do app deve chamar `indexedDB` diretamente, só este módulo.
 */

export const DB_NAME = 'hidrometros-db';
export const DB_VERSION = 1;

export const STORES = /** @type {const} */ ({
  HIDROMETROS: 'hidrometros',
  CONFERENCIAS: 'conferencias',
  ITENS_CONFERIDOS: 'itens_conferidos',
  IMPORTS: 'imports',
  CONFIG: 'config',
});

/** @type {Promise<IDBDatabase>|null} */
let dbPromise = null;

/**
 * Abre (ou cria/migra) o banco. Reaproveita a mesma conexão entre chamadas.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.HIDROMETROS)) {
        const s = db.createObjectStore(STORES.HIDROMETROS, { keyPath: 'id' });
        s.createIndex('numeroSerieNorm', 'numeroSerieNorm', { unique: false });
        s.createIndex('idDevolucao', 'idDevolucao', { unique: false });
        s.createIndex('chaveComposta', 'chaveComposta', { unique: false });
        s.createIndex('ordemServico', 'ordemServico', { unique: false });
        s.createIndex('codigoHidrometro', 'codigoHidrometro', { unique: false });
        s.createIndex('concessionaria', 'concessionaria', { unique: false });
        s.createIndex('dataRecebimento', 'dataRecebimento', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.CONFERENCIAS)) {
        const s = db.createObjectStore(STORES.CONFERENCIAS, { keyPath: 'id' });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.ITENS_CONFERIDOS)) {
        const s = db.createObjectStore(STORES.ITENS_CONFERIDOS, { keyPath: 'id' });
        s.createIndex('conferenciaId', 'conferenciaId', { unique: false });
        s.createIndex('hidrometroId', 'hidrometroId', { unique: false });
        s.createIndex('conferenciaId_hidrometroId', ['conferenciaId', 'hidrometroId'], { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.IMPORTS)) {
        const s = db.createObjectStore(STORES.IMPORTS, { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.CONFIG)) {
        db.createObjectStore(STORES.CONFIG, { keyPath: 'key' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Banco de dados bloqueado por outra aba/versão aberta.'));
  });

  return dbPromise;
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function promisifyTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação abortada.'));
  });
}

/**
 * @param {string} storeName
 * @param {any} key
 */
export async function dbGet(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return promisifyRequest(tx.objectStore(storeName).get(key));
}

/**
 * @param {string} storeName
 */
export async function dbGetAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return promisifyRequest(tx.objectStore(storeName).getAll());
}

/**
 * @param {string} storeName
 * @param {string} indexName
 * @param {IDBValidKey|IDBKeyRange} query
 */
export async function dbGetAllByIndex(storeName, indexName, query) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return promisifyRequest(tx.objectStore(storeName).index(indexName).getAll(query));
}

/**
 * @param {string} storeName
 * @param {any} value
 */
export async function dbPut(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await promisifyTx(tx);
  return value;
}

/**
 * Grava vários registros na mesma transação (rápido para import de milhares de linhas).
 * @param {string} storeName
 * @param {any[]} values
 */
export async function dbBulkPut(storeName, values) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await promisifyTx(tx);
}

/**
 * @param {string} storeName
 * @param {any} key
 */
export async function dbDelete(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await promisifyTx(tx);
}

/**
 * @param {string} storeName
 */
export async function dbCount(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  return promisifyRequest(tx.objectStore(storeName).count());
}

/**
 * @param {string} storeName
 */
export async function dbClear(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await promisifyTx(tx);
}

/** Config: leitura/gravação simples de chave-valor (nome do operador, etc.) */
export async function configGet(key, fallback = null) {
  const row = await dbGet(STORES.CONFIG, key);
  return row ? row.value : fallback;
}

/**
 * @param {string} key
 * @param {any} value
 */
export async function configSet(key, value) {
  return dbPut(STORES.CONFIG, { key, value });
}
