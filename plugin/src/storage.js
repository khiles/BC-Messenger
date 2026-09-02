// Storage module: owns the IndexedDB connection + all schema-aware CRUD that
// doesn't itself trigger UI redraws. Business-logic wrappers that touch
// contactMeta or call refreshContactList() stay in main.js and use these
// primitives via ensureDbReady() / getDb().

import { DB_VER } from './constants.js';

let idbDb         = null;
let dbOpenPromise = null;

// Wired from main.js at boot — returns the per-account DB name.
let getActiveDbName = () => 'BCOfflineMessenger_default';

export function initStorageContext({ getActiveDbName: gn } = {}) {
  if (gn) getActiveDbName = gn;
}

export function getDb() { return idbDb; }

export function closeStorage() {
  try { idbDb?.close?.(); } catch {}
  idbDb = null;
  dbOpenPromise = null;
}

export function deleteCurrentDatabase() {
  const name = getActiveDbName();
  closeStorage();
  return new Promise(resolve => {
    const req = unsafeWindow.indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

function openDB(indexedDB, dbName, dbVer) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, dbVer);
    req.onupgradeneeded = e => {
      const d   = e.target.result;
      const old = e.oldVersion;
      if (!d.objectStoreNames.contains('messages')) {
        const s = d.createObjectStore('messages', { keyPath: 'id', autoIncrement: true });
        s.createIndex('partnerNum', 'partnerNum');
        s.createIndex('serverId',   'serverId',   { unique: false });
        s.createIndex('groupId',    'groupId',    { unique: false });
        s.createIndex('groupMessageRef', 'groupMessageRef', { unique: false });
      } else {
        const tx = e.target.transaction;
        const s = tx.objectStore('messages');
        if (old < 2 && !s.indexNames.contains('serverId'))
          s.createIndex('serverId', 'serverId', { unique: false });
        if (old < 3 && !s.indexNames.contains('groupId'))
          s.createIndex('groupId', 'groupId', { unique: false });
        if (old < 5 && !s.indexNames.contains('groupMessageRef'))
          s.createIndex('groupMessageRef', 'groupMessageRef', { unique: false });
      }
      if (!d.objectStoreNames.contains('contacts'))
        d.createObjectStore('contacts', { keyPath: 'memberNum' });
      if (!d.objectStoreNames.contains('groups'))
        d.createObjectStore('groups', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('syncCursors'))
        d.createObjectStore('syncCursors', { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

export function ensureDbReady() {
  if (idbDb) return Promise.resolve(idbDb);
  dbOpenPromise = dbOpenPromise || openDB(unsafeWindow.indexedDB, getActiveDbName(), DB_VER)
    .then(db => { idbDb = db; return db; })
    .catch(err => { dbOpenPromise = null; throw err; });
  return dbOpenPromise;
}

// ── Pure reads ──────────────────────────────────────────────────────────────

export function getMessages(partnerNum) {
  return new Promise((resolve, reject) => {
    if (!idbDb) return resolve([]);
    const tx  = idbDb.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').index('partnerNum').getAll(partnerNum);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function getAllContacts() {
  return new Promise((resolve, reject) => {
    if (!idbDb) return resolve([]);
    const tx  = idbDb.transaction('contacts', 'readonly');
    const req = tx.objectStore('contacts').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function getAllStoredMessages() {
  return new Promise((resolve, reject) => {
    if (!idbDb) return resolve([]);
    const tx  = idbDb.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

export function getGroupMessages(groupId) {
  return new Promise((resolve, reject) => {
    if (!idbDb) return resolve([]);
    const tx  = idbDb.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').index('groupId').getAll(groupId);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function getAllGroups() {
  return new Promise((resolve, reject) => {
    if (!idbDb) return resolve([]);
    const tx  = idbDb.transaction('groups', 'readonly');
    const req = tx.objectStore('groups').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export function getGroup(groupId) {
  return new Promise((resolve, reject) => {
    if (!idbDb) return resolve(null);
    const tx  = idbDb.transaction('groups', 'readonly');
    const req = tx.objectStore('groups').get(groupId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  });
}

export function saveGroup(group) {
  return ensureDbReady().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('groups', 'readwrite');
    const req = tx.objectStore('groups').put(group);
    req.onsuccess = () => resolve(group);
    req.onerror   = () => reject(req.error);
  }));
}

export function deleteGroup(groupId) {
  return new Promise(resolve => {
    if (!idbDb) return resolve();
    const tx  = idbDb.transaction(['messages', 'groups'], 'readwrite');
    const idx = tx.objectStore('messages').index('groupId').openCursor(IDBKeyRange.only(groupId));
    idx.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.objectStore('groups').delete(groupId);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

export function deleteConversation(contactNum) {
  return new Promise(resolve => {
    if (!idbDb) return resolve();
    const tx  = idbDb.transaction(['messages', 'contacts'], 'readwrite');
    const idx = tx.objectStore('messages').index('partnerNum').openCursor(IDBKeyRange.only(contactNum));
    idx.onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
    tx.objectStore('contacts').delete(contactNum);
    tx.oncomplete = resolve;
    tx.onerror    = resolve;
  });
}

// ── Pure updates ────────────────────────────────────────────────────────────

export function updateMsgStatus(serverId, status, readAt = null) {
  if (!serverId) return Promise.resolve(null);
  return ensureDbReady().then(db => new Promise(resolve => {
    const tx  = db.transaction('messages', 'readwrite');
    const req = tx.objectStore('messages').index('serverId').get(serverId);
    req.onsuccess = () => {
      if (!req.result) return resolve(null);
      const updated = { ...req.result, status };
      if (readAt) updated.readAt = readAt;
      tx.objectStore('messages').put(updated);
      resolve(updated);
    };
    req.onerror = () => resolve(null);
  }));
}

export function updateMessageServerId(msg, serverId) {
  if (!msg?.id || !serverId) return Promise.resolve(null);
  return ensureDbReady().then(db => new Promise(resolve => {
    const tx  = db.transaction('messages', 'readwrite');
    const req = tx.objectStore('messages').get(msg.id);
    req.onsuccess = () => {
      if (!req.result) return resolve(null);
      const updated = { ...req.result, serverId };
      tx.objectStore('messages').put(updated);
      resolve(updated);
    };
    req.onerror = () => resolve(null);
  }));
}

export function getAllKnownServerIds() {
  return ensureDbReady().then(db => new Promise(resolve => {
    const ids = new Set();
    const tx  = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').index('serverId').openCursor();
    req.onsuccess = e => {
      const cursor = e.target.result;
      if (!cursor) return resolve(ids);
      if (cursor.key != null) ids.add(String(cursor.key));
      cursor.continue();
    };
    req.onerror = () => resolve(ids);
  }));
}

export function findDuplicateLocalMessage(partnerNum, senderNum, content, sentAt) {
  return ensureDbReady().then(db => new Promise(resolve => {
    const tx  = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').index('partnerNum').getAll(IDBKeyRange.only(partnerNum));
    req.onsuccess = () => {
      const tol = 30000;
      const ts  = Number(sentAt) || 0;
      const found = (req.result || []).find(m =>
        m.senderNum === senderNum &&
        m.content   === content   &&
        m.serverId  == null       &&
        !m.fromUs                 &&
        Math.abs((Number(m.sentAt) || 0) - ts) < tol
      );
      resolve(found || null);
    };
    req.onerror = () => resolve(null);
  }));
}

// ── Sync cursors ────────────────────────────────────────────────────────────

export function getSyncCursor(key = 'default') {
  return ensureDbReady().then(db => new Promise(resolve => {
    if (!db.objectStoreNames.contains('syncCursors')) return resolve(0);
    try {
      const tx  = db.transaction('syncCursors', 'readonly');
      const req = tx.objectStore('syncCursors').get(key);
      req.onsuccess = () => resolve(req.result?.cursor ?? 0);
      req.onerror   = () => resolve(0);
    } catch { resolve(0); }
  }));
}

export function setSyncCursor(cursor, key = 'default') {
  return ensureDbReady().then(db => new Promise(resolve => {
    if (!db.objectStoreNames.contains('syncCursors')) return resolve();
    try {
      const tx  = db.transaction('syncCursors', 'readwrite');
      tx.objectStore('syncCursors').put({ key, cursor });
      tx.oncomplete = resolve;
      tx.onerror    = resolve;
    } catch { resolve(); }
  }));
}
