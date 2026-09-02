import { SERVER } from './constants.js';

// The auth header value is owned by login state in main.js. main.js calls
// setAuthHeaderProvider() once at boot; api.js calls it for every request.
let authHeaderProvider = () => '';

export function setAuthHeaderProvider(fn) {
  authHeaderProvider = fn;
}

function parseResponse(r) {
  const text = r.responseText ?? '';
  try { return JSON.parse(text); }
  catch {
    console.error('[BCM] Non-JSON response', r.status, text.slice(0, 300));
    throw new Error(`HTTP ${r.status} — server returned non-JSON`);
  }
}

export function httpPost(path, body, auth = true) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers['Authorization'] = authHeaderProvider();
    GM_xmlhttpRequest({
      method: 'POST', url: SERVER + path, headers,
      data: JSON.stringify(body), timeout: 10000,
      onload:    r => { try { resolve(parseResponse(r)); } catch (e) { reject(e); } },
      onerror:   () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}

export function httpGet(path) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET', url: SERVER + path,
      headers: { 'Authorization': authHeaderProvider() }, timeout: 10000,
      onload:    r => { try { resolve(parseResponse(r)); } catch (e) { reject(e); } },
      onerror:   () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}

export function httpDelete(path) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'DELETE', url: SERVER + path,
      headers: { 'Authorization': authHeaderProvider() }, timeout: 10000,
      onload:    r => { try { resolve(parseResponse(r)); } catch (e) { reject(e); } },
      onerror:   () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}

export function httpPut(path, body) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'PUT', url: SERVER + path,
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeaderProvider() }, timeout: 10000,
      data: JSON.stringify(body),
      onload:    r => { try { resolve(parseResponse(r)); } catch (e) { reject(e); } },
      onerror:   () => reject(new Error('network error')),
      ontimeout: () => reject(new Error('timeout')),
    });
  });
}

// withAuthRetry retries a request once after re-registering when the server
// returns "Invalid credentials". main.js wires its register() via setRegisterFn.
let registerFn = async () => false;

export function setRegisterFn(fn) {
  registerFn = fn;
}

export async function withAuthRetry(requestFn) {
  const first = await requestFn();
  if (first?.error !== 'Invalid credentials') return first;
  const ok = await registerFn();
  if (!ok) {
    console.warn('[BCM] Re-register failed after Invalid credentials response');
    return first;
  }
  return requestFn();
}

export function fetchLinkPreview(url) {
  return new Promise(resolve => {
    GM_xmlhttpRequest({
      method: 'GET', url: `${SERVER}/api/link-preview?url=${encodeURIComponent(url)}`,
      headers: { 'Authorization': authHeaderProvider() }, timeout: 8000,
      onload: r => { try { resolve(JSON.parse(r.responseText)); } catch { resolve(null); } },
      onerror: () => resolve(null), ontimeout: () => resolve(null),
    });
  });
}

// ── Stickers / GIFs ───────────────────────────────────────────────────────────

export function uploadSticker(dataBase64, name = '') {
  return withAuthRetry(() => httpPost('/api/uploads/sticker', { dataBase64, name }));
}

export function fetchStickers() {
  return withAuthRetry(() => httpGet('/api/stickers'));
}

export function gifSearch(q, limit = 24) {
  return withAuthRetry(() => httpGet(`/api/gif-search?q=${encodeURIComponent(q)}&limit=${limit}`));
}

// ── Group join-by-code ────────────────────────────────────────────────────────

export function getGroupJoinPreview(token) {
  return withAuthRetry(() => httpGet(`/api/groups/join/${encodeURIComponent(token)}`));
}

export function requestGroupJoin(token, note = '') {
  return withAuthRetry(() => httpPost(`/api/groups/join/${encodeURIComponent(token)}`, { note }));
}

export function createGroupInvite(groupId) {
  return withAuthRetry(() => httpPost(`/api/groups/${groupId}/invite`, {}));
}

export function getGroupJoinRequests(groupId) {
  return withAuthRetry(() => httpGet(`/api/groups/${groupId}/join-requests`));
}

export function acceptGroupJoinRequest(groupId, requestId) {
  return withAuthRetry(() => httpPost(`/api/groups/${groupId}/join-requests/${requestId}/accept`, {}));
}

export function declineGroupJoinRequest(groupId, requestId) {
  return withAuthRetry(() => httpPost(`/api/groups/${groupId}/join-requests/${requestId}/decline`, {}));
}
