// E2E module: owns all encryption state and orchestration.
//
// main.js wires per-account context (STORE prefix, current memberNumber) at boot via
// initCryptoContext(). HTTP calls go through api.js. UI (chat-header indicator, info
// dialog) lives in main.js and consumes the read-only getters below.

import { httpGet, httpPut } from './api.js';

// ── Pure primitives (no state) ──────────────────────────────────────────────

export async function generateE2EKeypair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}

export async function exportE2EPubKey(kp) {
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export async function exportE2EPrivKey(kp) {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey));
}

export async function importE2EPubKey(b64) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

export async function importE2EPrivKey(jwkStr) {
  return crypto.subtle.importKey('jwk', JSON.parse(jwkStr),
    { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
}

export async function deriveE2ESharedKey(privKey, theirPubKey) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPubKey },
    privKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export async function encryptE2E(sharedKey, plaintext, aad = null) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = aad;
  const ct  = await crypto.subtle.encrypt(params, sharedKey,
    new TextEncoder().encode(plaintext));
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `${b64(iv.buffer)}:${b64(ct)}`;
}

export async function decryptE2E(sharedKey, encrypted, aad = null) {
  const [ivB64, ctB64] = encrypted.split(':');
  const from = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const params = { name: 'AES-GCM', iv: from(ivB64) };
  if (aad) params.additionalData = aad;
  const plain = await crypto.subtle.decrypt(params, sharedKey, from(ctB64));
  return new TextDecoder().decode(plain);
}

export function dmAAD(senderNum, recipientNum) {
  return new TextEncoder().encode(`bcm-v2|${senderNum}|${recipientNum}`);
}

export function groupAAD(groupId, senderNum) {
  return new TextEncoder().encode(`bcm-v2g|${groupId}|${senderNum}`);
}

export async function computeSafetyNumber(myPubB64, theirPubB64) {
  if (!myPubB64 || !theirPubB64) return null;
  const sorted = myPubB64 < theirPubB64 ? myPubB64 + '|' + theirPubB64 : theirPubB64 + '|' + myPubB64;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sorted));
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const s = hex.slice(0, 20).toUpperCase();
  return `${s.slice(0,5)}-${s.slice(5,10)}-${s.slice(10,15)}-${s.slice(15,20)}`;
}

// ── Wire prefixes ───────────────────────────────────────────────────────────

export const E2E_V2_PREFIX  = '[BCME2Ev2]';
export const E2E_V2G_PREFIX = '[BCME2Ev2g]';
const E2E_LEGACY_PREFIX     = '[BCME2E]';

// ── Module state ────────────────────────────────────────────────────────────

let e2ePrivateKey   = null;
let e2ePublicKeyB64 = null;
const e2eSharedKeys     = new Map();
const e2eContactPubKeys = new Map();
let e2ePinned           = {};
let e2eAllowPlaintext   = {};
const e2eKeyChanged     = new Set();

// Wired from main.js at boot — values that change with the active account.
let getStore        = () => 'bcm_default_';
let getMemberNumber = () => null;

export function initCryptoContext({ getStore: gs, getMemberNumber: gm } = {}) {
  if (gs) getStore = gs;
  if (gm) getMemberNumber = gm;
}

function loadPinnedE2E() {
  const STORE = getStore();
  try { e2ePinned = JSON.parse(GM_getValue(STORE + 'e2e_pinned', '{}')) || {}; }
  catch { e2ePinned = {}; }
  try { e2eAllowPlaintext = JSON.parse(GM_getValue(STORE + 'e2e_allow_plain', '{}')) || {}; }
  catch { e2eAllowPlaintext = {}; }
}

function savePinnedE2E() {
  GM_setValue(getStore() + 'e2e_pinned', JSON.stringify(e2ePinned));
}

function saveAllowPlaintext() {
  GM_setValue(getStore() + 'e2e_allow_plain', JSON.stringify(e2eAllowPlaintext));
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function initE2E() {
  loadPinnedE2E();
  const STORE = getStore();
  const storedPriv = GM_getValue(STORE + 'e2e_priv', '');
  const storedPub  = GM_getValue(STORE + 'e2e_pub',  '');
  if (storedPriv && storedPub) {
    try {
      e2ePrivateKey   = await importE2EPrivKey(storedPriv);
      e2ePublicKeyB64 = storedPub;
      httpPut('/api/pubkey', { publicKey: e2ePublicKeyB64 }).catch(() => {});
      return;
    } catch {}
  }
  const kp = await generateE2EKeypair();
  e2ePrivateKey   = kp.privateKey;
  e2ePublicKeyB64 = await exportE2EPubKey(kp);
  GM_setValue(STORE + 'e2e_priv', await exportE2EPrivKey(kp));
  GM_setValue(STORE + 'e2e_pub',  e2ePublicKeyB64);
  httpPut('/api/pubkey', { publicKey: e2ePublicKeyB64 }).catch(() => {});
}

export function isE2EReady() {
  return !!e2ePrivateKey;
}

// ── Contact key resolution ──────────────────────────────────────────────────

// Returns { key, status, pub } where status is 'ok' | 'no-key' | 'changed'.
export async function getContactSharedKey(memberNum) {
  memberNum = Number(memberNum);
  if (!e2ePrivateKey) return { key: null, status: 'no-key', pub: null };

  if (e2eKeyChanged.has(memberNum)) {
    return { key: null, status: 'changed', pub: e2eContactPubKeys.get(memberNum) ?? null };
  }

  if (!e2eContactPubKeys.has(memberNum)) {
    try {
      const r = await httpGet(`/api/pubkey/${memberNum}`);
      e2eContactPubKeys.set(memberNum, r?.publicKey ?? null);
    } catch { e2eContactPubKeys.set(memberNum, null); }
  }
  const serverPub = e2eContactPubKeys.get(memberNum);
  if (!serverPub) return { key: null, status: 'no-key', pub: null };

  const pinned = e2ePinned[memberNum];
  if (!pinned) {
    e2ePinned[memberNum] = { pub: serverPub, firstSeen: Date.now(), verified: false };
    savePinnedE2E();
  } else if (pinned.pub !== serverPub) {
    e2eKeyChanged.add(memberNum);
    e2eSharedKeys.delete(memberNum);
    return { key: null, status: 'changed', pub: serverPub };
  }

  if (e2eSharedKeys.has(memberNum)) {
    return { key: e2eSharedKeys.get(memberNum), status: 'ok', pub: serverPub };
  }
  try {
    const sharedKey = await deriveE2ESharedKey(e2ePrivateKey, await importE2EPubKey(serverPub));
    e2eSharedKeys.set(memberNum, sharedKey);
    return { key: sharedKey, status: 'ok', pub: serverPub };
  } catch {
    return { key: null, status: 'no-key', pub: serverPub };
  }
}

export async function getSelfSharedKey() {
  const me = getMemberNumber();
  if (!e2ePrivateKey || !e2ePublicKeyB64) return null;
  if (e2eSharedKeys.has(me)) return e2eSharedKeys.get(me);
  try {
    const k = await deriveE2ESharedKey(e2ePrivateKey, await importE2EPubKey(e2ePublicKeyB64));
    e2eSharedKeys.set(me, k);
    return k;
  } catch { return null; }
}

export async function acceptKeyChange(memberNum) {
  memberNum = Number(memberNum);
  const newPub = e2eContactPubKeys.get(memberNum);
  if (!newPub) return false;
  e2ePinned[memberNum] = { pub: newPub, firstSeen: Date.now(), verified: false };
  savePinnedE2E();
  e2eKeyChanged.delete(memberNum);
  e2eSharedKeys.delete(memberNum);
  return true;
}

export function markContactVerified(memberNum, verified = true) {
  memberNum = Number(memberNum);
  if (!e2ePinned[memberNum]) return false;
  e2ePinned[memberNum].verified = !!verified;
  savePinnedE2E();
  return true;
}

// Read-only accessors used by the UI dialog/indicator in main.js.
export function getPinnedFor(memberNum)       { return e2ePinned[Number(memberNum)] ?? null; }
export function getAllowPlaintext(memberNum)  { return !!e2eAllowPlaintext[Number(memberNum)]; }
export function setAllowPlaintext(memberNum, allow) {
  e2eAllowPlaintext[Number(memberNum)] = !!allow;
  saveAllowPlaintext();
}
export async function safetyNumberFor(memberNum) {
  return computeSafetyNumber(e2ePublicKeyB64, e2ePinned[Number(memberNum)]?.pub ?? null);
}

// Group-message decrypt helper (sender may be self or another member).
export async function decryptGroupContent(content, senderNum, groupId) {
  if (!content?.startsWith(E2E_V2G_PREFIX)) return content;
  const aad = groupAAD(Number(groupId), Number(senderNum));
  let key = null;
  if (Number(senderNum) === getMemberNumber()) {
    key = await getSelfSharedKey();
  } else {
    const r = await getContactSharedKey(Number(senderNum)).catch(() => ({ key: null }));
    key = r?.key || null;
  }
  if (!key) return '[🔒 Encrypted group message — no key for sender]';
  try { return await decryptE2E(key, content.slice(E2E_V2G_PREFIX.length), aad); }
  catch { return '[🔒 Could not decrypt group message]'; }
}
