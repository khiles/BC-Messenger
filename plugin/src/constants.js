export const SERVER  = 'https://messenger.vo-p.com';
export const WS_URL  = 'wss://messenger.vo-p.com/ws';
export const SCRIPT_VERSION = '1.2.0';
export const UPDATE_URL = 'https://raw.githubusercontent.com/khiles/BC-Messenger/main/bc-offline-messenger.user.js';
export const STORE_BASE = 'bcm_';
export const DB_NAME = 'BCOfflineMessenger';
export const DB_VER  = 5;
export const DEFAULT_AWAY_TIMEOUT_MINS = 10;
export const MIN_AWAY_TIMEOUT_MINS = 1;
export const MAX_AWAY_TIMEOUT_MINS = 240;
export const MIN_ACTIVITY_DEBOUNCE_MS = 1000;
export const MAX_REACTION_KEY_BODY_LENGTH = 80;
export const MAX_STICKER_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_NOTIFICATION_BODY_LENGTH = 160;
export const MAX_QUOTE_TEXT_LENGTH = 200;
export const MAX_STATUS_LENGTH = 60;
export const MAX_DISCORD_WEBHOOK_LENGTH = 500;
export const MAX_REPORT_HISTORY_ITEMS = 30;
export const MAX_STARRED_PANEL_ITEMS = 300;
export const CONTEXT_MENU_ITEM_HEIGHT = 32;
export const CONTEXT_MENU_TOTAL_VERTICAL_PADDING = 12;
export const INITIAL_RECONNECT_RETRY_MS = 15000;
export const MAX_RECONNECT_RETRY_MS = 120000;
export const LOCAL_SEND_BYPASS_TTL_MS = 5000;
export const MAX_LOCAL_SEND_BYPASS_KEYS = 64;
export const BCM_QUOTE_PREFIX = '[BCMQUOTE]';
export const BCM_MSG_PREFIX = '[BCMMSG]';
export const E2E_PREFIX     = '[BCME2E]';    // legacy DM (no AAD)
export const E2E_V2_PREFIX  = '[BCME2Ev2]';  // DM with AAD
export const E2E_V2G_PREFIX = '[BCME2Ev2g]'; // group with AAD
export const VIRT_PAGE_SIZE = 80;
export const DISAPPEAR_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 60 * 60 * 1000, label: '1h' },
  { value: 6 * 60 * 60 * 1000, label: '6h' },
  { value: 24 * 60 * 60 * 1000, label: '24h' },
  { value: 7 * 24 * 60 * 60 * 1000, label: '7d' },
];
