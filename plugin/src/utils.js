// Pure helpers with no module-state dependencies. Kept separate from main.js so
// they can be reused by future module extractions without dragging in state.

import { MAX_QUOTE_TEXT_LENGTH, BCM_MSG_PREFIX, BCM_QUOTE_PREFIX } from './constants.js';

export function hashBypassContent(content) {
  const text = String(content ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

export function deriveStatusFromGroupReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const total = Number(receipt.totalRecipients || 0);
  const read = Number(receipt.readCount || 0);
  const delivered = Number(receipt.deliveredCount || 0);
  if (total > 0 && read >= total) return 'read';
  if (delivered > 0) return 'delivered';
  return 'sent';
}

export function encodeMessagePayload(content, quote, options = {}) {
  const text = String(content ?? '');
  const spoiler = !!options.spoiler;
  const oneTime = !!options.oneTime;
  const hasQuote = !!quote;
  if (!text) return text;
  if (!hasQuote && !spoiler && !oneTime) return text;
  const payload = {
    text,
    spoiler,
    oneTime,
  };
  if (hasQuote) {
    payload.quote = {
      senderNum: quote.senderNum ?? null,
      senderName: String(quote.senderName ?? ''),
      text: String(quote.text ?? '').slice(0, MAX_QUOTE_TEXT_LENGTH),
    };
  }
  try {
    return `${BCM_MSG_PREFIX}${JSON.stringify(payload)}`;
  } catch {
    return text;
  }
}

export function parseMessagePayload(content) {
  const raw = String(content ?? '');
  if (raw.startsWith(BCM_MSG_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(BCM_MSG_PREFIX.length));
      const text = String(parsed?.text ?? '');
      const q = parsed?.quote;
      return {
        text,
        quote: q ? {
          senderNum: q.senderNum ?? null,
          senderName: String(q.senderName ?? ''),
          text: String(q.text ?? ''),
        } : null,
        spoiler: !!parsed?.spoiler,
        oneTime: !!parsed?.oneTime,
        poll: parsed?.poll && typeof parsed.poll === 'object' ? parsed.poll : null,
      };
    } catch {
      return { text: raw, quote: null, spoiler: false, oneTime: false, poll: null };
    }
  }
  if (!raw.startsWith(BCM_QUOTE_PREFIX)) return { text: raw, quote: null, spoiler: false, oneTime: false, poll: null };
  try {
    const parsed = JSON.parse(raw.slice(BCM_QUOTE_PREFIX.length));
    const text = String(parsed?.text ?? '');
    const q = parsed?.quote;
    if (!q || !text) return { text: raw, quote: null, spoiler: false, oneTime: false, poll: null };
    return {
      text,
      quote: {
        senderNum: q.senderNum ?? null,
        senderName: String(q.senderName ?? ''),
        text: String(q.text ?? ''),
      },
      spoiler: false,
      oneTime: false,
      poll: null,
    };
  } catch {
    return { text: raw, quote: null, spoiler: false, oneTime: false, poll: null };
  }
}

export function escapeRegExp(text) {
  return String(text ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseJSONOr(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function makeClientSecret() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

export function isServerBackedMessageKey(key) {
  return /^sid:\d+$/.test(String(key ?? '')) || String(key ?? '').startsWith('gref:');
}
