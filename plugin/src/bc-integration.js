// Bondage Club integration: in-game globals (Player.FriendNames, ChatRoomCharacter,
// FriendList, etc.) plus the small set of display-name normalisers that depend on them.
// Stateful merging (contactMeta + bcFriendCache + bcOnlineSet) goes through ./state.js.

import { state } from './state.js';

// ── Display-name normalisation ──────────────────────────────────────────────

export function isMemberNumberLikeName(name, memberNum = null) {
  const raw = String(name ?? '').trim();
  if (!raw) return true;
  if (/^unknown(?:\s+user)?$/i.test(raw)) return true;
  if (/^member\s*#?\s*\d+$/i.test(raw)) return true;
  if (/^\(?#?\d+\)?$/.test(raw)) return true;
  const n = Number(memberNum);
  if (n > 0) {
    const normalized = raw.replace(/[()\s#]/g, '');
    if (normalized === String(n)) return true;
  }
  return false;
}

export function getSafeDisplayName(name, memberNum = null, fallback = '') {
  const raw = String(name ?? '').trim();
  if (!raw || isMemberNumberLikeName(raw, memberNum)) return fallback;
  return raw;
}

// ── Friend lookups (unsafeWindow only) ──────────────────────────────────────

export function getFriendName(num) {
  const fn = unsafeWindow.Player?.FriendNames;
  if (!fn) return '';
  const n = Number(num);
  if (fn instanceof Map) return String(fn.get(n) ?? fn.get(String(n)) ?? '');
  return String(fn[String(n)] ?? fn[n] ?? '');
}

export function iterateFriendNames(callback) {
  const fn = unsafeWindow.Player?.FriendNames;
  if (!fn) return;
  const entries = fn instanceof Map ? fn.entries() : Object.entries(fn);
  for (const [key, name] of entries) {
    const n = Number(key);
    if (n > 0 && name) callback(n, String(name));
  }
}

export function coerceOnlineFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (['1', 'true', 'yes', 'online', 'available'].includes(raw)) return true;
  if (['0', 'false', 'no', 'offline', 'away', 'invisible'].includes(raw)) return false;
  return null;
}

export function getFriendEntryOnlineFlag(friend) {
  if (!friend || typeof friend !== 'object') return null;
  const direct =
    coerceOnlineFlag(friend.IsOnline)
    ?? coerceOnlineFlag(friend.isOnline)
    ?? coerceOnlineFlag(friend.Online)
    ?? coerceOnlineFlag(friend.online)
    ?? coerceOnlineFlag(friend.Connected)
    ?? coerceOnlineFlag(friend.connected)
    ?? coerceOnlineFlag(friend.Presence)
    ?? coerceOnlineFlag(friend.presence);
  if (direct !== null) return direct;
  const presenceRaw = String(friend.PresenceStatus ?? friend.presenceStatus ?? friend.Status ?? friend.status ?? '').trim().toLowerCase();
  if (!presenceRaw) return null;
  if (presenceRaw.includes('online')) return true;
  if (presenceRaw.includes('offline')) return false;
  return null;
}

export function parseFriendMemberNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function isCharacterLoadedForMember(num) {
  const n = Number(num);
  if (!n) return false;
  const W = unsafeWindow;
  const inRoom = [...(W.ChatRoomCharacter ?? []), ...(W.Character ?? [])].some(c => Number(c?.MemberNumber) === n);
  if (inRoom) return true;
  try {
    if (typeof W.CharacterFind === 'function') return !!W.CharacterFind(n);
  } catch {}
  return false;
}

// ── Stateful merging (uses state.bcFriendCache / state.contactMeta / state.bcOnlineSet) ──

export function parseBCFriendEntry(rawFriend) {
  if (rawFriend == null) return null;
  const friend = (rawFriend && typeof rawFriend === 'object')
    ? (rawFriend.Member ?? rawFriend.member ?? rawFriend.Friend ?? rawFriend.friend ?? rawFriend)
    : rawFriend;
  const num = (friend && typeof friend === 'object')
    ? parseFriendMemberNumber(
      friend.MemberNumber
      ?? friend.memberNumber
      ?? friend.MemberNum
      ?? friend.memberNum
      ?? friend.MemberID
      ?? friend.memberId
      ?? friend.Member
      ?? friend.member
    )
    : parseFriendMemberNumber(friend);
  if (!num) return null;
  const name = (friend && typeof friend === 'object')
    ? (friend.MemberName ?? friend.memberName ?? friend.Name ?? friend.name ?? friend.Nickname ?? friend.nickname ?? '')
    : '';
  const safeName = getSafeDisplayName(name, num, '');
  const online = getFriendEntryOnlineFlag(friend);
  const lastSeen = Number(
    (friend && typeof friend === 'object')
      ? (friend.LastSeen ?? friend.lastSeen ?? friend.LastLogin ?? friend.lastLogin ?? friend.LastActivity ?? friend.lastActivity ?? 0)
      : 0,
  ) || 0;
  const room = (friend && typeof friend === 'object')
    ? String(friend.ChatRoomName ?? friend.chatRoomName ?? friend.RoomName ?? friend.roomName ?? friend.Room ?? friend.room ?? '').trim()
    : '';
  return { memberNum: num, name: safeName, online, lastSeen, room };
}

export function getBCFriendEntries() {
  const W = unsafeWindow;
  const merged = new Map();
  const mergeEntry = (entry) => {
    if (!entry?.memberNum) return;
    const n = Number(entry.memberNum);
    if (!n) return;
    const prev = merged.get(n) || { memberNum: n, name: '', online: null, lastSeen: 0, room: '' };
    const safeName = getSafeDisplayName(entry.name, n, '');
    const online = coerceOnlineFlag(entry.online);
    const mergedEntry = {
      memberNum: n,
      name: safeName || prev.name || '',
      online: online !== null ? online : prev.online,
      lastSeen: Number(entry.lastSeen || prev.lastSeen || 0) || 0,
      room: entry.room || prev.room || '',
    };
    merged.set(n, mergedEntry);
  };
  for (const raw of (W.Player?.FriendList ?? [])) mergeEntry(parseBCFriendEntry(raw));
  iterateFriendNames((n, name) => mergeEntry({ memberNum: n, name }));
  for (const entry of Object.values(state.bcFriendCache || {})) mergeEntry(entry);
  return [...merged.values()];
}

export function memberAvailClass(num, isOnline) {
  if (!isOnline) return '';
  const avail = state.contactMeta[Number(num)]?.availability ?? 'online';
  if (avail === 'away') return 'away';
  if (avail === 'dnd')  return 'dnd';
  return 'online';
}

export function isMemberOnlineForUi(num, serverOnline = null) {
  const n = Number(num);
  if (!n) return false;
  if (state.contactMeta[n]?.availability === 'invisible') return false;
  const fromServer = coerceOnlineFlag(serverOnline);
  if (fromServer === true) return true;
  // Physically in the same BC room right now?
  if (isCharacterLoadedForMember(n)) return true;
  // bcOnlineSet is populated by processFriendListData with *only* online friends.
  if (state.bcOnlineSet.has(n)) return true;
  // bcFriendCache and contactMeta.bcOnline are also set by processFriendListData.
  const fromFriendCache = coerceOnlineFlag(state.bcFriendCache[n]?.online);
  if (fromFriendCache !== null) return fromFriendCache;
  const fromContactMeta = coerceOnlineFlag(state.contactMeta[n]?.bcOnline);
  if (fromContactMeta !== null) return fromContactMeta;
  if (fromServer !== null) return fromServer;
  return !!state.contactMeta[n]?.online;
}
