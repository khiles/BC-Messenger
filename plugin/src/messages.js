// Send paths for DMs and group messages, plus the protocol-message filter used
// by the receive path. Receive handlers (onIncomingMessage / onIncomingGroupMessage)
// still live in main.js because they touch dialog UI, toasts, and the unread badge.

import { state } from './state.js';
import { E2E_V2_PREFIX } from './constants.js';
import { httpPost, withAuthRetry } from './api.js';
import { getGroup } from './storage.js';
import {
  isE2EReady, getContactSharedKey, getSelfSharedKey,
  encryptE2E, dmAAD, groupAAD, getAllowPlaintext,
} from './crypto.js';

export function isProtocolMessage(content) {
  if (!content || typeof content !== 'string') return false;
  const t = content.trim();
  if (t === 'ReqRoom') return true;
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === 'object' && (obj.Name && 'Nickname' in obj)) return true;
    } catch {}
  }
  return false;
}

export function normalizeGroupMembers(members) {
  return (Array.isArray(members) ? members : [])
    .map(m => {
      if (m && typeof m === 'object') {
        const n = Number(m.member_number ?? m.memberNumber ?? m.memberNum ?? m.id);
        if (!n) return null;
        return { member_number: n, role: String(m.role || 'member') };
      }
      const n = Number(m);
      if (!n) return null;
      return { member_number: n, role: 'member' };
    })
    .filter(Boolean);
}

export async function sendToServer(recipientNum, content, alreadyDelivered = false, parentMessageRef = null, whisperDelivered = false) {
  let finalContent = content;
  if (isE2EReady()) {
    const r = await getContactSharedKey(recipientNum).catch(() => ({ key: null, status: 'no-key' }));
    if (r.status === 'ok' && r.key) {
      const aad = dmAAD(state.memberNumber, Number(recipientNum));
      finalContent = E2E_V2_PREFIX + await encryptE2E(r.key, content, aad);
    } else if (r.status === 'changed') {
      throw new Error(`The encryption key for member #${recipientNum} has changed. Open the chat and accept (or reject) the new key before sending.`);
    } else if (r.status === 'no-key') {
      if (!getAllowPlaintext(recipientNum)) {
        const ok = confirm(`Member #${recipientNum} hasn't published an encryption key.\n\nSending this message UNENCRYPTED will let the server see it.\n\nSend as plaintext anyway?\n(OK = send once, Cancel = abort. Use the lock menu in the chat header to remember this choice for the contact.)`);
        if (!ok) throw new Error('Send aborted: recipient has no encryption key.');
      }
    }
  }
  return withAuthRetry(() => httpPost('/api/messages', { recipientNumber: recipientNum, content: finalContent, alreadyDelivered, parentMessageRef, whisperDelivered }));
}

export async function sendGroupMessage(groupId, content, mentionTargets = [], parentMessageRef = null) {
  if (isE2EReady()) {
    const group = state.groups[groupId] || await getGroup(groupId);
    const members = normalizeGroupMembers(group?.members ?? []);
    if (members.length) {
      const aad = groupAAD(groupId, state.memberNumber);
      const ciphertexts = {};
      const missing = [];
      let blockedChanged = null;
      for (const m of members) {
        const num = Number(m.member_number);
        if (!num) continue;
        let key = null;
        if (num === state.memberNumber) {
          key = await getSelfSharedKey();
        } else {
          const r = await getContactSharedKey(num).catch(() => ({ key: null, status: 'no-key' }));
          if (r.status === 'changed') { blockedChanged = num; break; }
          key = r.key;
        }
        if (!key) { missing.push(num); continue; }
        ciphertexts[num] = await encryptE2E(key, content, aad);
      }
      if (blockedChanged) {
        throw new Error(`Group send blocked: member #${blockedChanged}'s encryption key has changed. Open their DM and accept or reject the new key first.`);
      }
      if (missing.length) {
        const ok = confirm(
          `${missing.length} group member(s) have no encryption key on record (#${missing.join(', #')}).\n\n` +
          `Their copy of this message will be unreadable; everyone else will see it encrypted.\n\n` +
          `Send anyway?`,
        );
        if (!ok) throw new Error('Group send aborted: some members have no encryption key.');
      }
      return withAuthRetry(() => httpPost(`/api/groups/${groupId}/messages`, { ciphertexts, mentionTargets, parentMessageRef }));
    }
  }
  return withAuthRetry(() => httpPost(`/api/groups/${groupId}/messages`, { content, mentionTargets, parentMessageRef }));
}
