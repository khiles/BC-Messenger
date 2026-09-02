  'use strict';

  import {
    SERVER, WS_URL, SCRIPT_VERSION, UPDATE_URL,
    STORE_BASE, DB_NAME, DB_VER,
    DEFAULT_AWAY_TIMEOUT_MINS, MIN_AWAY_TIMEOUT_MINS, MAX_AWAY_TIMEOUT_MINS,
    MIN_ACTIVITY_DEBOUNCE_MS,
    MAX_REACTION_KEY_BODY_LENGTH, MAX_NOTIFICATION_BODY_LENGTH,
    MAX_QUOTE_TEXT_LENGTH, MAX_STATUS_LENGTH, MAX_DISCORD_WEBHOOK_LENGTH,
    MAX_STICKER_UPLOAD_BYTES,
    MAX_REPORT_HISTORY_ITEMS, MAX_STARRED_PANEL_ITEMS,
    CONTEXT_MENU_ITEM_HEIGHT, CONTEXT_MENU_TOTAL_VERTICAL_PADDING,
    INITIAL_RECONNECT_RETRY_MS, MAX_RECONNECT_RETRY_MS,
    LOCAL_SEND_BYPASS_TTL_MS, MAX_LOCAL_SEND_BYPASS_KEYS,
    BCM_QUOTE_PREFIX, BCM_MSG_PREFIX,
    E2E_PREFIX, E2E_V2_PREFIX, E2E_V2G_PREFIX,
    VIRT_PAGE_SIZE, DISAPPEAR_OPTIONS,
  } from './constants.js';
  import { el, openModal, openAlert, openConfirm, openPrompt, openSelect, tickMark } from './dom.js';
  import { STATIC_THEMES, buildCustomTheme } from './themes.js';
  import {
    setAuthHeaderProvider, setRegisterFn, withAuthRetry,
    httpGet, httpPost, httpPut, httpDelete, fetchLinkPreview,
    uploadSticker, fetchStickers, gifSearch,
    getGroupJoinPreview, requestGroupJoin, createGroupInvite,
    getGroupJoinRequests, acceptGroupJoinRequest, declineGroupJoinRequest,
  } from './api.js';
  import {
    encryptE2E, decryptE2E, dmAAD, groupAAD,
    initCryptoContext, initE2E, isE2EReady,
    getContactSharedKey, getSelfSharedKey,
    acceptKeyChange, markContactVerified,
    getPinnedFor, getAllowPlaintext, setAllowPlaintext,
    safetyNumberFor, decryptGroupContent,
  } from './crypto.js';
  import {
    initStorageContext, getDb, closeStorage, deleteCurrentDatabase, ensureDbReady,
    getMessages, getAllContacts, getAllStoredMessages,
    getGroupMessages, getAllGroups, getGroup, saveGroup, deleteGroup,
    deleteConversation,
    updateMsgStatus, updateMessageServerId,
    getAllKnownServerIds, findDuplicateLocalMessage,
    getSyncCursor, setSyncCursor,
  } from './storage.js';
  import {
    getFriendName, iterateFriendNames, coerceOnlineFlag,
    getFriendEntryOnlineFlag, parseFriendMemberNumber, isCharacterLoadedForMember,
    isMemberNumberLikeName, getSafeDisplayName,
    parseBCFriendEntry, getBCFriendEntries, memberAvailClass, isMemberOnlineForUi,
  } from './bc-integration.js';
  import { state } from './state.js';
  import { isProtocolMessage, normalizeGroupMembers, sendToServer, sendGroupMessage } from './messages.js';
  import { DIALOG_CSS } from './styles.js';
  import {
    hashBypassContent, deriveStatusFromGroupReceipt,
    encodeMessagePayload, parseMessagePayload, escapeRegExp,
    parseJSONOr, makeClientSecret, isServerBackedMessageKey,
  } from './utils.js';
  state.STORE = `${STORE_BASE}default_`;


  state.toastsEnabled = GM_getValue(state.STORE + 'toasts', true);
  state.afkEnabled = GM_getValue(state.STORE + 'afk', false);
  state.afkMessage = GM_getValue(state.STORE + 'afkMessage', 'I\'m currently away. I\'ll respond when I\'m back!');

  function parseAwayTimeoutMins(value) {
    const parsed = Number(value);

    const safe = Number.isFinite(parsed) ? parsed : DEFAULT_AWAY_TIMEOUT_MINS;
    return Math.max(MIN_AWAY_TIMEOUT_MINS, Math.min(MAX_AWAY_TIMEOUT_MINS, safe));
  }

  // Reactions are stored as { [messageRef]: { [emoji]: [memberNumbers] } }.
  // Older versions stored a single emoji string per message; normalize both
  // shapes so stored data and server pushes are interchangeable.
  function normalizeReactionMap(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [ref, value] of Object.entries(raw)) {
      if (!ref || !value) continue;
      if (typeof value === 'string') {
        out[ref] = { [value]: [] };
      } else if (typeof value === 'object') {
        const inner = {};
        for (const [emoji, members] of Object.entries(value)) {
          if (!emoji) continue;
          inner[emoji] = Array.isArray(members) ? members.map(Number).filter(Boolean) : [];
        }
        if (Object.keys(inner).length) out[ref] = inner;
      }
    }
    return out;
  }

  function loadReactionMap() {
    return normalizeReactionMap(parseJSONOr(GM_getValue(state.STORE + 'reactions', '{}'), {}));
  }

  // Which emoji did *I* react with on this message, if any?
  function myReactionEmoji(reactionMap, memberNum = null) {
    const num = memberNum == null ? state.memberNumber : memberNum;
    if (!num || !reactionMap || typeof reactionMap !== 'object') return '';
    for (const [emoji, members] of Object.entries(reactionMap)) {
      if (Array.isArray(members) && members.includes(num)) return emoji;
    }
    return '';
  }

  function getStorePrefixForAccount(accountNum) {
    const n = Number(accountNum);
    return Number.isFinite(n) && n > 0 ? `${STORE_BASE}${n}_` : `${STORE_BASE}default_`;
  }

  function getDbNameForAccount(accountNum) {
    const n = Number(accountNum);
    return Number.isFinite(n) && n > 0 ? `${DB_NAME}_${n}` : `${DB_NAME}_default`;
  }

  state.clientSecret = '';
  state.activeDbName = getDbNameForAccount(null);

  function applyAccountScope(accountNum) {
    state.STORE = getStorePrefixForAccount(accountNum);
    const nextDbName = getDbNameForAccount(accountNum);
    if (state.activeDbName !== nextDbName) {
      closeStorage();
      state.activeDbName = nextDbName;
    }
  }

  function loadAccountScopedSettings() {
    state.toastsEnabled = GM_getValue(state.STORE + 'toasts', true);
    state.afkEnabled = GM_getValue(state.STORE + 'afk', false);
    state.afkMessage = GM_getValue(state.STORE + 'afkMessage', 'I\'m currently away. I\'ll respond when I\'m back!');

    let secret = String(GM_getValue(state.STORE + 'secret', '') || '').trim();
    if (!secret) {
      secret = makeClientSecret();
      GM_setValue(state.STORE + 'secret', secret);
    }
    state.clientSecret = secret;

    state.mutedContacts = new Set(parseJSONOr(GM_getValue(state.STORE + 'muted', '[]'), []));
    state.pinnedContacts = new Set(parseJSONOr(GM_getValue(state.STORE + 'pinned', '[]'), []));
    state.currentTheme = GM_getValue(state.STORE + 'theme', 'light');
    state.soundEnabled = GM_getValue(state.STORE + 'sound', true);
    state.systemNotificationsEnabled = GM_getValue(state.STORE + 'systemNotifications', false);
    state.sendReadReceipts = GM_getValue(state.STORE + 'readReceipts', true);
    state.sendTypingIndicators = GM_getValue(state.STORE + 'typingIndicators', true);
    state.showTypingIndicators = GM_getValue(state.STORE + 'showTypingIndicators', true);
    state.hideLastSeenFromOthers = GM_getValue(state.STORE + 'hideLastSeenFromOthers', false);
    state.discordWebhookEnabled = GM_getValue(state.STORE + 'discordWebhookEnabled', true);
    state.customStatus = String(GM_getValue(state.STORE + 'status', '') || '').slice(0, MAX_STATUS_LENGTH);
    state.discordWebhookUrl = String(GM_getValue(state.STORE + 'discordWebhook', '') || '').slice(0, MAX_DISCORD_WEBHOOK_LENGTH);
    state.fontSize = GM_getValue(state.STORE + 'fontSize', 'medium');
    state.awayTimeoutMins = parseAwayTimeoutMins(GM_getValue(state.STORE + 'awayMins', DEFAULT_AWAY_TIMEOUT_MINS));
    state.quickReplies = parseJSONOr(GM_getValue(state.STORE + 'quickreplies', JSON.stringify(['Be right back','On my way','Busy right now','❤️','Can we talk later?'])), ['Be right back','On my way','Busy right now','❤️','Can we talk later?']);
    state.messageTemplates = parseJSONOr(GM_getValue(state.STORE + 'templates', '[]'), []);
    state.contactNotes = parseJSONOr(GM_getValue(state.STORE + 'notes', '{}'), {});
    state.contactAvatarUrls = parseJSONOr(GM_getValue(state.STORE + 'avatarUrls', '{}'), {});
    state.msgReactions = loadReactionMap();
    state.starredMessages = new Set(parseJSONOr(GM_getValue(state.STORE + 'starred', '[]'), []));
    state.disappearingByConversation = parseJSONOr(GM_getValue(state.STORE + 'disappearing', '{}'), {});
    state.readReceiptDisabledConversations = parseJSONOr(GM_getValue(state.STORE + 'readReceiptsDisabledConversations', '{}'), {});
    state.unread = parseJSONOr(GM_getValue(state.STORE + 'unread', '{}'), {});
    state.groupUnread = parseJSONOr(GM_getValue(state.STORE + 'groupUnread', '{}'), {});
    state.blockedMembers = new Set();
    GM_setValue(state.STORE + 'recentBlockedBy', '[]');

    state.profileBio = '';
    state.profilePronouns = '';
    state.profileTimezone = '';
    state.profileBadges = [];
    state.profilePrivacy = { bio: 'public', pronouns: 'public', timezone: 'contacts', badges: 'public' };
    state.trustedContacts = new Set();

    state.availabilityState = GM_getValue(state.STORE + 'availability', 'online');
    state.dndStartTime = GM_getValue(state.STORE + 'dndStart', '');
    state.dndEndTime = GM_getValue(state.STORE + 'dndEnd', '');
    state.offlineCollapsed = GM_getValue(state.STORE + 'offlineCollapsed', false);
    state.onlineCollapsed = GM_getValue(state.STORE + 'onlineCollapsed', false);

    state.contactNotifyOverrides = parseJSONOr(GM_getValue(state.STORE + 'notifyOverrides', '{}'), {});
  }


  state.memberNumber    = null;
  state.memberName      = null;
  state.ws              = null;
  state.loggedIn        = false;
  state.selectedContact = null;
  state.unread          = {};
  state.contactMeta     = {};
  state.bcFriendCache   = {};
  state.bcOnlineSet     = new Set();
  // IndexedDB connection + pure CRUD live in ./storage.js — accessed via ensureDbReady() / getDb().

  state.origTitle             = document.title;
  state.mutedContacts         = new Set(JSON.parse(GM_getValue(state.STORE + 'muted',  '[]')));
  state.pinnedContacts        = new Set(JSON.parse(GM_getValue(state.STORE + 'pinned', '[]')));
  state.draftSaveTimers       = {};
  state.typingTimers          = {};
  state.typingSendTimer       = null;
  state.lobbyOpen             = false;
  state.lobbySearch           = '';
  state.lobbyRooms            = null;
  state.roomTabOpen           = false;
  state.friendsPanelOpen      = false;
  state.friendsPanelSearch    = '';
  state.roomHookRegistered    = false;
  state.friendHookRegistered  = false;
  state.sendMode              = 'beep';
  const localSendBypassUntil = new Map();
  state.emojiPanelEl          = null;
  state.ctxMenuEl             = null;
  state.lastRenderedMsgSentAt = 0;
  state.virtOffset = 0;
  // E2E state lives in ./crypto.js — wired up at boot via initCryptoContext.
  state.keyShortcutRegistered = false;
  state.resolvedAttempts      = new Set();

  state.currentTheme  = GM_getValue(state.STORE + 'theme', 'light');
  state.soundEnabled  = GM_getValue(state.STORE + 'sound', true);
  state.systemNotificationsEnabled = GM_getValue(state.STORE + 'systemNotifications', false);
  state.sendReadReceipts = GM_getValue(state.STORE + 'readReceipts', true);
  state.sendTypingIndicators = GM_getValue(state.STORE + 'typingIndicators', true);
  state.showTypingIndicators = GM_getValue(state.STORE + 'showTypingIndicators', true);
  state.hideLastSeenFromOthers = GM_getValue(state.STORE + 'hideLastSeenFromOthers', false);
  state.discordWebhookEnabled = GM_getValue(state.STORE + 'discordWebhookEnabled', true);
  state.customStatus = String(GM_getValue(state.STORE + 'status', '') || '').slice(0, MAX_STATUS_LENGTH);
  state.discordWebhookUrl = String(GM_getValue(state.STORE + 'discordWebhook', '') || '').slice(0, MAX_DISCORD_WEBHOOK_LENGTH);
  state.fontSize      = GM_getValue(state.STORE + 'fontSize', 'medium');
  state.compactMode   = !!GM_getValue(state.STORE + 'compact', false);
  state.beepHideMode  = GM_getValue(state.STORE + 'beepHideMode', 0);
  state.pinnedRooms   = JSON.parse(GM_getValue(state.STORE + 'pinnedRooms', '[]') || '[]');
  state.awayTimeoutMins = parseAwayTimeoutMins(GM_getValue(state.STORE + 'awayMins', DEFAULT_AWAY_TIMEOUT_MINS));
  state.quickReplies      = JSON.parse(GM_getValue(state.STORE + 'quickreplies', JSON.stringify(['Be right back','On my way','Busy right now','❤️','Can we talk later?'])));
  state.messageTemplates  = [];
  state.contactNotes  = JSON.parse(GM_getValue(state.STORE + 'notes', '{}'));
  state.contactAvatarUrls = JSON.parse(GM_getValue(state.STORE + 'avatarUrls', '{}'));
  state.contactTags   = JSON.parse(GM_getValue(state.STORE + 'tags', '{}'));
  state.activeLabelFilter = GM_getValue(state.STORE + 'activeLabel', '');
  state.msgReactions = loadReactionMap();
  state.starredMessages = new Set(JSON.parse(GM_getValue(state.STORE + 'starred', '[]')));
  state.disappearingByConversation = JSON.parse(GM_getValue(state.STORE + 'disappearing', '{}'));
  state.readReceiptDisabledConversations = parseJSONOr(GM_getValue(state.STORE + 'readReceiptsDisabledConversations', '{}'), {});
  state.blockedMembers = new Set();
  state.notesOpen     = false;
  state.notesSaveTimer = null;
  state.syncedPrefsSaveTimer = null;
  state.awayTimer     = null;
  state.isAway        = false;
  state.awayActivityLast = Date.now();
  state.awayActivityRegistered = false;
  state.reactionPanelEl = null;
  state.qrPanelEl     = null;
  state.msgSearchOpen = false;
  state.msgSearchHits = [];
  state.msgSearchIdx  = 0;
  state.currentQuote  = null;
  state.currentParentMessageRef = null;
  state.composeSpoiler = false;
  state.composeOneTime = false;
  state.starredPanelOpen = false;
  state.collectionsPanelOpen = false;
  state.unreadPanelOpen = false;
  state.mediaPanelOpen = false;
  state.disappearTimers = {};
  state.oneTimeViewerEl = null;
  state.pinnedMessages  = JSON.parse(GM_getValue(state.STORE + 'pinnedMessages', '{}'));
  state.scheduledMessages = JSON.parse(GM_getValue(state.STORE + 'scheduled', '[]'));
  state.scheduledTimers = {};

  state.groups        = {};
  state.selectedGroup = null;
  state.groupUnread   = {};
  state.afkReplySent  = new Set();
  state.pendingMentions  = [];
  state.mentionPanelEl   = null;
  state.groupLastMsgCache = {};
  state.msgPageOffsets   = {};
  state.sidebarSearchToken = 0;

  state.profileBio = '';
  state.profilePronouns = '';
  state.profileTimezone = '';
  state.profileBadges = [];
  state.profilePrivacy = { bio: 'public', pronouns: 'public', timezone: 'contacts', badges: 'public' };
  state.trustedContacts = new Set();
  state.availabilityState = 'online';
  state.dndStartTime = '';
  state.dndEndTime = '';
  state.previousAvailability = 'online';
  state.offlineCollapsed = false;
  state.onlineCollapsed = false;
  state.onlineSort = GM_getValue(state.STORE + 'onlineSort', 'recent');
  state.conversationFolders = {};
  state.activeFolderFilter  = 'all';
  state.contactNotifyOverrides = {};
  state.keywordAlerts      = GM_getValue(state.STORE + 'keywordAlerts', []);
  state.reminderItems      = GM_getValue(state.STORE + 'reminders', []);
  state.autoResponderRules = GM_getValue(state.STORE + 'autoRules', []);
  state.selectionMode      = false;
  state.selectedMsgs       = new Set();


  // BC integration helpers (display-name normalisers, friend-list parsers, online checks)
  // live in ./bc-integration.js.

  function localSendBypassKey(kind, memberNum, content) {
    return `${kind}|${Number(memberNum) || 0}|${hashBypassContent(content)}`;
  }

  function markLocalSendBypass(kind, memberNum, content) {
    const now = Date.now();
    if (localSendBypassUntil.size > MAX_LOCAL_SEND_BYPASS_KEYS) {
      for (const [k, exp] of localSendBypassUntil.entries()) {
        if (exp <= now) localSendBypassUntil.delete(k);
      }
    }
    if (localSendBypassUntil.size >= MAX_LOCAL_SEND_BYPASS_KEYS) {
      let oldestKey = null;
      let oldestExp = Infinity;
      for (const [k, exp] of localSendBypassUntil.entries()) {
        if (exp < oldestExp) {
          oldestExp = exp;
          oldestKey = k;
        }
      }
      if (oldestKey) localSendBypassUntil.delete(oldestKey);
    }
    localSendBypassUntil.set(localSendBypassKey(kind, memberNum, content), now + LOCAL_SEND_BYPASS_TTL_MS);
  }

  function consumeLocalSendBypass(kind, memberNum, content) {
    const key = localSendBypassKey(kind, memberNum, content);
    const exp = localSendBypassUntil.get(key);
    if (!exp || exp < Date.now()) {
      localSendBypassUntil.delete(key);
      return false;
    }
    localSendBypassUntil.delete(key);
    return true;
  }

  function saveMessage(partnerNum, senderNum, content, sentAt, fromUs, serverId = null, status = null, deleted = false, parentMessageRef = null) {
    return ensureDbReady().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(['messages', 'contacts'], 'readwrite');
      const msg = { partnerNum, senderNum, content, sentAt, fromUs, serverId, status, deleted: !!deleted, parentMessageRef };
      if (!msg.deleted) {
        const cfg = getDisappearConfigForConversation(`c_${partnerNum}`);
        const sentTs = Number(sentAt || Date.now());
        if (cfg.ttlMs > 0 && sentTs > 0 && (!cfg.enabledAt || sentTs >= cfg.enabledAt)) {
          msg.disappearAt = sentTs + cfg.ttlMs;
        }
      }
      const r   = tx.objectStore('messages').add(msg);
      r.onsuccess = () => {
        msg.id = r.result;
        const safe = getSafeDisplayName(state.contactMeta[partnerNum]?.name, partnerNum, '');
        const name = safe || `Member #${partnerNum}`;
        tx.objectStore('contacts').put({ memberNum: partnerNum, memberName: name, lastMsg: content, lastMsgAt: sentAt });
        resolve(msg);
      };
      r.onerror = () => reject(r.error);
    }));
  }

  function upsertContact(memberNum, name) {
    if (!state.contactMeta[memberNum]) state.contactMeta[memberNum] = {};
    if (name) state.contactMeta[memberNum].name = name;
    const db = getDb();
    if (!db) return;
    try {
      const tx  = db.transaction('contacts', 'readwrite');
      const st  = tx.objectStore('contacts');
      const req = st.get(memberNum);
      req.onsuccess = () => {
        const row = req.result ?? { memberNum, lastMsg: '', lastMsgAt: 0 };
        if (name) row.memberName = name;
        st.put(row);
      };
      tx.onerror = () => {};
    } catch {}
  }

  function saveGroupMessage(groupId, senderNum, senderName, content, sentAt, fromUs, serverId = null, status = null, deleted = false, groupMessageRef = null, receipt = null) {
    return ensureDbReady().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction('messages', 'readwrite');
      const msg = { groupId, senderNum, senderName, content, sentAt, fromUs, serverId, status, messageType: 'group', deleted: !!deleted, groupMessageRef: groupMessageRef || null };
      if (receipt && typeof receipt === 'object') {
        msg.groupTotalRecipients = Number(receipt.totalRecipients || 0);
        msg.groupDeliveredCount = Number(receipt.deliveredCount || 0);
        msg.groupReadCount = Number(receipt.readCount || 0);
      }
      if (!msg.deleted) {
        const cfg = getDisappearConfigForConversation(`g_${groupId}`);
        const sentTs = Number(sentAt || Date.now());
        if (cfg.ttlMs > 0 && sentTs > 0 && (!cfg.enabledAt || sentTs >= cfg.enabledAt)) {
          msg.disappearAt = sentTs + cfg.ttlMs;
        }
      }
      const r   = tx.objectStore('messages').add(msg);
      r.onsuccess = () => {
        msg.id = r.result;
        resolve(msg);
      };
      r.onerror = () => reject(r.error);
    }));
  }

  function updateGroupReceiptForMessage(msg, receipt, groupMessageRef = null) {
    if (!msg || !receipt) return { ...(msg || {}) };
    const status = deriveStatusFromGroupReceipt(receipt) || msg.status || null;
    return {
      ...msg,
      status,
      groupMessageRef: groupMessageRef || msg.groupMessageRef || null,
      groupTotalRecipients: Number(receipt.totalRecipients || 0),
      groupDeliveredCount: Number(receipt.deliveredCount || 0),
      groupReadCount: Number(receipt.readCount || 0),
    };
  }

  function updateGroupMessageReceipt(groupMessageRef, senderMessageId, receipt) {
    if ((!groupMessageRef && !senderMessageId) || !receipt) return Promise.resolve(null);
    return ensureDbReady().then(db => new Promise(resolve => {
      const tx = db.transaction('messages', 'readwrite');
      const st = tx.objectStore('messages');
      const applyAndResolve = row => {
        if (!row) return resolve(null);
        const updated = updateGroupReceiptForMessage(row, receipt, groupMessageRef);
        st.put(updated);
        if ((state.selectedGroup && updated.groupId === state.selectedGroup) || (state.selectedContact && updated.partnerNum === state.selectedContact && !state.selectedGroup)) {
          redrawCurrentConversation();
        } else {
          refreshContactList();
        }
        resolve(updated);
      };
      if (senderMessageId) {
        const req = st.index('serverId').get(senderMessageId);
        req.onsuccess = () => {
          if (req.result) return applyAndResolve(req.result);
          if (!groupMessageRef) return resolve(null);
          const fallbackReq = st.index('groupMessageRef').get(groupMessageRef);
          fallbackReq.onsuccess = () => applyAndResolve(fallbackReq.result || null);
          fallbackReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
        return;
      }
      const req = st.index('groupMessageRef').get(groupMessageRef);
      req.onsuccess = () => applyAndResolve(req.result || null);
      req.onerror = () => resolve(null);
    }));
  }

  function updateMessageContentByServerId(serverId, content, isEdited = false) {
    if (!serverId) return Promise.resolve(null);
    return ensureDbReady().then(db => new Promise(resolve => {
      const tx = db.transaction('messages', 'readwrite');
      const req = tx.objectStore('messages').index('serverId').get(serverId);
      req.onsuccess = () => {
        if (!req.result) return resolve(null);
        const updated = { ...req.result, content: String(content ?? ''), edited: isEdited ? true : !!req.result.edited };
        tx.objectStore('messages').put(updated);
        if ((state.selectedContact && updated.partnerNum === state.selectedContact && !state.selectedGroup) || (state.selectedGroup && updated.groupId === state.selectedGroup)) {
          redrawCurrentConversation();
        } else {
          refreshContactList();
        }
        resolve(updated);
      };
      req.onerror = () => resolve(null);
    }));
  }

  function markMessageDeletedByServerId(serverId) {
    if (!serverId) return Promise.resolve(null);
    return ensureDbReady().then(db => new Promise(resolve => {
      const tx = db.transaction('messages', 'readwrite');
      const req = tx.objectStore('messages').index('serverId').get(serverId);
      req.onsuccess = () => {
        if (!req.result) return resolve(null);
        const updated = { ...req.result, deleted: true, content: '' };
        tx.objectStore('messages').put(updated);
        if ((state.selectedContact && updated.partnerNum === state.selectedContact && !state.selectedGroup) || (state.selectedGroup && updated.groupId === state.selectedGroup)) {
          redrawCurrentConversation();
        } else {
          refreshContactList();
        }
        resolve(updated);
      };
      req.onerror = () => resolve(null);
    }));
  }


  setAuthHeaderProvider(() => `Bearer ${state.memberNumber}:${state.clientSecret}`);
  setRegisterFn(register);
  initCryptoContext({ getStore: () => state.STORE, getMemberNumber: () => state.memberNumber });
  initStorageContext({ getActiveDbName: () => state.activeDbName });

  async function register() {
    try {
      const r = await httpPost('/api/register', {
        memberNumber: state.memberNumber,
        memberName: state.memberName,
        clientSecret: state.clientSecret,
        status: state.customStatus,
        discordWebhook: state.discordWebhookEnabled ? state.discordWebhookUrl : '',
        hideLastSeen: state.hideLastSeenFromOthers,
      }, false);
      return r.success === true;
    } catch (e) {
      console.error('[BCM] Register failed:', e.message);
      return false;
    }
  }

  async function getStatus(num) {
    try { return await httpGet(`/api/status/${num}`); }
    catch { return null; }
  }

  // ── E2E encryption ────────────────────────────────────────────────────────────
  // State, init, contact-key resolution, group-decrypt helper all live in ./crypto.js.

  async function pollBulkRelayStatus() {
    try {
      const nums = Object.keys(state.contactMeta).map(Number).filter(Boolean);
      if (!nums.length) return;
      const r = await httpPost('/api/status/bulk', { memberNumbers: nums });
      if (!r?.online) return;
      let changed = false;
      for (const [key, isOnline] of Object.entries(r.online)) {
        const n = Number(key);
        if (!n) continue;
        if (!state.contactMeta[n]) state.contactMeta[n] = {};
        const prev = state.contactMeta[n].online;
        const next = !!isOnline;
        if (prev !== next) {
          state.contactMeta[n].online = next;
          // Also sync state.bcFriendCache so isMemberOnlineForUi picks it up
          if (state.bcFriendCache[n]) state.bcFriendCache[n].online = next;
          changed = true;
        }
      }
      if (changed && state.loggedIn) refreshContactList();
    } catch {}
  }

  async function getMessageHistory(since = 0, limit = 100) {
    return httpGet(`/api/messages?since=${Math.max(0, Number(since) || 0)}&limit=${Math.min(500, Math.max(1, Number(limit) || 100))}`);
  }

  async function syncHistoryFromServer(limit = 500) {
    const r = await getMessageHistory(0, limit);
    const rows = Array.isArray(r?.messages) ? r.messages : [];
    for (const m of rows) {
      const fromUs = Number(m.sender_number) === Number(state.memberNumber);
      const partnerNum = fromUs ? Number(m.recipient_number) : Number(m.sender_number);
      if (!partnerNum) continue;
      const existing = await getMessages(partnerNum);
      if (existing.some(x => String(x.serverId || '') === String(m.id))) continue;
      let body = String(m.content ?? '');
      if (body.startsWith(E2E_V2_PREFIX) || body.startsWith(E2E_PREFIX)) {
        const r = await getContactSharedKey(partnerNum).catch(() => ({ key: null }));
        if (r?.key) {
          const isV2 = body.startsWith(E2E_V2_PREFIX);
          const ct = body.slice((isV2 ? E2E_V2_PREFIX : E2E_PREFIX).length);
          const aad = isV2 ? dmAAD(Number(m.sender_number), Number(m.recipient_number)) : null;
          try { body = await decryptE2E(r.key, ct, aad); }
          catch { body = '[🔒 Could not decrypt message]'; }
        } else {
          body = '[🔒 Encrypted message — update your plugin to read this]';
        }
      }
      await saveMessage(partnerNum, Number(m.sender_number), body, Number(m.sent_at || Date.now()), fromUs, m.id, m.read_at ? 'read' : (m.delivered ? 'delivered' : 'sent'), !!m.deleted);
    }
    return rows.length;
  }

  async function syncGroupHistoryFromServer(groupId, limit = 200) {
    const gid = Number(groupId);
    if (!gid) return 0;
    const r = await getGroupMessageHistory(gid, limit, 0);
    const rows = Array.isArray(r?.messages) ? r.messages : [];
    if (!rows.length) return 0;
    const knownIds = await getAllKnownServerIds();
    let added = 0;
    for (const m of rows) {
      const sid = m?.id;
      const senderNum = Number(m?.sender_number || 0);
      const fromUs = senderNum === Number(state.memberNumber);
      const receipt = {
        totalRecipients: Number(m?.total_recipients || 0),
        deliveredCount: Number(m?.delivered_count || 0),
        readCount: Number(m?.read_count || 0),
      };
      const status = fromUs
        ? deriveStatusFromGroupReceipt(receipt)
        : (m?.read_at ? 'read' : (m?.delivered ? 'delivered' : 'sent'));
      if (sid != null && knownIds.has(String(sid))) {
        await updateGroupMessageReceipt(String(m?.group_message_ref || ''), sid, receipt);
        if (status) await updateMsgStatus(sid, status);
        continue;
      }
      let historyContent = String(m?.content ?? '');
      if (historyContent.startsWith(E2E_V2G_PREFIX)) {
        historyContent = await decryptGroupContent(historyContent, senderNum, gid);
      }
      await saveGroupMessage(
        gid,
        senderNum,
        String(m?.sender_name || `Member #${senderNum}`),
        historyContent,
        Number(m?.sent_at || Date.now()),
        fromUs,
        sid ?? null,
        status,
        !!m?.deleted,
        m?.group_message_ref || null,
        receipt,
      );
      if (sid != null) knownIds.add(String(sid));
      added += 1;
    }
    return added;
  }


  async function createGroup(name, memberNumbers) {
    return httpPost('/api/groups', { name, memberNumbers });
  }

  async function getGroups() {
    return httpGet('/api/groups');
  }

  async function getGroupDetails(groupId) {
    return httpGet(`/api/groups/${groupId}`);
  }

  async function addGroupMembers(groupId, memberNumbers) {
    return httpPost(`/api/groups/${groupId}/members`, { memberNumbers });
  }

  async function removeGroupMember(groupId, memberNum) {
    return httpDelete(`/api/groups/${groupId}/members/${memberNum}`);
  }

  async function setGroupMemberRole(groupId, memberNum, role) {
    return httpPost(`/api/groups/${groupId}/members/${memberNum}/role`, { role });
  }

  async function renameGroup(groupId, name) {
    return httpPost(`/api/groups/${groupId}/rename`, { name });
  }

  async function getGroupMessageHistory(groupId, limit = 100, offset = 0) {
    return httpGet(`/api/groups/${groupId}/messages?limit=${limit}&offset=${offset}`);
  }

  async function getSyncedState() {
    return withAuthRetry(() => httpGet('/api/state'));
  }

  async function setServerReaction(messageRef, emoji) {
    return withAuthRetry(() => httpPost('/api/reactions', { messageRef, emoji }));
  }

  async function setServerStar(messageRef, starred) {
    return withAuthRetry(() => httpPost('/api/stars', { messageRef, starred }));
  }

  async function saveServerPreferences(preferences) {
    return withAuthRetry(() => httpPost('/api/preferences', preferences));
  }


  async function blockMember(targetNumber) {
    return httpPost('/api/blocks', { memberNumber: targetNumber });
  }

  async function unblockMember(targetNumber) {
    return httpDelete(`/api/blocks/${targetNumber}`);
  }

  async function getBlocks() {
    return httpGet('/api/blocks');
  }

  async function refreshBlockedMembersCache() {
    if (!state.memberNumber) {
      state.blockedMembers = new Set();
      return state.blockedMembers;
    }
    try {
      const result = await withAuthRetry(() => httpGet('/api/blocks'));
      state.blockedMembers = new Set(
        (Array.isArray(result?.blocks) ? result.blocks : [])
          .map(row => Number(row?.blocked_number || 0))
          .filter(num => num > 0)
      );
    } catch {}
    return state.blockedMembers;
  }

  function isBlockedMember(memberNum) {
    return state.blockedMembers.has(Number(memberNum) || 0);
  }

  async function deleteAllAccountData() {
    return withAuthRetry(() => httpDelete('/api/account/data'));
  }

  async function reportMember(targetNumber, messageId = null, reason = '') {
    return httpPost('/api/reports', { targetNumber, messageId, reason });
  }

  async function getMyReports(limit = MAX_REPORT_HISTORY_ITEMS) {
    const safeLimit = Math.max(1, Math.min(MAX_REPORT_HISTORY_ITEMS, Number(limit) || MAX_REPORT_HISTORY_ITEMS));
    return withAuthRetry(() => httpGet(`/api/reports?limit=${safeLimit}`));
  }

  async function getEditRevisions(messageId) {
    return httpGet(`/api/messages/${messageId}/revisions`);
  }

  async function getSyncCheckpoint() {
    try { return (await httpGet('/api/sync/checkpoint'))?.cursorAt ?? 0; }
    catch { return 0; }
  }

  async function updateSyncCheckpoint(cursorAt) {
    try { await httpPost('/api/sync/checkpoint', { cursorAt }); } catch {}
  }


  async function loadProfile(memberNum) {
    try { return await httpGet(`/api/profile/${memberNum}`); }
    catch { return null; }
  }

  async function saveProfile(profileData) {
    return withAuthRetry(() => httpPut('/api/profile', profileData));
  }

  async function getContactCard(memberNum) {
    try { return await withAuthRetry(() => httpGet(`/api/profile/${memberNum}/contact-card`)); }
    catch { return null; }
  }

  async function loadOwnProfile() {
    if (!state.memberNumber) return;
    const p = await loadProfile(state.memberNumber);
    if (!p) return;
    state.profileBio = p.bio || '';
    state.profilePronouns = p.pronouns || '';
    state.profileTimezone = p.timezone || '';
    state.profileBadges = Array.isArray(p.badges) ? p.badges : [];
    state.profilePrivacy = p.privacy || { bio: 'public', pronouns: 'public', timezone: 'contacts', badges: 'public' };
  }

  async function getTrustedContacts() {
    try {
      const r = await withAuthRetry(() => httpGet('/api/trusted'));
      return Array.isArray(r?.trusted) ? r.trusted : [];
    } catch { return []; }
  }

  async function addTrustedContact(memberNum) {
    return httpPost('/api/trusted', { memberNumber: memberNum });
  }

  async function removeTrustedContact(memberNum) {
    return httpDelete(`/api/trusted/${memberNum}`);
  }

  async function refreshTrustedContactsCache() {
    if (!state.memberNumber) { state.trustedContacts = new Set(); return; }
    const list = await getTrustedContacts();
    state.trustedContacts = new Set(list.map(t => Number(t.memberNumber)).filter(Boolean));
  }


  async function getConversationFolders() {
    try {
      const r = await withAuthRetry(() => httpGet('/api/conversations/folders'));
      return Array.isArray(r?.folders) ? r.folders : [];
    } catch { return []; }
  }

  async function setConversationFolder(targetNum, folder, label = '') {
    return withAuthRetry(() => httpPost(`/api/conversations/${targetNum}/folder`, { folder, label }));
  }

  async function snoozeConversation(targetNum, durationMs) {
    return httpPost(`/api/conversations/${targetNum}/snooze`, { durationMs });
  }


  async function getMessageRequests() {
    try {
      return await withAuthRetry(() => httpGet('/api/message-requests'));
    } catch { return { requests: [] }; }
  }

  async function acceptMessageRequest(requestId) {
    return httpPost(`/api/message-requests/${requestId}/accept`);
  }

  async function declineMessageRequest(requestId) {
    return httpPost(`/api/message-requests/${requestId}/decline`);
  }


  async function getCollections() {
    try { return await withAuthRetry(() => httpGet('/api/collections')); }
    catch { return { collections: [] }; }
  }

  async function getCollectionMessages(name) {
    try { return await httpGet(`/api/collections/${encodeURIComponent(name)}`); }
    catch { return { messages: [] }; }
  }

  async function addToCollection(messageRef, collectionName) {
    return withAuthRetry(() => httpPost('/api/collections', { messageRef, collectionName }));
  }

  async function removeFromCollection(collectionName, messageRef) {
    return httpDelete(`/api/collections/${encodeURIComponent(collectionName)}/messages/${encodeURIComponent(messageRef)}`);
  }

  async function setAvailability(availability, dndStart = '', dndEnd = '') {
    return withAuthRetry(() => httpPut('/api/availability', { availability, dndStart, dndEnd }));
  }


  async function createPoll(messageRef, question, options, durationMinutes = 0) {
    return withAuthRetry(() => httpPost('/api/polls', { messageRef, question, options, durationMinutes }));
  }

  async function votePoll(messageRef, optionIndex) {
    return httpPost(`/api/polls/${encodeURIComponent(messageRef)}/vote`, { optionIndex });
  }

  async function getPoll(messageRef) {
    try { return await httpGet(`/api/polls/${encodeURIComponent(messageRef)}`); }
    catch { return null; }
  }


  function connectWs() {
    if (state.ws) return;
    try { state.ws = new WebSocket(WS_URL); } catch (e) { console.error('[BCM] WS create error:', e); return; }

    state.ws.addEventListener('open', () =>
      state.ws.send(JSON.stringify({ type: 'auth', memberNumber: state.memberNumber, clientSecret: state.clientSecret })));

    state.ws.addEventListener('message', async e => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      if      (msg.type === 'auth_ok')    {
        const cursor = await getSyncCursor();
        if (cursor > 0 && state.ws?.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: 'sync_ack', cursorAt: cursor }));
        }
        syncServerBackedState().catch(() => {});
      }
      else if (msg.type === 'auth_error') { console.error('[BCM] WS auth error'); state.ws.close(); }
      else if (msg.type === 'pending')    {
        const knownIds = await getAllKnownServerIds();
        for (const m of (msg.messages ?? [])) {
          if (m.id != null && knownIds.has(String(m.id))) continue;
          await onIncomingMessage(m.sender_number, m.sender_name, m.content, m.sent_at, m.id, m.parent_message_ref);
          if (m.id != null) knownIds.add(String(m.id));
        }
        const latest = (msg.messages ?? []).reduce((max, m) => Math.max(max, Number(m.sent_at) || 0), 0);
        if (latest > 0) {
          const prev = await getSyncCursor();
          if (latest > prev) {
            await setSyncCursor(latest);
            updateSyncCheckpoint(latest).catch(() => {});
          }
        }
      }
      else if (msg.type === 'message')    { await onIncomingMessage(msg.senderNumber, msg.senderName, msg.content, msg.sentAt, msg.id, msg.parentMessageRef); }
      else if (msg.type === 'message_delivered') {
        const updated = await updateMsgStatus(msg.id, 'delivered');
        if (updated) updateBubbleTick(msg.id, 'delivered');
      }
      else if (msg.type === 'message_read') {
        const updated = await updateMsgStatus(msg.id, 'read', msg.readAt ?? null);
        if (updated) updateBubbleTick(msg.id, 'read', updated.readAt ?? null);
      }
      else if (msg.type === 'message_edited') {
        await updateMessageContentByServerId(msg.id, msg.content ?? '', true);
      }
      else if (msg.type === 'message_deleted') {
        await markMessageDeletedByServerId(msg.id);
      }
      else if (msg.type === 'groups_list') {
        for (const g of (msg.groups ?? [])) {
          g.members = normalizeGroupMembers(g.members);
          state.groups[g.id] = g;
          await saveGroup(g);
        }
        refreshContactList();
      }
      else if (msg.type === 'group_created') {
        const gid = toSafeGroupId(msg.groupId);
        if (!gid) return;
        const g = { id: gid, name: msg.name, createdBy: msg.createdBy, createdAt: msg.createdAt, avatarColor: msg.avatarColor, members: normalizeGroupMembers(msg.members ?? []) };
        state.groups[g.id] = g;
        await saveGroup(g);
        refreshContactList();
      }
      else if (msg.type === 'group_message') {
        const gid = toSafeGroupId(msg.groupId);
        if (!gid) return;
        await onIncomingGroupMessage(gid, msg.senderNumber, msg.senderName, msg.content, msg.sentAt, msg.id, msg.mentioned, msg.mentionTargets, msg.groupMessageRef, msg.receipt);
      }
      else if (msg.type === 'pending_group') {
        const knownIds = await getAllKnownServerIds();
        for (const m of (msg.messages ?? [])) {
          const gid = toSafeGroupId(m.group_id);
          if (!gid) continue;
          if (m.id != null && knownIds.has(String(m.id))) continue;
          await onIncomingGroupMessage(gid, m.sender_number, m.sender_name, m.content, m.sent_at, m.id, false, null, m.group_message_ref, null);
          if (m.id != null) knownIds.add(String(m.id));
        }
      }
      else if (msg.type === 'group_message_receipt') {
        await updateGroupMessageReceipt(msg.groupMessageRef ?? null, msg.senderMessageId ?? null, msg.receipt ?? null);
      }
      else if (msg.type === 'reaction_updated') {
        if (msg.messageRef) {
          if (msg.reactions && typeof msg.reactions === 'object') {
            state.msgReactions[msg.messageRef] = msg.reactions;
          } else {
            // Older server (no full set): apply a single member's change.
            const cur = { ...(state.msgReactions[msg.messageRef] || {}) };
            for (const [emoji, members] of Object.entries(cur)) {
              cur[emoji] = (members || []).filter(n => n !== msg.memberNumber);
              if (!cur[emoji].length) delete cur[emoji];
            }
            if (msg.emoji) (cur[msg.emoji] ||= []).push(msg.memberNumber);
            state.msgReactions[msg.messageRef] = cur;
          }
          persistReactions();
          updateBubbleReactionByKey(msg.messageRef);
          if (state.starredPanelOpen) renderStarredPanel();
        }
      }
      else if (msg.type === 'preferences_updated') {
        applyServerPreferences(msg.preferences ?? null);
      }
      else if (msg.type === 'group_member_added') {
        const gid = toSafeGroupId(msg.groupId);
        if (!gid) return;
        const g = state.groups[gid] || await getGroup(gid);
        if (g) {
          g.name = msg.groupName;
          g.avatarColor = msg.avatarColor;
          state.groups[gid] = g;
          await saveGroup(g);
          refreshContactList();
        }
      }
      else if (msg.type === 'group_members_updated') {
        const gid = toSafeGroupId(msg.groupId);
        if (!gid) return;
        const g = state.groups[gid] || await getGroup(gid);
        if (g) {
          g.members = normalizeGroupMembers(msg.members ?? []);
          state.groups[gid] = g;
          await saveGroup(g);
          if (state.selectedGroup === gid) {
            updateGroupHeaderStatus(gid);
            updateGroupHeaderControls(gid);
          }
          refreshContactList();
        }
      }
      else if (msg.type === 'group_renamed') {
        const gid = toSafeGroupId(msg.groupId);
        const name = String(msg.name ?? '').trim();
        if (!gid || !name) return;
        const g = state.groups[gid] || await getGroup(gid);
        if (!g) return;
        g.name = name;
        state.groups[gid] = g;
        await saveGroup(g);
        if (state.selectedGroup === gid) {
          const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
          if (hName) hName.textContent = name;
        }
        refreshContactList();
      }
      else if (msg.type === 'group_typing') {
        const gid = toSafeGroupId(msg.groupId);
        const senderNum = Number(msg.senderNumber || 0);
        if (!gid || !senderNum || senderNum === Number(state.memberNumber)) return;
        if (!state.showTypingIndicators) return;
        showGroupTypingIndicator(gid, senderNum, msg.senderName);
      }
      else if (msg.type === 'group_member_removed') {
        const gid = toSafeGroupId(msg.groupId);
        if (!gid) return;
        delete state.groups[gid];
        await deleteGroup(gid);
        if (state.selectedGroup === gid) {
          state.selectedGroup = null;
          state.selectedContact = null;
          closeDialog();
        }
        refreshContactList();
      }
      else if (msg.type === 'group_join_requested') {
        // Only group admins receive this.
        const gid = toSafeGroupId(msg.groupId);
        const requesterNum = Number(msg.memberNumber || 0);
        const requesterName = requesterNum ? getDisplayNameForMember(requesterNum, `Member #${requesterNum}`) : 'Someone';
        showNote(`📥 ${requesterName} requested to join "${msg.groupName || 'your group'}"`, false);
        if (gid && state.selectedGroup === gid) {
          const manageBtn = state.dialogEl?.querySelector('.bcm-manage-group-btn');
          if (manageBtn) manageBtn.title = 'Manage group — new join request';  // list refreshes on open
        }
      }
      else if (msg.type === 'group_join_decision') {
        const gid = toSafeGroupId(msg.groupId);
        if (msg.accepted) {
          showNote(`✅ You joined "${msg.groupName || 'the group'}"`, false);
          try {
            const r = await getGroups();
            const freshGroups = r?.groups || [];
            for (const g of freshGroups) {
              const gidN = Number(g.id);
              if (!gidN) continue;
              state.groups[gidN] = {
                id: gidN,
                name: g.name,
                createdBy: g.created_by,
                createdAt: g.created_at,
                avatarColor: g.avatar_color || '',
                members: normalizeGroupMembers(g.members || []),
              };
              await saveGroup(state.groups[gidN]);
            }
            refreshContactList();
          } catch {}
        } else {
          showNote(`❌ Your request to join "${msg.groupName || 'the group'}" was declined`, false);
        }
      }
      else if (msg.type === 'poll_created' || msg.type === 'poll_vote_updated') {
        if (state.dialogOpen) redrawCurrentConversation().catch(() => {});
      }
    });

    state.ws.addEventListener('close', () => { state.ws = null; if (state.loggedIn) setTimeout(connectWs, 6000); });
    state.ws.addEventListener('error', () => console.warn('[BCM] WS error'));
  }


  async function onIncomingMessage(senderNum, senderNameStr, content, sentAt, serverId, parentMessageRef = null) {
    try {
      if (isProtocolMessage(content)) return;
      if (content?.startsWith(E2E_V2_PREFIX)) {
        const r = await getContactSharedKey(parseInt(senderNum, 10)).catch(() => ({ key: null }));
        if (r?.key) {
          const aad = dmAAD(Number(senderNum), state.memberNumber);
          try { content = await decryptE2E(r.key, content.slice(E2E_V2_PREFIX.length), aad); }
          catch { content = '[🔒 Could not decrypt message]'; }
        } else if (r?.status === 'changed') {
          content = '[🔒 Encrypted — sender\'s key changed; verify before reading]';
        } else {
          content = '[🔒 Encrypted message — update your plugin to read this]';
        }
      } else if (content?.startsWith(E2E_PREFIX)) {
        // Legacy v1 (no AAD) — decode-only for backward compat
        const r = await getContactSharedKey(parseInt(senderNum, 10)).catch(() => ({ key: null }));
        if (r?.key) {
          try { content = await decryptE2E(r.key, content.slice(E2E_PREFIX.length)); }
          catch { content = '[🔒 Could not decrypt message]'; }
        } else {
          content = '[🔒 Encrypted message — update your plugin to read this]';
        }
      }
      senderNum = parseInt(senderNum, 10);
      senderNameStr = getDisplayNameForMember(senderNum, senderNameStr || `Member #${senderNum}`);
      upsertContact(senderNum, senderNameStr);

      if (serverId != null) {
        const dup = await findDuplicateLocalMessage(senderNum, senderNum, content, sentAt ?? Date.now());
        if (dup) {
          await updateMessageServerId(dup, serverId);
          return;
        }
      }

      let msg = { partnerNum: senderNum, senderNum, content, sentAt: sentAt ?? Date.now(), fromUs: false, serverId: serverId ?? null, parentMessageRef };
      try { msg = await saveMessage(senderNum, senderNum, content, sentAt ?? Date.now(), false, serverId ?? null, null, false, parentMessageRef); } catch {}
      scheduleDisappearingForMessage(msg);

      showToast(senderNameStr, content, senderNum);

      if (state.selectedContact === senderNum) {
        appendBubble(msg);
        scrollMsgs();
      } else {
        state.unread[senderNum] = (state.unread[senderNum] ?? 0) + 1;
        updateHTMLBadge();
        refreshContactList();
      }

      if (state.afkEnabled && state.isAway && state.afkMessage && senderNum !== state.memberNumber) {
        sendAfkReply(senderNum);
      }
      if (senderNum && senderNum !== state.memberNumber && state.autoResponderRules.length > 0) {
        const txt = String(content ?? '').toLowerCase();
        for (const rule of state.autoResponderRules) {
          const matches = rule.matchType === 'any' || (rule.keyword && txt.includes(rule.keyword.toLowerCase()));
          if (matches && rule.reply) {
            setTimeout(() => sendToServer(senderNum, rule.reply).catch(() => {}), 900 + Math.random() * 300);
            break;
          }
        }
      }
    } catch (e) { console.error('[BCM] onIncomingMessage:', e); }
  }

  function markMemberOffline(num) {
    // Clear ALL online indicators — state.bcOnlineSet is checked first in isMemberOnlineForUi
    // so it MUST be cleared or the contact stays "online" regardless of everything else.
    state.bcOnlineSet.delete(num);
    if (state.bcFriendCache[num]) state.bcFriendCache[num].online = false;
    if (state.contactMeta[num]) {
      state.contactMeta[num].bcOnline = false;
      state.contactMeta[num].online   = false;
    }
    if (state.loggedIn) {
      refreshContactList();
      // Ask BC for an authoritative friend-list update
      try { unsafeWindow.ServerSend?.('AccountQuery', { Query: 'FriendList' }); } catch {}
    }
  }

  function pingBCMPresence(memberNum) {
    const W = unsafeWindow;
    if (!state.loggedIn || typeof W.ServerSend !== 'function') return;
    const isBcFriend = (W.Player?.FriendList ?? []).some(n => parseInt(n, 10) === memberNum);
    if (!isBcFriend) return;
    W.ServerSend('AccountBeep', { MemberNumber: memberNum, BeepType: 'BCMHello', IsSecret: true });
  }

  // ── Contact online heatmap ────────────────────────────────────────────────────
  function getHeatBuckets(num) {
    return parseJSONOr(GM_getValue(`${state.STORE}heat_${num}`, 'null'), new Array(24).fill(0));
  }
  function recordOnlineNow(num) {
    const buckets = getHeatBuckets(num);
    buckets[new Date().getHours()]++;
    GM_setValue(`${state.STORE}heat_${num}`, JSON.stringify(buckets));
  }

  function hasInvitedContact(contactNum) {
    return !!GM_getValue(`${state.STORE}invited_${contactNum}`, false);
  }

  function markContactInvited(contactNum) {
    GM_setValue(`${state.STORE}invited_${contactNum}`, Date.now());
  }

  async function sendBCMInvite(contactNum) {
    // One-shot: never send the invite beep more than once per contact.
    if (hasInvitedContact(contactNum)) {
      showNote('📨 Invite already sent to this contact', false);
      return;
    }
    markContactInvited(contactNum);

    const installUrl = 'https://raw.githubusercontent.com/khiles/BC-Messenger/main/bc-offline-messenger.user.js';
    const inviteText = `Hey! I use BC Messenger, a free Tampermonkey userscript that adds private messaging to Bondage Club — offline delivery, group chat, reactions and more. Install it free here: ${installUrl}`;
    const W = unsafeWindow;
    const now = Date.now();

    // Send via BC beep so non-BCM users can actually receive it
    if (typeof W.ServerSend === 'function') {
      const isBcFriend = (W.Player?.FriendList ?? []).some(n => parseInt(n, 10) === contactNum);
      if (isBcFriend) {
        markLocalSendBypass('beep', contactNum, inviteText);
        W.ServerSend('AccountBeep', { MemberNumber: contactNum, Message: inviteText, BeepType: '', IsSecret: true });
      }
    }

    // Save locally and show in conversation.
    // Use 'delivered' status so scheduleReBeepCheck never re-sends this invite.
    let msg;
    try { msg = await saveMessage(contactNum, state.memberNumber, inviteText, now, true, null, 'delivered'); } catch {}
    if (msg && state.selectedContact === contactNum && !state.selectedGroup) { appendBubble(msg); scrollMsgs(); }
    refreshContactList();

    // Also queue on relay in case they happen to have BCM on another device
    sendToServer(contactNum, inviteText, true).then(r => {
      if (r?.success && r.id && msg) updateMessageServerId(msg, r.id).catch(() => {});
    }).catch(() => {});

    showNote('📨 Invite sent!', false);
  }

  async function openSavedMessages() {
    if (!state.memberNumber) { showNote('Not logged in yet', true); return; }
    closeAllPanels();
    const name = state.memberName || `Member #${state.memberNumber}`;
    if (!state.contactMeta[state.memberNumber]) {
      state.contactMeta[state.memberNumber] = { name, num: state.memberNumber };
    }
    await selectContact(state.memberNumber);
    const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
    if (hName) hName.textContent = '📌 Saved Messages';
  }

  async function sendFriendInvite(contactNum) {
    const name = state.memberName || `Member #${state.memberNumber}`;
    const text = `👋 ${name} (#${state.memberNumber}) would like to add you as a BC friend!`;
    const now = Date.now();
    let msg;
    try { msg = await saveMessage(contactNum, state.memberNumber, text, now, true, null, 'delivered'); } catch {}
    if (msg && state.selectedContact === contactNum && !state.selectedGroup) { appendBubble(msg); scrollMsgs(); }
    refreshContactList();
    sendToServer(contactNum, text, true).then(r => {
      if (r?.success && r.id && msg) updateMessageServerId(msg, r.id).catch(() => {});
    }).catch(() => {});
    showNote('👋 Friend invite sent!', false);
  }

  async function sendRoomInvite(contactNum) {
    const roomName = unsafeWindow.ChatRoomData?.Name;
    if (!roomName) { showNote('You are not in a room', false); return; }
    const text = `\u{1F3E0}ROOMINVITE:${roomName}`;
    const now = Date.now();
    let msg;
    try { msg = await saveMessage(contactNum, state.memberNumber, text, now, true, null, 'delivered'); } catch {}
    if (msg && state.selectedContact === contactNum && !state.selectedGroup) { appendBubble(msg); scrollMsgs(); }
    refreshContactList();
    sendToServer(contactNum, text, true).then(r => {
      if (r?.success && r.id && msg) updateMessageServerId(msg, r.id).catch(() => {});
    }).catch(() => {});
    showNote('🏠 Room invite sent!', false);
  }

  // On startup, fix any legacy invite messages that were stored with 'sent' status
  // so scheduleReBeepCheck never picks them up again.
  async function fixLegacyInviteMessages() {
    try {
      const db = await ensureDbReady();
      const tx = db.transaction('messages', 'readwrite');
      const store = tx.objectStore('messages');
      const req = store.getAll();
      req.onsuccess = () => {
        const installMarker = 'raw.githubusercontent.com/khiles/BC-Messenger';
        for (const msg of (req.result || [])) {
          if (msg.fromUs && msg.status === 'sent' && String(msg.content ?? '').includes(installMarker)) {
            msg.status = 'delivered';
            store.put(msg);
            // Also mark this contact as already invited so we never re-send
            if (msg.partnerNum) markContactInvited(msg.partnerNum);
          }
        }
      };
    } catch {}
  }

  const INVITE_MARKER = 'raw.githubusercontent.com/khiles/BC-Messenger';

  function isInviteContent(content) {
    return String(content ?? '').includes(INVITE_MARKER);
  }

  function updateMsgStatusById(localId, status) {
    return ensureDbReady().then(db => new Promise(resolve => {
      const tx  = db.transaction('messages', 'readwrite');
      const req = tx.objectStore('messages').get(localId);
      req.onsuccess = () => {
        if (!req.result) return resolve(null);
        const updated = { ...req.result, status };
        tx.objectStore('messages').put(updated);
        resolve(updated);
      };
      req.onerror = () => resolve(null);
    }));
  }

  function scheduleReBeepCheck(memberNum) {
    if (!state.loggedIn) return;
    setTimeout(async () => {
      if (!state.loggedIn) return;
      try {
        const status = await getStatus(memberNum);
        if (status?.isOnline) return;
        const msgs = await getMessages(memberNum);

        const toRebeep = [];
        for (const m of msgs) {
          if (!m.fromUs || m.status !== 'sent' || m.deleted) continue;
          if ((Date.now() - Number(m.sentAt)) >= 172800000) continue;

          if (isInviteContent(m.content)) {
            // Permanently fix any legacy invite stored as 'sent' — update to
            // 'delivered' in place and record this contact as already invited.
            if (m.id) updateMsgStatusById(m.id, 'delivered').catch(() => {});
            markContactInvited(memberNum);
            continue; // never re-beep invites
          }
          toRebeep.push(m);
        }

        if (toRebeep.length === 0) return;
        const W = unsafeWindow;
        if (typeof W.ServerSend !== 'function') return;
        const isBcFriend = (W.Player?.FriendList ?? []).some(n => parseInt(n, 10) === memberNum);
        if (!isBcFriend) return;
        for (const m of toRebeep.slice(-3)) {
          markLocalSendBypass('beep', memberNum, m.content);
          W.ServerSend('AccountBeep', { MemberNumber: memberNum, Message: m.content, BeepType: '', IsSecret: true });
        }
      } catch {}
    }, 9000);
  }

  async function onIncomingGroupMessage(groupId, senderNum, senderName, content, sentAt, serverId, mentioned = false, mentionTargets = null, groupMessageRef = null, receipt = null) {
    try {
      groupId = parseInt(groupId, 10);
      senderNum = parseInt(senderNum, 10);
      senderName = getDisplayNameForMember(senderNum, senderName || `Member #${senderNum}`);
      if (typeof content === 'string' && content.startsWith(E2E_V2G_PREFIX)) {
        content = await decryptGroupContent(content, senderNum, groupId);
      }

      const isMentioned = !!mentioned || (Array.isArray(mentionTargets) && mentionTargets.includes(state.memberNumber));
      const statusFromReceipt = deriveStatusFromGroupReceipt(receipt);
      const isFromUs = senderNum === state.memberNumber;

      let msg = {
        groupId, senderNum, senderName, content, sentAt: sentAt ?? Date.now(), fromUs: isFromUs,
        serverId: serverId ?? null, status: statusFromReceipt, messageType: 'group', mentioned: isMentioned, groupMessageRef: groupMessageRef || null,
      };
      msg = updateGroupReceiptForMessage(msg, receipt, groupMessageRef);
      try { msg = await saveGroupMessage(groupId, senderNum, senderName, content, sentAt ?? Date.now(), isFromUs, serverId ?? null, statusFromReceipt, false, groupMessageRef, receipt); } catch {}
      scheduleDisappearingForMessage(msg);

      const group = state.groups[groupId];
      if (group) {
        const displayName = isMentioned ? `💬 ${group.name} (you were mentioned)` : `${group.name}: ${senderName}`;
        showToast(displayName, content, null);

        if (state.selectedGroup === groupId) {
          appendBubble(msg);
          scrollMsgs();
          if (!isFromUs && serverId && state.ws?.readyState === WebSocket.OPEN && canSendReadReceiptsForConversation(`g_${groupId}`)) {
            state.ws.send(JSON.stringify({ type: 'read', messageIds: [serverId] }));
          }
        } else {
          if (!isFromUs) state.groupUnread[groupId] = (state.groupUnread[groupId] ?? 0) + 1;
          updateHTMLBadge();
          refreshContactList();
        }
      }
    } catch (e) { console.error('[BCM] onIncomingGroupMessage:', e); }
  }

  state.afkReplyTimeout = null;
  async function sendAfkReply(recipientNum) {
    if (state.afkReplySent.has(recipientNum)) return;

    state.afkReplySent.add(recipientNum);

    clearTimeout(state.afkReplyTimeout);
    state.afkReplyTimeout = setTimeout(async () => {
      try {
        await sendToServer(recipientNum, state.afkMessage);
      } catch (e) {
        console.error('[BCM] Failed to send AFK reply:', e);
      }
    }, 2000);
  }

  function updateAwayIndicator() {
    const title = state.dialogEl?.querySelector('.bcm-dtitle');
    if (title) title.textContent = state.isAway ? '💬 BC Messenger (AFK)' : '💬 BC Messenger';
    if (state.htmlTrigger) state.htmlTrigger.title = state.isAway ? 'BC Offline Messenger (AFK)' : 'BC Offline Messenger (Alt+M)';
  }

  function setAwayState(nextAway) {
    const val = !!nextAway;
    if (state.isAway === val) return;
    state.isAway = val;
    if (!state.isAway) state.afkReplySent.clear();
    updateAwayIndicator();
  }

  function scheduleAwayTimer() {
    clearTimeout(state.awayTimer);
    if (!state.afkEnabled) {
      setAwayState(false);
      return;
    }
    const timeoutMs = state.awayTimeoutMins * 60000;
    const elapsed = Date.now() - state.awayActivityLast;
    if (elapsed >= timeoutMs) {
      setAwayState(true);
      return;
    }
    state.awayTimer = setTimeout(() => setAwayState(true), timeoutMs - elapsed);
  }

  function markUserActivity() {
    const now = Date.now();
    if (!state.isAway && now - state.awayActivityLast < MIN_ACTIVITY_DEBOUNCE_MS) return;
    state.awayActivityLast = now;
    setAwayState(false);
    scheduleAwayTimer();
  }

  function registerAwayActivityTracking() {
    if (state.awayActivityRegistered) return;
    state.awayActivityRegistered = true;
    const onActivity = () => markUserActivity();
    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach(evt =>
      window.addEventListener(evt, onActivity, { passive: true, capture: true })
    );
    scheduleAwayTimer();
  }


  function loadModSDK() {
    return new Promise(resolve => {
      if (unsafeWindow.bcModSdk) return resolve(unsafeWindow.bcModSdk);
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://cdn.jsdelivr.net/npm/bondage-club-mod-sdk@1/dist/bcmodsdk.js',
        onload(r) {
          try {
            const s = document.createElement('script');
            s.textContent = r.responseText;
            (document.head || document.documentElement).appendChild(s);
            s.remove();
          } catch {}
          resolve(unsafeWindow.bcModSdk ?? null);
        },
        onerror: () => resolve(null),
      });
    });
  }

  function registerHooks(mod) {
    mod.hookFunction('ChatRoomMessageDisplay', 0, (args, next) => {
      const [data] = args;
      if (data?.Type === 'ServerMessage' &&
          (data.Content === 'Beep' || data.Content === 'Whisper')) {
        if (state.beepHideMode === 2) return;
        if (state.beepHideMode === 1 && state.dialogEl && document.body.contains(state.dialogEl)) return;
      }
      return next(args);
    });

    mod.hookFunction('GameRun', 1, (args, next) => {
      const result = next(args);
      return result;
    });

    mod.hookFunction('ServerSend', 1, async (args, next) => {
      try {
        const [type, data] = args;

        if (type === 'ChatRoomJoin') {
          if (data?.Name) {
            const now = Date.now();
            if (state.lastChatRoomJoinSent.name === data.Name &&
                now - state.lastChatRoomJoinSent.timestamp < 3000) {
              return;
            }
            state.lastChatRoomJoinSent = { name: data.Name, timestamp: now };
          }
        }

        if (!state.loggedIn) return next(args);

        if (type === 'AccountBeep' && data?.Message) {
          const rn = parseInt(data.MemberNumber, 10);
          if (!rn) return next(args);
          if (consumeLocalSendBypass('beep', rn, data.Message)) return next(args);
          const result = next(args);
          const isTextBeep = !data.BeepType;
          if (isTextBeep) {
            try {
              const status = await getStatus(rn);
              const statusName = getSafeDisplayName(status?.state.memberName, rn, '');
              const name  = statusName || getDisplayNameForMember(rn, `Member #${rn}`);
              upsertContact(rn, name);
              const now   = Date.now();
              const initialStatus = isMemberOnlineForUi(rn, status?.isOnline) ? 'delivered' : 'sent';
              const saved = await saveMessage(rn, state.memberNumber, data.Message, now, true, null, initialStatus);
              if (initialStatus === 'sent') showNote('Recipient appears offline — message queued', false);
              refreshContactList();
              if (state.selectedContact === rn) { appendBubble(saved); scrollMsgs(); }
              sendToServer(rn, data.Message, true).then(r => {
                if (r?.success && r.id) {
                  updateMessageServerId(saved, r.id).catch(() => {});
                  if (r.delivered === true && initialStatus !== 'delivered') {
                    updateMsgStatus(r.id, 'delivered').then(updated => { if (updated) updateBubbleTick(r.id, 'delivered'); }).catch(() => {});
                  }
                }
              }).catch(() => {});
            } catch {}
          }
          return result;
        }

        if (type === 'ChatRoomChat' && data?.Type === 'Whisper' && data?.Content) {
          const rn = parseInt(data.Target, 10);
          if (rn) {
            if (consumeLocalSendBypass('whisper', rn, data.Content)) return next(args);
            const result = next(args);
            try {
              const W    = unsafeWindow;
              const char = (W.Character ?? []).find(c => c.MemberNumber === rn);
              const name = getSafeDisplayName(char?.Name, rn, '') || `Member #${rn}`;
              upsertContact(rn, name);
              const now   = Date.now();
              const saved = await saveMessage(rn, state.memberNumber, data.Content, now, true, null, 'delivered');
              refreshContactList();
              if (state.selectedContact === rn) { appendBubble(saved); scrollMsgs(); }
              sendToServer(rn, data.Content, false, null, true).then(r => {
                if (r?.success && r.id) updateMessageServerId(saved, r.id).catch(() => {});
              }).catch(() => {});
            } catch {}
            return result;
          }
        }
      } catch (e) { console.error('[BCM] ServerSend hook:', e); }
      return next(args);
    });

    mod.hookFunction('ServerAccountBeep', 0, (args, next) => {
      try {
        const [data] = args;
        if (data?.BeepType === 'BCMHello' && data?.MemberNumber) {
          const senderNum = parseInt(data.MemberNumber, 10);
          if (senderNum && !isBlockedMember(senderNum)) {
            if (!state.contactMeta[senderNum]) state.contactMeta[senderNum] = {};
            if (!state.contactMeta[senderNum].hasBCM) {
              state.contactMeta[senderNum].hasBCM = true;
              if (state.loggedIn) refreshContactList();
            }
            pingBCMPresence(senderNum);
          }
          return next(args);
        }
        if (data?.BeepType === 'BCMTyping' && data?.MemberNumber) {
          const senderNum = parseInt(data.MemberNumber, 10);
          if (state.loggedIn && state.showTypingIndicators && !isMuted(senderNum) && !isBlockedMember(senderNum)) showTypingIndicator(senderNum);
          return next(args);
        }
        if (state.loggedIn && data?.MemberNumber && data?.Message && (!data.BeepType || data.BeepType === '')) {
          const senderNum  = parseInt(data.MemberNumber, 10);
          if (!isBlockedMember(senderNum)) {
            const senderName = getSafeDisplayName(data.MemberName, senderNum, '') || `Member #${senderNum}`;
            const beepContent = stripBcFormattingTrailer(data.Message);
            if (beepContent) onIncomingMessage(senderNum, senderName, beepContent, Date.now(), null);
          }
        }
      } catch {}
      return next(args);
    });

    try {
      mod.hookFunction('ChatRoomMessage', 0, (args, next) => {
        try {
          const [data] = args;
          const whisperContent = resolveBcWhisperContent(data);
          if (state.loggedIn && data?.Type === 'Whisper' && whisperContent) {
            const senderNum = parseInt(data.Sender, 10);
            if (senderNum && senderNum !== state.memberNumber && !isBlockedMember(senderNum)) {
              const W    = unsafeWindow;
              const char = (W.Character ?? []).find(c => c.MemberNumber === senderNum);
              const name = getSafeDisplayName(char?.Name, senderNum, '') || `Member #${senderNum}`;
              onIncomingMessage(senderNum, name, whisperContent, Date.now(), null);
            }
          }

          // Detect when someone disconnects/leaves the room so we can update their
          // online status immediately instead of waiting for the 30-second poll.
          if (state.loggedIn && data?.Sender) {
            const type    = data.Type ?? '';
            const content = String(data.Content ?? data.content ?? '').toLowerCase();
            const isLeaveOrDisconnect =
              type === 'Disconnect' ||
              content.includes('disconnect') ||
              content.includes('actionleave') ||
              content.includes('actiondisconnect') ||
              content.includes('serverleave') ||
              content.includes('serverdisconnect');
            if (isLeaveOrDisconnect) {
              const leavingNum = parseInt(data.Sender, 10);
              if (leavingNum && leavingNum !== state.memberNumber) {
                markMemberOffline(leavingNum);
              }
            }
          }
        } catch {}
        return next(args);
      });
    } catch {}

    try {
      mod.hookFunction('AccountQueryResult', 0, (args, next) => {
        onAccountQueryResult(args[0], args[1]);
        return next(args);
      });
    } catch (err) {
      console.error('[BCM] Failed to hook AccountQueryResult:', err);
    }

    try {
      mod.hookFunction('FriendListLoadFriendList', 0, (args, next) => {
        if (Array.isArray(args[0])) {
          processFriendListData(args[0]);
        } else {
        }
        return next(args);
      });
    } catch (err) {
      console.error('[BCM] Failed to hook FriendListLoadFriendList:', err);
    }

    try {
      mod.hookFunction('InformationSheetRun', 1, (args, next) => {
        const result = next(args);
        const W = unsafeWindow;
        if (W.InformationSheetSelection === 'Online' || W.InformationSheetSelection === 'Offline') {
          try {
            modifyFriendsListDisplay();
          } catch (err) {
            console.error('[BCM] Error modifying friends list:', err);
          }
        }
        return result;
      });
    } catch (err) {
      console.error('[BCM] Failed to hook InformationSheetRun:', err);
    }

    try {
      mod.hookFunction('ChatRoomSync', 1, (args, next) => {
        const result = next(args);
        const W = unsafeWindow;
        const roomName = args[0]?.Name ?? W.ChatRoomData?.Name;
        if (roomName) {
          state.pendingJoinTarget = null;
          state.leavingForJoin = false;
          refreshLobbyJoinButtons();
        }
        return result;
      });
    } catch (err) {
      console.error('[BCM] Failed to hook ChatRoomSync:', err);
    }

    try {
      mod.hookFunction('ChatRoomLeave', 1, (args, next) => {
        if (!state.leavingForJoin) {
          state.pendingJoinTarget = null;
          state.lastChatRoomJoinSent = { name: null, timestamp: 0 };
          refreshLobbyJoinButtons();
        }
        return next(args);
      });
    } catch (err) {
      console.error('[BCM] Failed to hook ChatRoomLeave:', err);
    }

    // Hook CharacterDelete as a fast-path for when BC removes someone from the room.
    // This may not fire on all BC versions; the W.Character polling below is the fallback.
    try {
      mod.hookFunction('CharacterDelete', 0, (args, next) => {
        const result = next(args);
        try {
          const raw = args[0];
          const num = Number(raw?.MemberNumber ?? raw?.memberNumber ?? raw) || 0;
          if (num && num !== state.memberNumber) markMemberOffline(num);
        } catch {}
        return result;
      });
    } catch {
      // CharacterDelete may not exist in this BC version — polling handles it instead
    }

  }

  function modifyFriendsListDisplay() {
    const W = unsafeWindow;
    if (!W.Player || !W.Player.FriendList) return;

    const friends = W.Player.FriendList || [];

    const onlineFriends = [];
    const offlineFriends = [];

    for (const friend of friends) {
      const memberNum = parseInt(friend?.MemberNumber, 10);
      if (!memberNum) continue;

      const isOnline = isMemberOnlineForUi(memberNum);
      if (isOnline) {
        onlineFriends.push(friend);
      } else {
        offlineFriends.push(friend);
      }
    }

    if (W.InformationSheetSelection === 'Online') {
      W.Player.FriendList = onlineFriends;
    } else if (W.InformationSheetSelection === 'Offline') {
      W.Player.FriendList = offlineFriends;
    } else {
      W.Player.FriendList = [...onlineFriends, ...offlineFriends];
    }
  }


  function processFriendListData(data) {
    const hasExplicitRowsArray =
      Array.isArray(data)
      || Array.isArray(data?.Result)
      || Array.isArray(data?.result)
      || Array.isArray(data?.Friends)
      || Array.isArray(data?.friends);
    if (!hasExplicitRowsArray) {
      return;
    }
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.Result) ? data.Result
      : Array.isArray(data?.result) ? data.result
      : Array.isArray(data?.Friends) ? data.Friends
      : Array.isArray(data?.friends) ? data.friends
      : [];
    state.bcOnlineSet.clear();
    for (const f of rows) {
      const parsed = parseBCFriendEntry(f);
      if (parsed?.memberNum) {
        state.bcOnlineSet.add(parsed.memberNum);
      }
    }
    const W = unsafeWindow;
    let changed = false;
    const returnedNums = new Set();

    for (const friend of rows) {
      const parsed = parseBCFriendEntry(friend);
      if (!parsed?.memberNum) continue;
      const num = parsed.memberNum;
      returnedNums.add(num);
      const safeName = parsed.name;
      const prevCache = state.bcFriendCache[num] || {};
      // Use bcReportedOnline (only written here, never by markMemberOffline) so that a
      // temporary offline-mark from room-leave polling doesn't look like a fresh login.
      const wasOnline = prevCache.bcReportedOnline === true;
      state.bcFriendCache[num] = {
        memberNum: num,
        name: safeName || prevCache.name || '',
        online: true,
        bcReportedOnline: true,
        lastSeen: parsed.lastSeen || prevCache.lastSeen || 0,
        room: parsed.room || '',
      };
      if (!wasOnline && state.loggedIn) {
        scheduleReBeepCheck(num);
        pingBCMPresence(num);
        recordOnlineNow(num);
      }
      if (!state.contactMeta[num]) state.contactMeta[num] = {};
      state.contactMeta[num].bcOnline = true;
      state.contactMeta[num].online = true;
      state.contactMeta[num].room = parsed.room || prevCache.room || '';
      changed = true;
      if (safeName) {
        if (state.contactMeta[num].username !== safeName) changed = true;
        state.contactMeta[num].username = safeName;
        if (isMemberNumberLikeName(state.contactMeta[num].name, num)) {
          state.contactMeta[num].name = safeName;
          upsertContact(num, safeName);
        }
        const fn = W.Player?.FriendNames;
        if (fn) {
          const existing = fn instanceof Map ? (fn.get(num) || fn.get(String(num))) : (fn[String(num)] || fn[num]);
          if (!getSafeDisplayName(existing, num, '')) {
            if (fn instanceof Map) fn.set(num, safeName);
            else fn[String(num)] = safeName;
          }
        }
      }
    }

    // Build the set of ALL known friends from state.bcFriendCache (reliable) plus whatever
    // W.Player.FriendList currently holds.  We intentionally do NOT rely solely on
    // W.Player.FriendList here because modifyFriendsListDisplay() may have replaced it
    // with a filtered subset (online-only or offline-only), which would make us miss
    // marking the absent group as offline.
    const allKnownNums = new Set([
      ...Object.keys(state.bcFriendCache).map(Number).filter(Boolean),
      ...(W.Player?.FriendList ?? []).map(r => parseFriendMemberNumber(r)).filter(Boolean),
    ]);
    for (const n of allKnownNums) {
      if (returnedNums.has(n)) continue;
      const prev = state.bcFriendCache[n] || {};
      state.bcFriendCache[n] = { memberNum: n, name: prev.name || '', online: false, bcReportedOnline: false, lastSeen: prev.lastSeen || 0, room: '' };
      if (state.contactMeta[n]) {
        state.contactMeta[n].bcOnline = false;
        state.contactMeta[n].online = false;
      }
      changed = true;
    }

    if (changed && state.loggedIn) {
      refreshContactList();
      if (state.friendsPanelOpen) renderFriendsPanel();
      if (state.selectedContact) refreshHeaderOnlineStatus(state.selectedContact);
    }
  }

  function onAccountQueryResult(argOne, argTwo) {
    try {
      if (argOne && typeof argOne === 'object' && !Array.isArray(argOne) && ('Query' in argOne || 'query' in argOne)) {
        const query = String(argOne.Query ?? argOne.query ?? '').toLowerCase();
        if (query === 'friendlist') {
          processFriendListData(
            argOne.Result
            ?? argOne.result
            ?? argOne.Data
            ?? argOne.data
            ?? argOne.Friends
            ?? argOne.friends,
          );
        }
      } else if (Array.isArray(argOne)) {
        processFriendListData(argOne);
      } else if (String(argOne ?? '').toLowerCase() === 'friendlist' && Array.isArray(argTwo)) {
        processFriendListData(argTwo);
      } else if (!argOne && Array.isArray(argTwo)) {
        processFriendListData(argTwo);
      }
    } catch {}
  }

  function tryRegisterBCExtension() {
    const W = unsafeWindow;
    if (typeof W.PreferenceRegisterExtensionSetting !== 'function') return false;
    W.PreferenceRegisterExtensionSetting({
      Identifier: 'BCOfflineMessenger',
      ButtonText:  'BC Messenger',
      Image:       '',
      Load:  () => {},
      Draw:  () => {
        if (typeof W.DrawText   !== 'function') return;
        if (typeof W.DrawButton !== 'function') return;
        const conn      = state.ws?.readyState === 1;
        const connLabel = conn ? '● Connected' : '○ Disconnected';
        const connColor = conn ? '#34c468' : '#c43060';
        W.DrawText('BC Offline Messenger', 1000, 125, '#2d2d2d', 'White');
        W.DrawText(`Member #${state.memberNumber ?? '—'}  ·  ${connLabel}`, 1000, 190, connColor, '');
        W.DrawButton(875, 280, 250, 55, '⚙ Open Settings', '#fff0f4', '', 'Open BC Messenger settings');
        W.DrawButton(875, 360, 250, 55, '💬 Open Messenger', '#f0f8ff', '', 'Open BC Messenger window');
      },
      Click: () => {
        if (typeof W.MouseIn !== 'function') return;
        if (W.MouseIn(875, 280, 250, 55)) openSettingsDialog();
        if (W.MouseIn(875, 360, 250, 55)) toggleDialog();
      },
      Exit: () => { closeSettingsDialog(); },
    });
    return true;
  }

  function scheduleBCExtensionRegistration() {
    if (!tryRegisterBCExtension()) setTimeout(scheduleBCExtensionRegistration, 2000);
  }


  state.htmlTrigger = null;
  state.htmlBadgeEl = null;

  function applyTriggerBaseStyles(el) {
    const s = el.style;
    const sp = (k, v) => s.setProperty(k, v, 'important');
    sp('position', 'fixed');
    // Override popover UA defaults (inset:0; margin:auto; width/height:fit-content)
    sp('inset', 'auto');
    sp('margin', '0');
    sp('top', 'auto');
    sp('left', 'auto');
    sp('bottom', '20px');
    sp('right', '20px');
    sp('width', '52px');
    sp('height', '52px');
    sp('min-width', '52px');
    sp('max-width', '52px');
    sp('border-radius', '50%');
    sp('background', 'linear-gradient(135deg,#c43060,#e05888)');
    sp('border', '2px solid #f0a0c0');
    sp('cursor', 'pointer');
    sp('z-index', '2147483645');
    sp('display', 'flex');
    sp('align-items', 'center');
    sp('justify-content', 'center');
    sp('box-shadow', '0 4px 18px rgba(196,48,96,.5)');
    sp('user-select', 'none');
    sp('pointer-events', 'all');
    sp('box-sizing', 'border-box');
    sp('overflow', 'visible');
    sp('transform', 'translateZ(0)');
    sp('-webkit-transform', 'translateZ(0)');
    sp('will-change', 'transform');
    sp('isolation', 'isolate');
    sp('font-size', '0');
  }

  function setupHtmlTrigger() {
    if (state.htmlTrigger && document.contains(state.htmlTrigger)) {
      updateHTMLBadge();
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #bcm-trigger::before {
        content:''!important; display:block!important;
        width:8px!important; height:8px!important; border-radius:50%!important;
        background:rgba(255,255,255,0.92)!important;
        box-shadow:11px 0 0 rgba(255,255,255,0.92),22px 0 0 rgba(255,255,255,0.92)!important;
        margin-left:-11px!important; flex-shrink:0!important; pointer-events:none!important;
      }
      #bcm-trigger:hover { background:linear-gradient(135deg,#d44070,#ee6898)!important; }
      #bcm-trigger-badge {
        position:absolute!important; top:-4px!important; right:-4px!important;
        background:#e03030!important; color:#fff!important; border-radius:10px!important;
        font-size:10px!important; font-weight:bold!important; font-family:Arial,sans-serif!important;
        padding:2px 5px!important; min-width:16px!important; text-align:center!important;
        pointer-events:none!important; display:none!important; box-sizing:border-box!important;
        animation:bcm-badge-pulse 1.8s ease-in-out infinite!important;
      }
      @keyframes bcm-badge-pulse {
        0%,100%{transform:scale(1)}
        50%{transform:scale(1.2)}
      }
      #bcm-online-chip {
        position:absolute!important; bottom:-12px!important; left:50%!important;
        transform:translateX(-50%)!important; background:#22b573!important;
        color:#fff!important; font-size:9px!important; padding:1px 6px!important;
        border-radius:8px!important; white-space:nowrap!important;
        pointer-events:none!important; display:none!important;
        font-family:Arial,sans-serif!important; z-index:1!important;
        box-sizing:border-box!important;
      }
      /* popover reset — strip UA sheet margins/padding when in top layer */
      #bcm-trigger:popover-open { margin:0; padding:0; border:none; background:transparent; overflow:visible; }
    `;
    document.head.appendChild(style);

    state.htmlTrigger = document.createElement('div');
    state.htmlTrigger.id = 'bcm-trigger';
    state.htmlTrigger.title = 'BC Offline Messenger (Alt+M)';
    applyTriggerBaseStyles(state.htmlTrigger);

    state.htmlBadgeEl = document.createElement('span');
    state.htmlBadgeEl.id = 'bcm-trigger-badge';
    state.htmlTrigger.appendChild(state.htmlBadgeEl);

    const htmlOnlineChip = document.createElement('span');
    htmlOnlineChip.id = 'bcm-online-chip';
    state.htmlTrigger.appendChild(htmlOnlineChip);

    let tdrag = false, tdx = 0, tdy = 0, tmoved = false;
    state.htmlTrigger.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      tdrag = true; tmoved = false;
      const r = state.htmlTrigger.getBoundingClientRect();
      tdx = e.clientX - r.left; tdy = e.clientY - r.top;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('mousemove', e => {
      if (!tdrag) return;
      tmoved = true;
      state.htmlTrigger.style.setProperty('right',  'auto', 'important');
      state.htmlTrigger.style.setProperty('bottom', 'auto', 'important');
      state.htmlTrigger.style.setProperty('left', Math.max(0, Math.min(e.clientX - tdx, window.innerWidth  - 52)) + 'px', 'important');
      state.htmlTrigger.style.setProperty('top',  Math.max(0, Math.min(e.clientY - tdy, window.innerHeight - 52)) + 'px', 'important');
      e.stopPropagation();
    }, true);
    window.addEventListener('mouseup', e => {
      if (!tdrag) return;
      tdrag = false;
      if (tmoved) {
        const r = state.htmlTrigger.getBoundingClientRect();
        GM_setValue(state.STORE + 'iconPos', JSON.stringify({ left: r.left, top: r.top }));
      } else if (state.loggedIn) {
        toggleDialog();
      }
    }, true);

    const savedPos = GM_getValue(state.STORE + 'iconPos', null);
    if (savedPos) {
      try {
        const { left, top } = JSON.parse(savedPos);
        const l = Math.max(0, Math.min(left, window.innerWidth  - 52));
        const t = Math.max(0, Math.min(top,  window.innerHeight - 52));
        state.htmlTrigger.style.setProperty('right',  'auto', 'important');
        state.htmlTrigger.style.setProperty('bottom', 'auto', 'important');
        state.htmlTrigger.style.setProperty('left', l + 'px', 'important');
        state.htmlTrigger.style.setProperty('top',  t + 'px', 'important');
      } catch {}
    }

    // Prefer the Popover API — puts the element in the browser's top layer,
    // which renders above WebGL composited layers (fixes Safari/Edge visibility).
    // Fall back to documentElement (same anchor used by all other BCM overlays).
    if (typeof state.htmlTrigger.showPopover === 'function') {
      state.htmlTrigger.setAttribute('popover', 'manual');
      document.documentElement.appendChild(state.htmlTrigger);
      try { state.htmlTrigger.showPopover(); } catch {}
    } else {
      document.documentElement.appendChild(state.htmlTrigger);
    }
    updateHTMLBadge();
  }


  state.toastRoot = null;

  function ensureToastRoot() {
    if (state.toastRoot && document.documentElement.contains(state.toastRoot)) return state.toastRoot;
    state.toastRoot = document.createElement('div');
    Object.assign(state.toastRoot.style, {
      position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '300px',
      pointerEvents: 'none', fontFamily: 'Arial, sans-serif',
    });
    document.documentElement.appendChild(state.toastRoot);
    return state.toastRoot;
  }

  function showToast(senderName, content, senderNum) {
    if (isMuted(senderNum)) return;

    const override = senderNum ? state.contactNotifyOverrides[String(senderNum)] : null;
    if (override === 'never') return;
    const alwaysNotify = override === 'always';

    const msgTextLower = String(content ?? '').toLowerCase();
    const matchedKw = state.keywordAlerts.find(kw => kw && msgTextLower.includes(kw.toLowerCase()));
    if (matchedKw && !alwaysNotify) {
      playNotifSound();
      const root = ensureToastRoot();
      const kt = document.createElement('div');
      Object.assign(kt.style, {
        background: '#fff8e1', border: '2px solid #f0b000', borderRadius: '10px',
        padding: '10px 14px', color: '#2d2d2d', fontSize: '13px',
        boxShadow: '0 4px 20px rgba(240,176,0,.35)', cursor: 'pointer',
        pointerEvents: 'all', opacity: '0', transform: 'translateX(110%)',
        transition: 'opacity .25s ease, transform .25s ease', wordBreak: 'break-word',
      });
      const kn = document.createElement('div');
      kn.style.cssText = 'font-weight:bold;color:#b07800;margin-bottom:3px;font-size:12px';
      kn.textContent = '🔔 ' + senderName + ' — keyword: ' + matchedKw;
      const kb = document.createElement('div');
      kb.style.cssText = 'color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      kb.textContent = String(content ?? '');
      kt.appendChild(kn); kt.appendChild(kb);
      kt.onclick = () => {
        if (senderNum && state.loggedIn) { openDialog(); selectContact(senderNum, state.contactMeta[senderNum]?.name ?? `Member #${senderNum}`); }
        kt.remove();
      };
      root.appendChild(kt);
      requestAnimationFrame(() => { kt.style.opacity = '1'; kt.style.transform = 'translateX(0)'; });
      setTimeout(() => { kt.style.opacity = '0'; kt.style.transform = 'translateX(110%)'; setTimeout(() => kt.remove(), 300); }, 6000);
      return;
    }

    const inDnd = state.availabilityState === 'dnd';

    const canNativeNotify = state.systemNotificationsEnabled && typeof Notification !== 'undefined'
      && Notification.permission === 'granted' && document.visibilityState === 'hidden';

    if (!state.toastsEnabled && !canNativeNotify) return;

    if (!inDnd) playNotifSound();
    else if (!canNativeNotify) return;

    if (canNativeNotify && (alwaysNotify || !inDnd)) {
      try {
        const n = new Notification(senderName, { body: String(content ?? '').slice(0, MAX_NOTIFICATION_BODY_LENGTH) });
        n.onclick = () => {
          try { unsafeWindow.focus?.(); window.focus(); } catch {}
          n.close();
          if (senderNum && state.loggedIn) { openDialog(); selectContact(senderNum, state.contactMeta[senderNum]?.name ?? `Member #${senderNum}`); }
        };
      } catch {}
    }
    if (!state.toastsEnabled || inDnd) return;
    const root  = ensureToastRoot();
    const toast = document.createElement('div');
    Object.assign(toast.style, {
      background: '#ffffff', border: '1px solid #f0b0c8', borderRadius: '10px',
      padding: '10px 14px', color: '#2d2d2d', fontSize: '13px',
      boxShadow: '0 4px 20px rgba(196,48,96,.25)', cursor: 'pointer',
      pointerEvents: 'all', opacity: '0', transform: 'translateX(110%)',
      transition: 'opacity .25s ease, transform .25s ease', wordBreak: 'break-word',
    });
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const name = document.createElement('div');
    name.style.cssText = 'font-weight:bold;color:#c43060;margin-bottom:3px;font-size:12px';
    name.textContent = '💬 ' + senderName;
    const body = document.createElement('div');
    body.style.cssText = 'color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    body.textContent = content;
    const ts = document.createElement('div');
    ts.style.cssText = 'color:#a0a8b8;font-size:10px;margin-top:4px';
    ts.textContent = time;
    toast.append(name, body, ts);
    toast.addEventListener('click', () => {
      dismiss();
      if (senderNum && state.loggedIn) { openDialog(); selectContact(senderNum, state.contactMeta[senderNum]?.name ?? `Member #${senderNum}`); }
    });
    root.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      toast.style.opacity = '1'; toast.style.transform = 'translateX(0)';
    }));
    function dismiss() {
      toast.style.opacity = '0'; toast.style.transform = 'translateX(110%)';
      setTimeout(() => toast.remove(), 280);
    }
    setTimeout(dismiss, 6000);
  }


  const THEMES = {
    ...STATIC_THEMES,
    get custom() { return buildCustomTheme(state.STORE); },
  };



  function applyTheme(name) {
    if (!THEMES[name]) name = 'light';
    state.currentTheme = name;
    GM_setValue(state.STORE + 'theme', name);
    let s = document.getElementById('bcm-theme-vars');
    if (!s) { s = document.createElement('style'); s.id = 'bcm-theme-vars'; document.documentElement.appendChild(s); }
    const vars = THEMES[name].replace('--bcm-font-size:13px', `--bcm-font-size:${{ small:'11px', medium:'13px', large:'15px' }[state.fontSize] ?? '13px'}`);
    s.textContent = `.bcm-dialog-wrap,.bcm-settings-wrap,.bcm-ctx-menu,.bcm-emoji-panel,.bcm-qr-panel,.bcm-onetime-overlay,.bcm-mention-panel,.bcm-globalsearch-card{${vars}}`;
    document.querySelectorAll('.bcm-theme-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.theme === name);
    });
    document.querySelectorAll('.bcm-fontsize-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === state.fontSize);
    });
  }

  function applyFontSize(size) {
    state.fontSize = size;
    GM_setValue(state.STORE + 'fontSize', size);
    applyTheme(state.currentTheme);
    document.querySelectorAll('.bcm-fontsize-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.size === size);
    });
  }


  function applyCompactMode(on) {
    state.compactMode = !!on;
    GM_setValue(state.STORE + 'compact', state.compactMode);
    state.dialogEl?.classList.toggle('bcm-compact', state.compactMode);
    document.querySelectorAll('.bcm-density-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.density === 'compact') === state.compactMode);
    });
  }

  function playNotifSound() {
    if (!state.soundEnabled) return;
    try {
      const ctx  = new (unsafeWindow.AudioContext || unsafeWindow.webkitAudioContext)();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }

  function requestNotificationPermission() {
    if (!state.systemNotificationsEnabled || typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  }

  function persistStarred() {
    GM_setValue(state.STORE + 'starred', JSON.stringify([...state.starredMessages]));
  }

  function persistSyncedPreferencesLocal() {
    GM_setValue(state.STORE + 'notes', JSON.stringify(state.contactNotes));
    GM_setValue(state.STORE + 'pinned', JSON.stringify([...state.pinnedContacts]));
    GM_setValue(state.STORE + 'muted', JSON.stringify([...state.mutedContacts]));
    GM_setValue(state.STORE + 'disappearing', JSON.stringify(state.disappearingByConversation));
    GM_setValue(state.STORE + 'notifyOverrides', JSON.stringify(state.contactNotifyOverrides));
    saveToExtensionSettings();
  }

  function saveToExtensionSettings() {
    try {
      const W = unsafeWindow;
      if (!W.Player?.ExtensionSettings) return;
      W.Player.ExtensionSettings['BCMessenger'] = JSON.stringify({
        muted: [...state.mutedContacts],
        pinned: [...state.pinnedContacts],
        quickReplies: state.quickReplies,
      });
      if (typeof W.ServerSend === 'function') {
        W.ServerSend('AccountUpdate', { ExtensionSettings: W.Player.ExtensionSettings });
      }
    } catch (e) {}
  }

  function loadFromExtensionSettings() {
    // Only restore if GM storage was cleared (key is literally absent from localStorage)
    if (localStorage.getItem('_gm_' + state.STORE + 'muted') !== null) return;
    try {
      const W = unsafeWindow;
      const raw = W.Player?.ExtensionSettings?.['BCMessenger'];
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.muted)) {
        state.mutedContacts = new Set(data.muted);
        GM_setValue(state.STORE + 'muted', JSON.stringify([...state.mutedContacts]));
      }
      if (Array.isArray(data.pinned)) {
        state.pinnedContacts = new Set(data.pinned);
        GM_setValue(state.STORE + 'pinned', JSON.stringify([...state.pinnedContacts]));
      }
      if (Array.isArray(data.quickReplies) && data.quickReplies.length) {
        state.quickReplies = data.quickReplies;
        GM_setValue(state.STORE + 'quickreplies', JSON.stringify(state.quickReplies));
      }
      showToast('Settings restored from BC backup', false);
    } catch (e) {}
  }

  function buildSyncedPreferencesPayload() {
    return {
      notes: { ...(state.contactNotes || {}) },
      pinned: [...state.pinnedContacts].map(Number).filter(Boolean),
      muted: [...state.mutedContacts].map(Number).filter(Boolean),
      disappearing: { ...(state.disappearingByConversation || {}) },
      notifyOverrides: { ...(state.contactNotifyOverrides || {}) },
    };
  }

  function hasLocalSyncedPreferences() {
    return Object.keys(state.contactNotes || {}).length > 0
      || state.pinnedContacts.size > 0
      || state.mutedContacts.size > 0
      || Object.keys(state.disappearingByConversation || {}).length > 0
      || Object.keys(state.contactNotifyOverrides || {}).length > 0;
  }

  function applyServerReactions(reactions) {
    const next = {};
    Object.entries(state.msgReactions || {}).forEach(([key, value]) => {
      if (!isServerBackedMessageKey(key) && value) next[key] = value;
    });
    Object.entries(reactions || {}).forEach(([key, value]) => {
      if (isServerBackedMessageKey(key) && value && typeof value === 'object') next[key] = value;
    });
    state.msgReactions = next;
    persistReactions();
  }

  function applyServerStarred(starred) {
    const next = new Set();
    [...state.starredMessages].forEach(key => {
      if (!isServerBackedMessageKey(key)) next.add(key);
    });
    (Array.isArray(starred) ? starred : []).forEach(key => {
      if (isServerBackedMessageKey(key)) next.add(String(key));
    });
    state.starredMessages = next;
    persistStarred();
  }

  function applyServerPreferences(preferences) {
    if (!preferences || typeof preferences !== 'object') return;
    state.contactNotes = preferences.notes && typeof preferences.notes === 'object' ? { ...preferences.notes } : {};
    state.pinnedContacts = new Set((Array.isArray(preferences.pinned) ? preferences.pinned : []).map(Number).filter(Boolean));
    state.mutedContacts = new Set((Array.isArray(preferences.muted) ? preferences.muted : []).map(Number).filter(Boolean));
    state.disappearingByConversation = preferences.disappearing && typeof preferences.disappearing === 'object' ? { ...preferences.disappearing } : {};
    state.contactNotifyOverrides = preferences.notifyOverrides && typeof preferences.notifyOverrides === 'object' ? { ...preferences.notifyOverrides } : {};
    persistSyncedPreferencesLocal();
    if (state.selectedContact) syncNotesBar(state.selectedContact);
    updateDisappearingHeaderButton();
    updateReadReceiptHeaderButton();
    refreshContactList();
    if (state.dialogOpen) redrawCurrentConversation().catch(() => {});
  }

  function scheduleSyncedPreferencesSave() {
    persistSyncedPreferencesLocal();
    clearTimeout(state.syncedPrefsSaveTimer);
    state.syncedPrefsSaveTimer = setTimeout(() => {
      if (!state.loggedIn || !state.memberNumber) return;
      saveServerPreferences(buildSyncedPreferencesPayload()).catch(() => {});
    }, 400);
  }

  function persistNotifyOverrides() {
    GM_setValue(state.STORE + 'notifyOverrides', JSON.stringify(state.contactNotifyOverrides));
    scheduleSyncedPreferencesSave();
  }

  function getNotifyOverrideIcon(num) {
    const mode = state.contactNotifyOverrides[String(num)];
    if (mode === 'always') return '🔔';
    if (mode === 'never') return '🔕';
    return '';
  }

  async function syncServerBackedState() {
    // Note: fetch response object into a local const so `state` still refers to
    // the shared module state below (seeding reads the local reaction map).
    const serverState = await getSyncedState();
    const serverReactions = serverState?.reactions || {};
    const serverStarred = serverState?.starred || [];
    let seededServerState = false;
    if (!Object.keys(serverReactions).length) {
      const localServerReactions = Object.entries(state.msgReactions || {})
        .filter(([key, value]) => isServerBackedMessageKey(key) && value && typeof value === 'object' && Object.keys(value).length);
      for (const [key, value] of localServerReactions) {
        const mine = myReactionEmoji(value);
        if (mine) await setServerReaction(key, mine).catch(() => {});
      }
      if (localServerReactions.length) seededServerState = true;
    }
    if (!serverStarred.length) {
      const localServerStarred = [...state.starredMessages].filter(isServerBackedMessageKey);
      for (const key of localServerStarred) {
        await setServerStar(key, true).catch(() => {});
      }
      if (localServerStarred.length) seededServerState = true;
    }
    const nextState = seededServerState ? await getSyncedState().catch(() => null) : serverState;
    if (nextState) {
      applyServerReactions(nextState?.reactions || {});
      applyServerStarred(nextState?.starred || []);
    }
    if (nextState?.preferences) {
      applyServerPreferences(nextState.preferences);
    } else if (hasLocalSyncedPreferences()) {
      await saveServerPreferences(buildSyncedPreferencesPayload()).catch(() => {});
    }
    if (state.dialogOpen) await redrawCurrentConversation();
    if (state.starredPanelOpen) renderStarredPanel();

    loadOwnProfile().catch(() => {});
    refreshTrustedContactsCache().catch(() => {});
  }

  async function setReactionByKey(key, emoji) {
    if (!key) return;
    const nextEmoji = String(emoji ?? '');
    const prevMap = state.msgReactions[key] || {};
    const prevSnapshot = JSON.parse(JSON.stringify(prevMap));
    const myNum = state.memberNumber;

    // Optimistic local update: clear my previous reaction, add the new one.
    const next = {};
    for (const [em, members] of Object.entries(prevMap)) {
      const rest = members.filter(n => n !== myNum);
      if (rest.length) next[em] = rest;
    }
    if (nextEmoji) next[nextEmoji] = [...(next[nextEmoji] || []), myNum];
    state.msgReactions[key] = next;
    persistReactions();
    updateBubbleReactionByKey(key);

    if (isServerBackedMessageKey(key)) {
      try {
        const r = await setServerReaction(key, nextEmoji);
        if (r?.reactions && typeof r.reactions === 'object') {
          state.msgReactions[key] = r.reactions;
          persistReactions();
          updateBubbleReactionByKey(key);
        }
      } catch (e) {
        state.msgReactions[key] = prevSnapshot;
        persistReactions();
        updateBubbleReactionByKey(key);
        showNote(`Reaction sync failed: ${e.message}`, true);
      }
    }
  }

  async function setStarByKey(key, starred) {
    if (!key) return;
    const wasStarred = state.starredMessages.has(key);
    if (starred) state.starredMessages.add(key);
    else state.starredMessages.delete(key);
    persistStarred();
    updateBubbleStarByKey(key);
    if (state.starredPanelOpen) renderStarredPanel();
    if (isServerBackedMessageKey(key)) {
      try {
        await setServerStar(key, !!starred);
      } catch (e) {
        if (wasStarred) state.starredMessages.add(key);
        else state.starredMessages.delete(key);
        persistStarred();
        updateBubbleStarByKey(key);
        if (state.starredPanelOpen) renderStarredPanel();
        showNote(`Star sync failed: ${e.message}`, true);
      }
    }
  }

  function isStarred(key) {
    return !!key && state.starredMessages.has(key);
  }

  function toggleStarByKey(key) {
    if (!key) return;
    setStarByKey(key, !state.starredMessages.has(key)).catch(() => {});
  }

  function updateBubbleStarByKey(key) {
    if (!key) return;
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    const bubble = list ? Array.from(list.querySelectorAll('.bcm-bubble')).find(b => b.dataset.reactionKey === key) : null;
    if (!bubble) return;
    bubble.classList.toggle('is-starred', isStarred(key));
    let star = bubble.querySelector('.bcm-star-chip');
    if (isStarred(key)) {
      if (!star) {
        star = el('span', { cls: 'bcm-star-chip', title: 'Starred' }, '⭐');
        bubble.appendChild(star);
      }
    } else if (star) {
      star.remove();
    }
  }

  function encodeQuotePayload(content, quote) {
    return encodeMessagePayload(content, quote, { spoiler: false, oneTime: false });
  }

  function parseQuotePayload(content) {
    return parseMessagePayload(content);
  }

  function stripBcFormattingTrailer(content) {
    const raw = String(content ?? '');
    if (!raw) return '';
    const trailerRe = /(?:\r?\n|\s)*[\uF000-\uF8FF]?\{[^{}\n]*(?:"messageType"|"messageColor")[^{}\n]*\}\s*$/;
    if (!trailerRe.test(raw)) return raw;
    return raw.replace(trailerRe, '').trimEnd();
  }

  function resolveBcWhisperContent(data) {
    const rawContent = stripBcFormattingTrailer(data?.Content);
    const dictionary = Array.isArray(data?.Dictionary) ? data.Dictionary : [];
    if (!dictionary.length) return rawContent;

    if (rawContent) {
      let formatted = rawContent;
      for (const entry of dictionary) {
        const tag = String(entry?.Tag ?? '').trim();
        const text = String(entry?.Text ?? '');
        if (!tag || !text) continue;
        const escapedTag = escapeRegExp(tag);
        formatted = formatted
          .replace(new RegExp(`\\{${escapedTag}\\}`, 'g'), text)
          .replace(new RegExp(`%${escapedTag}%`, 'g'), text)
          .replace(new RegExp(`\\b${escapedTag}\\b`, 'g'), text);
      }
      if (formatted && formatted !== rawContent) return stripBcFormattingTrailer(formatted);
    }

    const preferredTag = ['Message', 'Content', 'ChatMessage', 'Text', 'AutomaticSentence']
      .map(tag => dictionary.find(entry => String(entry?.Tag ?? '').toLowerCase() === tag.toLowerCase()))
      .find(Boolean);
    if (preferredTag?.Text) return stripBcFormattingTrailer(preferredTag.Text);

    const longestText = dictionary
      .map(entry => String(entry?.Text ?? '').trim())
      .filter(Boolean)
      .sort((a, b) => b.length - a.length)[0];
    if (longestText) return stripBcFormattingTrailer(longestText);

    return rawContent;
  }

  function getMessagePreviewText(content, deleted = false) {
    if (deleted) return '[Message deleted]';
    const parsed = parseMessagePayload(content ?? '');
    if (parsed.oneTime) return '🔐 One-time message';
    if (parsed.spoiler) return '🙈 Spoiler message';
    return parsed.text || '';
  }

  function setQuote(msg, reactionKey) {
    if (!msg) return;
    const parsed = parseQuotePayload(msg.content ?? '');
    state.currentQuote = {
      senderNum: msg.senderNum ?? null,
      senderName: msg.senderName || (msg.fromUs ? (state.memberName ?? `Member #${state.memberNumber}`) : `Member #${msg.senderNum}`),
      text: (parsed.text || '').slice(0, MAX_QUOTE_TEXT_LENGTH),
    };
    state.currentParentMessageRef = reactionKey || null;
    syncQuoteBar();
  }

  function clearQuote() {
    state.currentQuote = null;
    state.currentParentMessageRef = null;
    syncQuoteBar();
  }

  function syncQuoteBar() {
    const bar = state.dialogEl?.querySelector('.bcm-quote-bar');
    const textEl = state.dialogEl?.querySelector('.bcm-quote-text');
    if (!bar || !textEl) return;
    if (!state.currentQuote) {
      bar.style.display = 'none';
      textEl.textContent = '';
      return;
    }
    bar.style.display = 'flex';
    const sender = state.currentQuote.senderName || (state.currentQuote.senderNum ? `Member #${state.currentQuote.senderNum}` : 'Unknown');
    textEl.textContent = `Replying to ${sender}: ${state.currentQuote.text || '(empty)'}`;
  }

  function syncComposeModeButtons() {
    const spoilerBtn = state.dialogEl?.querySelector('.bcm-spoiler-btn');
    const oneTimeBtn = state.dialogEl?.querySelector('.bcm-onetime-btn');
    if (spoilerBtn) spoilerBtn.classList.toggle('active', state.composeSpoiler);
    if (oneTimeBtn) oneTimeBtn.classList.toggle('active', state.composeOneTime);
  }

  function clearComposeModes() {
    state.composeSpoiler = false;
    state.composeOneTime = false;
    syncComposeModeButtons();
  }


  function toggleHeaderOverflow() {
    const wrap = state.dialogEl?.querySelector('.bcm-overflow-wrap');
    if (!wrap) return;
    const isOpen = wrap.classList.toggle('open');
    if (isOpen) {
      const close = e => {
        if (!wrap.contains(e.target)) {
          wrap.classList.remove('open');
          document.removeEventListener('click', close, true);
        }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    }
  }

  function toggleMsgSearch() {
    const bar = state.dialogEl?.querySelector('.bcm-msgsearch-bar');
    if (!bar) return;
    state.msgSearchOpen = !state.msgSearchOpen;
    bar.classList.toggle('open', state.msgSearchOpen);
    if (state.msgSearchOpen) bar.querySelector('.bcm-msgsearch-input')?.focus();
    else { closeMsgSearch(); }
  }

  function closeMsgSearch() {
    state.msgSearchOpen = false;
    const bar = state.dialogEl?.querySelector('.bcm-msgsearch-bar');
    if (bar) { bar.classList.remove('open'); const inp = bar.querySelector('.bcm-msgsearch-input'); if (inp) inp.value = ''; }
    state.dialogEl?.querySelectorAll('.bcm-highlight').forEach(m => {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    state.msgSearchHits = []; state.msgSearchIdx = 0;
    updateMsgSearchCount();
  }

  function runMsgSearch(q) {
    state.dialogEl?.querySelectorAll('.bcm-highlight').forEach(m => {
      m.replaceWith(document.createTextNode(m.textContent));
    });
    state.msgSearchHits = []; state.msgSearchIdx = 0;
    if (!q.trim()) { updateMsgSearchCount(); return; }
    const list  = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    list.querySelectorAll('.bcm-bubble').forEach(bubble => {
      const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      for (const node of nodes) {
        const text = node.nodeValue;
        if (!re.test(text)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0, m;
        while ((m = re.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          const mark = document.createElement('mark');
          mark.className = 'bcm-highlight';
          mark.textContent = m[0];
          frag.appendChild(mark);
          state.msgSearchHits.push(mark);
          last = m.index + m[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      }
    });
    if (state.msgSearchHits.length) {
      state.msgSearchHits[0].classList.add('active');
      state.msgSearchHits[0].scrollIntoView({ block: 'nearest' });
    }
    updateMsgSearchCount();
  }

  function stepMsgSearch(dir) {
    if (!state.msgSearchHits.length) return;
    state.msgSearchHits[state.msgSearchIdx]?.classList.remove('active');
    state.msgSearchIdx = (state.msgSearchIdx + dir + state.msgSearchHits.length) % state.msgSearchHits.length;
    const hit = state.msgSearchHits[state.msgSearchIdx];
    hit.classList.add('active');
    hit.scrollIntoView({ block: 'nearest' });
    updateMsgSearchCount();
  }

  function updateMsgSearchCount() {
    const el2 = state.dialogEl?.querySelector('.bcm-msgsearch-count');
    if (!el2) return;
    el2.textContent = state.msgSearchHits.length ? `${state.msgSearchIdx + 1}/${state.msgSearchHits.length}` : (state.dialogEl?.querySelector('.bcm-msgsearch-input')?.value ? '0' : '');
  }


  function closeQRPanel() {
    state.qrPanelEl?.remove();
    state.qrPanelEl = null;
  }

  function toggleQRPanel(inputEl) {
    if (state.qrPanelEl) { closeQRPanel(); return; }
    const rect = inputEl.getBoundingClientRect();
    state.qrPanelEl = el('div', { cls: 'bcm-qr-panel',
      style: { left: rect.left + 'px', bottom: (window.innerHeight - rect.top + 6) + 'px', maxWidth: rect.width + 'px' }
    });
    if (!state.quickReplies.length) {
      state.qrPanelEl.appendChild(el('div', { cls: 'bcm-qr-item', style: { color: 'var(--bcm-text-muted)', cursor: 'default' } }, 'No quick replies saved'));
    } else {
      for (const qr of state.quickReplies) {
        state.qrPanelEl.appendChild(el('div', { cls: 'bcm-qr-item', onclick: () => {
          const start = inputEl.selectionStart ?? inputEl.value.length;
          const end   = inputEl.selectionEnd   ?? inputEl.value.length;
          inputEl.value = inputEl.value.slice(0, start) + qr + inputEl.value.slice(end);
          inputEl.selectionStart = inputEl.selectionEnd = start + qr.length;
          inputEl.focus();
          autoResize({ target: inputEl });
          closeQRPanel();
        }}, qr));
      }
    }
    document.documentElement.appendChild(state.qrPanelEl);
    setTimeout(() => document.addEventListener('click', closeQRPanel, { once: true }), 0);
  }


  state.tmplPanelEl = null;
  function closeTmplPanel() { state.tmplPanelEl?.remove(); state.tmplPanelEl = null; }

  function toggleTemplatePanel(inputEl) {
    if (state.tmplPanelEl) { closeTmplPanel(); return; }
    const rect = inputEl.getBoundingClientRect();
    state.tmplPanelEl = el('div', { cls: 'bcm-qr-panel',
      style: { left: rect.left + 'px', bottom: (window.innerHeight - rect.top + 6) + 'px', maxWidth: rect.width + 'px' }
    });
    if (!state.messageTemplates.length) {
      state.tmplPanelEl.appendChild(el('div', { cls: 'bcm-qr-item', style: { color: 'var(--bcm-text-muted)', cursor: 'default' } }, 'No templates yet — add some in Settings'));
    } else {
      for (const t of state.messageTemplates) {
        const preview = t.text.length > 50 ? t.text.slice(0, 50) + '…' : t.text;
        state.tmplPanelEl.appendChild(el('div', { cls: 'bcm-qr-item', title: t.text, onclick: () => {
          const start = inputEl.selectionStart ?? inputEl.value.length;
          const end   = inputEl.selectionEnd   ?? inputEl.value.length;
          inputEl.value = inputEl.value.slice(0, start) + t.text + inputEl.value.slice(end);
          inputEl.selectionStart = inputEl.selectionEnd = start + t.text.length;
          inputEl.focus();
          autoResize({ target: inputEl });
          closeTmplPanel();
        }},
          el('strong', { style: { marginRight: '4px' } }, t.name + ':'),
          preview,
        ));
      }
    }
    document.documentElement.appendChild(state.tmplPanelEl);
    setTimeout(() => document.addEventListener('click', closeTmplPanel, { once: true }), 0);
  }

  function updateNotesIndicator(num = state.selectedContact) {
    const btn = state.dialogEl?.querySelector('.bcm-notes-btn');
    const editBtn = state.dialogEl?.querySelector('.bcm-edit-contact-btn');
    const hasContact = !!num;
    const hasNote = hasContact && !!String(state.contactNotes[String(num)] ?? '').trim();
    if (btn) btn.disabled = !hasContact;
    if (editBtn) editBtn.disabled = !hasContact;
    if (btn) btn.classList.toggle('has-note', hasNote);
  }

  function syncNotesBar(num = state.selectedContact) {
    const bar = state.dialogEl?.querySelector('.bcm-notes-bar');
    const area = state.dialogEl?.querySelector('.bcm-notes-text');
    updateNotesIndicator(num);
    if (!bar || !area) return;
    bar.classList.toggle('open', state.notesOpen && !!num);
    area.value = num ? (state.contactNotes[String(num)] ?? '') : '';
    area.disabled = !num;
  }

  function persistContactNote(num, value) {
    const key = String(num);
    const note = value.trim();
    if (note) state.contactNotes[key] = note;
    else delete state.contactNotes[key];
    scheduleSyncedPreferencesSave();
    updateNotesIndicator(num);
  }

  function persistContactTags(num, tags) {
    const key = String(num);
    if (tags && tags.length) state.contactTags[key] = tags;
    else delete state.contactTags[key];
    GM_setValue(state.STORE + 'tags', JSON.stringify(state.contactTags));
    renderTagStrip();
    refreshContactList();
  }

  function getAllTags() {
    const all = new Set();
    Object.values(state.contactTags).forEach(t => t.forEach(tag => all.add(tag)));
    return [...all].sort();
  }

  function renderTagStrip() {
    const strip = state.dialogEl?.querySelector('.bcm-tag-strip');
    if (!strip) return;
    strip.innerHTML = '';
    const tags = getAllTags();
    if (!tags.length) { strip.style.display = 'none'; return; }
    strip.style.display = '';
    for (const tag of tags) {
      strip.appendChild(el('button', {
        cls: `bcm-tag-chip${state.activeLabelFilter === tag ? ' active' : ''}`,
        onclick: () => {
          state.activeLabelFilter = state.activeLabelFilter === tag ? '' : tag;
          GM_setValue(state.STORE + 'activeLabel', state.activeLabelFilter);
          renderTagStrip();
          refreshContactList();
        },
      }, tag));
    }
  }

  function saveCurrentContactNote() {
    if (!state.selectedContact) return;
    const notesArea = state.dialogEl?.querySelector('.bcm-notes-text');
    if (notesArea) persistContactNote(state.selectedContact, notesArea.value);
  }

  function onNotesInput(e) {
    if (!state.selectedContact) return;
    state.dialogEl?.querySelector('.bcm-notes-btn')?.classList.toggle('has-note', !!e.target.value.trim());
    clearTimeout(state.notesSaveTimer);
    const num = state.selectedContact;
    const value = e.target.value;
    state.notesSaveTimer = setTimeout(() => persistContactNote(num, value), 500);
  }

  function toggleNotesBar() {
    if (!state.selectedContact) return;
    state.notesOpen = !state.notesOpen;
    syncNotesBar();
    if (state.notesOpen) state.dialogEl?.querySelector('.bcm-notes-text')?.focus();
  }

  function getContactAvatarUrl(memberNum) {
    const key = String(memberNum);
    return sanitizeHttpUrl(String(state.contactAvatarUrls[key] ?? '').trim()) || '';
  }

  function setContactAvatarUrl(memberNum, url) {
    const key = String(memberNum);
    const safeUrl = sanitizeHttpUrl(String(url ?? '').trim()) || '';
    if (safeUrl) state.contactAvatarUrls[key] = safeUrl;
    else delete state.contactAvatarUrls[key];
    GM_setValue(state.STORE + 'avatarUrls', JSON.stringify(state.contactAvatarUrls));
    return safeUrl;
  }

  function createContactAvatar(memberNum, name, online = false, cls = 'bcm-avatar') {
    const avatarUrl = getContactAvatarUrl(memberNum);
    const style = avatarUrl ? {} : { background: getAvatarFallbackColor(memberNum) };
    const initLetter = (name || '?').charAt(0).toUpperCase();
    const availCls = memberAvailClass(memberNum, online);
    const avatar = el('div', { cls: `${cls}${availCls ? ' ' + availCls : ''}`, style },
      ...(avatarUrl
        ? [el('img', {
            cls: 'bcm-avatar-img',
            src: avatarUrl,
            alt: `${name || 'Contact'} avatar`,
            referrerpolicy: 'no-referrer',
            loading: 'lazy',
            onerror: e => {
              const host = e.currentTarget?.parentElement;
              if (!host) return;
              host.replaceChildren();
              host.style.background = getAvatarFallbackColor(memberNum);
              host.textContent = initLetter;
            },
          })]
        : [initLetter]
      )
    );
    return avatar;
  }

  function buildAvatarFallbackDataUrl(memberNum, name) {
    const initial = String(name || '?').charAt(0).toUpperCase();
    const svg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="100%" height="100%" fill="${getAvatarFallbackColor(memberNum)}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" fill="white">${initial}</text></svg>`);
    return `data:image/svg+xml;utf8,${svg}`;
  }

  function getAvatarFallbackColor(memberNum) {
    return `hsl(${Number(memberNum) % 360},52%,48%)`;
  }

  function syncHeaderAvatarForContact(num, name, online = false) {
    const avatar = state.dialogEl?.querySelector('.bcm-msghead-avatar');
    if (!avatar) return;
    avatar.style.display = num ? '' : 'none';
    if (!num) {
      avatar.removeAttribute('src');
      return;
    }
    const safeName = getSafeDisplayName(name, num, '') || `Member #${num}`;
    const node = createContactAvatar(num, safeName, online, 'bcm-msghead-avatar');
    avatar.className = node.className;
    avatar.style.cssText = node.style.cssText;
    if (node.querySelector('img')) {
      avatar.src = node.querySelector('img').src;
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = buildAvatarFallbackDataUrl(num, safeName);
      };
    } else {
      avatar.onerror = null;
      avatar.src = buildAvatarFallbackDataUrl(num, safeName);
    }
  }



  state.dialogEl   = null;
  state.dialogOpen = false;

  function buildDialog() {
    if (state.dialogEl) return;

    const style = document.createElement('style');
    style.textContent = DIALOG_CSS;
    document.documentElement.appendChild(style);

    state.dialogEl = el('div', { cls: 'bcm-dialog-wrap' },
      el('div', { cls: 'bcm-titlebar' },
        el('div', { cls: 'bcm-dtitle' }, '💬 BC Messenger'),
        el('div', { cls: 'bcm-gear', title: 'Settings', onclick: e => { e.stopPropagation(); openSettingsDialog(); } }, '⚙'),
        el('div', { cls: 'bcm-dclose', onclick: closeDialog }, '×'),
      ),
      el('div', { cls: 'bcm-update-bar', style: { display: 'none' } }),
      el('div', { cls: 'bcm-body' },
        el('div', { cls: 'bcm-sidebar' },
          el('div', { cls: 'bcm-search-wrap' },
            el('input', { cls: 'bcm-search', type: 'text', placeholder: 'Search…',
              oninput: onSearchInput, onkeydown: stopProp }),
            el('button', { cls: 'bcm-clearall-btn', onclick: clearAllUnread, title: 'Mark all as read' }, '✓ All'),
          ),
          el('div', { cls: 'bcm-tag-strip', style: { display: 'none' } }),
          el('div', { cls: 'bcm-icon-strip' },
            el('button', { cls: 'bcm-strip-btn bcm-friends-tab',     title: 'Friends',     onclick: () => toggleFriendsPanel()     }, '👤'),
            el('button', { cls: 'bcm-strip-btn bcm-roomusers-tab',   title: 'Room users',  onclick: () => toggleRoomUsersPanel()   }, '👥'),
            el('button', { cls: 'bcm-strip-btn bcm-lobby-tab',       title: 'Lobby',       onclick: () => toggleLobbyPanel()       }, '🏠'),
            el('button', { cls: 'bcm-strip-btn bcm-starred-tab',     title: 'Starred',     onclick: () => toggleStarredPanel()     }, '⭐'),
            el('button', { cls: 'bcm-strip-btn bcm-collections-tab', title: 'Collections', onclick: () => toggleCollectionsPanel() }, '📁'),
            el('button', { cls: 'bcm-strip-btn bcm-state.unread-tab',      title: 'Unread',      onclick: () => toggleUnreadPanel()      }, '📬'),
            el('button', { cls: 'bcm-strip-btn', title: 'Saved messages', onclick: () => openSavedMessages() }, '🔖'),
            el('div',    { cls: 'bcm-strip-sep' }),
            el('button', { cls: 'bcm-strip-btn', title: 'Import friends', onclick: () => openBCImportDialog()   }, '📥'),
            el('button', { cls: 'bcm-strip-btn', title: 'Import room',    onclick: () => openRoomImportDialog() }, '📍'),
            el('button', { cls: 'bcm-strip-btn', title: 'Broadcast',      onclick: () => openBroadcastDialog()  }, '📣'),
          ),
          el('div', { cls: 'bcm-clist' }),
          el('button', { cls: 'bcm-addbtn', onclick: promptAddContact },
            '+', el('span', { cls: 'bcm-addbtn-label' }, ' New message')),
          el('button', { cls: 'bcm-addbtn', onclick: promptCreateGroup, style: { marginTop: '4px' } },
            '👥', el('span', { cls: 'bcm-addbtn-label' }, ' New group')),
          el('button', { cls: 'bcm-addbtn', onclick: openJoinGroupDialog, style: { marginTop: '4px' } },
            '🔗', el('span', { cls: 'bcm-addbtn-label' }, ' Join group')),
          el('button', {
            cls: 'bcm-addbtn bcm-mobile-expand-btn',
            style: { marginTop: '4px', display: 'none' },
            title: 'Expand sidebar',
            onclick: () => {
              const sidebar = state.dialogEl?.querySelector('.bcm-sidebar');
              const expanded = sidebar?.classList.toggle('bcm-sidebar-expanded');
              if (expanded) {
                const collapse = () => { sidebar?.classList.remove('bcm-sidebar-expanded'); document.removeEventListener('click', collapse, true); };
                setTimeout(() => document.addEventListener('click', collapse, true), 0);
              }
            },
          }, '☰'),
        ),
        el('div', { cls: 'bcm-friends-panel' }),
        el('div', { cls: 'bcm-lobby-panel' }),
        el('div', { cls: 'bcm-roomusers-panel' }),
        el('div', { cls: 'bcm-starred-panel' }),
        el('div', { cls: 'bcm-collections-panel' }),
        el('div', { cls: 'bcm-state.unread-panel' }),
        el('div', { cls: 'bcm-media-panel' }),
        el('div', { cls: 'bcm-main' },
          el('div', { cls: 'bcm-msghead' },
            el('img', { cls: 'bcm-msghead-avatar', style: { display: 'none' }, alt: 'Contact avatar' }),
            el('div', { cls: 'bcm-msghead-dot' }),
            el('div', { cls: 'bcm-msghead-main' },
              el('div', { cls: 'bcm-msghead-top' },
                el('div', { cls: 'bcm-msghead-name' }, 'Select a contact'),
                el('span', { cls: 'bcm-e2e-indicator', title: '', onclick: () => openE2EInfoDialog(state.selectedContact) }),
                el('button', { cls: 'bcm-header-btn bcm-edit-contact-btn', title: 'Edit contact (name/notes/avatar)', disabled: true, onclick: () => state.selectedContact && openEditContactDialog(state.selectedContact) }, '🖼'),
              ),
              el('div', { cls: 'bcm-msghead-status' }, ''),
            ),
            el('button', { cls: 'bcm-header-btn bcm-disappear-btn', title: 'Disappearing messages', style: { display: 'none' }, onclick: cycleDisappearingSetting }, '🕐'),
            el('button', { cls: 'bcm-header-btn bcm-read-receipt-btn', title: 'Read receipts for this conversation', style: { display: 'none' }, onclick: toggleCurrentConversationReadReceipts }, '✓✓'),
            el('button', { cls: 'bcm-search-btn', title: 'Search messages', onclick: toggleMsgSearch }, '🔍'),
            el('div', { cls: 'bcm-overflow-wrap' },
              el('button', { cls: 'bcm-header-btn bcm-overflow-btn', title: 'More actions',
                onclick: e => { e.stopPropagation(); toggleHeaderOverflow(); }
              }, '⋯'),
              el('div', { cls: 'bcm-header-overflow' },
                el('button', { cls: 'bcm-overflow-item bcm-manage-group-btn', style: { display: 'none' }, onclick: () => state.selectedGroup && openManageGroupDialog(state.selectedGroup) }, '⚙ Manage group'),
                el('button', { cls: 'bcm-overflow-item bcm-stats-btn',   style: { display: 'none' }, onclick: () => state.selectedContact && openConversationStats(state.selectedContact) }, 'ℹ️ Stats'),
                el('button', { cls: 'bcm-overflow-item bcm-media-btn',   style: { display: 'none' }, onclick: () => { toggleHeaderOverflow(); toggleMediaPanel(); } }, '🖼 Media'),
                el('button', { cls: 'bcm-overflow-item', title: 'Scheduled messages', onclick: () => { toggleHeaderOverflow(); openScheduledMessagesPanel(); } }, '⏰ Scheduled'),
                el('button', { cls: 'bcm-overflow-item bcm-export-json-btn',
                  onclick: () => { toggleHeaderOverflow(); if (state.selectedContact) exportConversation(state.selectedContact); else if (state.selectedGroup) exportConversation(null); }
                }, '⬇ Export'),
                el('button', { cls: 'bcm-overflow-item bcm-export-html-btn',
                  onclick: () => { toggleHeaderOverflow(); if (state.selectedContact) exportConversationHtml(state.selectedContact); else if (state.selectedGroup) exportConversationHtml(null); }
                }, '🗎 Export HTML'),
                el('button', { cls: 'bcm-overflow-item bcm-join-room-btn', style: { display: 'none' },
                  onclick: () => { toggleHeaderOverflow(); const r = state.contactMeta[state.selectedContact]?.room; if (r) joinRoom(r); }
                }, '🚪 Join their room'),
                el('button', { cls: 'bcm-overflow-item bcm-invite-room-btn', style: { display: 'none' },
                  onclick: () => { toggleHeaderOverflow(); if (state.selectedContact) sendRoomInvite(state.selectedContact); }
                }, '🏠 Invite to my room'),
              ),
            ),
          ),
          el('div', { cls: 'bcm-msgsearch-bar' },
            el('input', { cls: 'bcm-msgsearch-input', type: 'text', placeholder: 'Search messages…',
              oninput: e => runMsgSearch(e.target.value),
              onkeydown: e => { if (e.key === 'Enter') stepMsgSearch(e.shiftKey ? -1 : 1); e.stopPropagation(); },
            }),
            el('button', { cls: 'bcm-msgsearch-nav', onclick: () => stepMsgSearch(-1) }, '▲'),
            el('button', { cls: 'bcm-msgsearch-nav', onclick: () => stepMsgSearch(1) }, '▼'),
            el('span', { cls: 'bcm-msgsearch-count' }, ''),
            el('button', { cls: 'bcm-msgsearch-close', onclick: closeMsgSearch }, '✕'),
          ),
          el('div', { cls: 'bcm-pin-banner' },
            el('span', { cls: 'bcm-pin-banner-icon' }, '📌'),
            el('span', { cls: 'bcm-pin-banner-text' }, ''),
            el('button', { cls: 'bcm-pin-all-btn', title: 'Show all pins', onclick: e => { e.stopPropagation(); openPinnedMessagesPanel(); } }, 'All pins'),
            el('button', { cls: 'bcm-pin-banner-close', title: 'Unpin', onclick: e => { e.stopPropagation(); unpinLatestMessage(); } }, '✕'),
          ),
          el('div', { cls: 'bcm-quote-bar' },
            el('span', { cls: 'bcm-quote-text' }, ''),
            el('button', { cls: 'bcm-quote-clear', onclick: clearQuote, title: 'Cancel reply' }, '✕'),
          ),
          el('div', { cls: 'bcm-msglist-wrap' },
            el('div', { cls: 'bcm-msglist' },
              el('div', { cls: 'bcm-empty' }, 'Select a contact to start messaging'),
            ),
            el('button', { cls: 'bcm-scroll-bottom-btn', title: 'Scroll to bottom', onclick: () => {
              scrollMsgs();
              state.dialogEl?.querySelector('.bcm-scroll-bottom-btn')?.classList.remove('visible');
            }}, '↓'),
          ),
          el('div', { cls: 'bcm-selection-bar' },
            el('span', { cls: 'bcm-sel-count' }, '0 selected'),
            el('button', { cls: 'bcm-btn', style: { fontSize: '11px', padding: '3px 8px' }, onclick: async () => {
              if (state.selectedMsgs.size === 0) return;
              const ok = await openConfirm(`Delete ${state.selectedMsgs.size} message(s)? This cannot be undone.`);
              if (!ok) return;
              for (const key of [...state.selectedMsgs]) {
                const bubble = state.dialogEl?.querySelector(`[data-reaction-key="${key}"]`) || state.dialogEl?.querySelector(`[data-sid="${key}"]`);
                if (!bubble) continue;
                const sid = bubble.dataset.sid;
                try {
                  if (sid && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'delete', id: Number(sid) }));
                  bubble.remove();
                } catch {}
              }
              exitSelectionMode();
            }}, '🗑️ Delete'),
            el('button', { cls: 'bcm-btn', style: { fontSize: '11px', padding: '3px 8px' }, onclick: () => {
              for (const key of state.selectedMsgs) {
                if (key) toggleStarByKey(key).catch(() => {});
              }
              exitSelectionMode();
              showNote('Messages starred');
            }}, '⭐ Star'),
            el('button', { cls: 'bcm-btn-secondary', style: { fontSize: '11px', padding: '3px 8px' }, onclick: exitSelectionMode }, 'Cancel'),
          ),
          el('div', { cls: 'bcm-inputbar' },
            el('div', { cls: 'bcm-inputrow' },
              el('button', { cls: 'bcm-sticker-btn', title: 'Stickers & GIFs',
                onclick: e => { e.stopPropagation(); const inp = state.dialogEl?.querySelector('.bcm-input'); if (inp) toggleStickerPanel(inp); }
              }, '🖼'),
              el('button', { cls: 'bcm-emoji-btn', title: 'Emojis',
                onclick: e => { e.stopPropagation(); const inp = state.dialogEl?.querySelector('.bcm-input'); if (inp) toggleEmojiPanel(inp); }
              }, '😊'),
              el('textarea', { cls: 'bcm-input', placeholder: 'Type a message… (Enter to send)',
                onkeydown: onInputKeydown, oninput: onInputChange }),
              el('span', { cls: 'bcm-charcount' }, '0 / 5000'),
              el('button', { cls: 'bcm-sendbtn', onclick: doSend }, 'Send'),
            ),
            el('div', { cls: 'bcm-compose-toolbar' },
              el('button', { cls: 'bcm-qr-btn', title: 'Quick replies',
                onclick: e => { e.stopPropagation(); const inp = state.dialogEl?.querySelector('.bcm-input'); if (inp) toggleQRPanel(inp); }
              }, '📋'),
              el('button', { cls: 'bcm-qr-btn', title: 'Message templates',
                onclick: e => { e.stopPropagation(); const inp = state.dialogEl?.querySelector('.bcm-input'); if (inp) toggleTemplatePanel(inp); }
              }, '📝'),
              el('button', { cls: 'bcm-compose-flag-btn bcm-spoiler-btn', title: 'Spoiler message (hidden until clicked)',
                onclick: e => { e.stopPropagation(); state.composeSpoiler = !state.composeSpoiler; syncComposeModeButtons(); }
              }, '🙈'),
              el('button', { cls: 'bcm-compose-flag-btn bcm-onetime-btn', title: 'One-time message (deleted after viewing)',
                onclick: e => { e.stopPropagation(); state.composeOneTime = !state.composeOneTime; syncComposeModeButtons(); }
              }, '1×'),
              el('button', { cls: 'bcm-compose-flag-btn', title: 'Create a poll (question + options)',
                onclick: e => { e.stopPropagation(); openPollCreationDialog(); }
              }, '📊'),
              el('button', { cls: 'bcm-schedule-btn', title: 'Schedule send',
                onclick: e => { e.stopPropagation(); openScheduleSendDialog(); }
              }, '⏰'),
              el('button', { cls: 'bcm-compose-flag-btn bcm-activity-btn', title: 'In-game action (only visible when contact is in your room)', style: { display: 'none' },
                onclick: e => { e.stopPropagation(); toggleActivityPanel(); }
              }, '🎮'),
              el('div', { cls: 'bcm-toolbar-spacer' }),
              el('label', {},
                el('input', { type: 'radio', name: 'bcm-sendmode', value: 'beep', checked: 'true',
                  onchange: () => { state.sendMode = 'beep'; } }),
                'Beep',
              ),
              el('label', {},
                el('input', { type: 'radio', name: 'bcm-sendmode', value: 'whisper',
                  onchange: () => { state.sendMode = 'whisper'; } }),
                'Whisper',
              ),
            ),
          ),
        ),
      ),
      el('div', { cls: 'bcm-resize-handle' }),
    );

    document.documentElement.appendChild(state.dialogEl);
    makeDraggable(state.dialogEl, state.dialogEl.querySelector('.bcm-titlebar'));
    makeResizable(state.dialogEl);
    syncComposeModeButtons();

    const savedSize = GM_getValue(state.STORE + 'panelSize', null);
    if (savedSize) {
      try {
        const { w, h } = JSON.parse(savedSize);
        const maxW = window.innerWidth * 0.98, maxH = window.innerHeight * 0.94;
        state.dialogEl.style.setProperty('width',  Math.max(300, Math.min(w, maxW)) + 'px', 'important');
        state.dialogEl.style.setProperty('height', Math.max(260, Math.min(h, maxH)) + 'px', 'important');
      } catch {}
    }
    window.addEventListener('resize', () => {
      if (!state.dialogEl) return;
      const maxW = window.innerWidth * 0.98, maxH = window.innerHeight * 0.94;
      const curW = parseInt(state.dialogEl.style.width, 10);
      const curH = parseInt(state.dialogEl.style.height, 10);
      if (curW > maxW) state.dialogEl.style.setProperty('width',  Math.max(300, maxW) + 'px', 'important');
      if (curH > maxH) state.dialogEl.style.setProperty('height', Math.max(260, maxH) + 'px', 'important');
    });
    applyTheme(state.currentTheme);
    if (state.compactMode) state.dialogEl.classList.add('bcm-compact');
    document.addEventListener('keydown', onGlobalKeydown);
    renderTagStrip();
    syncNotesBar(null);
    syncQuoteBar();
    updateAwayIndicator();

    const _msgList = state.dialogEl.querySelector('.bcm-msglist');
    const _scrollBtn = state.dialogEl.querySelector('.bcm-scroll-bottom-btn');
    if (_msgList && _scrollBtn) {
      _msgList.addEventListener('scroll', () => {
        const atBottom = _msgList.scrollTop >= _msgList.scrollHeight - _msgList.clientHeight - 100;
        _scrollBtn.classList.toggle('visible', !atBottom);
      });
    }
  }

  function openDialog() {
    buildDialog();
    state.dialogOpen = true;
    state.dialogEl.classList.add('bcm-open');
    const dismissed = GM_getValue(STORE_BASE + 'dismissedUpdate', '');
    const lastLatest = GM_getValue(STORE_BASE + 'lastLatestVersion', '');
    if (lastLatest && semverGt(lastLatest, SCRIPT_VERSION) && lastLatest !== dismissed) {
      showUpdateBanner(lastLatest);
    }
    refreshContactList();
    setTimeout(() => state.dialogEl.querySelector('.bcm-search')?.focus(), 50);
  }

  function closeDialog() {
    saveCurrentContactNote();
    state.dialogOpen = false;
    document.removeEventListener('keydown', onGlobalKeydown);
    state.dialogEl?.classList.remove('bcm-open');
    closeReactionPanel();
    closeOneTimeViewer();
    closeEmojiPanel();
    closeContextMenu();
    closeMentionPanel();
  }

  function onGlobalKeydown(e) {
    if (!state.dialogOpen) return;
    // Escape — close topmost overlay or panel
    if (e.key === 'Escape') {
      if (document.querySelector('.bcm-ctx-menu')) { closeContextMenu(); return; }
      if (document.querySelector('.bcm-modal-overlay')) return; // modal handles its own Escape
      closeAllPanels();
      return;
    }
    // Ctrl/Cmd+Enter — send message (when compose input is focused)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const input = state.dialogEl?.querySelector('.bcm-input');
      if (input && document.activeElement === input) { e.preventDefault(); doSend(); }
      return;
    }
    // Alt+↑ / Alt+↓ — navigate between conversations
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const contacts = [...(state.dialogEl?.querySelectorAll('.bcm-contact[data-num]') ?? [])];
      if (!contacts.length) return;
      const idx = contacts.findIndex(c => Number(c.dataset.num) === state.selectedContact);
      const next = e.key === 'ArrowDown' ? contacts[idx + 1] : contacts[idx - 1];
      if (next) next.click();
      return;
    }
  }

  function toggleDialog() {
    if (!state.loggedIn) return;
    state.dialogOpen ? closeDialog() : openDialog();
  }


  function makeDraggable(panel, handle) {
    let ox = 0, oy = 0, drag = false;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      drag = true;
      const r = panel.getBoundingClientRect();
      panel.style.setProperty('transform', 'none', 'important');
      panel.style.setProperty('left', r.left + 'px', 'important');
      panel.style.setProperty('top',  r.top  + 'px', 'important');
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('mousemove', e => {
      if (!drag) return;
      const maxX = window.innerWidth - 40, maxY = window.innerHeight - 40;
      panel.style.setProperty('left', Math.max(0, Math.min(e.clientX - ox, maxX)) + 'px', 'important');
      panel.style.setProperty('top',  Math.max(0, Math.min(e.clientY - oy, maxY)) + 'px', 'important');
      e.stopPropagation();
    }, true);
    window.addEventListener('mouseup', () => { drag = false; }, true);
  }

  function makeResizable(panel) {
    const handle = panel.querySelector('.bcm-resize-handle');
    if (!handle) return;
    let resizing = false, startX, startY, startW, startH;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = panel.offsetWidth; startH = panel.offsetHeight;
      e.preventDefault(); e.stopPropagation();
    }, true);
    window.addEventListener('mousemove', e => {
      if (!resizing) return;
      const newW = Math.max(420, Math.min(startW + e.clientX - startX, window.innerWidth  * 0.95));
      const newH = Math.max(300, Math.min(startH + e.clientY - startY, window.innerHeight * 0.9));
      panel.style.setProperty('width',  newW + 'px', 'important');
      panel.style.setProperty('height', newH + 'px', 'important');
      if (panel === state.dialogEl && state.settingsEl?.classList.contains('bcm-open')) {
        state.settingsEl.style.setProperty('width',  newW + 'px', 'important');
        state.settingsEl.style.setProperty('height', newH + 'px', 'important');
      }
      e.stopPropagation();
    }, true);
    window.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      GM_setValue(state.STORE + 'panelSize', JSON.stringify({ w: panel.offsetWidth, h: panel.offsetHeight }));
    }, true);
  }


  state.settingsEl = null;

  function toggle(label, initialValue, onChange, tooltip = '') {
    const inp = el('input', { type: 'checkbox' });
    inp.checked = initialValue;
    inp.addEventListener('change', () => { if (onChange) onChange(inp.checked); });
    const row = el('div', { cls: 'bcm-settings-row', title: tooltip || '' },
      el('span', { cls: 'bcm-settings-label', title: tooltip || '' }, label),
      el('label', { cls: 'bcm-toggle', title: tooltip || '' },
        inp, el('span', { cls: 'bcm-toggle-track' }), el('span', { cls: 'bcm-toggle-thumb' })),
    );
    inp.title = tooltip || '';
    return row;
  }

  function getMainPanelSizeForSettings() {
    const maxW = window.innerWidth * 0.95;
    const maxH = window.innerHeight * 0.9;
    let w = Number(state.dialogEl?.offsetWidth) || 0;
    let h = Number(state.dialogEl?.offsetHeight) || 0;
    if (!w || !h) {
      const savedSize = GM_getValue(state.STORE + 'panelSize', null);
      if (savedSize) {
        try {
          const parsed = JSON.parse(savedSize);
          w = Number(parsed?.w) || w;
          h = Number(parsed?.h) || h;
        } catch {}
      }
    }
    if (!w) w = 680;
    if (!h) h = 500;
    return {
      w: Math.max(420, Math.min(w, maxW)),
      h: Math.max(300, Math.min(h, maxH)),
    };
  }

  function syncSettingsSizeToMainPanel() {
    if (!state.settingsEl) return;
    const { w, h } = getMainPanelSizeForSettings();
    state.settingsEl.style.setProperty('width', `${w}px`, 'important');
    state.settingsEl.style.setProperty('height', `${h}px`, 'important');
  }

  function applySettingsTooltips(root) {
    const labelTips = {
      'Font size': 'Adjust the messenger text size used in messages and inputs.',
      'Toast pop-ups': 'Show in-page popup notifications for new messages.',
      'Notification sound': 'Play a sound when a new message arrives.',
      'System notifications (hidden tab)': 'Use browser/system notifications when the game tab is hidden.',
      'Send read receipts': 'Send read-status updates when you view incoming DMs.',
      'Share typing indicators': 'Send typing notifications while you are composing messages.',
      'Show typing indicators': 'Show typing notifications from other members.',
      'Enable AFK auto-reply': 'Automatically reply when you are marked away.',
      'AFK timeout (minutes)': 'Minutes of inactivity before AFK mode is considered active.',
      'AFK message': 'Message sent automatically while AFK is enabled and active.',
      'Server': 'Current BC Messenger backend endpoint.',
      'Status': 'Current WebSocket connection state.',
      'Member': 'Your logged-in Bondage Club member number.',
      'Custom status (max 60 chars)': 'Set the status text shown to other users.',
      'Discord webhook URL': 'Optional Discord webhook used for DM notification forwarding.',
      'Enable Discord webhook notifications': 'Turn webhook DM forwarding on/off without deleting the URL.',
      'Hide my last-seen timestamp': 'Limit last-seen timestamp visibility for your account.',
      'Profile avatar': 'Edit the avatar URL shown for your own profile in BCM.',
      'Blocked members': 'Members you blocked from sending you new messages.',
      'Submitted reports': 'Recent abuse reports you submitted.',
    };
    root.querySelectorAll('.bcm-settings-label').forEach(labelEl => {
      const key = String(labelEl.textContent || '').trim();
      const tip = labelTips[key];
      if (!tip) return;
      labelEl.title = tip;
      const row = labelEl.closest('.bcm-settings-row');
      if (row) row.title = tip;
    });

    const buttonTips = {
      'Edit my avatar': 'Open your self-contact editor and set your avatar URL.',
      'Clear history': 'Delete only local chat history and local contacts cache.',
      'Delete all data': 'Delete all local BCM data and request full server-side data removal for this account.',
      'Reset identity': 'Clear your local client secret and regenerate identity on reload.',
      'Sync history': 'Fetch recent message history from server and merge it locally.',
      '+': 'Add this quick reply.',
      '×': 'Close settings.',
    };
    root.querySelectorAll('button').forEach(btn => {
      const key = String(btn.textContent || '').trim();
      const tip = buttonTips[key];
      if (tip && !btn.title) btn.title = tip;
    });

    root.querySelectorAll('.bcm-theme-swatch').forEach(swatch => {
      const name = swatch.querySelector('.bcm-theme-label')?.textContent?.trim();
      if (name) swatch.title = `Switch theme to ${name}`;
    });
    root.querySelectorAll('.bcm-fontsize-btn').forEach(btn => {
      const size = btn.getAttribute('data-size');
      if (size === 'small') btn.title = 'Use smaller text';
      if (size === 'medium') btn.title = 'Use default text size';
      if (size === 'large') btn.title = 'Use larger text';
    });
    root.querySelectorAll('.bcm-settings-row input, .bcm-settings-row textarea').forEach(inp => {
      if (inp.title) return;
      const rowTitle = inp.closest('.bcm-settings-row')?.getAttribute('title');
      if (rowTitle) inp.title = rowTitle;
    });
  }

  async function wipeAllLocalAccountData() {
    try { state.ws?.close?.(); } catch {}
    await deleteCurrentDatabase();

    const defaultQuickReplies = ['Be right back', 'On my way', 'Busy right now', '❤️', 'Can we talk later?'];
    state.toastsEnabled = true;
    state.afkEnabled = false;
    state.afkMessage = 'I\'m currently away. I\'ll respond when I\'m back!';
    state.mutedContacts = new Set();
    state.pinnedContacts = new Set();
    state.currentTheme = 'light';
    state.soundEnabled = true;
    state.systemNotificationsEnabled = false;
    state.sendReadReceipts = true;
    state.sendTypingIndicators = true;
    state.showTypingIndicators = true;
    state.hideLastSeenFromOthers = false;
    state.discordWebhookEnabled = true;
    state.customStatus = '';
    state.discordWebhookUrl = '';
    state.fontSize = 'medium';
    state.awayTimeoutMins = DEFAULT_AWAY_TIMEOUT_MINS;
    state.quickReplies = [...defaultQuickReplies];
    state.contactNotes = {};
    state.contactAvatarUrls = {};
    state.msgReactions = {};
    state.starredMessages = new Set();
    state.disappearingByConversation = {};
    state.readReceiptDisabledConversations = {};
    state.blockedMembers = new Set();
    state.pinnedMessages = {};
    Object.values(state.scheduledTimers).forEach(t => clearTimeout(t));
    state.scheduledMessages = [];
    state.scheduledTimers = {};
    state.unread = {};
    state.groupUnread = {};
    state.groups = {};
    state.allContacts = [];
    state.contactMeta = {};
    state.resolvedAttempts = new Set();
    state.selectedContact = null;
    state.selectedGroup = null;

    GM_setValue(state.STORE + 'toasts', true);
    GM_setValue(state.STORE + 'afk', false);
    GM_setValue(state.STORE + 'afkMessage', state.afkMessage);
    GM_setValue(state.STORE + 'muted', '[]');
    GM_setValue(state.STORE + 'pinned', '[]');
    GM_setValue(state.STORE + 'theme', 'light');
    GM_setValue(state.STORE + 'sound', true);
    GM_setValue(state.STORE + 'systemNotifications', false);
    GM_setValue(state.STORE + 'readReceipts', true);
    GM_setValue(state.STORE + 'typingIndicators', true);
    GM_setValue(state.STORE + 'showTypingIndicators', true);
    GM_setValue(state.STORE + 'hideLastSeenFromOthers', false);
    GM_setValue(state.STORE + 'discordWebhookEnabled', true);
    GM_setValue(state.STORE + 'status', '');
    GM_setValue(state.STORE + 'discordWebhook', '');
    GM_setValue(state.STORE + 'fontSize', 'medium');
    GM_setValue(state.STORE + 'awayMins', DEFAULT_AWAY_TIMEOUT_MINS);
    GM_setValue(state.STORE + 'quickreplies', JSON.stringify(defaultQuickReplies));
    GM_setValue(state.STORE + 'notes', '{}');
    GM_setValue(state.STORE + 'avatarUrls', '{}');
    GM_setValue(state.STORE + 'reactions', '{}');
    GM_setValue(state.STORE + 'starred', '[]');
    GM_setValue(state.STORE + 'disappearing', '{}');
    GM_setValue(state.STORE + 'readReceiptsDisabledConversations', '{}');
    GM_setValue(state.STORE + 'recentBlockedBy', '[]');
    GM_setValue(state.STORE + 'pinnedMessages', '{}');
    GM_setValue(state.STORE + 'scheduled', '[]');
    GM_setValue(state.STORE + 'unread', '{}');
    GM_setValue(state.STORE + 'groupUnread', '{}');
    GM_setValue(state.STORE + 'iconPos', null);
    GM_setValue(state.STORE + 'panelSize', null);
    GM_setValue(state.STORE + 'secret', '');
    GM_setValue(state.STORE + 'onboarded', false);
  }

  function openSettingsDialog() {
    closeEmojiPanel();
    closeContextMenu();
    closeMentionPanel();
    if (!state.settingsEl) {
      state.settingsEl = el('div', { cls: 'bcm-settings-wrap' });
      document.documentElement.appendChild(state.settingsEl);
    }
    state.settingsEl.innerHTML = '';
    const wsStates = ['Connecting…', 'Connected', 'Closing…', 'Disconnected'];
    const wsLabel  = state.ws ? wsStates[state.ws.readyState] ?? 'Unknown' : (state.loggedIn ? 'Reconnecting…' : 'Disconnected');
    const wsColor  = state.ws?.readyState === 1 ? 'var(--bcm-online)' : 'var(--bcm-accent)';

    state.settingsEl.appendChild(
      el('div', { cls: 'bcm-settings-titlebar' },
        el('span', { cls: 'bcm-settings-title' }, '⚙ BC Messenger Settings'),
        el('button', { cls: 'bcm-settings-close', onclick: closeSettingsDialog }, '×'),
      )
    );

    const THEME_META = {
      light:    { label: 'Light',    bg: '#ffffff', dot: '#c43060' },
      dark:     { label: 'Dark',     bg: '#1e1e2e', dot: '#e05888' },
      midnight: { label: 'Midnight', bg: '#000000', dot: '#5090e0' },
      lavender: { label: 'Lavender', bg: '#f6f4ff', dot: '#7c5cbf' },
      custom:   { label: 'Custom',   bg: '#ffffff', dot: '#888888' },
    };
    const themeGrid = el('div', { cls: 'bcm-theme-grid' });
    for (const [key, meta] of Object.entries(THEME_META)) {
      const swatch = el('div', { cls: `bcm-theme-swatch${state.currentTheme === key ? ' active' : ''}`, 'data-theme': key, title: `Switch theme to ${meta.label}`,
        onclick: () => { if (key !== 'custom') applyTheme(key); }
      },
        el('div', { cls: 'bcm-theme-dot', style: { background: meta.bg, border: `3px solid ${meta.dot}` } }),
        el('div', { cls: 'bcm-theme-label' }, meta.label),
      );
      themeGrid.appendChild(swatch);
    }

    const customColors = [
      { key: 'accent', label: 'Accent' },
      { key: 'accent_bg', label: 'Accent bg' },
      { key: 'bg', label: 'Background' },
      { key: 'bg_side', label: 'Sidebar bg' },
      { key: 'bg_title', label: 'Title bg' },
      { key: 'bg_input', label: 'Input bg' },
      { key: 'text', label: 'Text' },
      { key: 'text_muted', label: 'Muted text' },
      { key: 'border', label: 'Borders' },
      { key: 'bubble_sent', label: 'Sent bubble' },
      { key: 'bubble_recv', label: 'Recv bubble' },
      { key: 'online', label: 'Online dot' },
    ];
    const customGrid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '4px', marginBottom: '8px' } });
    for (const c of customColors) {
      const defaultColor = GM_getValue(state.STORE + 'custom_' + c.key, '');
      customGrid.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' } },
        el('label', { style: { fontSize: '9px', color: 'var(--bcm-text-muted)' } }, c.label),
        el('input', {
          type: 'color',
          value: defaultColor || c.default,
          style: { width: '28px', height: '20px', border: 'none', borderRadius: '3px', cursor: 'pointer', padding: '0' },
          onchange: (e) => {
            GM_setValue(state.STORE + 'custom_' + c.key, e.target.value);
            if (state.currentTheme === 'custom') applyTheme('custom');
          },
        }),
      ));
    }
    const customApplyBtn = el('button', { cls: 'bcm-settings-btn', style: { marginBottom: '8px' }, onclick: () => applyTheme('custom') }, 'Apply custom theme');

    const fontSizes = [['small','A','11px'],['medium','A','13px'],['large','A','15px']];
    const fontRow = el('div', { cls: 'bcm-fontsize-row' });
    for (const [size, label] of fontSizes) {
      fontRow.appendChild(el('button', { cls: `bcm-fontsize-btn${state.fontSize === size ? ' active' : ''}`, 'data-size': size, title: `Use ${size} font size`,
        style: { fontSize: fontSizes.find(f=>f[0]===size)[2] },
        onclick: () => applyFontSize(size),
      }, label));
    }

    const beepHideRow = el('div', { cls: 'bcm-fontsize-row' });
    for (const [val, label] of [[0, 'Show'], [1, 'Hide when open'], [2, 'Always hide']]) {
      beepHideRow.appendChild(el('button', {
        cls: `bcm-density-btn${state.beepHideMode === val ? ' active' : ''}`,
        onclick: () => {
          state.beepHideMode = val;
          GM_setValue(state.STORE + 'beepHideMode', val);
          beepHideRow.querySelectorAll('.bcm-density-btn').forEach((b, i) => b.classList.toggle('active', i === val));
        },
      }, label));
    }

    const densityRow = el('div', { cls: 'bcm-fontsize-row' });
    for (const [key, label] of [['comfortable', 'Comfortable'], ['compact', 'Compact']]) {
      densityRow.appendChild(el('button', {
        cls: `bcm-density-btn${(key === 'compact') === state.compactMode ? ' active' : ''}`,
        'data-density': key,
        onclick: () => applyCompactMode(key === 'compact'),
      }, label));
    }

    const qrContainer = el('div', {});
    function renderQRSettings(container) {
      container.innerHTML = '';
      const list = el('div', { cls: 'bcm-qr-settings-list' });
      state.quickReplies.forEach((qr, i) => {
        list.appendChild(el('div', { cls: 'bcm-qr-settings-item' },
          el('span', { cls: 'bcm-qr-settings-text' }, qr),
          el('button', { cls: 'bcm-qr-settings-del', title: 'Delete', onclick: () => {
            state.quickReplies.splice(i, 1);
            GM_setValue(state.STORE + 'quickreplies', JSON.stringify(state.quickReplies));
            saveToExtensionSettings();
            renderQRSettings(container);
          }}, '×'),
        ));
      });
      const addInput = el('input', { cls: 'bcm-qr-add-input', type: 'text', placeholder: 'New quick reply…', title: 'Add a reusable quick-reply phrase' });
      const addBtn = el('button', { cls: 'bcm-qr-add-btn', onclick: () => {
        const v = addInput.value.trim();
        if (!v) return;
        state.quickReplies.push(v);
        GM_setValue(state.STORE + 'quickreplies', JSON.stringify(state.quickReplies));
        saveToExtensionSettings();
        addInput.value = '';
        renderQRSettings(container);
      }, title: 'Add this quick reply' }, '+');
      container.appendChild(list);
      container.appendChild(el('div', { cls: 'bcm-qr-add-row' }, addInput, addBtn));
    }
    renderQRSettings(qrContainer);

    const tmplContainer = el('div', {});
    function renderTmplSettings(container) {
      container.innerHTML = '';
      const list = el('div', { cls: 'bcm-qr-settings-list' });
      state.messageTemplates.forEach((t, i) => {
        list.appendChild(el('div', { cls: 'bcm-qr-settings-item' },
          el('span', { cls: 'bcm-qr-settings-text', title: t.text },
            el('strong', {}, t.name + ': '),
            t.text,
          ),
          el('button', { cls: 'bcm-qr-settings-del', title: 'Delete', onclick: () => {
            state.messageTemplates.splice(i, 1);
            GM_setValue(state.STORE + 'templates', JSON.stringify(state.messageTemplates));
            renderTmplSettings(container);
          }}, '×'),
        ));
      });
      const nameInput = el('input', { cls: 'bcm-qr-add-input', type: 'text', placeholder: 'Name (e.g. "Greeting")', style: { flex: '0 0 38%', marginRight: '4px' } });
      const textInput = el('input', { cls: 'bcm-qr-add-input', type: 'text', placeholder: 'Template text…' });
      const addBtn = el('button', { cls: 'bcm-qr-add-btn', onclick: () => {
        const name = nameInput.value.trim(), text = textInput.value.trim();
        if (!name || !text) return;
        state.messageTemplates.push({ name, text });
        GM_setValue(state.STORE + 'templates', JSON.stringify(state.messageTemplates));
        nameInput.value = ''; textInput.value = '';
        renderTmplSettings(container);
      }, title: 'Save template' }, '+');
      container.appendChild(list);
      container.appendChild(el('div', { cls: 'bcm-qr-add-row' }, nameInput, textInput, addBtn));
    }
    renderTmplSettings(tmplContainer);

    const blockContainer = el('div', {});
    async function renderBlockSettings(container) {
      container.innerHTML = '';
      const loading = el('div', { cls: 'bcm-settings-val', style: { textAlign: 'left' } }, 'Loading blocked members…');
      container.appendChild(loading);
      try {
        const result = await getBlocks();
        const rows = Array.isArray(result?.blocks) ? result.blocks : [];
        container.innerHTML = '';
        if (!rows.length) {
          container.appendChild(el('div', { cls: 'bcm-settings-val', style: { textAlign: 'left' } }, 'No blocked members'));
          return;
        }
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        rows.forEach(row => {
          const num = Number(row?.blocked_number || 0);
          if (!num) return;
          const label = `${getDisplayNameForMember(num, `Member #${num}`)} (#${num})`;
          list.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
            el('span', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, label),
            el('button', { cls: 'bcm-settings-btn', style: { flex: '0 0 auto', padding: '4px 10px', fontSize: '11px' }, onclick: async () => {
              try {
                const response = await unblockMember(num);
                if (!response?.success) throw new Error(response?.error || 'Failed');
                await refreshBlockedMembersCache();
                showNote(`Unblocked #${num}`, false);
                await renderBlockSettings(container);
                refreshContactList();
              } catch (e) {
                showNote(`Unblock failed: ${e.message}`, true);
              }
            } }, 'Unblock')
          ));
        });
        container.appendChild(list);
      } catch {
        container.innerHTML = '';
        container.appendChild(el('div', { cls: 'bcm-settings-val', style: { textAlign: 'left' } }, state.loggedIn ? 'Unable to load blocked members' : 'Log in to manage blocked members'));
      }
    }
    renderBlockSettings(blockContainer).catch(() => {});

    const reportHistoryContainer = el('div', {});
    async function renderReportHistorySettings(container) {
      container.innerHTML = '';
      const loading = el('div', { cls: 'bcm-settings-val', style: { textAlign: 'left' } }, 'Loading report history…');
      container.appendChild(loading);
      try {
        const result = await getMyReports(MAX_REPORT_HISTORY_ITEMS);
        const rows = Array.isArray(result?.reports) ? result.reports : [];
        container.innerHTML = '';
        if (!rows.length) {
          container.appendChild(el('div', { cls: 'bcm-settings-val', style: { textAlign: 'left' } }, 'No submitted reports'));
          return;
        }
        const list = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        rows.forEach(row => {
          const target = Number(row?.target_number || 0);
          const when = Number(row?.reported_at || 0);
          const reason = String(row?.reason || '').trim();
          list.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
            el('div', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, `⚑ ${getDisplayNameForMember(target, `Member #${target}`)} (#${target})`),
            el('div', { style: { fontSize: '10px', color: 'var(--bcm-text-muted)' } }, when ? new Date(when).toLocaleString() : ''),
            ...(reason ? [el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, reason.slice(0, 220))] : []),
          ));
        });
        container.appendChild(list);
      } catch {
        container.innerHTML = '';
        container.appendChild(el('div', { cls: 'bcm-settings-val', style: { textAlign: 'left' } }, state.loggedIn ? 'Unable to load report history' : 'Log in to view report history'));
      }
    }
    renderReportHistorySettings(reportHistoryContainer).catch(() => {});

    async function renderTrustedContacts() {
      const container = document.getElementById('bcm-trusted-container');
      if (!container) return;
      container.innerHTML = 'Loading…';
      try {
        await refreshTrustedContactsCache();
        const list = [...state.trustedContacts];
        container.innerHTML = '';
        if (!list.length) {
          container.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'No trusted contacts'));
          return;
        }
        list.forEach(num => {
          container.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 0' } },
            el('span', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, `${getDisplayNameForMember(num, `Member #${num}`)} (#${num})`),
            el('button', { cls: 'bcm-settings-btn', style: { flex: '0 0 auto', padding: '4px 10px', fontSize: '11px' }, onclick: async () => {
              try { await removeTrustedContact(num); await refreshTrustedContactsCache(); showNote(`Removed #${num} from trusted`, false); openSettingsDialog(); }
              catch (e) { showNote(`Failed: ${e.message}`, true); }
            } }, 'Remove'),
          ));
        });
      } catch { container.innerHTML = el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'Unable to load').outerHTML; }
    }
    renderTrustedContacts().catch(() => {});

    async function renderArchive() {
      const container = document.getElementById('bcm-archive-container');
      if (!container) return;
      container.innerHTML = 'Loading…';
      try {
        const folders = await getConversationFolders();
        const archived = folders.filter(f => f.folder === 'archive');
        container.innerHTML = '';
        if (!archived.length) {
          container.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'No archived conversations'));
          return;
        }
        archived.forEach(f => {
          const num = f.targetNumber;
          container.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '4px 0' } },
            el('span', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, `${getDisplayNameForMember(num, `Member #${num}`)} (#${num})`),
            el('button', { cls: 'bcm-settings-btn', style: { flex: '0 0 auto', padding: '4px 10px', fontSize: '11px' }, onclick: async () => {
              try { await setConversationFolder(num, 'inbox'); showNote(`Unarchived conversation with #${num}`, false); openSettingsDialog(); }
              catch (e) { showNote(`Failed: ${e.message}`, true); }
            } }, 'Unarchive'),
          ));
        });
      } catch { container.innerHTML = el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'Unable to load').outerHTML; }
    }
    renderArchive().catch(() => {});

    async function renderMessageRequests() {
      const container = document.getElementById('bcm-requests-container');
      if (!container) return;
      container.innerHTML = 'Loading…';
      try {
        const result = await getMessageRequests();
        const requests = Array.isArray(result?.requests) ? result.requests : [];
        container.innerHTML = '';
        if (!requests.length) {
          container.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'No pending message requests'));
          return;
        }
        requests.forEach(r => {
          const senderNum = Number(r.sender_number);
          container.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 0', borderBottom: '1px solid var(--bcm-border)' } },
            el('div', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, `From #${senderNum} — ${new Date(r.sent_at).toLocaleString()}`),
            el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, String(r.content || '').slice(0, 100)),
            el('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } },
              el('button', { cls: 'bcm-settings-btn', style: { padding: '4px 10px', fontSize: '11px' }, onclick: async () => {
                try { await acceptMessageRequest(r.id); showNote('Request accepted', false); renderMessageRequests(); refreshContactList(); }
                catch (e) { showNote(`Failed: ${e.message}`, true); }
              } }, 'Accept'),
              el('button', { cls: 'bcm-settings-btn', style: { padding: '4px 10px', fontSize: '11px' }, onclick: async () => {
                try { await declineMessageRequest(r.id); showNote('Request declined', false); renderMessageRequests(); }
                catch (e) { showNote(`Failed: ${e.message}`, true); }
              } }, 'Decline'),
            ),
          ));
        });
      } catch { container.innerHTML = el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'Unable to load').outerHTML; }
    }
    renderMessageRequests().catch(() => {});

    const TABS = [
      { id: 'appearance',   label: '🎨 Appearance' },
      { id: 'notifs',       label: '🔔 Notifications' },
      { id: 'profile',      label: '👤 Profile' },
      { id: 'privacy',      label: '🔒 Privacy' },
      { id: 'connection',   label: '🔌 Connection' },
      { id: 'shortcuts',    label: '⌨ Shortcuts' },
    ];
    const activeTab = GM_getValue(state.STORE + 'settingsTab', 'appearance');
    const panes = {};
    const tabNav = el('div', { cls: 'bcm-stab-nav' });

    for (const tab of TABS) {
      const pane = el('div', { cls: `bcm-stab-pane${activeTab === tab.id ? ' active' : ''}` });
      panes[tab.id] = pane;
      const btn = el('button', { cls: `bcm-stab-btn${activeTab === tab.id ? ' active' : ''}`, onclick: () => {
        tabNav.querySelectorAll('.bcm-stab-btn').forEach(b => b.classList.remove('active'));
        Object.values(panes).forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        pane.classList.add('active');
        GM_setValue(state.STORE + 'settingsTab', tab.id);
      }}, tab.label);
      tabNav.appendChild(btn);
    }

    panes.appearance.append(
      el('div', { cls: 'bcm-settings-section' }, 'Theme'),
      themeGrid,
      customGrid,
      customApplyBtn,
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Font size'),
        fontRow,
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Message density'),
        densityRow,
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'BC beep popups'),
        beepHideRow,
      ),
    );

    panes.notifs.append(
      el('div', { cls: 'bcm-settings-section' }, 'Messages'),
      toggle('Toast pop-ups', state.toastsEnabled, v => { state.toastsEnabled = v; GM_setValue(state.STORE + 'toasts', v); }, 'Show in-page popup notifications for new messages.'),
      toggle('Notification sound', state.soundEnabled, v => { state.soundEnabled = v; GM_setValue(state.STORE + 'sound', v); }, 'Play a notification sound when new messages arrive.'),
      toggle('System notifications (hidden tab)', state.systemNotificationsEnabled, v => {
        state.systemNotificationsEnabled = v;
        GM_setValue(state.STORE + 'systemNotifications', v);
        requestNotificationPermission();
      }, 'Use browser/system notifications while the tab is hidden.'),
      toggle('Send read receipts', state.sendReadReceipts, v => {
        state.sendReadReceipts = v;
        GM_setValue(state.STORE + 'readReceipts', v);
        updateReadReceiptHeaderButton();
      }, 'Send read status updates when you open incoming DMs.'),
      toggle('Share typing indicators', state.sendTypingIndicators, v => {
        state.sendTypingIndicators = v;
        GM_setValue(state.STORE + 'typingIndicators', v);
      }, 'Send typing indicators while you compose messages.'),
      toggle('Show typing indicators', state.showTypingIndicators, v => {
        state.showTypingIndicators = v;
        GM_setValue(state.STORE + 'showTypingIndicators', v);
      }, 'Display typing indicators from other members.'),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Away From Keyboard (AFK)'),
      toggle('Enable AFK auto-reply', state.afkEnabled, v => {
        state.afkEnabled = v;
        GM_setValue(state.STORE + 'afk', v);
        if (!v) { state.afkReplySent.clear(); setAwayState(false); }
        scheduleAwayTimer();
      }, 'Automatically send your AFK message when away mode is active.'),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'AFK timeout (minutes)'),
        el('input', {
          type: 'number', min: String(MIN_AWAY_TIMEOUT_MINS), max: String(MAX_AWAY_TIMEOUT_MINS),
          value: String(state.awayTimeoutMins),
          style: { width: '88px', padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', fontSize: '12px' },
          onchange: e => {
            state.awayTimeoutMins = parseAwayTimeoutMins(e.target.value);
            e.target.value = String(state.awayTimeoutMins);
            GM_setValue(state.STORE + 'awayMins', state.awayTimeoutMins);
            scheduleAwayTimer();
          }
        }),
      ),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('span', { cls: 'bcm-settings-label' }, 'AFK message'),
        el('textarea', {
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' },
          value: state.afkMessage,
          oninput: e => { state.afkMessage = e.target.value; GM_setValue(state.STORE + 'afkMessage', state.afkMessage); }
        }),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Quick Replies'),
      qrContainer,
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, '📝 Message Templates'),
      el('div', { cls: 'bcm-settings-hint' }, 'Reusable messages with a name. Click 📝 in the compose bar to insert.'),
      tmplContainer,
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, '🔔 Keyword Alerts'),
      el('div', { cls: 'bcm-settings-hint' }, 'Get alerted when these words appear in any message, even when muted.'),
      el('div', { cls: 'bcm-kw-list' },
        ...state.keywordAlerts.map((kw, i) =>
          el('div', { cls: 'bcm-kw-chip' },
            el('span', {}, kw),
            el('button', { cls: 'bcm-kw-remove', onclick: () => {
              state.keywordAlerts.splice(i, 1);
              GM_setValue(state.STORE + 'keywordAlerts', state.keywordAlerts);
              openSettingsDialog();
            }}, '✕'),
          )
        ),
        state.keywordAlerts.length === 0 ? el('span', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, 'No keywords yet.') : null,
      ),
      el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
        (() => { const kwInp = el('input', { cls: 'bcm-modal-input', type: 'text', placeholder: 'Add keyword…', style: { flex: '1' } }); kwInp.id = 'bcm-kw-input'; return kwInp; })(),
        el('button', { cls: 'bcm-btn', onclick: () => {
          const inp = document.getElementById('bcm-kw-input');
          const val = inp?.value.trim();
          if (!val || state.keywordAlerts.includes(val)) { if (inp) inp.value = ''; return; }
          state.keywordAlerts.push(val);
          GM_setValue(state.STORE + 'keywordAlerts', state.keywordAlerts);
          openSettingsDialog();
        }}, 'Add'),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, '🤖 Auto-Responder Rules'),
      el('div', { cls: 'bcm-settings-hint' }, 'Auto-reply when a received message matches a keyword.'),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
        ...state.autoResponderRules.map((rule, i) =>
          el('div', { cls: 'bcm-rule-row' },
            el('span', { cls: 'bcm-rule-label' },
              rule.matchType === 'any' ? '💬 Any message' : `🔍 "${rule.keyword}"`,
              ' → ',
              el('em', {}, (rule.reply || '').slice(0, 40) + ((rule.reply || '').length > 40 ? '…' : '')),
            ),
            el('button', { cls: 'bcm-kw-remove', onclick: () => {
              state.autoResponderRules.splice(i, 1);
              GM_setValue(state.STORE + 'autoRules', state.autoResponderRules);
              openSettingsDialog();
            }}, '✕'),
          )
        ),
        state.autoResponderRules.length === 0 ? el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)', padding: '2px 0' } }, 'No rules yet.') : null,
      ),
      el('button', { cls: 'bcm-btn', style: { marginTop: '6px', alignSelf: 'flex-start', fontSize: '11px', padding: '4px 10px' }, onclick: async () => {
        const matchPick = await openSelect('When should this rule fire?', [
          { label: '🔍 Keyword match', value: 'keyword' },
          { label: '💬 Any incoming message', value: 'any' },
        ]);
        if (!matchPick) return;
        let keyword = '';
        if (matchPick.value === 'keyword') {
          keyword = await openPrompt('Keyword to match (case-insensitive):', '');
          if (!keyword?.trim()) return;
          keyword = keyword.trim();
        }
        const reply = await openPrompt('Auto-reply text:', '');
        if (!reply?.trim()) return;
        state.autoResponderRules.push({ id: String(Date.now()), matchType: matchPick.value, keyword, reply: reply.trim() });
        GM_setValue(state.STORE + 'autoRules', state.autoResponderRules);
        openSettingsDialog();
      }}, '+ Add Rule'),
    );

    panes.profile.append(
      el('div', { cls: 'bcm-settings-section' }, 'Availability'),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Status'),
        el('select', {
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '160px' },
          value: state.availabilityState,
          onchange: e => {
            state.availabilityState = e.target.value;
            GM_setValue(state.STORE + 'availability', state.availabilityState);
            if (state.loggedIn) setAvailability(state.availabilityState, state.dndStartTime, state.dndEndTime).catch(() => {});
          }
        },
          el('option', { value: 'online' }, '🟢 Online'),
          el('option', { value: 'away' }, '🟡 Away'),
          el('option', { value: 'dnd' }, '🔴 Do Not Disturb'),
          el('option', { value: 'invisible' }, '⚫ Invisible'),
        ),
      ),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('span', { cls: 'bcm-settings-label' }, 'Custom status (max 60 chars)'),
        el('input', {
          type: 'text', value: state.customStatus, maxlength: String(MAX_STATUS_LENGTH),
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)' },
          oninput: e => {
            state.customStatus = String(e.target.value ?? '').slice(0, MAX_STATUS_LENGTH);
            GM_setValue(state.STORE + 'status', state.customStatus);
            if (state.loggedIn) register().catch(() => {});
          }
        }),
      ),
      el('div', { cls: 'bcm-settings-section', style: { marginTop: '4px' } }, 'Quiet hours (DND schedule)'),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Start time'),
        el('input', { type: 'time', value: state.dndStartTime,
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '140px' },
          onchange: e => { state.dndStartTime = e.target.value; GM_setValue(state.STORE + 'dndStart', state.dndStartTime); if (state.loggedIn) setAvailability(state.availabilityState, state.dndStartTime, state.dndEndTime).catch(() => {}); }
        }),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'End time'),
        el('input', { type: 'time', value: state.dndEndTime,
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '140px' },
          onchange: e => { state.dndEndTime = e.target.value; GM_setValue(state.STORE + 'dndEnd', state.dndEndTime); if (state.loggedIn) setAvailability(state.availabilityState, state.dndStartTime, state.dndEndTime).catch(() => {}); }
        }),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Profile info'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('span', { cls: 'bcm-settings-label' }, 'Bio'),
        el('textarea', {
          placeholder: 'Tell others about yourself…', value: state.profileBio, maxlength: '500', rows: '3',
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' },
          oninput: e => { state.profileBio = e.target.value; },
        }),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Pronouns'),
        el('input', { type: 'text', value: state.profilePronouns, maxlength: '40', placeholder: 'e.g. they/them',
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '180px' },
          oninput: e => { state.profilePronouns = String(e.target.value ?? '').slice(0, 40); },
        }),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Timezone'),
        el('select', {
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '180px' },
          onchange: e => { state.profileTimezone = e.target.value; },
        },
          el('option', { value: '', selected: !state.profileTimezone }, '— Select —'),
          ...[
            { offset: 'UTC-12', label: 'UTC-12 (Baker Island)' }, { offset: 'UTC-11', label: 'UTC-11 (Midway)' },
            { offset: 'UTC-10', label: 'UTC-10 (Hawaii)' },      { offset: 'UTC-9',  label: 'UTC-9 (Alaska)' },
            { offset: 'UTC-8',  label: 'UTC-8 (Pacific, NA)' },  { offset: 'UTC-7',  label: 'UTC-7 (Mountain, NA)' },
            { offset: 'UTC-6',  label: 'UTC-6 (Central, NA)' },  { offset: 'UTC-5',  label: 'UTC-5 (Eastern, NA)' },
            { offset: 'UTC-4',  label: 'UTC-4 (Atlantic)' },     { offset: 'UTC-3',  label: 'UTC-3 (Brazil, ARG)' },
            { offset: 'UTC-2',  label: 'UTC-2 (S. Georgia)' },   { offset: 'UTC-1',  label: 'UTC-1 (Azores)' },
            { offset: 'UTC+0',  label: 'UTC+0 (London, GMT)' },  { offset: 'UTC+1',  label: 'UTC+1 (Berlin, CET)' },
            { offset: 'UTC+2',  label: 'UTC+2 (Athens, EET)' },  { offset: 'UTC+3',  label: 'UTC+3 (Moscow, MSK)' },
            { offset: 'UTC+4',  label: 'UTC+4 (Dubai)' },        { offset: 'UTC+5',  label: 'UTC+5 (Karachi)' },
            { offset: 'UTC+6',  label: 'UTC+6 (Dhaka)' },        { offset: 'UTC+7',  label: 'UTC+7 (Bangkok)' },
            { offset: 'UTC+8',  label: 'UTC+8 (Shanghai, SGT)' },{ offset: 'UTC+9',  label: 'UTC+9 (Tokyo, JST)' },
            { offset: 'UTC+10', label: 'UTC+10 (Sydney)' },      { offset: 'UTC+11', label: 'UTC+11 (Solomon)' },
            { offset: 'UTC+12', label: 'UTC+12 (Auckland)' },
          ].map(tz => { const opts = { value: tz.offset }; if (state.profileTimezone === tz.offset) opts.selected = true; return el('option', opts, tz.label); })
        ),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Profile avatar'),
        el('button', { cls: 'bcm-settings-btn', style: { flex: '0 0 auto' }, title: 'Open your self-contact editor and set your avatar URL', onclick: async () => {
          if (!state.memberNumber) { await openAlert('Log in first.'); return; }
          await openEditContactDialog(state.memberNumber);
        }}, 'Edit my avatar'),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Profile privacy'),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Bio visibility'),
        el('select', { style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '140px' }, onchange: e => { state.profilePrivacy.bio = e.target.value; } },
          el('option', { value: 'public',   selected: state.profilePrivacy.bio === 'public'   }, 'Public'),
          el('option', { value: 'contacts', selected: state.profilePrivacy.bio === 'contacts' }, 'Contacts'),
          el('option', { value: 'hidden',   selected: state.profilePrivacy.bio === 'hidden'   }, 'Hidden'),
        ),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Pronouns visibility'),
        el('select', { style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '140px' }, onchange: e => { state.profilePrivacy.pronouns = e.target.value; } },
          el('option', { value: 'public',   selected: state.profilePrivacy.pronouns === 'public'   }, 'Public'),
          el('option', { value: 'contacts', selected: state.profilePrivacy.pronouns === 'contacts' }, 'Contacts'),
          el('option', { value: 'hidden',   selected: state.profilePrivacy.pronouns === 'hidden'   }, 'Hidden'),
        ),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Timezone visibility'),
        el('select', { style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '140px' }, onchange: e => { state.profilePrivacy.timezone = e.target.value; } },
          el('option', { value: 'public',   selected: state.profilePrivacy.timezone === 'public'   }, 'Public'),
          el('option', { value: 'contacts', selected: state.profilePrivacy.timezone === 'contacts' }, 'Contacts'),
          el('option', { value: 'hidden',   selected: state.profilePrivacy.timezone === 'hidden'   }, 'Hidden'),
        ),
      ),
      el('div', { cls: 'bcm-settings-btnrow' },
        el('button', { cls: 'bcm-settings-btn', title: 'Save your profile to the server', onclick: async () => {
          if (!state.memberNumber) { await openAlert('Log in first.'); return; }
          try {
            const avatarUrl = getContactAvatarUrl(state.memberNumber);
            const r = await saveProfile({ bio: state.profileBio, pronouns: state.profilePronouns, timezone: state.profileTimezone, avatarUrl, badges: state.profileBadges, privacyBio: state.profilePrivacy.bio, privacyPronouns: state.profilePrivacy.pronouns, privacyTimezone: state.profilePrivacy.timezone, privacyBadges: state.profilePrivacy.badges });
            if (r?.success) showNote('Profile saved', false); else throw new Error(r?.error || 'Failed');
          } catch (e) { showNote(`Profile save failed: ${e.message}`, true); }
        }}, 'Save profile'),
        el('button', { cls: 'bcm-settings-btn', title: 'Load your profile from the server', onclick: async () => {
          if (!state.memberNumber) { await openAlert('Log in first.'); return; }
          try { await loadOwnProfile(); openSettingsDialog(); showNote('Profile loaded', false); }
          catch (e) { showNote(`Profile load failed: ${e.message}`, true); }
        }}, 'Load from server'),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Trusted Contacts'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('span', { cls: 'bcm-settings-label' }, 'Trusted contacts can see more profile fields'),
        el('div', { id: 'bcm-trusted-container' }, ''),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('input', { id: 'bcm-trusted-add-input', type: 'text', placeholder: 'Member number…', style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)', width: '120px' } }),
        el('button', { cls: 'bcm-settings-btn', onclick: async () => {
          const input = document.getElementById('bcm-trusted-add-input');
          const num = parseInt(input?.value, 10);
          if (!num || num === state.memberNumber) return;
          try { await addTrustedContact(num); await refreshTrustedContactsCache(); showNote(`Added #${num} to trusted contacts`, false); openSettingsDialog(); }
          catch (e) { showNote(`Failed: ${e.message}`, true); }
        }}, 'Add'),
      ),
    );

    panes.privacy.append(
      el('div', { cls: 'bcm-settings-section' }, 'Privacy'),
      toggle('Hide my last-seen timestamp', state.hideLastSeenFromOthers, v => {
        state.hideLastSeenFromOthers = v;
        GM_setValue(state.STORE + 'hideLastSeenFromOthers', v);
        if (state.loggedIn) register().catch(() => {});
      }, 'Limit exposure of your last-seen timestamp to other users.'),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Blocked members'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        blockContainer,
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Submitted reports'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        reportHistoryContainer,
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Message Requests'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('span', { cls: 'bcm-settings-label' }, 'Pending requests from unknown users'),
        el('div', { id: 'bcm-requests-container' }, ''),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Archived conversations'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('div', { id: 'bcm-archive-container' }, ''),
      ),
    );

    panes.connection.append(
      el('div', { cls: 'bcm-settings-section' }, 'Connection'),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Server'),
        el('span', { cls: 'bcm-settings-val' }, SERVER),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Status'),
        el('span', { cls: 'bcm-settings-val', style: { color: wsColor } }, wsLabel),
      ),
      el('div', { cls: 'bcm-settings-row' },
        el('span', { cls: 'bcm-settings-label' }, 'Member'),
        el('span', { cls: 'bcm-settings-val' }, state.memberNumber ? `#${state.memberNumber}` : '—'),
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Discord webhook'),
      el('div', { cls: 'bcm-settings-row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
        el('span', { cls: 'bcm-settings-label' }, 'Webhook URL'),
        el('input', {
          type: 'url', value: state.discordWebhookUrl, maxlength: String(MAX_DISCORD_WEBHOOK_LENGTH),
          placeholder: 'https://discord.com/api/webhooks/...',
          style: { padding: '6px 8px', border: '1px solid var(--bcm-border)', borderRadius: '6px', fontSize: '12px', background: 'var(--bcm-bg-input)', color: 'var(--bcm-text)' },
          oninput: e => { state.discordWebhookUrl = String(e.target.value ?? '').slice(0, MAX_DISCORD_WEBHOOK_LENGTH); GM_setValue(state.STORE + 'discordWebhook', state.discordWebhookUrl); if (state.loggedIn) register().catch(() => {}); }
        }),
      ),
      toggle('Enable Discord webhook notifications', state.discordWebhookEnabled, v => {
        state.discordWebhookEnabled = v;
        GM_setValue(state.STORE + 'discordWebhookEnabled', v);
        if (state.loggedIn) register().catch(() => {});
      }, 'When off, the webhook URL is ignored for DM forwarding.'),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Data'),
      el('div', { cls: 'bcm-settings-btnrow' },
        el('button', { cls: 'bcm-settings-btn', title: 'Delete local chat history and local contacts only', onclick: async () => {
          if (!await openConfirm('Clear all local message history?\nThis cannot be undone.')) return;
          const db = getDb();
          if (!db) return;
          const tx = db.transaction(['messages','contacts'], 'readwrite');
          tx.objectStore('messages').clear();
          tx.objectStore('contacts').clear();
          state.allContacts = []; state.contactMeta = {}; state.resolvedAttempts = new Set();
          refreshContactList();
          const ml = state.dialogEl?.querySelector('.bcm-msglist');
          if (ml) { ml.innerHTML = ''; ml.appendChild(el('div', { cls: 'bcm-empty' }, 'History cleared')); }
          closeSettingsDialog();
        }}, 'Clear history'),
        el('button', { cls: 'bcm-settings-btn danger', title: 'Delete all local BCM data and remove your account data from the server database', onclick: async () => {
          if (!await openConfirm('Delete ALL BCM data for this account?\nThis removes local data and also requests full server-side account data deletion.\nThis cannot be undone.')) return;
          try {
            const result = await deleteAllAccountData();
            if (!result?.success) throw new Error(result?.error || 'server deletion failed');
          } catch (e) { await openAlert(`Server data deletion failed: ${e.message}`); return; }
          await wipeAllLocalAccountData();
          location.reload();
        }}, 'Delete all data'),
        el('button', { cls: 'bcm-settings-btn danger', title: 'Regenerate your local identity secret and reconnect as a fresh client', onclick: async () => {
          if (!await openConfirm('Generate a new identity?\nYou will be re-registered on the server.')) return;
          GM_setValue(state.STORE + 'secret', '');
          location.reload();
        }}, 'Reset identity'),
        el('button', { cls: 'bcm-settings-btn', title: 'Fetch and merge recent server history into local storage', onclick: async () => {
          try { const count = await syncHistoryFromServer(500); refreshContactList(); showNote(`Synced ${count} message(s)`, false); }
          catch (e) { showNote(`Sync failed: ${e.message}`, true); }
        }}, 'Sync history'),
        el('button', { cls: 'bcm-settings-btn', title: 'Export all settings as a JSON file for backup', onclick: exportSettingsBackup }, 'Backup settings'),
        el('button', { cls: 'bcm-settings-btn', title: 'Import settings from a previously exported backup', onclick: importSettingsBackup }, 'Restore settings'),
      ),
      el('div', { cls: 'bcm-settings-ver' }, `BC Offline Messenger v${SCRIPT_VERSION}`),
    );

    const SHORTCUT_ROWS = [
      ['Alt + M',         'Toggle messenger open/close'],
      ['Ctrl/⌘ + K',     'Focus contact search'],
      ['Ctrl/⌘ + N',     'New direct message'],
      ['Ctrl/⌘ + Shift + N', 'New group conversation'],
      ['Ctrl/⌘ + Enter', 'Send message'],
      ['Enter',           'Send message (single-line mode)'],
      ['Shift + Enter',   'New line in message'],
      ['Escape',          'Close open panel / overlay'],
      ['Ctrl/⌘ + F',     'Search messages in conversation'],
      ['↑ / ↓',          'Navigate search results'],
    ];
    panes.shortcuts.append(
      el('div', { cls: 'bcm-settings-section' }, 'Keyboard Shortcuts'),
      el('table', { cls: 'bcm-shortcuts-table' },
        el('tbody', {},
          ...SHORTCUT_ROWS.map(([key, desc]) =>
            el('tr', {},
              el('td', {}, el('kbd', { cls: 'bcm-kbd' }, key)),
              el('td', { style: { color: 'var(--bcm-text)', fontSize: '12px', paddingLeft: '12px' } }, desc),
            )
          )
        )
      ),
      el('hr', { cls: 'bcm-settings-divider' }),
      el('div', { cls: 'bcm-settings-section' }, 'Mouse & Touch'),
      el('div', { cls: 'bcm-settings-hint' }, 'Right-click a contact → pin, mute, tag, delete history.'),
      el('div', { cls: 'bcm-settings-hint' }, 'Hover a message bubble → click a reaction emoji to add/remove it.'),
      el('div', { cls: 'bcm-settings-hint' }, 'Long-press or right-click a bubble → reply, copy, star, delete.'),
    );

    const layout = el('div', { cls: 'bcm-settings-layout' }, tabNav, ...Object.values(panes));
    applySettingsTooltips(layout);
    state.settingsEl.appendChild(layout);
    syncSettingsSizeToMainPanel();
    state.settingsEl.classList.add('bcm-open');
    makeDraggable(state.settingsEl, state.settingsEl.querySelector('.bcm-settings-titlebar'));
  }

  function closeSettingsDialog() { state.settingsEl?.classList.remove('bcm-open'); }

  function exportSettingsBackup() {
    const backup = {
      version: '1.0.0',
      timestamp: Date.now(),
      memberNumber: state.memberNumber,
      store: state.STORE,
      settings: {}
    };
    const keysToExport = [
      'toasts', 'afk', 'afkMessage', 'muted', 'pinned', 'theme', 'sound',
      'systemNotifications', 'readReceipts', 'typingIndicators', 'showTypingIndicators',
      'hideLastSeenFromOthers', 'discordWebhookEnabled', 'status', 'discordWebhook',
      'fontSize', 'awayMins', 'quickreplies', 'notes', 'avatarUrls',
      'reactions', 'starred', 'disappearing', 'readReceiptsDisabledConversations',
      'pinnedMessages', 'scheduled', 'availability', 'dndStart', 'dndEnd',
    ];
    for (const key of keysToExport) {
      backup.settings[key] = GM_getValue(state.STORE + key, null);
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bcm-backup-${state.memberNumber || 'unknown'}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNote('Settings exported', false);
  }

  async function importSettingsBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    const file = await new Promise(resolve => {
      input.onchange = () => resolve(input.files?.[0]);
      input.click();
    });
    if (!file) return;
    try {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });
      const backup = JSON.parse(text);
      if (!backup.settings || typeof backup.settings !== 'object') {
        throw new Error('Invalid backup format');
      }
      if (!await openConfirm(`Import settings from backup dated ${new Date(backup.timestamp).toLocaleString()}?\n\nCurrent settings will be overwritten.`)) return;
      for (const [key, value] of Object.entries(backup.settings)) {
        if (value !== null && value !== undefined) {
          GM_setValue(state.STORE + key, value);
        }
      }
      showNote('Settings restored — reloading', false);
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      showNote(`Import failed: ${e.message}`, true);
    }
  }


  state.allContacts = [];

  async function refreshContactList() {
    const fromDb = await getAllContacts();
    const dbMap  = Object.fromEntries(fromDb.map(c => [c.memberNum, c]));
    const W = unsafeWindow;
    for (const f of getBCFriendEntries()) {
      const num = Number(f.memberNum);
      if (!num) continue;
      const safeName = getSafeDisplayName(f.name, num, '') || state.contactMeta[num]?.name || `Member #${num}`;
      if (!dbMap[num]) dbMap[num] = { memberNum: num, memberName: safeName, lastMsg: '', lastMsgAt: 0 };
      if (!state.contactMeta[num]) state.contactMeta[num] = {};
      if (safeName) state.contactMeta[num].name = safeName;
      const online = coerceOnlineFlag(f.online);
      if (online !== null) {
        state.contactMeta[num].bcOnline = online;
        state.contactMeta[num].online = isMemberOnlineForUi(num, state.contactMeta[num]?.online);
      }
    }
    for (const [num, meta] of Object.entries(state.contactMeta)) {
      const n = parseInt(num);
      if (dbMap[n] && meta.name) dbMap[n].memberName = meta.name;
    }

    iterateFriendNames((num, nickname) => {
      const safeName = getSafeDisplayName(nickname, num, '');
      if (safeName && dbMap[num]) {
        if (!state.contactMeta[num]) state.contactMeta[num] = {};
        state.contactMeta[num].name = safeName;
        dbMap[num].memberName = safeName;
        upsertContact(num, safeName);
      }
    });
    for (const char of (W.ChatRoomCharacter ?? [])) {
      const num = parseInt(char.MemberNumber, 10);
      const safeName = getSafeDisplayName(char?.Name, num, '');
      if (!num || !safeName) continue;
      if (dbMap[num] && isMemberNumberLikeName(state.contactMeta[num]?.name, num)) {
        if (!state.contactMeta[num]) state.contactMeta[num] = {};
        state.contactMeta[num].name = safeName;
        dbMap[num].memberName = safeName;
        upsertContact(num, safeName);
      }
    }
    if (typeof W.CharacterFind === 'function') {
      for (const num of Object.keys(dbMap).map(Number)) {
        if (getSafeDisplayName(state.contactMeta[num]?.name, num, '')) continue;
        try {
          const char = W.CharacterFind(num);
          const safeName = getSafeDisplayName(char?.Name, num, '');
          if (safeName) {
            if (!state.contactMeta[num]) state.contactMeta[num] = {};
            state.contactMeta[num].name = safeName;
            dbMap[num].memberName = safeName;
            upsertContact(num, safeName);
          }
        } catch {}
      }
    }
    state.allContacts = Object.values(dbMap).sort((a, b) => {
      const ap = isPinned(a.memberNum) ? 1 : 0;
      const bp = isPinned(b.memberNum) ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return (b.lastMsgAt ?? 0) - (a.lastMsgAt ?? 0);
    });

    const groupList = await getAllGroups();
    for (const g of groupList) {
      g.members = normalizeGroupMembers(g.members);
      state.groups[g.id] = g;
    }

    state.groupLastMsgCache = {};
    for (const g of groupList) {
      try {
        const gmsgs = await getGroupMessages(g.id);
        if (gmsgs.length) {
          const last = gmsgs[gmsgs.length - 1];
          state.groupLastMsgCache[g.id] = { text: getMessagePreviewText(last.content || '', !!last.deleted), at: last.sentAt || 0 };
        }
      } catch {}
    }

    try {
      const folderList = await getConversationFolders();
      state.conversationFolders = {};
      for (const f of folderList) {
        state.conversationFolders[f.targetNumber] = { folder: f.folder, snoozedUntil: f.snoozedUntil, label: f.label };
      }
    } catch {}

    renderContactList(state.dialogEl?.querySelector('.bcm-search')?.value ?? '');
    if (state.friendsPanelOpen) renderFriendsPanel();
    resolveUnknownNames();
  }

  async function resolveUnknownNames() {
    const unknowns = state.allContacts
      .filter(c => isMemberNumberLikeName(c.memberName, c.memberNum) && !state.resolvedAttempts.has(c.memberNum))
      .slice(0, 5);
    if (!unknowns.length) return;
    for (const c of unknowns) {
      state.resolvedAttempts.add(c.memberNum);
      try {
        const s = await getStatus(c.memberNum);
          const safeName = getSafeDisplayName(s?.state.memberName, c.memberNum, '');
          if (safeName) {
          state.contactMeta[c.memberNum] = { ...state.contactMeta[c.memberNum], name: safeName, online: isMemberOnlineForUi(c.memberNum, s?.isOnline), availability: s?.availability ?? 'online', lastSeen: s.lastSeen, status: s.status ?? '' };
            upsertContact(c.memberNum, safeName);
          }
        } catch {}
      }
    const resolved = unknowns.filter(c => getSafeDisplayName(state.contactMeta[c.memberNum]?.name, c.memberNum, ''));
    if (resolved.length) refreshContactList();
  }

  async function resolveUnknownFriends() {
    const friendNums = [...new Set(getBCFriendEntries().map(f => Number(f.memberNum)).filter(Boolean))];
    const unknowns = friendNums
      .filter(num => isMemberNumberLikeName(state.contactMeta[num]?.name, num) && !state.resolvedAttempts.has(num))
      .slice(0, 20);
    if (!unknowns.length) return;
    for (const num of unknowns) {
      state.resolvedAttempts.add(num);
      try {
        const s = await getStatus(num);
        const safeName = getSafeDisplayName(s?.state.memberName, num, '');
        const online = isMemberOnlineForUi(num, s?.isOnline);
        if (safeName) {
          state.contactMeta[num] = { ...state.contactMeta[num], name: safeName, username: safeName, online, availability: s?.availability ?? 'online', lastSeen: s.lastSeen, status: s.status ?? '' };
          upsertContact(num, safeName);
        } else if (state.contactMeta[num]) {
          state.contactMeta[num] = { ...state.contactMeta[num], online, availability: s?.availability ?? 'online', lastSeen: s?.lastSeen ?? state.contactMeta[num]?.lastSeen, status: s?.status ?? state.contactMeta[num]?.status ?? '' };
        }
      } catch {}
    }
    if (state.friendsPanelOpen) renderFriendsPanel();
  }

  function updateOnlineChip(n) {
    const chip = document.getElementById('bcm-online-chip');
    if (!chip) return;
    chip.textContent = `${n} online`;
    chip.style.display = n > 0 ? '' : 'none';
  }

  async function renderContactList(filter) {
    const list = state.dialogEl?.querySelector('.bcm-clist');
    if (!list) return;
    list.innerHTML = '';
    const q = (filter ?? '').toLowerCase();
    const runId = ++state.sidebarSearchToken;

    const now = Date.now();
    const uniqueFolders = [...new Set(
      Object.values(state.conversationFolders)
        .map(f => f.folder)
        .filter(f => f && f !== 'archive' && f !== 'inbox')
    )];
    const hasSnoozed = Object.values(state.conversationFolders).some(f => f.snoozedUntil && f.snoozedUntil > now);
    if (uniqueFolders.length > 0 || hasSnoozed) {
      const tabRow = el('div', { cls: 'bcm-folder-tabs' },
        el('div', { cls: `bcm-folder-tab${state.activeFolderFilter === 'all' ? ' active' : ''}`,
          onclick: () => { state.activeFolderFilter = 'all'; renderContactList(filter); }}, 'All'),
        ...uniqueFolders.map(f =>
          el('div', { cls: `bcm-folder-tab${state.activeFolderFilter === f ? ' active' : ''}`,
            onclick: () => { state.activeFolderFilter = f; renderContactList(filter); }}, `📁 ${f}`)
        ),
        hasSnoozed ? el('div', { cls: `bcm-folder-tab${state.activeFolderFilter === 'snoozed' ? ' active' : ''}`,
          onclick: () => { state.activeFolderFilter = 'snoozed'; renderContactList(filter); }}, '😴 Snoozed') : null,
      );
      list.appendChild(tabRow);
    } else if (state.activeFolderFilter !== 'all') {
      state.activeFolderFilter = 'all';
    }

    const snoozedTimes = Object.values(state.conversationFolders)
      .map(f => f.snoozedUntil).filter(t => t && t > now);
    if (snoozedTimes.length) {
      const earliest = Math.min(...snoozedTimes);
      setTimeout(() => renderContactList(state.dialogEl?.querySelector('.bcm-search')?.value ?? ''), earliest - now + 100);
    }

    const shownContacts = state.allContacts.filter(c => {
      if (c.memberNum === state.memberNumber) return false;
      if (q && !String(c.memberNum).includes(q) && !(c.memberName ?? '').toLowerCase().includes(q)) return false;
      if (state.activeLabelFilter) {
        const tags = state.contactTags[String(c.memberNum)] ?? [];
        if (!tags.includes(state.activeLabelFilter)) return false;
      }
      const cf = state.conversationFolders[c.memberNum];
      if (state.activeFolderFilter === 'snoozed') return cf?.snoozedUntil && cf.snoozedUntil > now;
      if (state.activeFolderFilter !== 'all') return cf?.folder === state.activeFolderFilter;
      if (cf?.snoozedUntil && cf.snoozedUntil > now) return false;
      if (cf?.folder === 'archive') return false;
      return true;
    });

    const shownGroups = Object.values(state.groups).filter(g =>
      !q || g.name.toLowerCase().includes(q) || String(g.id).includes(q)
    ).sort((a, b) => (state.groupLastMsgCache[b.id]?.at || 0) - (state.groupLastMsgCache[a.id]?.at || 0));
    let renderedAny = false;

    for (const g of shownGroups) {
      const gid = g.id;
      const memberCount = Array.isArray(g.members) ? g.members.length : 0;
      const badge = (state.groupUnread[gid] > 0) ? [el('div', { cls: 'bcm-cbadge' }, state.groupUnread[gid] > 9 ? '9+' : String(state.groupUnread[gid]))] : [];
      const groupPreview = state.groupLastMsgCache[gid]?.text || `${memberCount} member${memberCount !== 1 ? 's' : ''}`;
      list.appendChild(
        el('div', {
          cls: `bcm-contact bcm-group${state.selectedGroup === gid ? ' active' : ''}`,
          onclick: () => selectGroup(gid),
        },
          el('div', { cls: 'bcm-group-icon', style: { background: g.avatarColor || '#8b7fa8' } }, '👥'),
          el('div', { cls: 'bcm-cinfo' },
            el('div', { cls: 'bcm-cname' }, g.name),
            el('div', { cls: 'bcm-cprev' }, groupPreview),
          ),
          ...badge,
        )
      );
      renderedAny = true;
    }

    const onlineContacts = [];
    const offlineContacts = [];
    for (const c of shownContacts) {
      const online = isMemberOnlineForUi(c.memberNum);
      if (online) {
        onlineContacts.push(c);
      } else {
        offlineContacts.push(c);
      }
    }

    updateOnlineChip(onlineContacts.length);

    if (onlineContacts.length > 0) {
      const chevron = state.onlineCollapsed ? '▶' : '▼';
      const sortLabels = { recent: 'Recent', name: 'Name', avail: 'Status' };
      const hdr = el('div', { cls: 'bcm-section-hdr',
        onclick: () => {
          state.onlineCollapsed = !state.onlineCollapsed;
          GM_setValue(state.STORE + 'onlineCollapsed', state.onlineCollapsed);
          renderContactList(state.dialogEl?.querySelector('.bcm-search')?.value ?? '');
        },
      },
        `${chevron} Online — ${onlineContacts.length}`,
        el('button', { cls: 'bcm-sort-btn', title: 'Sort online list', onclick: e => {
          e.stopPropagation();
          state.onlineSort = state.onlineSort === 'recent' ? 'name' : state.onlineSort === 'name' ? 'avail' : 'recent';
          GM_setValue(state.STORE + 'onlineSort', state.onlineSort);
          renderContactList(state.dialogEl?.querySelector('.bcm-search')?.value ?? '');
        }}, `↕ ${sortLabels[state.onlineSort] ?? 'Recent'}`),
      );
      list.appendChild(hdr);

      const sortedOnline = [...onlineContacts];
      if (state.onlineSort === 'name') sortedOnline.sort((a, b) => {
        const na = getSafeDisplayName(state.contactMeta[a.memberNum]?.name, a.memberNum, '') || a.memberName || '';
        const nb = getSafeDisplayName(state.contactMeta[b.memberNum]?.name, b.memberNum, '') || b.memberName || '';
        return na.localeCompare(nb);
      });
      if (state.onlineSort === 'avail') sortedOnline.sort((a, b) => {
        const O = { online: 0, away: 1, dnd: 2 };
        return (O[memberAvailClass(a.memberNum, true)] ?? 9) - (O[memberAvailClass(b.memberNum, true)] ?? 9);
      });

      const onlineGroup = el('div', { cls: 'bcm-contact-group', style: { display: state.onlineCollapsed ? 'none' : 'block' } });
      list.appendChild(onlineGroup);
      for (const c of sortedOnline) {
        const num    = c.memberNum;
        const name   = getSafeDisplayName(state.contactMeta[num]?.name, num, '')
          || getSafeDisplayName(c.memberName, num, '')
          || `Member #${num}`;
        const online = true;
        const preview = getMessagePreviewText(c.lastMsg || '', false);
        const badge  = (state.unread[num] > 0) ? [el('div', { cls: 'bcm-cbadge' }, state.unread[num] > 9 ? '9+' : String(state.unread[num]))] : [];
        const pinIcon  = isPinned(num) ? [el('span', { cls: 'bcm-pin-icon',  title: 'Pinned'  }, '📌')] : [];
        const muteIcon = isMuted(num)  ? [el('span', { cls: 'bcm-mute-icon', title: 'Muted'   }, '🔇')] : [];
        const schedIcon = getScheduledCountForConversation(`c_${num}`) > 0 ? [el('span', { cls: 'bcm-scheduled-badge', title: 'Scheduled messages' }, '⏰')] : [];
        const draftIcon = hasDraft(num) ? [el('span', { cls: 'bcm-draft-icon', title: 'Draft' }, '✎')] : [];
        const notifyIcon = getNotifyOverrideIcon(num) ? [el('span', { cls: 'bcm-notify-icon', title: state.contactNotifyOverrides[String(num)] === 'always' ? 'Always notify' : 'Never notify' }, getNotifyOverrideIcon(num))] : [];
        const avClass = memberAvailClass(num, true);
        const statusParts = [];
        if (avClass === 'away') statusParts.push('🟡 Away');
        else if (avClass === 'dnd') statusParts.push('🔴 DND');
        const cstatus = state.contactMeta[num]?.status;
        const room    = state.contactMeta[num]?.room;
        if (cstatus) statusParts.push(cstatus);
        else if (room) statusParts.push(`📍 ${room}`);
        const statusLine = statusParts.length ? [el('div', { cls: 'bcm-cstatus' }, statusParts.join(' · '))] : [];
        onlineGroup.appendChild(
          el('div', {
            cls: `bcm-contact${state.selectedContact === num && !state.selectedGroup ? ' active' : ''}`,
            'data-num': String(num),
            onclick:        () => selectContact(num, name),
            oncontextmenu: e  => { e.preventDefault(); e.stopPropagation(); openContactContextMenu(num, e.clientX, e.clientY); },
          },
            createContactAvatar(num, name, online),
            el('div', { cls: 'bcm-cinfo' },
              el('div', { cls: 'bcm-cname' },
                name,
                ...(state.contactMeta[num]?.hasBCM ? [el('span', { cls: 'bcm-bcm-badge', title: 'Has BC Messenger' }, 'M')] : []),
              ),
              el('div', { cls: 'bcm-cprev' }, preview || ' '),
              ...statusLine,
            ),
            ...pinIcon,
            ...muteIcon,
            ...schedIcon,
            ...draftIcon,
            ...notifyIcon,
            ...badge,
            el('div', { cls: 'bcm-contact-actions' },
              el('button', { cls: 'bcm-cact-btn', title: 'Send message', onclick: e => { e.stopPropagation(); selectContact(num, name); }}, '💬'),
              el('button', { cls: 'bcm-cact-btn', title: 'View profile', onclick: e => { e.stopPropagation(); openProfileCard(num); }}, '👤'),
            ),
          )
        );
        renderedAny = true;
      }
    }

    if (offlineContacts.length > 0) {
      const chevronOff = state.offlineCollapsed ? '▶' : '▼';
      list.appendChild(el('div', { cls: 'bcm-section-hdr',
        onclick: () => {
          state.offlineCollapsed = !state.offlineCollapsed;
          GM_setValue(state.STORE + 'offlineCollapsed', state.offlineCollapsed);
          renderContactList(state.dialogEl?.querySelector('.bcm-search')?.value ?? '');
        },
      }, `${chevronOff} Offline — ${offlineContacts.length}`));

      const offlineGroup = el('div', { cls: 'bcm-contact-group', style: { display: state.offlineCollapsed ? 'none' : 'block' } });
      list.appendChild(offlineGroup);

      for (const c of offlineContacts) {
        const num    = c.memberNum;
        const name   = getSafeDisplayName(state.contactMeta[num]?.name, num, '')
          || getSafeDisplayName(c.memberName, num, '')
          || `Member #${num}`;
        const online = false;
        const preview = getMessagePreviewText(c.lastMsg || '', false);
        const badge  = (state.unread[num] > 0) ? [el('div', { cls: 'bcm-cbadge' }, state.unread[num] > 9 ? '9+' : String(state.unread[num]))] : [];
        const pinIcon  = isPinned(num) ? [el('span', { cls: 'bcm-pin-icon',  title: 'Pinned'  }, '📌')] : [];
        const muteIcon = isMuted(num)  ? [el('span', { cls: 'bcm-mute-icon', title: 'Muted'   }, '🔇')] : [];
        const schedIcon = getScheduledCountForConversation(`c_${num}`) > 0 ? [el('span', { cls: 'bcm-scheduled-badge', title: 'Scheduled messages' }, '⏰')] : [];
        const draftIcon = hasDraft(num) ? [el('span', { cls: 'bcm-draft-icon', title: 'Draft' }, '✎')] : [];
        const notifyIcon = getNotifyOverrideIcon(num) ? [el('span', { cls: 'bcm-notify-icon', title: state.contactNotifyOverrides[String(num)] === 'always' ? 'Always notify' : 'Never notify' }, getNotifyOverrideIcon(num))] : [];
        offlineGroup.appendChild(
          el('div', {
            cls: `bcm-contact${state.selectedContact === num && !state.selectedGroup ? ' active' : ''}`,
            'data-num': String(num),
            onclick:        () => selectContact(num, name),
            oncontextmenu: e  => { e.preventDefault(); e.stopPropagation(); openContactContextMenu(num, e.clientX, e.clientY); },
          },
            createContactAvatar(num, name, online),
            el('div', { cls: 'bcm-cinfo' },
              el('div', { cls: 'bcm-cname' },
                name,
                ...(state.contactMeta[num]?.hasBCM ? [el('span', { cls: 'bcm-bcm-badge', title: 'Has BC Messenger' }, 'M')] : []),
              ),
              el('div', { cls: 'bcm-cprev' }, preview || ' '),
            ),
            ...pinIcon,
            ...muteIcon,
            ...schedIcon,
            ...draftIcon,
            ...notifyIcon,
            ...badge,
            el('div', { cls: 'bcm-contact-actions' },
              el('button', { cls: 'bcm-cact-btn', title: 'Send message', onclick: e => { e.stopPropagation(); selectContact(num, name); }}, '💬'),
              el('button', { cls: 'bcm-cact-btn', title: 'View profile', onclick: e => { e.stopPropagation(); openProfileCard(num); }}, '👤'),
            ),
          )
        );
        renderedAny = true;
      }
    }
    const renderedSearchResults = q.length >= 2 ? await renderSidebarMessageSearchResults(list, q, runId) : false;
    if (runId !== state.sidebarSearchToken) return;
    if (!renderedAny && !renderedSearchResults) {
      list.appendChild(el('div', { style: { padding: '14px', color: '#3a2850', fontSize: '12px', textAlign: 'center' } },
        q ? 'No results' : 'No contacts or state.groups yet'));
    }
  }

  function onSearchInput(e) { renderContactList(e.target.value); }


  function closeContextMenu() {
    state.ctxMenuEl?.remove();
    state.ctxMenuEl = null;
  }

  function enterSelectionMode() {
    state.selectionMode = true;
    state.selectedMsgs.clear();
    const bar = state.dialogEl?.querySelector('.bcm-selection-bar');
    if (bar) bar.style.display = 'flex';
    updateSelectionBar();
  }

  function exitSelectionMode() {
    state.selectionMode = false;
    state.selectedMsgs.clear();
    const bar = state.dialogEl?.querySelector('.bcm-selection-bar');
    if (bar) bar.style.display = 'none';
    state.dialogEl?.querySelectorAll('.bcm-bubble.bcm-selected').forEach(b => b.classList.remove('bcm-selected'));
  }

  function updateSelectionBar() {
    const bar = state.dialogEl?.querySelector('.bcm-selection-bar');
    if (!bar) return;
    const c = bar.querySelector('.bcm-sel-count');
    if (c) c.textContent = `${state.selectedMsgs.size} selected`;
  }

  function closeMentionPanel() {
    state.mentionPanelEl?.remove();
    state.mentionPanelEl = null;
  }

  async function openEditContactDialog(contactNum) {
    const currentName = getSafeDisplayName(state.contactMeta[contactNum]?.name, contactNum, '') || `Member #${contactNum}`;
    const currentNotes = String(state.contactNotes[String(contactNum)] ?? '');
    const currentAvatar = String(state.contactAvatarUrls[String(contactNum)] ?? '');
    const canEditAvatar = Number(contactNum) === Number(state.memberNumber);

    let editTags = [...(state.contactTags[String(contactNum)] ?? [])];

    const tagChipsEl = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', minHeight: '24px' } });
    const tagInput = el('input', { cls: 'bcm-modal-input', type: 'text', placeholder: 'Add tag (Enter to add)', style: { marginTop: '0' } });

    function rebuildTagChips() {
      tagChipsEl.innerHTML = '';
      for (const tag of editTags) {
        tagChipsEl.appendChild(el('span', {
          style: { display: 'inline-flex', alignItems: 'center', gap: '3px', background: 'var(--bcm-accent-bg)', border: '1px solid var(--bcm-accent)', borderRadius: '10px', padding: '2px 8px', fontSize: '11px', color: 'var(--bcm-accent)', cursor: 'default' },
        }, tag,
          el('button', { style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--bcm-text-muted)', padding: '0 0 0 2px', fontSize: '11px', lineHeight: '1' },
            onclick: () => { editTags = editTags.filter(t => t !== tag); rebuildTagChips(); }
          }, '✕'),
        ));
      }
    }
    rebuildTagChips();

    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newTag = tagInput.value.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
        if (newTag && !editTags.includes(newTag) && editTags.length < 10) {
          editTags.push(newTag);
          rebuildTagChips();
        }
        tagInput.value = '';
      }
    });

    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      el('div', { cls: 'bcm-modal-body' }, `Edit contact #${contactNum}`),
      el('input', { cls: 'bcm-modal-input', type: 'text', value: currentName, placeholder: 'Display name' }),
      el('textarea', {
        cls: 'bcm-modal-input',
        rows: '4',
        placeholder: 'Notes',
        style: { resize: 'vertical', minHeight: '80px', marginTop: '0' },
      }, currentNotes),
      ...(canEditAvatar ? [el('input', {
        cls: 'bcm-modal-input',
        type: 'url',
        value: currentAvatar,
        placeholder: 'Avatar Image URL (https://...)',
      })] : []),
      el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)', marginTop: '4px' } }, 'Labels'),
      tagChipsEl,
      tagInput,
    );

    const [nameInput, notesInput, avatarInput] = Array.from(wrap.querySelectorAll('.bcm-modal-input'));
    const ok = await openModal({
      title: 'Edit Contact',
      body: wrap,
      buttons: [
        { label: 'Cancel', primary: false, value: false },
        { label: 'Save', primary: true, value: true },
      ],
    });
    if (!ok) return;

    const nextName = String(nameInput?.value ?? '').trim();
    const safeName = getSafeDisplayName(nextName, contactNum, '') || `Member #${contactNum}`;
    const nextNotes = String(notesInput?.value ?? '');
    const nextAvatar = canEditAvatar ? String(avatarInput?.value ?? '').trim() : currentAvatar;
    const safeAvatar = nextAvatar ? sanitizeHttpUrl(nextAvatar) : '';
    if (canEditAvatar && nextAvatar && !safeAvatar) {
      await openAlert('Avatar Image URL must be a valid URL using http:// or https://.');
      return;
    }

    state.contactMeta[contactNum] = { ...state.contactMeta[contactNum], name: safeName };
    upsertContact(contactNum, safeName);
    persistContactNote(contactNum, nextNotes);
    persistContactTags(contactNum, editTags);
    if (canEditAvatar) setContactAvatarUrl(contactNum, safeAvatar || '');

    if (state.selectedContact === contactNum) {
      const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
      if (hName) hName.textContent = safeName;
      const hDot = state.dialogEl?.querySelector('.bcm-msghead-dot');
      syncHeaderAvatarForContact(contactNum, safeName, hDot?.classList.contains('online'));
      syncNotesBar(contactNum);
    }
    refreshContactList();
  }

  async function openProfileCard(contactNum) {
    let profile;
    try {
      profile = await getContactCard(contactNum);
    } catch { profile = null; }

    const name     = getSafeDisplayName(state.contactMeta[contactNum]?.name, contactNum, '') || `Member #${contactNum}`;
    const bio      = profile?.bio || '';
    const pronouns = profile?.pronouns || '';
    const timezone = profile?.timezone || '';
    const badges   = Array.isArray(profile?.badges) ? profile.badges : [];
    const isOnline = profile?.isOnline || isMemberOnlineForUi(contactNum);
    const lastSeen = profile?.lastSeen;
    const status   = profile?.status || state.contactMeta[contactNum]?.status || '';

    const avail    = profile?.availability ?? state.contactMeta[contactNum]?.availability ?? 'online';
    const effAvail = isOnline ? avail : 'offline';
    const AVAIL_LABEL = { online: '🟢 Online', away: '🟡 Away', dnd: '🔴 Do Not Disturb', invisible: '⚫ Offline', offline: '⚫ Offline' };
    const AVAIL_COLOR = { online: 'var(--bcm-online)', away: '#f5a623', dnd: '#e03030', invisible: 'var(--bcm-text-muted)', offline: 'var(--bcm-text-muted)' };
    const availLabel = AVAIL_LABEL[effAvail] ?? '⚫ Offline';
    const availColor = AVAIL_COLOR[effAvail] ?? 'var(--bcm-text-muted)';

    const lastSeenText = !isOnline && lastSeen
      ? `Last seen ${new Date(lastSeen).toLocaleString()}`
      : null;

    const header = el('div', { style: { display: 'flex', gap: '14px', alignItems: 'flex-start', width: '100%' } },
      createContactAvatar(contactNum, name, isOnline, 'bcm-profile-avatar'),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 } },
        el('div', { style: { fontWeight: '700', fontSize: '15px', color: 'var(--bcm-text)' } }, name),
        el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, `#${contactNum}`),
        el('span', { style: { display: 'inline-block', marginTop: '4px', fontSize: '11px', fontWeight: '600',
          color: availColor, background: 'var(--bcm-bg-side)', border: `1px solid ${availColor}`,
          borderRadius: '10px', padding: '2px 8px' } }, availLabel),
      ),
    );

    const statusRow = status
      ? el('div', { style: { fontSize: '12px', fontStyle: 'italic', color: 'var(--bcm-text-muted)', borderLeft: '2px solid var(--bcm-border)', paddingLeft: '8px' } }, `"${status}"`)
      : null;

    const lastSeenRow = lastSeenText
      ? el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, lastSeenText)
      : null;

    const detailItems = [
      ...(pronouns ? [['Pronouns', pronouns]] : []),
      ...(timezone ? [['Timezone',  timezone]]  : []),
    ];
    const detailGrid = detailItems.length
      ? el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', width: '100%' } },
          ...detailItems.map(([label, val]) =>
            el('div', { style: { fontSize: '11px' } },
              el('span', { style: { color: 'var(--bcm-text-muted)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '.04em', fontSize: '10px' } }, label + ' '),
              el('span', { style: { color: 'var(--bcm-text)' } }, val),
            )
          )
        )
      : null;

    const bioBox = bio
      ? el('div', { style: { fontSize: '12px', color: 'var(--bcm-text)', whiteSpace: 'pre-wrap', background: 'var(--bcm-bg-side)',
          border: '1px solid var(--bcm-border)', borderRadius: '6px', padding: '8px 10px', maxHeight: '80px', overflowY: 'auto', width: '100%', boxSizing: 'border-box' } }, bio)
      : null;

    const badgeRow = badges.length
      ? el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          ...badges.map(b => el('span', { style: { background: 'var(--bcm-accent)', color: '#fff', padding: '2px 8px', borderRadius: '10px', fontSize: '11px' } }, b))
        )
      : null;

    const trustedChip = profile?.isTrusted
      ? el('div', { style: { fontSize: '11px', color: '#c43060', fontWeight: '600' } }, '⭐ Trusted contact')
      : null;

    // Online heatmap
    const heatBuckets = getHeatBuckets(contactNum);
    const heatMax = Math.max(1, ...heatBuckets);
    const heatRow = Math.max(...heatBuckets) > 0
      ? el('div', { cls: 'bcm-heat-row', title: 'Typical online hours (your local time)' },
          el('div', { cls: 'bcm-heat-label' }, '🕐 Typically online'),
          el('div', { cls: 'bcm-heat-bars' },
            ...heatBuckets.map((v, h) => {
              const pct = Math.round((v / heatMax) * 100);
              const bar = el('div', { cls: 'bcm-heat-bar', title: `${String(h).padStart(2, '0')}:00 — seen ${v}×` });
              bar.style.height = Math.max(4, pct) + '%';
              if (pct > 60) bar.style.background = 'var(--bcm-accent)';
              return bar;
            }),
          ),
        )
      : null;

    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' } },
      header,
      ...(statusRow   ? [statusRow]   : []),
      ...(lastSeenRow ? [lastSeenRow] : []),
      ...(detailGrid  ? [el('hr', { style: { border: 'none', borderTop: '1px solid var(--bcm-border)', margin: '0' } }), detailGrid] : []),
      ...(bioBox      ? [bioBox]      : []),
      ...(badgeRow    ? [badgeRow]    : []),
      ...(trustedChip ? [trustedChip] : []),
      ...(heatRow     ? [el('hr', { style: { border: 'none', borderTop: '1px solid var(--bcm-border)', margin: '0' } }), heatRow] : []),
    );

    const buttons = [{ label: 'Close', primary: false, value: false }];
    if (contactNum !== state.memberNumber) {
      buttons.unshift({ label: 'Send message', primary: true, value: 'msg' });
    }

    const choice = await openModal({ title: `${name}'s Profile`, body: wrap, buttons });
    if (choice === 'msg') selectContact(contactNum);
  }

  function openContactContextMenu(contactNum, x, y) {
    closeContextMenu();
    const pinLabel  = isPinned(contactNum) ? 'Unpin'   : 'Pin to top';
    const muteLabel = isMuted(contactNum)  ? 'Unmute'  : 'Mute';
    const readReceiptsOn = canSendReadReceiptsForConversation(`c_${contactNum}`);
    const pinEmoji  = isPinned(contactNum) ? '📌 '     : '📌 ';
    const muteEmoji = isMuted(contactNum)  ? '🔔 '     : '🔇 ';

    state.ctxMenuEl = el('div', { cls: 'bcm-ctx-menu' },
      el('div', { cls: 'bcm-ctx-item', onclick: () => { togglePin(contactNum);  closeContextMenu(); } }, pinEmoji  + pinLabel),
      el('div', { cls: 'bcm-ctx-item', onclick: () => { toggleMute(contactNum); closeContextMenu(); } }, muteEmoji + muteLabel),
      el('div', { cls: 'bcm-ctx-item', onclick: () => {
        const key = `c_${contactNum}`;
        if (isReadReceiptsDisabledForConversation(key)) delete state.readReceiptDisabledConversations[key];
        else state.readReceiptDisabledConversations[key] = true;
        persistReadReceiptConversationSettings();
        if (state.selectedContact === contactNum) updateReadReceiptHeaderButton();
        closeContextMenu();
      } }, `${readReceiptsOn ? '✓✓' : '✓'} Read receipts`),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => { closeContextMenu(); await openEditContactDialog(contactNum); } }, '✏ Edit'),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => { closeContextMenu(); await openProfileCard(contactNum); } }, '👤 View profile'),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        try {
          await setConversationFolder(contactNum, 'archive');
          state.conversationFolders[contactNum] = { ...(state.conversationFolders[contactNum] || {}), folder: 'archive' };
          showNote(`Chat with #${contactNum} archived`, false);
          refreshContactList();
        } catch (e) { showNote(`Archive failed: ${e.message}`, true); }
      } }, '📦 Archive'),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        const folderName = await openPrompt('Move to folder (leave blank to remove folder):', state.conversationFolders[contactNum]?.folder || '');
        if (folderName === null) return;
        const cleaned = folderName.trim();
        try {
          await setConversationFolder(contactNum, cleaned || 'inbox', '');
          if (cleaned) state.conversationFolders[contactNum] = { ...(state.conversationFolders[contactNum] || {}), folder: cleaned };
          else delete state.conversationFolders[contactNum];
          showNote(cleaned ? `Moved to folder "${cleaned}"` : 'Folder removed', false);
          refreshContactList();
        } catch (e) { showNote(`Failed: ${e.message}`, true); }
      } }, `📁 ${state.conversationFolders[contactNum]?.folder && state.conversationFolders[contactNum].folder !== 'archive' && state.conversationFolders[contactNum].folder !== 'inbox' ? `Folder: ${state.conversationFolders[contactNum].folder}` : 'Move to folder'}`),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        const snoozePick = await openSelect('Snooze for how long?', [
          { value: '30',    label: '30 minutes' },
          { value: '60',    label: '1 hour' },
          { value: '240',   label: '4 hours' },
          { value: '1440',  label: 'Tomorrow (24 hours)' },
          { value: '10080', label: '1 week' },
          { value: '0',     label: 'Clear snooze' },
        ]);
        if (snoozePick === null) return;
        const mins = parseInt(snoozePick, 10) || 0;
        try {
          await snoozeConversation(contactNum, mins * 60 * 1000);
          if (mins > 0) {
            state.conversationFolders[contactNum] = { ...(state.conversationFolders[contactNum] || {}), snoozedUntil: Date.now() + mins * 60 * 1000 };
            showNote(`Chat snoozed for ${mins >= 1440 ? `${mins/1440}d` : mins >= 60 ? `${mins/60}h` : `${mins}m`}`, false);
          } else {
            if (state.conversationFolders[contactNum]) state.conversationFolders[contactNum].snoozedUntil = null;
            showNote('Snooze cleared', false);
          }
          refreshContactList();
        } catch (e) { showNote(`Snooze failed: ${e.message}`, true); }
      } }, state.conversationFolders[contactNum]?.snoozedUntil > Date.now() ? '🔔 Clear snooze' : '🔕 Snooze'),
      state.trustedContacts.has(contactNum)
        ? el('div', { cls: 'bcm-ctx-item', onclick: async () => {
            closeContextMenu();
            try { await removeTrustedContact(contactNum); await refreshTrustedContactsCache(); showNote(`Removed #${contactNum} from trusted`, false); }
            catch (e) { showNote(`Failed: ${e.message}`, true); }
          }}, '⭐ Untrust')
        : el('div', { cls: 'bcm-ctx-item', onclick: async () => {
            closeContextMenu();
            try { await addTrustedContact(contactNum); await refreshTrustedContactsCache(); showNote(`Added #${contactNum} to trusted`, false); }
            catch (e) { showNote(`Failed: ${e.message}`, true); }
          }}, '⭐ Trust'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => { closeContextMenu(); sendFriendInvite(contactNum); } }, '👋 Invite as BC friend'),
      ...(unsafeWindow.ChatRoomData?.Name ? [el('div', { cls: 'bcm-ctx-item', onclick: () => { closeContextMenu(); sendRoomInvite(contactNum); } }, '🏠 Invite to my room')] : []),
      el('div', { cls: 'bcm-ctx-item bcm-ctx-divider' }, ''),
      el('div', { cls: 'bcm-ctx-item', style: { fontSize: '10px', opacity: '0.7', cursor: 'default' } }, 'Notifications:'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => {
        closeContextMenu();
        state.contactNotifyOverrides[String(contactNum)] = 'always';
        persistNotifyOverrides();
        refreshContactList();
      } }, state.contactNotifyOverrides[String(contactNum)] === 'always' ? '🔔 ✓ Always notify' : '🔔 Always notify'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => {
        closeContextMenu();
        state.contactNotifyOverrides[String(contactNum)] = 'never';
        persistNotifyOverrides();
        refreshContactList();
      } }, state.contactNotifyOverrides[String(contactNum)] === 'never' ? '🔕 ✓ Never notify' : '🔕 Never notify'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => {
        closeContextMenu();
        delete state.contactNotifyOverrides[String(contactNum)];
        persistNotifyOverrides();
        refreshContactList();
      } }, !state.contactNotifyOverrides[String(contactNum)] ? '🔔 ✓ Default' : '🔔 Default'),
      isBlockedMember(contactNum)
        ? el('div', { cls: 'bcm-ctx-item', onclick: async () => {
            closeContextMenu();
            if (!await openConfirm(`Unblock Member #${contactNum}?`)) return;
            try {
              const response = await unblockMember(contactNum);
              if (!response?.success) throw new Error(response?.error || 'Failed');
              await refreshBlockedMembersCache();
              showNote(`Member #${contactNum} unblocked`, false);
              refreshContactList();
            } catch (e) {
              showNote(`Unblock failed: ${e.message}`, true);
            }
          }}, '✅ Unblock')
        : el('div', { cls: 'bcm-ctx-item', onclick: async () => {
            closeContextMenu();
            if (!await openConfirm(`Block Member #${contactNum}?\nThey will not be able to send you new messages.`)) return;
            try {
              await blockMember(contactNum);
              await refreshBlockedMembersCache();
              showNote(`Member #${contactNum} blocked`, false);
              refreshContactList();
            } catch (e) {
              showNote(`Block failed: ${e.message}`, true);
            }
          }}, '🚫 Block'),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        const reason = await openPrompt(`Report Member #${contactNum}\nDescribe the issue (optional):`);
        if (reason === null) return;
        try {
          await reportMember(contactNum, null, reason.trim());
          showNote('Report submitted — thank you', false);
        } catch (e) {
          showNote(`Report failed: ${e.message}`, true);
        }
      }}, '⚑ Report'),
      el('div', { cls: 'bcm-ctx-item bcm-ctx-danger',
        onclick: async () => {
          closeContextMenu();
          if (!await openConfirm('Delete all messages with this contact?')) return;
          await deleteConversation(contactNum);
          delete state.contactMeta[contactNum];
          delete state.unread[contactNum];
          delete state.contactNotes[String(contactNum)];
          delete state.contactAvatarUrls[String(contactNum)];
          scheduleSyncedPreferencesSave();
          GM_setValue(state.STORE + 'avatarUrls', JSON.stringify(state.contactAvatarUrls));
          if (state.selectedContact === contactNum) {
              state.selectedContact = null;
              state.lastRenderedMsgSentAt = 0;
              const ml = state.dialogEl?.querySelector('.bcm-msglist');
              if (ml) { ml.innerHTML = ''; ml.appendChild(el('div', { cls: 'bcm-empty' }, 'Conversation deleted')); }
              const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
              if (hName) hName.textContent = 'Select a contact';
              syncHeaderAvatarForContact(null, '', false);
            }
          updateHTMLBadge();
          refreshContactList();
        }
      }, '🗑 Delete history'),
    );

    const menuW = 170;
    const menuH = (state.ctxMenuEl.children.length * CONTEXT_MENU_ITEM_HEIGHT) + CONTEXT_MENU_TOTAL_VERTICAL_PADDING;
    state.ctxMenuEl.style.left = Math.min(x, window.innerWidth  - menuW - 8) + 'px';
    state.ctxMenuEl.style.top  = Math.min(y, window.innerHeight - menuH - 8) + 'px';
    document.documentElement.appendChild(state.ctxMenuEl);

    setTimeout(() => {
      const outside = e => {
        if (!state.ctxMenuEl?.contains(e.target)) { closeContextMenu(); document.removeEventListener('mousedown', outside, true); }
      };
      const esc = e => {
        if (e.key === 'Escape') { closeContextMenu(); document.removeEventListener('keydown', esc, true); }
      };
      document.addEventListener('mousedown', outside, true);
      document.addEventListener('keydown',   esc,     true);
    }, 0);
  }

  function mutateMessageByReactionKey(reactionKey, mutator) {
    return new Promise(resolve => {
      const db = getDb();
      if (!db || !reactionKey) return resolve(null);
      const tx = db.transaction('messages', 'readwrite');
      const req = tx.objectStore('messages').openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return resolve(null);
        const row = cursor.value;
        if (getReactionKey(row) === reactionKey) {
          const updated = mutator({ ...row });
          cursor.update(updated);
          return resolve(updated);
        }
        cursor.continue();
      };
      req.onerror = () => resolve(null);
    });
  }

  async function editMessageByKey(msg, reactionKey) {
    if (!msg?.fromUs && msg?.senderNum !== state.memberNumber) return;
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    const bubble = Array.from(list.querySelectorAll('.bcm-bubble')).find(b => b.dataset.reactionKey === reactionKey);
    if (!bubble) {
      const parsed = parseQuotePayload(msg.content ?? '');
      const next = await openPrompt('Edit message:', parsed.text ?? '');
      if (next == null) return;
      const trimmed = String(next).trim();
      if (!trimmed) return;
      const newContent = encodeQuotePayload(trimmed, parsed.quote);
      await mutateMessageByReactionKey(reactionKey, row => ({ ...row, content: newContent, edited: true }));
      if (msg.serverId && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'edit', id: msg.serverId, newContent }));
      await redrawCurrentConversation();
      return;
    }
    const contentEl = bubble.querySelector('.bcm-msg-content');
    if (!contentEl || contentEl.querySelector('.bcm-inline-edit-ta')) return;
    const parsed = parseQuotePayload(msg.content ?? '');
    const origHTML = contentEl.innerHTML;
    contentEl.innerHTML = '';
    const ta = el('textarea', { cls: 'bcm-inline-edit-ta' });
    ta.value = parsed.text ?? '';
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') cancel(); });
    const save = async () => {
      const trimmed = ta.value.trim();
      if (!trimmed) { cancel(); return; }
      const newContent = encodeQuotePayload(trimmed, parsed.quote);
      await mutateMessageByReactionKey(reactionKey, row => ({ ...row, content: newContent, edited: true }));
      if (msg.serverId && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: 'edit', id: msg.serverId, newContent }));
      await redrawCurrentConversation();
    };
    const cancel = () => { contentEl.innerHTML = origHTML; };
    const btnRow = el('div', { cls: 'bcm-inline-edit-actions' },
      el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: cancel }, 'Cancel'),
      el('button', { cls: 'bcm-modal-btn primary', type: 'button', onclick: save }, 'Save'),
    );
    contentEl.appendChild(ta);
    contentEl.appendChild(btnRow);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }

  async function deleteMessageByKey(msg, reactionKey) {
    if (!msg?.fromUs && msg?.senderNum !== state.memberNumber) return;
    await mutateMessageByReactionKey(reactionKey, row => ({ ...row, content: '', deleted: true }));
    if (msg.serverId && state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'delete', id: msg.serverId }));
    }
    await redrawCurrentConversation();
  }

  async function forwardMessage(msg) {
    const parsed = parseQuotePayload(msg.content ?? '');
    const body = parsed.text || '';
    if (!body.trim()) return;
    const target = await openPrompt('Forward to member number, or group id as g:<id> (example: 12345 or g:12)');
    if (!target) return;
    const val = target.trim();
    const forwarded = `↪ Forwarded: ${body}`;
    try {
      if (/^g:\d+$/i.test(val)) {
        const gid = parseInt(val.slice(2), 10);
        const r = await sendGroupMessage(gid, forwarded);
        if (!r?.success) throw new Error(r?.error || 'failed');
      } else {
        const rn = parseInt(val, 10);
        if (!rn) throw new Error('invalid member number');
        const r = await sendToServer(rn, forwarded);
        if (!r?.success) throw new Error(r?.error || 'failed');
      }
      showNote('Message forwarded', false);
    } catch (e) {
      showNote(`Forward failed: ${e.message}`, true);
    }
  }

  function openMessageContextMenu(msg, reactionKey, x, y) {
    closeContextMenu();
    const mine = !!msg?.fromUs || msg?.senderNum === state.memberNumber;
    const starLabel = isStarred(reactionKey) ? '⭐ Unstar' : '⭐ Star';
    const canPin = state.selectedGroup ? isCurrentUserGroupAdmin(state.groups[state.selectedGroup]) : !!state.selectedContact;
    const pinLabel = canPin && isPinnedMessage(reactionKey) ? '📌 Unpin' : '📌 Pin';
    const editedItems = (msg?.edited && msg?.serverId) ? [
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        try {
          const r = await getEditRevisions(msg.serverId);
          const revs = r?.revisions ?? [];
          if (!revs.length) { showNote('No edit history found', false); return; }
          openEditHistoryModal(revs);
        } catch { showNote('Could not load edit history', true); }
      }}, '📜 Edit history'),
    ] : [];
    const hasParent = !!msg?.parentMessageRef;
    state.ctxMenuEl = el('div', { cls: 'bcm-ctx-menu' },
      hasParent ? el('div', { cls: 'bcm-ctx-item', onclick: () => { scrollToMessageByRef(msg.parentMessageRef); closeContextMenu(); } }, '🔼 Jump to parent') : null,
      el('div', { cls: 'bcm-ctx-item', onclick: () => {
        closeContextMenu();
        const text = parseQuotePayload(msg.content ?? '').text || '';
        const fallback = () => {
          try {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
          } catch {}
        };
        try { navigator.clipboard.writeText(text).catch(fallback); } catch { fallback(); }
        showNote('Copied to clipboard', false);
      }}, '📋 Copy'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => { setQuote(msg, reactionKey); closeContextMenu(); state.dialogEl?.querySelector('.bcm-input')?.focus(); } }, '↩ Reply'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => { toggleStarByKey(reactionKey); closeContextMenu(); } }, starLabel),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        const name = await openPrompt('Save to collection:\nEnter a collection name (e.g. "favorites", "read later", "funny"):', 'favorites');
        if (name === null || !name.trim()) return;
        try {
          await addToCollection(reactionKey, name.trim());
          showNote(`Saved to "${name.trim()}" collection`, false);
        } catch (e) { showNote(`Failed: ${e.message}`, true); }
      } }, '📁 Save to collection'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => { forwardMessage(msg); closeContextMenu(); } }, '↪ Forward to…'),
      el('div', { cls: 'bcm-ctx-item', onclick: async () => {
        closeContextMenu();
        const pick = await openSelect('Remind me in:', [
          { label: '30 minutes', value: 30 },
          { label: '1 hour', value: 60 },
          { label: '4 hours', value: 240 },
          { label: 'Tomorrow (8h)', value: 480 },
          { label: '1 day', value: 1440 },
        ]);
        if (!pick) return;
        const r = {
          id: String(Date.now()),
          msgText: String(msg.content ?? '').slice(0, 200),
          senderName: state.contactMeta[msg.senderNum]?.name || `Member #${msg.senderNum}`,
          remindAt: Date.now() + pick.value * 60 * 1000,
        };
        state.reminderItems.push(r);
        GM_setValue(state.STORE + 'reminders', state.reminderItems);
        setTimeout(processReminders, Math.max(500, r.remindAt - Date.now()) + 100);
        showNote(`Reminder set for ${pick.label}`);
      }}, '⏰ Remind me'),
      el('div', { cls: 'bcm-ctx-item', onclick: () => { closeContextMenu(); enterSelectionMode(); }}, '☑️ Select messages'),
      ...(canPin ? [el('div', { cls: 'bcm-ctx-item', onclick: () => { togglePinMessage(msg, reactionKey); closeContextMenu(); } }, pinLabel)] : []),
      ...editedItems,
      ...(mine ? [
        el('div', { cls: 'bcm-ctx-item', onclick: () => { editMessageByKey(msg, reactionKey); closeContextMenu(); } }, '✏ Edit message'),
        el('div', { cls: 'bcm-ctx-item bcm-ctx-danger', onclick: () => { deleteMessageByKey(msg, reactionKey); closeContextMenu(); } }, '🗑 Delete message'),
      ] : []),
    );
    state.ctxMenuEl.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    state.ctxMenuEl.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    document.documentElement.appendChild(state.ctxMenuEl);
    setTimeout(() => {
      const outside = e => {
        if (!state.ctxMenuEl?.contains(e.target)) { closeContextMenu(); document.removeEventListener('mousedown', outside, true); }
      };
      document.addEventListener('mousedown', outside, true);
    }, 0);
  }

  function toSafeGroupId(value) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function getGroupMemberCount(group) {
    return normalizeGroupMembers(group?.members ?? []).length;
  }

  function getGroupMemberCountLabel(groupId) {
    const group = state.groups[groupId];
    const memberCount = getGroupMemberCount(group);
    return `${memberCount} member${memberCount !== 1 ? 's' : ''}`;
  }

  function updateGroupHeaderStatus(groupId) {
    if (state.selectedGroup !== groupId) return;
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    if (!hStatus || hStatus.className === 'bcm-msghead-status bcm-typing') return;
    hStatus.textContent = getGroupMemberCountLabel(groupId);
    hStatus.className = 'bcm-msghead-status';
  }

  function isCurrentUserGroupAdmin(group) {
    return normalizeGroupMembers(group?.members ?? []).some(m => Number(m.member_number) === Number(state.memberNumber) && m.role === 'admin');
  }

  function getDisplayNameForMember(num, fallback = null) {
    const n = Number(num);
    if (!n) return fallback || 'Unknown';
    const metaName = state.contactMeta[n]?.name;
    if (getSafeDisplayName(metaName, n, '')) return String(metaName).trim();
    const friendName = getFriendName(n);
    if (getSafeDisplayName(friendName, n, '')) return String(friendName).trim();
    const W = unsafeWindow;
    for (const char of [...(W.ChatRoomCharacter ?? []), ...(W.Character ?? [])]) {
      if (Number(char?.MemberNumber) === n && getSafeDisplayName(char?.Name, n, '')) return String(char.Name).trim();
    }
    try {
      if (typeof W.CharacterFind === 'function') {
        const c = W.CharacterFind(n);
        if (getSafeDisplayName(c?.Name, n, '')) return String(c.Name).trim();
      }
    } catch {}
    return fallback || `Member #${n}`;
  }

  function getFriendUsernameForMember(num) {
    const n = Number(num);
    if (!n) return '';
    const fromMeta = getSafeDisplayName(state.contactMeta[n]?.username, n, '');
    if (fromMeta) return String(fromMeta).trim();
    const display = getSafeDisplayName(state.contactMeta[n]?.name, n, '');
    if (display && !isMemberNumberLikeName(display, n)) return String(display).trim();
    return '';
  }

  function getCurrentConversationKey() {
    if (state.selectedGroup) return `g_${state.selectedGroup}`;
    if (state.selectedContact) return `c_${state.selectedContact}`;
    return null;
  }

  function persistReadReceiptConversationSettings() {
    GM_setValue(state.STORE + 'readReceiptsDisabledConversations', JSON.stringify(state.readReceiptDisabledConversations || {}));
  }

  function isReadReceiptsDisabledForConversation(key) {
    if (!key) return false;
    return !!(state.readReceiptDisabledConversations && state.readReceiptDisabledConversations[key]);
  }

  function canSendReadReceiptsForConversation(key = null) {
    if (!state.sendReadReceipts) return false;
    const convKey = key || getCurrentConversationKey();
    if (!convKey) return false;
    return !isReadReceiptsDisabledForConversation(convKey);
  }

  function toggleCurrentConversationReadReceipts() {
    const key = getCurrentConversationKey();
    if (!key) return;
    if (isReadReceiptsDisabledForConversation(key)) delete state.readReceiptDisabledConversations[key];
    else state.readReceiptDisabledConversations[key] = true;
    persistReadReceiptConversationSettings();
    updateReadReceiptHeaderButton();
    showNote(
      canSendReadReceiptsForConversation(key)
        ? 'Read receipts enabled for this conversation'
        : 'Read receipts disabled for this conversation',
      false
    );
  }

  function getMessageConversationKey(msg) {
    if (msg?.groupId) return `g_${msg.groupId}`;
    if (msg?.partnerNum) return `c_${msg.partnerNum}`;
    return null;
  }

  function getDisappearConfigForConversation(key) {
    if (!key) return { ttlMs: 0, enabledAt: 0 };
    const raw = state.disappearingByConversation?.[key];
    if (raw && typeof raw === 'object') {
      const ttlMs = Number(raw.ttlMs ?? 0);
      const enabledAt = Number(raw.enabledAt ?? 0);
      return {
        ttlMs: Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : 0,
        enabledAt: Number.isFinite(enabledAt) && enabledAt > 0 ? enabledAt : 0,
      };
    }
    const ttlMs = Number(raw ?? 0);
    const safeTtl = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : 0;
    if (safeTtl > 0) {
      const migrated = { ttlMs: safeTtl, enabledAt: Date.now() };
      state.disappearingByConversation[key] = migrated;
      saveDisappearSettings();
      return migrated;
    }
    return { ttlMs: 0, enabledAt: 0 };
  }

  function getDisappearMsForConversation(key) {
    return getDisappearConfigForConversation(key).ttlMs;
  }

  function saveDisappearSettings() {
    scheduleSyncedPreferencesSave();
  }

  function updateDisappearingHeaderButton() {
    const btn = state.dialogEl?.querySelector('.bcm-disappear-btn');
    if (!btn) return;
    const key = getCurrentConversationKey();
    if (!key) {
      btn.style.display = 'none';
      return;
    }
    const cfg = getDisappearConfigForConversation(key);
    const option = DISAPPEAR_OPTIONS.find(o => o.value === cfg.ttlMs) || DISAPPEAR_OPTIONS[0];
    btn.style.display = '';
    btn.title = `Disappearing messages: ${option.label} (click to change)`;
    btn.textContent = cfg.ttlMs > 0 ? `🕐${option.label}` : '🕐';
    btn.classList.toggle('active', cfg.ttlMs > 0);
  }

  function updateReadReceiptHeaderButton() {
    const btn = state.dialogEl?.querySelector('.bcm-read-receipt-btn');
    if (!btn) return;
    const key = getCurrentConversationKey();
    if (!key) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = '';
    const enabled = canSendReadReceiptsForConversation(key);
    btn.textContent = enabled ? '✓✓' : '✓';
    if (!state.sendReadReceipts) {
      btn.title = 'Read receipts are globally disabled in settings';
    } else {
      btn.title = enabled
        ? 'Read receipts are enabled for this conversation'
        : 'Read receipts are disabled for this conversation';
    }
    btn.classList.toggle('active', enabled);
  }

  async function deleteMessageByLocalId(localId) {
    return new Promise(resolve => {
      const db = getDb();
      if (!db || !localId) return resolve(false);
      const tx = db.transaction('messages', 'readwrite');
      tx.objectStore('messages').delete(localId);
      tx.oncomplete = async () => {
        await redrawCurrentConversation();
        refreshContactList();
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  }

  function getDisappearTimerKey(msg, convoKey = null) {
    const key = convoKey || getMessageConversationKey(msg) || 'unknown';
    return `${key}:${msg?.id ?? '0'}`;
  }

  function messageQualifiesForDisappear(msg, convoKey = null) {
    const key = convoKey || getMessageConversationKey(msg);
    const cfg = getDisappearConfigForConversation(key);
    if (!cfg.ttlMs) return false;
    const sentAt = Number(msg?.sentAt || 0);
    if (!sentAt) return false;
    if (cfg.enabledAt && sentAt < cfg.enabledAt) return false;
    return true;
  }

  function getMessageDisappearAt(msg, convoKey = null) {
    const fixed = Number(msg?.disappearAt || 0);
    if (Number.isFinite(fixed) && fixed > 0) return fixed;
    const key = convoKey || getMessageConversationKey(msg);
    if (!messageQualifiesForDisappear(msg, key)) return 0;
    const cfg = getDisappearConfigForConversation(key);
    const sentAt = Number(msg?.sentAt || 0);
    if (!cfg.ttlMs || !sentAt) return 0;
    return sentAt + cfg.ttlMs;
  }

  function scheduleDisappearingForMessage(msg) {
    const key = getMessageConversationKey(msg);
    if (!msg?.id || msg.deleted) return;
    const expiresAt = getMessageDisappearAt(msg, key);
    if (!expiresAt) return;
    const delay = Math.max(0, expiresAt - Date.now());
    const timerKey = getDisappearTimerKey(msg, key);
    clearTimeout(state.disappearTimers[timerKey]);
    state.disappearTimers[timerKey] = setTimeout(() => {
      deleteMessageByLocalId(msg.id).catch(() => {});
      delete state.disappearTimers[timerKey];
    }, delay);
  }

  function setCurrentConversationDisappearMs(ms) {
    const key = getCurrentConversationKey();
    if (!key) return;
    const prev = getDisappearConfigForConversation(key);
    if (!ms) {
      delete state.disappearingByConversation[key];
    } else {
      const enabledAt = prev.ttlMs > 0 && prev.enabledAt > 0 ? prev.enabledAt : Date.now();
      state.disappearingByConversation[key] = { ttlMs: ms, enabledAt };
    }
    saveDisappearSettings();
    Object.keys(state.disappearTimers).forEach(id => {
      if (!id.startsWith(`${key}:`)) return;
      clearTimeout(state.disappearTimers[id]);
      delete state.disappearTimers[id];
    });
    updateDisappearingHeaderButton();
    updateReadReceiptHeaderButton();
    redrawCurrentConversation();
  }

  async function cycleDisappearingSetting() {
    const key = getCurrentConversationKey();
    if (!key) return;
    const current = getDisappearMsForConversation(key);
    const idx = Math.max(0, DISAPPEAR_OPTIONS.findIndex(o => o.value === current));
    const next = DISAPPEAR_OPTIONS[(idx + 1) % DISAPPEAR_OPTIONS.length];
    if (next.value > 0 && state.selectedContact && !state.selectedGroup && !state.contactMeta[state.selectedContact]?.hasBCM) {
      const choice = await openModal({
        title: '⚠️ Contact may not have BC Messenger',
        body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px', color: 'var(--bcm-text)' } },
          el('p', {}, 'Disappearing messages are enforced by BC Messenger on both devices. This contact hasn\'t been detected as a BC Messenger user — messages will disappear for you but not for them.'),
          el('p', {}, 'Would you like to invite them to install BC Messenger?'),
        ),
        buttons: [
          { label: '📨 Invite them',    primary: true,  value: 'invite'  },
          { label: 'Enable anyway',     primary: false, value: 'proceed' },
          { label: 'Cancel',            primary: false, value: 'cancel'  },
        ],
      });
      if (choice !== 'proceed' && choice !== 'invite') return;
      if (choice === 'invite') {
        await sendBCMInvite(state.selectedContact);
        return;
      }
    }
    setCurrentConversationDisappearMs(next.value);
    showNote(`Disappearing messages: ${next.label}`, false);
  }

  async function updateGroupHeaderControls(groupId) {
    const msgHead = state.dialogEl?.querySelector('.bcm-msghead');
    if (!msgHead) return;
    const group = state.groups[groupId] || await getGroup(groupId);
    if (!group) return;
    const manageBtn = msgHead.querySelector('.bcm-manage-group-btn');
    if (manageBtn) manageBtn.style.display = isCurrentUserGroupAdmin(group) ? '' : 'none';
    updateDisappearingHeaderButton();
    updateReadReceiptHeaderButton();
  }

  async function openManageGroupDialog(groupId) {
    const group = await getGroupDetails(groupId);
    if (!group?.members) {
      await openAlert('Failed to load group members.');
      return;
    }
    const normalized = normalizeGroupMembers(group.members);
    const me = normalized.find(m => Number(m.member_number) === Number(state.memberNumber));
    if (!me || me.role !== 'admin') {
      await openAlert('Only admins can manage this group.');
      return;
    }

    const refreshAndRe = async () => {
      const fresh = await getGroupDetails(groupId);
      if (fresh?.members) {
        state.groups[groupId] = { ...(state.groups[groupId] || {}), ...fresh, members: normalizeGroupMembers(fresh.members) };
        await saveGroup(state.groups[groupId]);
      }
      await updateGroupHeaderControls(groupId);
      await refreshContactList();
    };

    const memberRowsEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '220px', overflowY: 'auto', marginBottom: '8px' } });
    for (const m of normalized) {
      const num = Number(m.member_number);
      const name = getDisplayNameForMember(num, `Member #${num}`);
      const isMe = num === state.memberNumber;
      const row = el('div', { cls: 'bcm-member-row' },
        el('span', { cls: 'bcm-member-row-name' }, `${m.role === 'admin' ? '👑 ' : '👤 '}${name} (#${num})`),
      );
      if (!isMe) {
        if (m.role !== 'admin') {
          row.appendChild(el('button', { cls: 'bcm-modal-btn', style: { fontSize: '11px', padding: '2px 7px' }, onclick: async () => {
            try {
              const r = await setGroupMemberRole(groupId, num, 'admin');
              if (!r?.success) throw new Error(r?.error || 'Failed');
              showNote(`Promoted ${name}`, false);
              await refreshAndRe();
              openManageGroupDialog(groupId);
            } catch (ex) { await openAlert(`Promote failed: ${ex.message}`); }
          }}, '▲ Promote'));
        } else {
          row.appendChild(el('button', { cls: 'bcm-modal-btn', style: { fontSize: '11px', padding: '2px 7px' }, onclick: async () => {
            try {
              const r = await setGroupMemberRole(groupId, num, 'member');
              if (!r?.success) throw new Error(r?.error || 'Failed');
              showNote(`Demoted ${name}`, false);
              await refreshAndRe();
              openManageGroupDialog(groupId);
            } catch (ex) { await openAlert(`Demote failed: ${ex.message}`); }
          }}, '▼ Demote'));
        }
        row.appendChild(el('button', { cls: 'bcm-modal-btn danger', style: { fontSize: '11px', padding: '2px 7px' }, onclick: async () => {
          if (!await openConfirm(`Kick ${name} from the group?`)) return;
          try {
            const r = await removeGroupMember(groupId, num);
            if (!r?.success) throw new Error(r?.error || 'Failed');
            showNote(`Kicked ${name}`, false);
            await refreshAndRe();
            openManageGroupDialog(groupId);
          } catch (ex) { await openAlert(`Kick failed: ${ex.message}`); }
        }}, '✕ Kick'));
      }
      memberRowsEl.appendChild(row);
    }

    const actionsEl = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
      el('button', { cls: 'bcm-modal-btn', onclick: async () => {
        const newName = await openPrompt('New group name:', group.name);
        if (!newName?.trim()) return;
        try {
          const r = await renameGroup(groupId, newName.trim());
          if (!r?.success) throw new Error(r?.error || 'Failed');
          showNote(`Group renamed to "${newName.trim()}"`, false);
          await refreshAndRe();
        } catch (ex) { await openAlert(`Rename failed: ${ex.message}`); }
      }}, '✏ Rename'),
      el('button', { cls: 'bcm-modal-btn primary', onclick: async () => {
        const existingNums = new Set(normalized.map(m => Number(m.member_number)));
        const resultsEl = el('div', { cls: 'bcm-member-results', style: { maxHeight: '160px', overflowY: 'auto' } });
        let picked = null;
        const onPick = (c) => { picked = c; };
        const searchWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '280px' } },
          el('input', {
            cls: 'bcm-modal-input',
            type: 'text',
            placeholder: 'Search by name, username, or number…',
            autofocus: true,
            style: { marginBottom: '0' },
            oninput: async (e) => {
              const q = String(e.target.value || '').trim();
              resultsEl.innerHTML = '';
              if (!q || q.length < 2) return;
              const candidates = await findMemberCandidates(q, 10);
              const filtered = candidates.filter(c => !existingNums.has(c.memberNum));
              if (!filtered.length) {
                resultsEl.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)', padding: '8px' } }, 'No matching members found'));
                return;
              }
              for (const c of filtered) {
                const label = getSafeDisplayName(c.name, c.memberNum, '') || `Member #${c.memberNum}`;
                resultsEl.appendChild(el('div', {
                  cls: 'bcm-member-result',
                  onclick: () => {
                    e.target.value = label;
                    onPick(c);
                    resultsEl.innerHTML = '';
                    resultsEl.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--bcm-online)', padding: '8px' } }, `✓ Selected: ${label}`));
                  },
                },
                el('div', {}, label),
                el('div', { cls: 'bcm-member-result-sub' }, buildMemberSearchLabel(c))));
              }
            },
            onkeydown: async (e) => {
              if (e.key === 'Enter') {
                const q = String(e.target.value || '').trim();
                if (!q) return;
                const resolved = await resolveMemberIdentifierWithChoice(q);
                if (resolved?.memberNum && !existingNums.has(resolved.memberNum)) {
                  onPick(resolved);
                  e.target.value = resolved.name || `Member #${resolved.memberNum}`;
                  resultsEl.innerHTML = '';
                  resultsEl.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--bcm-online)', padding: '8px' } }, `✓ Selected: ${resolved.name || `Member #${resolved.memberNum}`}`));
                }
              }
            },
          }),
          resultsEl,
        );
        const ok = await openModal({
          title: 'Add member',
          body: searchWrap,
          buttons: [
            { label: 'Cancel', primary: false, value: false },
            { label: 'Add', primary: true, value: true },
          ],
        });
        if (!ok || !picked?.memberNum) return;
        try {
          const r = await addGroupMembers(groupId, [picked.memberNum]);
          if (!r?.success) throw new Error(r?.error || 'Failed');
          if (!Array.isArray(r?.added) || !r.added.includes(picked.memberNum)) {
            throw new Error(r?.skipped?.[0]?.reason || 'Member was not added');
          }
          showNote(`Added ${picked.name || `Member #${picked.memberNum}`}`, false);
          await refreshAndRe();
          openManageGroupDialog(groupId);
        } catch (ex) { await openAlert(`Add member failed: ${ex.message}`); }
      }}, '+ Add member'),
      el('button', { cls: 'bcm-modal-btn', onclick: async () => {
        try {
          const r = await createGroupInvite(groupId);
          if (!r?.success) throw new Error(r?.error || 'Failed');
          const inviteBody = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '360px' } },
            el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, `Share this code with friends you want in "${r.groupName || group.name}":`),
            el('div', { cls: 'bcm-join-code' }, r.token),
            el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, 'Or share the ready-made invite message:'),
            el('textarea', { cls: 'bcm-modal-input', readonly: 'true', style: { minHeight: '70px', resize: 'vertical' } }, r.inviteText || ''),
          );
          const clicked = await openModal({
            title: '🔗 Group join link',
            body: inviteBody,
            buttons: [
              { label: 'Copy invite', value: 'copy' },
              { label: 'Close', primary: false, value: null },
            ],
          });
          if (clicked === 'copy') {
            try { await navigator.clipboard.writeText(r.inviteText || r.token); showNote('Invite copied to clipboard', false); }
            catch { showNote('Copy failed — select and copy manually', true); }
          }
        } catch (ex) { await openAlert(`Join link failed: ${ex.message}`); }
      }}, '🔗 Join link'),
      el('button', { cls: 'bcm-modal-btn', title: 'Reload members and pending join requests', onclick: async () => {
        openManageGroupDialog(groupId);
      }}, '↻ Refresh'),
    );

    // Pending join requests (admin review queue)
    const joinRequestsEl = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' } });
    let joinRequests = [];
    try {
      const rr = await getGroupJoinRequests(groupId);
      joinRequests = rr?.requests || [];
    } catch {}
    if (Array.isArray(joinRequests) && joinRequests.length) {
      joinRequestsEl.appendChild(el('div', { style: { fontSize: '11px', fontWeight: 'bold', color: 'var(--bcm-accent)', margin: '4px 0 2px' } },
        `📥 Join requests (${joinRequests.length})`));
      for (const jr of joinRequests) {
        const num = Number(jr.member_number);
        const name = jr.member_name || getDisplayNameForMember(num, `Member #${num}`);
        const row = el('div', { cls: 'bcm-member-row', style: { alignItems: 'center' } },
          el('span', { cls: 'bcm-member-row-name', style: { flex: '1' } }, `${name} (#${num})${jr.note ? ` — "${jr.note}"` : ''}`),
        );
        row.appendChild(el('button', {
          cls: 'bcm-modal-btn primary', style: { fontSize: '11px', padding: '2px 7px' },
          onclick: async () => {
            try {
              const rr2 = await acceptGroupJoinRequest(groupId, jr.id);
              if (!rr2?.success) throw new Error(rr2?.error || 'Failed');
              showNote(`Accepted ${name} into the group`, false);
              openManageGroupDialog(groupId);
            } catch (ex) { await openAlert(`Accept failed: ${ex.message}`); }
          },
        }, '✓ Accept'));
        row.appendChild(el('button', {
          cls: 'bcm-modal-btn danger', style: { fontSize: '11px', padding: '2px 7px' },
          onclick: async () => {
            try {
              const rr2 = await declineGroupJoinRequest(groupId, jr.id);
              if (!rr2?.success) throw new Error(rr2?.error || 'Failed');
              showNote(`Declined ${name}`, false);
              openManageGroupDialog(groupId);
            } catch (ex) { await openAlert(`Decline failed: ${ex.message}`); }
          },
        }, '✕ Decline'));
        joinRequestsEl.appendChild(row);
      }
    }

    await openModal({
      title: `⚙ Manage "${group.name}"`,
      body: el('div', {}, joinRequestsEl, memberRowsEl, actionsEl),
      buttons: [{ label: 'Close', primary: false, value: null }],
    });
  }

  async function getMemberSearchCandidates() {
    const map = new Map();
    const add = (num, name, username = '', aliases = []) => {
      const n = Number(num);
      if (!n) return;
      const resolvedName = getSafeDisplayName(name, n, '') || `Member #${n}`;
      const resolvedUsername = getSafeDisplayName(username, n, '');
      const prev = map.get(n) || { memberNum: n, name: '', username: '', aliases: [] };
      const aliasSet = new Set([...(prev.aliases || []), ...aliases.map(v => String(v || '').trim()).filter(Boolean)]);
      map.set(n, {
        memberNum: n,
        name: (!prev.name || isMemberNumberLikeName(prev.name, n)) ? resolvedName : prev.name,
        username: resolvedUsername || prev.username || '',
        aliases: [...aliasSet],
      });
    };
    for (const c of (state.allContacts || [])) add(c.memberNum, c.memberName, state.contactMeta[c.memberNum]?.username, [c.memberName]);
    for (const [k, v] of Object.entries(state.contactMeta || {})) add(Number(k), v?.name, v?.username, [v?.name, v?.username]);
    const W = unsafeWindow;
    iterateFriendNames((n, nickname) => add(n, nickname, getFriendUsernameForMember(n), [nickname, getFriendUsernameForMember(n)]));
    for (const friend of getBCFriendEntries()) add(friend.memberNum, friend.name, getFriendUsernameForMember(friend.memberNum), [friend.name, getFriendUsernameForMember(friend.memberNum)]);
    for (const ch of [...(W.ChatRoomCharacter || []), ...(W.Character || [])]) add(ch?.MemberNumber, ch?.Name, '', [ch?.Name]);
    return [...map.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function getFriendListCandidates() {
    return getBCFriendEntries()
      .map(entry => {
        const num = Number(entry.memberNum);
        const username = getFriendUsernameForMember(num);
        const displayRaw = getSafeDisplayName(entry.name, num, '') || getDisplayNameForMember(num, `Member #${num}`);
        const display = String(displayRaw || '').trim() || `Member #${num}`;
        const safeUsername = getSafeDisplayName(username, num, '');
        return { memberNum: num, name: display, username: safeUsername || display };
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  function buildMemberSearchLabel(candidate) {
    const num = Number(candidate?.memberNum) || 0;
    const name = getSafeDisplayName(candidate?.name, num, '') || `Member #${num}`;
    const username = getSafeDisplayName(candidate?.username, num, '');
    return username && username.toLowerCase() !== name.toLowerCase()
      ? `${name} · @${username} · #${num}`
      : `${name} · #${num}`;
  }

  function normalizeMemberLookupToken(token) {
    return String(token || '').trim().replace(/^[@#]+/, '').trim();
  }

  function getCandidateAliases(candidate) {
    const num = Number(candidate?.memberNum) || 0;
    const username = getSafeDisplayName(candidate?.username, num, '');
    const aliases = new Set(
      [
        String(candidate?.name || ''),
        username,
        username ? `@${username}` : '',
        String(num || ''),
        num ? `#${num}` : '',
        ...(Array.isArray(candidate?.aliases) ? candidate.aliases : []),
      ].map(v => String(v || '').trim()).filter(Boolean)
    );
    return [...aliases];
  }

  function scoreMemberCandidate(candidate, rawQuery) {
    const query = normalizeMemberLookupToken(rawQuery);
    if (!query) return -1;
    const exactRaw = String(rawQuery || '').trim().toLowerCase();
    const exactNormalized = query.toLowerCase();
    const aliases = getCandidateAliases(candidate);
    let best = -1;
    for (const alias of aliases) {
      const rawAlias = String(alias || '').trim();
      const normalizedAlias = normalizeMemberLookupToken(rawAlias).toLowerCase();
      if (!normalizedAlias) continue;
      if (rawAlias.toLowerCase() === exactRaw || normalizedAlias === exactNormalized) best = Math.max(best, 500);
      else if (normalizedAlias.startsWith(exactNormalized)) best = Math.max(best, 300);
      else if (normalizedAlias.includes(exactNormalized)) best = Math.max(best, 150);
    }
    return best;
  }

  async function findMemberCandidates(query, limit = 8) {
    const ranked = (await getMemberSearchCandidates())
      .map(candidate => ({ ...candidate, score: scoreMemberCandidate(candidate, query) }))
      .filter(candidate => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || String(a.name || '').localeCompare(String(b.name || '')));
    return ranked.slice(0, Math.max(1, limit));
  }

  async function openAmbiguousMemberAlert(candidates, token = '') {
    return new Promise(resolve => {
      const overlay = el('div', { cls: 'bcm-onetime-overlay' });
      const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(340px, 94vw)', maxWidth: 'min(520px, 96vw)' } });
      const finish = value => {
        overlay.remove();
        resolve(value ?? null);
      };
      card.appendChild(el('div', { cls: 'bcm-onetime-title' }, 'Multiple matches found'));
      card.appendChild(el('div', { cls: 'bcm-modal-body', style: { display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left' } },
        el('div', { style: { color: 'var(--bcm-text-muted)', fontSize: '12px' } }, token ? `Choose who "${token}" refers to.` : 'Choose a member from the matches below.'),
        ...candidates.map(c => el('button', {
          cls: 'bcm-member-result',
          type: 'button',
          style: { textAlign: 'left' },
          onclick: () => finish(c),
        },
        el('div', {}, getSafeDisplayName(c.name, c.memberNum, '') || `Member #${c.memberNum}`),
        el('div', { cls: 'bcm-member-result-sub' }, buildMemberSearchLabel(c))))),
      );
      const btnRow = el('div', { cls: 'bcm-onetime-actions' },
        el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => finish(null) }, 'Cancel'),
      );
      card.appendChild(btnRow);
      overlay.appendChild(card);
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
      document.documentElement.appendChild(overlay);
      setTimeout(() => card.querySelector('button')?.focus(), 30);
    });
  }

  async function resolveMemberIdentifier(token) {
    const raw = String(token || '').trim();
    const normalizedRaw = normalizeMemberLookupToken(raw);
    if (/^\d+$/.test(normalizedRaw)) {
      const numeric = parseInt(normalizedRaw, 10);
      return { memberNum: numeric, name: getDisplayNameForMember(numeric, `Member #${numeric}`) };
    }
    const candidates = await findMemberCandidates(raw, 12);
    if (!candidates.length) return null;
    const topScore = candidates[0].score;
    const top = candidates.filter(c => c.score === topScore);
    if (topScore >= 300 && top.length > 1) return { ambiguous: top.slice(0, 8) };
    return candidates[0];
  }

  async function resolveMemberIdentifierWithChoice(token) {
    const resolved = await resolveMemberIdentifier(token);
    if (!resolved?.ambiguous?.length) return resolved;
    return await openAmbiguousMemberAlert(resolved.ambiguous, token);
  }

  async function renderMemberLookupResults(container, query, onPick) {
    if (!container) return;
    const q = String(query || '').trim().toLowerCase();
    container.innerHTML = '';
    if (!q || q.length < 2) return;
    const candidates = await findMemberCandidates(query, 8);
    for (const c of candidates) {
      const label = getSafeDisplayName(c.name, c.memberNum, '') || `Member #${c.memberNum}`;
      container.appendChild(el('div', {
        cls: 'bcm-member-result',
        onclick: () => onPick(c),
      },
      el('div', {}, label),
      el('div', { cls: 'bcm-member-result-sub' }, buildMemberSearchLabel(c))));
    }
  }

  function renderFriendListPicker(container, onPick) {
    if (!container) return;
    container.innerHTML = '';
    const friends = getFriendListCandidates();
    if (!friends.length) {
      container.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, 'No friends detected in BC friend list.'));
      return;
    }
    for (const f of friends) {
      const label = getSafeDisplayName(f.name, f.memberNum, '') || `Member #${f.memberNum}`;
      container.appendChild(el('div', {
        cls: 'bcm-member-result',
        onclick: () => onPick(f),
      },
      el('div', {}, label),
      el('div', { cls: 'bcm-member-result-sub' }, buildMemberSearchLabel(f))));
    }
  }

  async function searchLocalMessages(query, limit = 24) {
    const q = String(query || '').trim().toLowerCase();
    if (!q || q.length < 2) return [];
    const [messages, contacts, groupList] = await Promise.all([
      getAllStoredMessages(),
      getAllContacts(),
      getAllGroups(),
    ]);
    const contactNameByNum = Object.fromEntries(contacts.map(c => [Number(c.memberNum), c.memberName]));
    const groupNameById = Object.fromEntries(groupList.map(g => [Number(g.id), g.name]));
    const results = [];
    for (const msg of messages) {
      const preview = getMessagePreviewText(msg.content ?? '', !!msg.deleted).trim();
      const partnerNum = Number(msg.partnerNum || 0) || Number(msg.senderNum || 0) || 0;
      const groupId = Number(msg.groupId || 0) || 0;
      const senderLabel = groupId
        ? getDisplayNameForMember(msg.senderNum, msg.senderName || `Member #${msg.senderNum}`)
        : (msg.fromUs ? (state.memberName ?? `Member #${state.memberNumber}`) : getDisplayNameForMember(partnerNum, contactNameByNum[partnerNum] || `Member #${partnerNum}`));
      const scopeLabel = groupId
        ? (groupNameById[groupId] || state.groups[groupId]?.name || `Group #${groupId}`)
        : (contactNameByNum[partnerNum] || state.contactMeta[partnerNum]?.name || `Member #${partnerNum}`);
      const haystack = [preview, senderLabel, scopeLabel].join('\n').toLowerCase();
      if (!haystack.includes(q)) continue;
      results.push({
        ...msg,
        preview,
        snippet: buildSearchSnippet(preview, q),
        scopeLabel,
        senderLabel,
        reactionKey: getReactionKey(msg),
      });
    }
    return results.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)).slice(0, limit);
  }

  function openMessageSearchWithQuery(query) {
    const bar = state.dialogEl?.querySelector('.bcm-msgsearch-bar');
    if (!bar) return;
    state.msgSearchOpen = true;
    bar.classList.add('open');
    const input = bar.querySelector('.bcm-msgsearch-input');
    if (input) input.value = query;
    runMsgSearch(query);
  }

  function flashBubble(bubble) {
    if (!bubble) return;
    bubble.classList.remove('bcm-search-jump');
    void bubble.offsetWidth;
    bubble.classList.add('bcm-search-jump');
    bubble.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => bubble.classList.remove('bcm-search-jump'), 1500);
  }

  function buildSearchSnippet(text, query, radius = 42) {
    const source = String(text || '').replace(/\s+/g, ' ').trim();
    const q = String(query || '').trim().toLowerCase();
    if (!source) return '(empty)';
    if (!q) return source;
    const idx = source.toLowerCase().indexOf(q);
    if (idx < 0) return source;
    const start = Math.max(0, idx - radius);
    const end = Math.min(source.length, idx + q.length + radius);
    return `${start > 0 ? '…' : ''}${source.slice(start, end).trim()}${end < source.length ? '…' : ''}`;
  }

  async function jumpToGlobalSearchResult(result, query) {
    if (result.groupId) {
      await selectGroup(result.groupId);
    } else {
      const partnerNum = Number(result.partnerNum || result.senderNum || 0);
      await selectContact(partnerNum, result.scopeLabel || `Member #${partnerNum}`);
    }
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    let bubble = result.serverId ? list.querySelector(`[data-sid="${result.serverId}"]`) : null;
    if (!bubble && result.reactionKey) {
      bubble = Array.from(list.querySelectorAll('.bcm-bubble')).find(b => b.dataset.reactionKey === result.reactionKey) || null;
    }
    if (bubble) {
      flashBubble(bubble);
      return;
    }
    openMessageSearchWithQuery(query);
  }

  async function renderSidebarMessageSearchResults(list, query, runId) {
    let results = [];
    try {
      results = await searchLocalMessages(query);
    } catch {
      return false;
    }
    if (runId !== state.sidebarSearchToken || state.dialogEl?.querySelector('.bcm-search')?.value?.trim().toLowerCase() !== String(query || '').trim().toLowerCase()) {
      return false;
    }
    if (!results.length) return false;
    list.appendChild(el('div', { cls: 'bcm-search-section-title' }, 'Local messages'));
    for (const result of results) {
      list.appendChild(el('div', {
        cls: 'bcm-search-result',
        onclick: () => jumpToGlobalSearchResult(result, query),
      },
      el('div', { cls: 'bcm-search-result-meta' }, `${result.scopeLabel} · ${result.senderLabel} · ${new Date(result.sentAt || Date.now()).toLocaleString()}`),
      el('div', { cls: 'bcm-search-result-text' }, result.snippet || result.preview || '(empty)')));
    }
    if (results.length >= 24) {
      list.appendChild(el('div', { cls: 'bcm-search-result-meta', style: { padding: '0 14px 8px 14px' } }, 'Showing the newest 24 local matches'));
    }
    return true;
  }


  function isPinned(num) { return state.pinnedContacts.has(Number(num)); }
  function isMuted(num)  { return state.mutedContacts.has(Number(num));  }

  function togglePin(num) {
    num = Number(num);
    if (state.pinnedContacts.has(num)) state.pinnedContacts.delete(num); else state.pinnedContacts.add(num);
    scheduleSyncedPreferencesSave();
    refreshContactList();
  }

  function toggleMute(num) {
    num = Number(num);
    if (state.mutedContacts.has(num)) state.mutedContacts.delete(num); else state.mutedContacts.add(num);
    scheduleSyncedPreferencesSave();
    refreshContactList();
  }

  function clearAllUnread() {
    state.unread = {};
    updateHTMLBadge();
    refreshContactList();
  }


  function savePinnedMessages() {
    GM_setValue(state.STORE + 'pinnedMessages', JSON.stringify(state.pinnedMessages));
  }

  function getPinnedForConversation(convKey) {
    return Array.isArray(state.pinnedMessages[convKey]) ? state.pinnedMessages[convKey] : [];
  }

  function isPinnedMessage(reactionKey) {
    if (!reactionKey) return false;
    const key = getCurrentConversationKey();
    if (!key) return false;
    return getPinnedForConversation(key).some(p => p.reactionKey === reactionKey);
  }

  function togglePinMessage(msg, reactionKey) {
    const convKey = getCurrentConversationKey();
    if (!convKey || !reactionKey) return;
    const pins = getPinnedForConversation(convKey);
    const idx = pins.findIndex(p => p.reactionKey === reactionKey);
    if (idx >= 0) {
      pins.splice(idx, 1);
    } else {
      const preview = getMessagePreviewText(msg.content ?? '', !!msg.deleted).trim().slice(0, 120) || '(attachment)';
      const isGroupMsg = msg.messageType === 'group' || msg.groupId;
      const senderLabel = isGroupMsg
        ? getDisplayNameForMember(msg.senderNum, msg.senderName || `Member #${msg.senderNum}`)
        : (msg.fromUs ? (state.memberName ?? `Member #${state.memberNumber}`) : (state.contactMeta[msg.partnerNum]?.name || `Member #${msg.partnerNum}`));
      pins.push({ reactionKey, preview, senderLabel, sentAt: msg.sentAt || 0 });
    }
    state.pinnedMessages[convKey] = pins;
    savePinnedMessages();
    updatePinBanner();
  }

  function unpinLatestMessage() {
    const convKey = getCurrentConversationKey();
    if (!convKey) return;
    const pins = getPinnedForConversation(convKey);
    if (!pins.length) return;
    pins.pop();
    state.pinnedMessages[convKey] = pins;
    savePinnedMessages();
    updatePinBanner();
  }

  function updatePinBanner() {
    const banner = state.dialogEl?.querySelector('.bcm-pin-banner');
    if (!banner) return;
    const convKey = getCurrentConversationKey();
    const pins = convKey ? getPinnedForConversation(convKey) : [];
    if (!pins.length) {
      banner.classList.remove('visible');
      return;
    }
    const latest = pins[pins.length - 1];
    const text = banner.querySelector('.bcm-pin-banner-text');
    if (text) text.textContent = `${latest.senderLabel}: ${latest.preview}`;
    banner.classList.add('visible');
    banner.onclick = e => {
      if (e.target.closest('.bcm-pin-banner-close') || e.target.closest('.bcm-pin-all-btn')) return;
      const list = state.dialogEl?.querySelector('.bcm-msglist');
      if (!list) return;
      const bubble = Array.from(list.querySelectorAll('.bcm-bubble')).find(b => b.dataset.reactionKey === latest.reactionKey) || null;
      if (bubble) flashBubble(bubble);
      else openMessageSearchWithQuery(latest.preview.slice(0, 40));
    };
  }

  function openPinnedMessagesPanel() {
    const convKey = getCurrentConversationKey();
    const pins = convKey ? getPinnedForConversation(convKey) : [];
    const list = state.dialogEl?.querySelector('.bcm-msglist');

    return new Promise(resolve => {
      const overlay = el('div', { cls: 'bcm-onetime-overlay' });
      const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(340px, 94vw)', maxWidth: 'min(520px, 96vw)', maxHeight: '70vh' } });
      const close = () => { overlay.remove(); resolve(); };
      card.appendChild(el('div', { cls: 'bcm-onetime-title' }, `📌 Pinned messages (${pins.length})`));
      const scrollArea = el('div', { cls: 'bcm-scheduled-list' });
      if (!pins.length) {
        scrollArea.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)', padding: '8px' } }, 'No pinned messages in this conversation.'));
      } else {
        [...pins].reverse().forEach(p => {
          const item = el('div', { cls: 'bcm-scheduled-item' });
          const info = el('div', { style: { flex: '1', minWidth: 0 } });
          info.appendChild(el('div', { cls: 'bcm-scheduled-item-meta' }, `${p.senderLabel} · ${p.sentAt ? new Date(p.sentAt).toLocaleString() : ''}`));
          info.appendChild(el('div', { cls: 'bcm-scheduled-item-text' }, p.preview));
          const delBtn = el('button', { cls: 'bcm-scheduled-item-del', title: 'Unpin', onclick: () => {
            const idx = pins.findIndex(x => x.reactionKey === p.reactionKey);
            if (idx >= 0) pins.splice(idx, 1);
            state.pinnedMessages[convKey] = pins;
            savePinnedMessages();
            updatePinBanner();
            item.remove();
          }}, '✕');
          item.appendChild(info);
          item.appendChild(delBtn);
          item.addEventListener('click', e => {
            if (e.target.closest('.bcm-scheduled-item-del')) return;
            close();
            if (!list) return;
            const bubble = Array.from(list?.querySelectorAll('.bcm-bubble') ?? []).find(b => b.dataset.reactionKey === p.reactionKey) || null;
            if (bubble) flashBubble(bubble);
            else openMessageSearchWithQuery(p.preview.slice(0, 40));
          });
          scrollArea.appendChild(item);
        });
      }
      card.appendChild(scrollArea);
      card.appendChild(el('div', { cls: 'bcm-onetime-actions' },
        el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: close }, 'Close'),
      ));
      overlay.appendChild(card);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      document.documentElement.appendChild(overlay);
    });
  }


  function saveScheduledMessages() {
    GM_setValue(state.STORE + 'scheduled', JSON.stringify(state.scheduledMessages));
  }

  function getScheduledCountForConversation(convKey) {
    if (!convKey) return 0;
    return state.scheduledMessages.filter(m => m.convKey === convKey).length;
  }

  function removeScheduledMessage(id) {
    if (state.scheduledTimers[id]) { clearTimeout(state.scheduledTimers[id]); delete state.scheduledTimers[id]; }
    const idx = state.scheduledMessages.findIndex(m => m.id === id);
    if (idx >= 0) state.scheduledMessages.splice(idx, 1);
    saveScheduledMessages();
    refreshContactList();
  }

  async function dispatchScheduledMessage(item) {
    removeScheduledMessage(item.id);
    if (!item.convKey) return;
    try {
      if (item.groupId) {
        const result = await sendGroupMessage(item.groupId, item.content);
        if (result?.success) {
          const sentAt = Date.now();
          const status = deriveStatusFromGroupReceipt(result?.receipt) || 'sent';
          let msg = {
            groupId: item.groupId, senderNum: state.memberNumber, senderName: state.memberName || `Member #${state.memberNumber}`,
            content: item.content, sentAt, fromUs: true, serverId: null, status, messageType: 'group',
            groupMessageRef: result?.groupMessageRef ?? null,
          };
          msg = updateGroupReceiptForMessage(msg, result?.receipt, result?.groupMessageRef ?? null);
          try { msg = await saveGroupMessage(item.groupId, state.memberNumber, state.memberName || `Member #${state.memberNumber}`, item.content, sentAt, true, null, status, false, result?.groupMessageRef ?? null, result?.receipt ?? null); } catch {}
          if (result?.senderMessageId) updateMessageServerId(msg, result.senderMessageId).catch(() => {});
          if (state.selectedGroup === item.groupId) { appendBubble(msg); scrollMsgs(); }
        } else {
          showNote(`Scheduled message failed to send to group`, true);
        }
      } else if (item.contactNum) {
        const cn = Number(item.contactNum);
        const result = await sendMessage(cn, item.content);
        if (result?.success) {
          const sentAt = Date.now();
          let msg = { partnerNum: cn, content: item.content, sentAt, fromUs: true, status: 'sent', serverId: null };
          try { msg = await saveMessage(cn, item.content, sentAt, true, null, 'sent'); } catch {}
          if (result?.messageId) updateMessageServerId(msg, result.messageId).catch(() => {});
          if (state.selectedContact === cn && !state.selectedGroup) { appendBubble(msg); scrollMsgs(); }
        } else {
          showNote(`Scheduled message failed to send`, true);
        }
      }
    } catch (e) {
      console.error('[BCM] Scheduled send error:', e);
      showNote('Scheduled message send error', true);
    }
  }

  function scheduleTimerForItem(item) {
    if (!item?.id || !item?.sendAt) return;
    const delay = Math.max(0, item.sendAt - Date.now());
    if (state.scheduledTimers[item.id]) clearTimeout(state.scheduledTimers[item.id]);
    state.scheduledTimers[item.id] = setTimeout(() => dispatchScheduledMessage(item), delay);
  }

  function processScheduledMessages() {
    const now = Date.now();
    const overdue = state.scheduledMessages.filter(m => m.sendAt <= now);
    const future  = state.scheduledMessages.filter(m => m.sendAt > now);
    for (const item of overdue) dispatchScheduledMessage(item);
    for (const item of future) scheduleTimerForItem(item);
    if (overdue.length > 0) refreshContactList();
  }

  function semverGt(a, b) {
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      const na = pa[i] ?? 0, nb = pb[i] ?? 0;
      if (na > nb) return true;
      if (na < nb) return false;
    }
    return false;
  }

  function showUpdateBanner(latestVersion) {
    const bar = state.dialogEl?.querySelector('.bcm-update-bar');
    if (!bar) return;
    bar.innerHTML = '';
    bar.style.display = 'flex';
    bar.appendChild(document.createTextNode('🆕 Update available — v' + latestVersion + '  '));
    const link = document.createElement('a');
    link.textContent = 'Install update';
    link.title = 'Click to install the latest version via Tampermonkey';
    link.addEventListener('click', () => window.open(UPDATE_URL, '_blank'));
    bar.appendChild(link);
    const dismiss = el('button', { cls: 'bcm-update-dismiss', title: 'Dismiss' }, '×');
    dismiss.addEventListener('click', () => {
      bar.style.display = 'none';
      GM_setValue(STORE_BASE + 'dismissedUpdate', latestVersion);
    });
    bar.appendChild(dismiss);
  }

  function checkForUpdates() {
    const dismissed = GM_getValue(STORE_BASE + 'dismissedUpdate', '');
    GM_xmlhttpRequest({
      method: 'GET',
      url: UPDATE_URL,
      headers: { 'Cache-Control': 'no-cache' },
      timeout: 10000,
      onload: r => {
        try {
          const match = r.responseText.match(/\/\/\s*@version\s+([\d.]+)/);
          if (!match) return;
          const latest = match[1].trim();
          if (semverGt(latest, SCRIPT_VERSION)) {
            GM_setValue(STORE_BASE + 'lastLatestVersion', latest);
            if (latest !== dismissed) showUpdateBanner(latest);
          }
        } catch {}
      },
      onerror: () => {},
      ontimeout: () => {},
    });
  }

  function processReminders() {
    const now = Date.now();
    const due    = state.reminderItems.filter(r => r.remindAt <= now);
    const future = state.reminderItems.filter(r => r.remindAt > now);
    for (const r of due) {
      showToast(`⏰ Reminder from ${r.senderName}`, r.msgText || '(no text)', null);
    }
    if (due.length > 0) {
      state.reminderItems = future;
      GM_setValue(state.STORE + 'reminders', state.reminderItems);
    }
    for (const r of future) {
      const delay = Math.max(500, r.remindAt - Date.now());
      setTimeout(processReminders, delay + 100);
    }
  }

  function makeModalOverlay() {
    const overlay = el('div', { cls: 'bcm-onetime-overlay' });
    overlay.style.setProperty('position', 'fixed', 'important');
    overlay.style.setProperty('top', '0', 'important');
    overlay.style.setProperty('left', '0', 'important');
    overlay.style.setProperty('width', '100vw', 'important');
    overlay.style.setProperty('height', '100vh', 'important');
    overlay.style.setProperty('display', 'flex', 'important');
    overlay.style.setProperty('align-items', 'center', 'important');
    overlay.style.setProperty('justify-content', 'center', 'important');
    overlay.style.setProperty('z-index', '2147483640', 'important');
    overlay.style.setProperty('background', 'rgba(0,0,0,.45)', 'important');
    return overlay;
  }

  async function openBCImportDialog() {
    const existing = new Set(Object.keys(state.contactMeta).map(Number));
    const bcFriends = getBCFriendEntries().filter(f => f.memberNum && !existing.has(Number(f.memberNum)));
    if (bcFriends.length === 0) { await openAlert('All your BC friends are already imported as contacts!'); return; }
    const selected = new Set(bcFriends.map(f => f.memberNum));
    await new Promise(resolve => {
      const overlay = makeModalOverlay();
      const finish = () => { overlay.remove(); resolve(); };
      const countLbl = el('span', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, `${selected.size} selected`);
      const updateCount = () => { countLbl.textContent = `${selected.size} selected`; };
      const rows = bcFriends.map(f => {
        const num = f.memberNum;
        const chk = el('input', { type: 'checkbox' });
        chk.checked = true;
        chk.addEventListener('change', () => { if (chk.checked) selected.add(num); else selected.delete(num); updateCount(); });
        return el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid var(--bcm-border)' } },
          chk,
          el('span', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, f.name || `Member #${num}`),
          f.room ? el('span', { style: { fontSize: '10px', color: 'var(--bcm-text-muted)', marginLeft: 'auto' } }, `📍 ${f.room}`) : null,
        );
      }).filter(Boolean);
      const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(340px,94vw)', maxWidth: 'min(500px,96vw)' } },
        el('div', { cls: 'bcm-onetime-title' }, '📥 Import BC Friends'),
        el('div', { cls: 'bcm-modal-body' }, `${bcFriends.length} BC friend${bcFriends.length !== 1 ? 's' : ''} not yet in your contacts:`),
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', margin: '4px 0 4px' } }, countLbl),
        el('div', { style: { maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--bcm-border)', borderRadius: '6px', margin: '0 0 8px' } }, ...rows),
        el('div', { cls: 'bcm-onetime-actions' },
          el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => finish() }, 'Cancel'),
          el('button', { cls: 'bcm-modal-btn primary', type: 'button', onclick: async () => {
            finish();
            let imported = 0;
            for (const f of bcFriends) {
              if (selected.has(f.memberNum)) { await upsertContact(f.memberNum, f.name || `Member #${f.memberNum}`); imported++; }
            }
            await refreshContactList();
            showNote(`Imported ${imported} contact${imported !== 1 ? 's' : ''}`);
          }}, 'Import Selected'),
        ),
      );
      overlay.appendChild(card);
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
      document.documentElement.appendChild(overlay);
    });
  }

  async function openBroadcastDialog() {
    const contacts = Object.entries(state.contactMeta)
      .filter(([num]) => Number(num) !== state.memberNumber)
      .map(([num, m]) => ({ num: Number(num), name: m.name || `Member #${num}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (contacts.length === 0) { await openAlert('No contacts to broadcast to.'); return; }
    const selected = new Set();
    await new Promise(resolve => {
      const overlay = makeModalOverlay();
      const finish = () => { overlay.remove(); resolve(); };
      const countLbl = el('span', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, '0 selected');
      const updateCount = () => { countLbl.textContent = `${selected.size} selected`; };
      const textarea = el('textarea', { cls: 'bcm-modal-input', placeholder: 'Message to broadcast…',
        style: { resize: 'vertical', minHeight: '60px', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', marginTop: '8px' } });
      textarea.addEventListener('keydown', e => e.stopPropagation());
      const rows = contacts.map(c => {
        const chk = el('input', { type: 'checkbox' });
        chk.addEventListener('change', () => { if (chk.checked) selected.add(c.num); else selected.delete(c.num); updateCount(); });
        return el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 10px', cursor: 'pointer', borderBottom: '1px solid var(--bcm-border)' } },
          chk,
          el('span', { style: { fontSize: '12px', color: 'var(--bcm-text)' } }, c.name),
        );
      });
      const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(360px,94vw)', maxWidth: 'min(520px,96vw)' } },
        el('div', { cls: 'bcm-onetime-title' }, '📣 Broadcast Message'),
        el('div', { cls: 'bcm-modal-body' }, 'Send the same message to multiple contacts.'),
        textarea,
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 4px' } },
          el('span', { style: { fontSize: '12px', fontWeight: '600', color: 'var(--bcm-text)' } }, 'Recipients:'),
          countLbl,
        ),
        el('div', { style: { maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--bcm-border)', borderRadius: '6px', marginBottom: '8px' } }, ...rows),
        el('div', { cls: 'bcm-onetime-actions' },
          el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => finish() }, 'Cancel'),
          el('button', { cls: 'bcm-modal-btn primary', type: 'button', onclick: async () => {
            const text = textarea.value.trim();
            if (!text) { showNote('Enter a message first', true); return; }
            if (selected.size === 0) { showNote('Select at least one recipient', true); return; }
            finish();
            let sent = 0;
            for (const num of selected) {
              try { await sendToServer(num, text); sent++; } catch {}
            }
            showNote(`Broadcast sent to ${sent} contact${sent !== 1 ? 's' : ''}`);
          }}, 'Send Broadcast'),
        ),
      );
      overlay.appendChild(card);
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(); });
      document.documentElement.appendChild(overlay);
      setTimeout(() => textarea.focus(), 30);
    });
  }

  async function openPollCreationDialog() {
    if (!state.selectedContact && !state.selectedGroup) {
      await openAlert('Select a contact or group first.');
      return;
    }
    if (state.selectedContact && !state.selectedGroup && !state.contactMeta[state.selectedContact]?.hasBCM) {
      const choice = await openModal({
        title: '⚠️ Contact may not have BC Messenger',
        body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px', color: 'var(--bcm-text)' } },
          el('p', {}, 'Polls require BC Messenger on both sides. This contact hasn\'t been detected as a BC Messenger user — they won\'t be able to see or vote in the poll.'),
          el('p', {}, 'Would you like to invite them to install BC Messenger first?'),
        ),
        buttons: [
          { label: '📨 Invite them',  primary: true,  value: 'invite'  },
          { label: 'Create anyway',  primary: false, value: 'proceed' },
          { label: 'Cancel',         primary: false, value: 'cancel'  },
        ],
      });
      if (choice !== 'proceed' && choice !== 'invite') return;
      if (choice === 'invite') {
        await sendBCMInvite(state.selectedContact);
        return;
      }
    }
    const optionInputs = [];
    let pollDuration = 0;
    const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      el('div', { cls: 'bcm-modal-body' }, 'Create a poll'),
      el('input', { cls: 'bcm-modal-input', type: 'text', placeholder: 'Poll question', autofocus: true }),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        ...[0, 1, 2, 3, 4].map(i => {
          const inp = el('input', { cls: 'bcm-modal-input', type: 'text', placeholder: `Option ${i + 1}${i < 2 ? ' (required)' : ''}` });
          optionInputs.push(inp);
          return inp;
        }),
      ),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        el('span', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'Duration:'),
        el('select', { cls: 'bcm-modal-input', style: { flex: '1' },
          onchange: (e) => { pollDuration = parseInt(e.target.value, 10) || 0; }
        },
          el('option', { value: '0' }, 'No limit'),
          el('option', { value: '5' }, '5 minutes'),
          el('option', { value: '15' }, '15 minutes'),
          el('option', { value: '30' }, '30 minutes'),
          el('option', { value: '60' }, '1 hour'),
          el('option', { value: '360' }, '6 hours'),
          el('option', { value: '1440' }, '24 hours'),
          el('option', { value: '10080' }, '7 days'),
        ),
      ),
    );
    const ok = await openModal({
      title: 'Create Poll',
      body: wrap,
      buttons: [
        { label: 'Cancel', primary: false, value: false },
        { label: 'Create poll', primary: true, value: true },
      ],
    });
    if (!ok) return;
    const questionInput = wrap.querySelector('.bcm-modal-input');
    const question = String(questionInput?.value ?? '').trim();
    const options = optionInputs.map(inp => String(inp.value ?? '').trim()).filter(Boolean);
    if (!question || options.length < 2) {
      await openAlert('Please enter a question and at least 2 options.');
      return;
    }

    const pollPayload = JSON.stringify({ text: '', spoiler: false, oneTime: false, poll: { question, options } });
    const content = `${BCM_MSG_PREFIX}${pollPayload}`;
    const now = Date.now();

    if (state.selectedGroup) {
      try {
        const result = await sendGroupMessage(state.selectedGroup, content);
        if (!result?.success) throw new Error(result?.error || 'Failed');
        await saveGroupMessage(state.selectedGroup, state.memberNumber, state.memberName ?? `Member #${state.memberNumber}`, content, now, true, result.senderMessageId ?? null, 'sent', false, result.groupMessageRef);
        const ref = `gref:${result.groupMessageRef}`;
        await createPoll(ref, question, options, pollDuration);
        showNote('Poll created', false);
        await redrawCurrentConversation();
        scrollMsgs();
      } catch (e) { await openAlert(`Poll failed: ${e.message}`); }
    } else {
      try {
        const result = await sendToServer(state.selectedContact, content, false);
        if (!result?.success) throw new Error(result?.error || 'Failed');
        await saveMessage(state.selectedContact, state.memberNumber, content, now, true, result.id ?? null, 'sent', false);
        const ref = `sid:${result.id}`;
        await createPoll(ref, question, options, pollDuration);
        showNote('Poll created', false);
        await redrawCurrentConversation();
        scrollMsgs();
      } catch (e) { await openAlert(`Poll failed: ${e.message}`); }
    }
  }

  function openScheduleSendDialog() {
    if (!state.selectedContact && !state.selectedGroup) {
      showNote('Select a contact or group first', true);
      return;
    }
    const input = state.dialogEl?.querySelector('.bcm-input');
    const content = input?.value?.trim() || '';
    if (!content) {
      showNote('Type a message first, then click ⏰ to schedule it', true);
      return;
    }

    const now = new Date();
    const defaultDate = new Date(now.getTime() + 60 * 60 * 1000);
    const padZ = n => String(n).padStart(2, '0');
    const defaultValue = `${defaultDate.getFullYear()}-${padZ(defaultDate.getMonth()+1)}-${padZ(defaultDate.getDate())}T${padZ(defaultDate.getHours())}:${padZ(defaultDate.getMinutes())}`;

    return new Promise(resolve => {
      const overlay = el('div', { cls: 'bcm-onetime-overlay' });
      const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(320px, 94vw)', maxWidth: 'min(420px, 96vw)' } });
      const close = val => { overlay.remove(); resolve(val ?? null); };

      const dtInput = el('input', {
        type: 'datetime-local',
        value: defaultValue,
        style: {
          background: 'var(--bcm-bg-input)', border: '1px solid var(--bcm-border)',
          color: 'var(--bcm-text)', borderRadius: '6px', padding: '7px 10px',
          fontSize: '13px', outline: 'none', width: '100%', boxSizing: 'border-box',
        }
      });
      dtInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(null); });

      const preview = el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)', border: '1px solid var(--bcm-border)', borderRadius: '6px', padding: '6px 8px', maxHeight: '60px', overflow: 'hidden', background: 'var(--bcm-bg-input)' } }, content.slice(0, 140) + (content.length > 140 ? '…' : ''));
      const convLabel = state.selectedGroup ? `Group: ${state.groups[state.selectedGroup]?.name || `#${state.selectedGroup}`}` : `DM: ${state.contactMeta[state.selectedContact]?.name || `Member #${state.selectedContact}`}`;

      card.appendChild(el('div', { cls: 'bcm-onetime-title' }, '⏰ Schedule send'));
      card.appendChild(el('div', { cls: 'bcm-modal-body', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, `To: ${convLabel}`),
        el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, 'Message preview:'),
        preview,
        el('div', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, 'Send at:'),
        dtInput,
      ));
      card.appendChild(el('div', { cls: 'bcm-onetime-actions' },
        el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: () => close(null) }, 'Cancel'),
        el('button', { cls: 'bcm-modal-btn', type: 'button', style: { background: 'var(--bcm-accent)', color: '#fff', border: 'none' }, onclick: () => {
          const dt = dtInput.value;
          if (!dt) { showNote('Please pick a date and time', true); return; }
          const sendAt = new Date(dt).getTime();
          if (!sendAt || isNaN(sendAt)) { showNote('Invalid date/time', true); return; }
          if (sendAt <= Date.now()) { showNote('Scheduled time must be in the future', true); return; }

          const id = `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          const convKey = getCurrentConversationKey();
          const item = {
            id,
            convKey,
            contactNum: state.selectedContact || null,
            groupId: state.selectedGroup || null,
            content: encodeMessagePayload(content, state.currentQuote, { spoiler: state.composeSpoiler, oneTime: state.composeOneTime }),
            sendAt,
          };
          state.scheduledMessages.push(item);
          saveScheduledMessages();
          scheduleTimerForItem(item);
          if (input) { input.value = ''; autoResize({ target: input }); }
          if (state.selectedContact) saveDraft(state.selectedContact, '');
          if (state.selectedGroup) saveDraft('g_' + state.selectedGroup, '');
          clearQuote();
          clearComposeModes();
          refreshContactList();
          showNote(`Message scheduled for ${new Date(sendAt).toLocaleString()}`, false);
          close(id);
        }}, 'Schedule'),
      ));
      overlay.appendChild(card);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
      document.documentElement.appendChild(overlay);
      setTimeout(() => dtInput.focus(), 30);
    });
  }

  function openScheduledMessagesPanel() {
    return new Promise(resolve => {
      const overlay = el('div', { cls: 'bcm-onetime-overlay' });
      const card = el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(360px, 94vw)', maxWidth: 'min(520px, 96vw)', maxHeight: '75vh' } });
      const close = () => { overlay.remove(); resolve(); };

      card.appendChild(el('div', { cls: 'bcm-onetime-title' }, `⏰ Scheduled messages (${state.scheduledMessages.length})`));
      const scrollArea = el('div', { cls: 'bcm-scheduled-list' });

      const renderList = () => {
        scrollArea.innerHTML = '';
        if (!state.scheduledMessages.length) {
          scrollArea.appendChild(el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)', padding: '8px' } }, 'No scheduled messages.'));
          return;
        }
        [...state.scheduledMessages].sort((a, b) => a.sendAt - b.sendAt).forEach(item => {
          const row = el('div', { cls: 'bcm-scheduled-item' });
          const convName = item.groupId
            ? (state.groups[item.groupId]?.name || `Group #${item.groupId}`)
            : (state.contactMeta[item.contactNum]?.name || `Member #${item.contactNum}`);
          const info = el('div', { style: { flex: '1', minWidth: 0 } });
          info.appendChild(el('div', { cls: 'bcm-scheduled-item-meta' }, `${convName} · ${new Date(item.sendAt).toLocaleString()}`));
          const previewText = getMessagePreviewText(item.content, false).slice(0, 100);
          info.appendChild(el('div', { cls: 'bcm-scheduled-item-text' }, previewText));
          const delBtn = el('button', { cls: 'bcm-scheduled-item-del', title: 'Cancel', onclick: () => {
            removeScheduledMessage(item.id);
            row.remove();
            const titleEl = card.querySelector('.bcm-onetime-title');
            if (titleEl) titleEl.textContent = `⏰ Scheduled messages (${state.scheduledMessages.length})`;
          } }, '✕');
          row.appendChild(info);
          row.appendChild(delBtn);
          scrollArea.appendChild(row);
        });
      };

      renderList();
      card.appendChild(scrollArea);
      card.appendChild(el('div', { cls: 'bcm-onetime-actions' },
        el('button', { cls: 'bcm-modal-btn', type: 'button', onclick: close }, 'Close'),
      ));
      overlay.appendChild(card);
      overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
      document.documentElement.appendChild(overlay);
    });
  }


  async function selectContact(num, name) {
    if (state.selectedContact && state.selectedContact !== num) {
      const prevInput = state.dialogEl?.querySelector('.bcm-input');
      if (prevInput) saveDraft(state.selectedContact, prevInput.value.trim());
      saveCurrentContactNote();
    }
    if (state.selectedGroup) {
      const prevInput = state.dialogEl?.querySelector('.bcm-input');
      if (prevInput) saveDraft('g_' + state.selectedGroup, prevInput.value.trim());
    }

    closeMsgSearch();
    clearQuote();

    Object.values(state.typingTimers).forEach(t => clearTimeout(t));
    state.typingTimers = {};

    state.selectedContact = num;
    state.selectedGroup = null;
    const preUnread = state.unread[num] ?? 0;
    state.unread[num]     = 0;
    updateHTMLBadge();
    refreshContactList();

    // Proactively ping this contact to detect BCM presence if not yet confirmed
    if (!state.contactMeta[num]?.hasBCM) pingBCMPresence(num);

    const hName   = state.dialogEl?.querySelector('.bcm-msghead-name');
    const hDot    = state.dialogEl?.querySelector('.bcm-msghead-dot');
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    if (hName) hName.textContent = name ?? `Member #${num}`;
    const initOnline = isMemberOnlineForUi(num);
    if (hDot) {
      const initDotClass = memberAvailClass(num, initOnline);
      hDot.className = `bcm-msghead-dot${initDotClass ? ' ' + initDotClass : ''}`;
      hDot.style.display = '';
    }
    if (hStatus && hStatus.className !== 'bcm-msghead-status bcm-typing') {
      const room = state.bcFriendCache[num]?.room || '';
      const initDotClass = memberAvailClass(num, initOnline);
      hStatus.textContent = formatPresenceText({ isOnline: initOnline, room, lastSeen: state.contactMeta[num]?.lastSeen, status: state.contactMeta[num]?.status, availability: state.contactMeta[num]?.availability });
      hStatus.className   = `bcm-msghead-status${initDotClass ? ' ' + initDotClass : ''}`;
    }
    syncHeaderAvatarForContact(num, name, initOnline);

    const leaveBtn = state.dialogEl?.querySelector('.bcm-leave-group-btn');
    if (leaveBtn) leaveBtn.style.display = 'none';
    const manageBtn = state.dialogEl?.querySelector('.bcm-manage-group-btn');
    if (manageBtn) manageBtn.style.display = 'none';
    const statsBtn = state.dialogEl?.querySelector('.bcm-stats-btn');
    if (statsBtn) statsBtn.style.display = '';
    const mediaBtn = state.dialogEl?.querySelector('.bcm-media-btn');
    if (mediaBtn) mediaBtn.style.display = '';
    const joinRoomBtn = state.dialogEl?.querySelector('.bcm-join-room-btn');
    if (joinRoomBtn) joinRoomBtn.style.display = state.contactMeta[num]?.room ? '' : 'none';
    const inviteRoomBtn = state.dialogEl?.querySelector('.bcm-invite-room-btn');
    if (inviteRoomBtn) inviteRoomBtn.style.display = unsafeWindow.ChatRoomData?.Name ? '' : 'none';
    updateDisappearingHeaderButton();
    updateReadReceiptHeaderButton();

    syncNotesBar(num);

    state.lastRenderedMsgSentAt = 0;
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (list) list.innerHTML = '';

    const msgs = await getMessages(num);
    if (!msgs.length) {
      list?.appendChild(el('div', { cls: 'bcm-empty' }, 'No messages yet — say hello!'));
    } else {
      state.virtOffset = Math.max(0, msgs.length - VIRT_PAGE_SIZE);
      renderConversationSlice(msgs, state.virtOffset);
      msgs.forEach(scheduleDisappearingForMessage);
      // Insert "New messages" separator and scroll to it if there were unreads
      let scrolledToUnread = false;
      if (preUnread > 0 && list) {
        const incoming = msgs.filter(m => !m.fromUs && !m.deleted);
        const firstUnreadMsg = incoming[incoming.length - preUnread];
        if (firstUnreadMsg) {
          const targetBubble = list.querySelector(
            firstUnreadMsg.serverId
              ? `[data-sid="${firstUnreadMsg.serverId}"]`
              : `[data-local-id="${firstUnreadMsg.id}"]`
          );
          if (targetBubble) {
            const sep = el('div', { cls: 'bcm-state.unread-sep' }, '— New messages —');
            list.insertBefore(sep, targetBubble);
            setTimeout(() => sep.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
            scrolledToUnread = true;
          }
        }
      }
      if (!scrolledToUnread) scrollMsgs();
    }

    const incomingIds = msgs.filter(m => !m.fromUs && m.serverId).map(m => m.serverId);
    if (incomingIds.length && state.ws?.readyState === WebSocket.OPEN && canSendReadReceiptsForConversation(`c_${num}`)) {
      state.ws.send(JSON.stringify({ type: 'read', messageIds: incomingIds }));
    }

    const hStatusQ = state.dialogEl?.querySelector('.bcm-msghead-status');
    getStatus(num).then(s => {
      if (!s) return;
      const online = isMemberOnlineForUi(num, s?.isOnline);
      const dn = getSafeDisplayName(s.memberName, num, '') || name || `Member #${num}`;
      const room = state.bcFriendCache[num]?.room || '';
      const avail = s?.availability ?? 'online';
      state.contactMeta[num] = { ...state.contactMeta[num], name: dn, online, availability: avail, lastSeen: s.lastSeen, status: s.status ?? '' };
      const dotClass = memberAvailClass(num, online);
      if (hName) hName.textContent = dn;
      if (hDot)  hDot.className = `bcm-msghead-dot${dotClass ? ' ' + dotClass : ''}`;
      syncHeaderAvatarForContact(num, dn, online);
      if (hStatusQ && hStatusQ.className !== 'bcm-msghead-status bcm-typing') {
        hStatusQ.textContent = formatPresenceText({ ...s, isOnline: online, room, availability: avail });
        hStatusQ.className   = `bcm-msghead-status${dotClass ? ' ' + dotClass : ''}`;
      }
      upsertContact(num, dn);
      refreshContactList();
    });

    const input = state.dialogEl?.querySelector('.bcm-input');
    if (input) {
      const draft = loadDraft(num);
      input.value = draft;
      autoResize({ target: input });
      input.focus();
      if (draft) input.selectionStart = input.selectionEnd = draft.length;
    }
    updatePinBanner();
    updateActivityButtonVisibility();
    updateE2EIndicator(num).catch(() => {});
  }

  async function selectGroup(groupId) {
    if (state.selectedContact) {
      const prevInput = state.dialogEl?.querySelector('.bcm-input');
      if (prevInput) saveDraft(state.selectedContact, prevInput.value.trim());
      saveCurrentContactNote();
    }
    if (state.selectedGroup && state.selectedGroup !== groupId) {
      const prevInput = state.dialogEl?.querySelector('.bcm-input');
      if (prevInput) saveDraft('g_' + state.selectedGroup, prevInput.value.trim());
    }

    closeMsgSearch();
    clearQuote();
    Object.values(state.typingTimers).forEach(t => clearTimeout(t));
    state.typingTimers = {};

    state.selectedContact = null;
    state.selectedGroup = groupId;
    state.groupUnread[groupId] = 0;
    updateHTMLBadge();
    refreshContactList();
    syncNotesBar(null);

    const group = state.groups[groupId];
    if (!group) return;

    const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
    const hDot  = state.dialogEl?.querySelector('.bcm-msghead-dot');
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    if (hName) hName.textContent = group.name;
    if (hDot) hDot.style.display = 'none';
    const groupStatsBtn = state.dialogEl?.querySelector('.bcm-stats-btn');
    if (groupStatsBtn) groupStatsBtn.style.display = 'none';
    const groupMediaBtn = state.dialogEl?.querySelector('.bcm-media-btn');
    if (groupMediaBtn) groupMediaBtn.style.display = 'none';
    syncHeaderAvatarForContact(null, '', false);
    if (hStatus) {
      hStatus.textContent = getGroupMemberCountLabel(groupId);
      hStatus.className = 'bcm-msghead-status';
    }

    const msgHead = state.dialogEl?.querySelector('.bcm-msghead');
    let leaveBtn = msgHead?.querySelector('.bcm-leave-group-btn');
    if (!leaveBtn && msgHead) {
      leaveBtn = el('button', { cls: 'bcm-header-btn bcm-leave-group-btn', title: 'Leave group', onclick: () => confirmLeaveGroup(groupId) }, '🚪');
      const searchBtn = msgHead.querySelector('.bcm-search-btn');
      if (searchBtn) msgHead.insertBefore(leaveBtn, searchBtn);
      else msgHead.appendChild(leaveBtn);
    }
    if (leaveBtn) leaveBtn.style.display = 'block';
    await updateGroupHeaderControls(groupId);

    state.lastRenderedMsgSentAt = 0;
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (list) list.innerHTML = '';

    const msgs = await getGroupMessages(groupId);
    if (!msgs.length) {
      list?.appendChild(el('div', { cls: 'bcm-empty' }, 'No messages yet — start the conversation!'));
    } else {
      state.virtOffset = Math.max(0, msgs.length - VIRT_PAGE_SIZE);
      renderConversationSlice(msgs, state.virtOffset);
      msgs.forEach(scheduleDisappearingForMessage);
      scrollMsgs();
    }

    const unreadIncomingIds = msgs
      .filter(m => Number(m.senderNum) !== Number(state.memberNumber) && m.serverId)
      .map(m => Number(m.serverId))
      .filter(Number.isFinite);
    if (unreadIncomingIds.length && state.ws?.readyState === WebSocket.OPEN && canSendReadReceiptsForConversation(`g_${groupId}`)) {
      state.ws.send(JSON.stringify({ type: 'read', messageIds: unreadIncomingIds }));
    }

    syncGroupHistoryFromServer(groupId, 250)
      .then(async added => {
        if (added > 0 && state.selectedGroup === groupId) await redrawCurrentConversation();
      })
      .catch(() => {});

    const input = state.dialogEl?.querySelector('.bcm-input');
    if (input) {
      const draft = loadDraft('g_' + groupId);
      input.value = draft;
      autoResize({ target: input });
      input.focus();
      if (draft) input.selectionStart = input.selectionEnd = draft.length;
    }
    updatePinBanner();
    updateActivityButtonVisibility();
    updateE2EIndicator(null).catch(() => {});
  }

  function renderConversationSlice(msgs, startIdx) {
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    state.lastRenderedMsgSentAt = 0;
    list.innerHTML = '';
    if (!msgs.length) return;
    if (startIdx > 0) {
      const loadCount = Math.min(startIdx, VIRT_PAGE_SIZE);
      const btn = el('button', { cls: 'bcm-load-more', onclick: async () => {
        const allMsgs = state.selectedGroup
          ? await getGroupMessages(state.selectedGroup)
          : await getMessages(state.selectedContact);
        const prevScrollHeight = list.scrollHeight;
        const prevScrollTop    = list.scrollTop;
        state.virtOffset = Math.max(0, state.virtOffset - VIRT_PAGE_SIZE);
        renderConversationSlice(allMsgs, state.virtOffset);
        list.scrollTop = prevScrollTop + (list.scrollHeight - prevScrollHeight);
      }}, `↑ Load ${loadCount} earlier messages`);
      list.appendChild(btn);
    }
    for (let i = startIdx; i < msgs.length; i++) {
      appendBubble(msgs[i], msgs[i - 1]?.sentAt ?? null);
    }
  }

  async function redrawCurrentConversation() {
    updateDisappearingHeaderButton();
    updateReadReceiptHeaderButton();
    if (state.selectedGroup) {
      const msgs = await getGroupMessages(state.selectedGroup);
      const list = state.dialogEl?.querySelector('.bcm-msglist');
      if (!list) return;
      state.virtOffset = Math.min(state.virtOffset, Math.max(0, msgs.length - VIRT_PAGE_SIZE));
      renderConversationSlice(msgs, state.virtOffset);
      msgs.forEach(scheduleDisappearingForMessage);
      scrollMsgs();
      return;
    }
    if (state.selectedContact) {
      const msgs = await getMessages(state.selectedContact);
      const list = state.dialogEl?.querySelector('.bcm-msglist');
      if (!list) return;
      state.virtOffset = Math.min(state.virtOffset, Math.max(0, msgs.length - VIRT_PAGE_SIZE));
      renderConversationSlice(msgs, state.virtOffset);
      msgs.forEach(scheduleDisappearingForMessage);
      scrollMsgs();
    }
  }

  function updateContactHeader(num, status) {
    if (state.selectedContact !== num || !status) return;
    const hName   = state.dialogEl?.querySelector('.bcm-msghead-name');
    const hDot    = state.dialogEl?.querySelector('.bcm-msghead-dot');
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    const online = isMemberOnlineForUi(num, status?.isOnline);
    const avail  = status?.availability ?? state.contactMeta[num]?.availability ?? 'online';
    const safeName = getSafeDisplayName(status.memberName, num, '');
    if (safeName) {
      state.contactMeta[num] = { ...state.contactMeta[num], name: safeName, online, availability: avail, lastSeen: status.lastSeen, status: status.status ?? '' };
      if (hName) hName.textContent = safeName;
    } else if (state.contactMeta[num]) {
      state.contactMeta[num] = { ...state.contactMeta[num], online, availability: avail, lastSeen: status?.lastSeen ?? state.contactMeta[num]?.lastSeen, status: status?.status ?? state.contactMeta[num]?.status ?? '' };
    }
    const dotClass = memberAvailClass(num, online);
    if (hDot)    hDot.className    = `bcm-msghead-dot${dotClass ? ' ' + dotClass : ''}`;
    syncHeaderAvatarForContact(num, safeName || state.contactMeta[num]?.name, online);
    if (hStatus && hStatus.className !== 'bcm-msghead-status bcm-typing') {
      hStatus.textContent = formatPresenceText({ ...status, isOnline: online, availability: avail });
      hStatus.className   = `bcm-msghead-status${dotClass ? ' ' + dotClass : ''}`;
    }
    refreshContactList();
  }


  function isSameDay(tsA, tsB) {
    if (!tsA || !tsB) return false;
    const a = new Date(tsA), b = new Date(tsB);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatDateSep(ts) {
    const d    = new Date(ts);
    const now  = new Date();
    const sot  = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const soy  = sot - 86400000;
    if (ts >= sot) return 'Today';
    if (ts >= soy) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatGroupReceiptLabel(msg) {
    if (!msg?.groupId || !msg?.fromUs) return '';
    const total = Number(msg.groupTotalRecipients || 0);
    if (total <= 0) return '';
    const delivered = Math.min(total, Number(msg.groupDeliveredCount || 0));
    const read = Math.min(total, Number(msg.groupReadCount || 0));
    if (read > 0) return `Seen ${read}/${total} · Delivered ${delivered}/${total}`;
    if (delivered > 0) return `Delivered ${delivered}/${total}`;
    return `Sent to ${total}`;
  }

  function apiGetGroupReceipts(groupMessageRef) {
    return httpGet(`/api/groups/messages/${encodeURIComponent(groupMessageRef)}/receipts`);
  }

  async function openSeenByModal(msg) {
    const group = state.groups[msg.groupId] || await getGroup(msg.groupId);
    if (!group) return;
    const body = el('div', { cls: 'bcm-seenby-wrap' },
      el('div', { cls: 'bcm-seenby-loading' }, '⏳ Loading…')
    );
    openModal({ title: '👁 Seen by', body, buttons: [{ label: 'Close', value: 'close' }] });

    let receipts = [];
    try { const r = await apiGetGroupReceipts(msg.groupMessageRef); receipts = r?.receipts ?? []; } catch {}

    const receiptMap = {};
    for (const row of receipts) receiptMap[row.recipient_number] = row;

    const members = normalizeGroupMembers(group.members ?? []).filter(m => m.member_number !== state.memberNumber);
    members.sort((a, b) => {
      const rank = m => { const r = receiptMap[m.member_number]; return r?.read_at ? 0 : r?.delivered ? 1 : 2; };
      return rank(a) - rank(b);
    });

    const rows = members.map(m => {
      const num  = m.member_number;
      const name = getDisplayNameForMember(num, `Member #${num}`);
      const rec  = receiptMap[num];
      const isRead      = !!rec?.read_at;
      const isDelivered = !!rec?.delivered;
      const statusLabel = isRead ? 'Read' : isDelivered ? 'Delivered' : 'Sent';
      const timeStr     = isRead
        ? new Date(Number(rec.read_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      const tickCls = isRead ? 'bcm-tick bcm-tick-read' : isDelivered ? 'bcm-tick bcm-tick-delivered' : 'bcm-tick bcm-tick-sent';
      return el('div', { cls: 'bcm-seenby-row' },
        createContactAvatar(num, name, false),
        el('div', { cls: 'bcm-seenby-info' },
          el('div', { cls: 'bcm-seenby-name' }, name),
          el('div', { cls: `bcm-seenby-status${isRead ? ' bcm-seenby-read' : ''}` },
            el('span', { cls: tickCls }, (isRead || isDelivered) ? ' ✓✓' : ' ✓'),
            ` ${statusLabel}`,
            timeStr ? el('span', { cls: 'bcm-seenby-time' }, ` · ${timeStr}`) : null,
          ),
        ),
      );
    });

    body.innerHTML = '';
    if (rows.length === 0) {
      body.appendChild(el('div', { cls: 'bcm-seenby-empty' }, 'No receipt data yet.'));
    } else {
      rows.forEach(r => body.appendChild(r));
    }
  }

  function createSpoilerNode(contentNodes) {
    const wrap = el('div', { cls: 'bcm-spoiler-wrap' },
      el('button', { cls: 'bcm-spoiler-reveal', type: 'button' }, 'Reveal spoiler'),
      el('div', { cls: 'bcm-spoiler-content' }, ...contentNodes),
    );
    wrap.querySelector('.bcm-spoiler-reveal')?.addEventListener('click', e => {
      e.stopPropagation();
      wrap.classList.add('revealed');
    });
    return wrap;
  }

  function closeOneTimeViewer() {
    state.oneTimeViewerEl?.remove();
    state.oneTimeViewerEl = null;
  }

  function openOneTimeViewer(parsed) {
    closeOneTimeViewer();
    const contentNodes = renderMessageContent(parsed?.text ?? '');
    state.oneTimeViewerEl = el('div', { cls: 'bcm-onetime-overlay' },
      el('div', { cls: 'bcm-onetime-card' },
        el('div', { cls: 'bcm-onetime-title' }, 'One-time message'),
        el('div', {}, ...contentNodes),
        el('div', { cls: 'bcm-onetime-actions' },
          el('button', { type: 'button', onclick: () => closeOneTimeViewer() }, 'Close'),
        ),
      ),
    );
    document.documentElement.appendChild(state.oneTimeViewerEl);
  }

  function openEditHistoryModal(revisions) {
    const overlay = el('div', { cls: 'bcm-onetime-overlay', onclick: e => { if (e.target === overlay) overlay.remove(); } },
      el('div', { cls: 'bcm-onetime-card', style: { minWidth: 'min(400px, 94vw)', maxWidth: 'min(600px, 96vw)' } },
        el('div', { cls: 'bcm-onetime-title' }, `📜 Edit history (${revisions.length} revision${revisions.length !== 1 ? 's' : ''})`),
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', maxHeight: '60vh' } },
          ...revisions.map((rev, i) => {
            const when = new Date(rev.revised_at).toLocaleString();
            return el('div', { style: { borderLeft: '3px solid var(--bcm-accent)', paddingLeft: '8px', fontSize: '12px' } },
              el('div', { style: { color: 'var(--bcm-text-muted)', fontSize: '11px', marginBottom: '2px' } }, `v${i + 1} · ${when}`),
              el('div', { style: { color: 'var(--bcm-text)', wordBreak: 'break-word' } }, rev.content || '(empty)'),
            );
          }),
        ),
        el('div', { cls: 'bcm-onetime-actions' },
          el('button', { type: 'button', onclick: () => overlay.remove() }, 'Close'),
        ),
      ),
    );
    document.documentElement.appendChild(overlay);
  }

  function appendBubble(msg, prevSentAt = null) {
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    const disappearAt = getMessageDisappearAt(msg);
    const shouldDisappear = disappearAt > 0;
    if (shouldDisappear && msg?.id) {
      const expiresAt = disappearAt;
      if (expiresAt <= Date.now()) {
        deleteMessageByLocalId(msg.id).catch(() => {});
        return;
      }
      scheduleDisappearingForMessage(msg);
    }
    list.querySelector('.bcm-empty')?.remove();

    const msgTs  = msg.sentAt || Date.now();
    const prevTs = prevSentAt ?? state.lastRenderedMsgSentAt;
    if (!prevTs || !isSameDay(prevTs, msgTs)) {
      list.appendChild(el('div', { cls: 'bcm-date-sep' }, formatDateSep(msgTs)));
    }
    state.lastRenderedMsgSentAt = msgTs;

    const isMine = msg.fromUs || msg.senderNum === state.memberNumber;
    const time   = msg.sentAt ? new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const tick   = (() => {
      if (!isMine) return null;
      const t = tickMark(msg.status);
      if (t && msg.status === 'read' && msg.readAt) {
        const rt = new Date(Number(msg.readAt));
        t.title = `Read at ${rt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      return t;
    })();
    let _rawContent = msg.content ?? '';
    if (_rawContent.startsWith(E2E_V2G_PREFIX) || _rawContent.startsWith(E2E_V2_PREFIX) || _rawContent.startsWith(E2E_PREFIX)) {
      _rawContent = '[🔒 Encrypted — could not decrypt]';
    }
    const parsed = parseMessagePayload(_rawContent);
    const contentText = msg.deleted ? '[Message deleted]' : parsed.text;

    const isGroupMsg = msg.messageType === 'group' || msg.groupId;
    const senderLabel = isGroupMsg && !isMine ? [el('div', { cls: 'bcm-sender-name' }, getDisplayNameForMember(msg.senderNum, msg.senderName || `Member #${msg.senderNum}`))] : [];
    const reactionKey = getReactionKey(msg);
    const reactionMap = reactionKey ? (state.msgReactions[reactionKey] || {}) : {};
    const reaction = myReactionEmoji(reactionMap);
    const hasAnyReactions = Object.keys(reactionMap).length > 0;
    const starred = isStarred(reactionKey);
    const groupReceiptLabel = formatGroupReceiptLabel(msg);
    const hasParent = !!msg.parentMessageRef;
    const quoteBlock = parsed.quote
      ? [el('div', { cls: `bcm-quote-inline${hasParent ? ' bcm-quote-clickable' : ''}`, title: hasParent ? 'Click to view parent message' : '', onclick: hasParent ? () => {
          scrollToMessageByRef(msg.parentMessageRef);
        } : null },
          el('span', { cls: 'bcm-quote-inline-sender' }, parsed.quote.senderName || (parsed.quote.senderNum ? `Member #${parsed.quote.senderNum}` : 'Quoted message')),
          parsed.quote.text,
        )]
      : [];
    const contentNodes = renderMessageContent(contentText ?? '');
    const renderedContent = parsed.oneTime && !msg.deleted
      ? [el('div', { cls: 'bcm-msg-content' },
          el('div', {}, '🔐 One-time message'),
          el('button', { cls: 'bcm-onetime-view-btn', type: 'button', onclick: async e => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = isMine ? 'Preview' : 'Viewed';
            if (!isMine && msg?.id && !msg.deleted) {
              const bubbleEl = btn.closest('.bcm-bubble');
              try {
                await deleteMessageByLocalId(msg.id);
                if (bubbleEl) bubbleEl.remove();
              } catch {
                showNote('Failed to delete one-time message', true);
                btn.disabled = false;
                btn.textContent = 'View once';
                return;
              }
            }
            openOneTimeViewer(parsed);
          } }, isMine ? 'Open preview' : 'View once'),
        )]
      : parsed.spoiler && !msg.deleted
        ? [el('div', { cls: 'bcm-msg-content' }, createSpoilerNode(contentNodes))]
        : contentText?.startsWith('\u{1F3E0}ROOMINVITE:') && !msg.deleted
          ? (() => {
              const roomName = contentText.slice('\u{1F3E0}ROOMINVITE:'.length);
              return [el('div', { cls: 'bcm-msg-content' },
                el('button', { cls: 'bcm-room-invite-card',
                  onclick: () => unsafeWindow.ServerSend?.('ChatRoomJoin', { Name: roomName })
                }, `🏠 Join room: ${roomName}`),
              )];
            })()
          : [el('div', { cls: 'bcm-msg-content' }, ...contentNodes)];

    const bubble = el('div', { cls: `bcm-bubble ${isMine ? 'sent' : 'recv'}${hasAnyReactions ? ' has-reaction' : ''}${starred ? ' is-starred' : ''}` },
      ...senderLabel,
      ...quoteBlock,
      ...(parsed.poll ? [renderPollWidget(parsed.poll, reactionKey, msg.groupId ? `gref:${msg.groupMessageRef}` : `sid:${msg.serverId}`)] : []),
      ...renderedContent,
      el('button', { cls: 'bcm-react-btn', title: reaction ? `Your reaction: ${reaction}. Click to change` : 'React', 'aria-label': reaction ? `Change reaction: ${REACTION_LABELS[reaction] || reaction}` : 'React to message',
        onclick: e => { e.stopPropagation(); openReactionPanel(e.currentTarget, reactionKey); }
      }, reaction || '😊'),
      el('div', { cls: 'bcm-btime' },
        time,
        ...(msg.edited && !msg.deleted ? [el('span', { cls: 'bcm-edited-mark', title: 'Message was edited' }, ' (edited)')] : []),
        ...(tick ? [tick] : []),
        ...(groupReceiptLabel ? [el('span', { cls: 'bcm-group-receipt', title: 'Group delivery/read summary' }, ` ${groupReceiptLabel}`)] : []),
        ...(shouldDisappear ? [el('span', { cls: 'bcm-disappear-mark', title: 'This message will disappear' }, '⏳')] : []),
        ...(parsed.spoiler ? [el('span', { cls: 'bcm-disappear-mark', title: 'Spoiler message' }, '🙈')] : []),
        ...(parsed.oneTime ? [el('span', { cls: 'bcm-disappear-mark', title: 'One-time message' }, '🔐')] : []),
      ),
      ...(starred ? [el('span', { cls: 'bcm-star-chip', title: 'Starred' }, '⭐')] : []),
    );
    if (msg.serverId) bubble.dataset.sid = String(msg.serverId);
    if (msg.id) bubble.dataset.localId = String(msg.id);
    if (reactionKey) bubble.dataset.reactionKey = reactionKey;
    bubble.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      openMessageContextMenu(msg, reactionKey, e.clientX, e.clientY);
    });
    bubble.addEventListener('click', e => {
      if (!state.selectionMode) return;
      e.stopPropagation();
      const key = bubble.dataset.reactionKey || bubble.dataset.sid;
      if (!key) return;
      if (state.selectedMsgs.has(key)) { state.selectedMsgs.delete(key); bubble.classList.remove('bcm-selected'); }
      else { state.selectedMsgs.add(key); bubble.classList.add('bcm-selected'); }
      updateSelectionBar();
    });
    const lpUrl = contentText?.match(URL_RE)?.[0];
    if (lpUrl && !IMAGE_URL_RE.test(lpUrl) && !VIDEO_URL_RE.test(lpUrl) && !msg.deleted) {
      fetchLinkPreview(lpUrl).then(preview => {
        if (!preview?.title || bubble.querySelector('.bcm-link-preview')) return;
        const card = el('div', { cls: 'bcm-link-preview', onclick: () => window.open(preview.url || lpUrl, '_blank') },
          preview.image ? el('img', { cls: 'bcm-lp-img', src: preview.image }) : null,
          el('div', { cls: 'bcm-lp-body' },
            el('div', { cls: 'bcm-lp-title' }, preview.title),
            preview.description ? el('div', { cls: 'bcm-lp-desc' }, preview.description.slice(0, 120) + (preview.description.length > 120 ? '…' : '')) : null,
            el('div', { cls: 'bcm-lp-domain' }, '🌐 ' + (preview.domain || '')),
          ),
        );
        const btimeEl = bubble.querySelector('.bcm-btime');
        if (btimeEl) bubble.insertBefore(card, btimeEl); else bubble.appendChild(card);
      }).catch(() => {});
    }
    list.appendChild(bubble);
    updateBubbleReactionByKey(reactionKey);

    // "Seen by" click — own group messages only
    if (isMine && msg.groupId && msg.groupMessageRef) {
      const btimeEl = bubble.querySelector('.bcm-btime');
      const clickTarget = btimeEl?.querySelector('.bcm-group-receipt') ?? btimeEl?.querySelector('.bcm-tick');
      if (clickTarget) {
        clickTarget.style.cursor = 'pointer';
        if (!clickTarget.title) clickTarget.title = 'Click to see who read this';
        clickTarget.addEventListener('click', e => { e.stopPropagation(); openSeenByModal(msg); });
      }
    }
  }

  function updateBubbleTick(serverId, status, readAt = null) {
    if (!serverId) return;
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    const bubble = list.querySelector(`[data-sid="${serverId}"]`);
    if (!bubble) return;
    const old = bubble.querySelector('.bcm-tick');
    const neu = tickMark(status);
    if (neu && readAt && status === 'read') {
      const rt = new Date(Number(readAt));
      neu.title = `Read at ${rt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (old && neu) old.replaceWith(neu);
    else if (neu) bubble.querySelector('.bcm-btime')?.appendChild(neu);
  }

  const URL_RE = /https?:\/\/[^\s<>"]+/g;
  const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
  const VIDEO_URL_RE = /\.(mp4|webm|ogg|mov|m4v)$/i;
  const YOUTUBE_VIDEO_ID_LENGTH = 11;
  const YOUTUBE_VIDEO_ID_RE = new RegExp(`^[a-zA-Z0-9_-]{${YOUTUBE_VIDEO_ID_LENGTH}}$`);
  const YOUTUBE_IFRAME_ALLOW = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '👎', '🔥', '👏'];
  const REACTION_LABELS = { '👍': 'thumbs up', '❤️': 'heart', '😂': 'laugh', '😮': 'surprised', '😢': 'sad', '👎': 'thumbs down', '🔥': 'fire', '👏': 'clap' };
  const EMOJI_CATALOG = [
    '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','😘','🥰','😗',
    '😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
    '😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑',
    '😲','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱',
    '🥵','🥶','😳','🤪','😵','🥴','😠','😡','🤬','😷','🤒','🤕','🤢','🤮','🤧','🥳',
    '👋','🤚','🖐','✋','🖖','👌','🤌','✌','🤞','🤟','🤘','🤙','👈','👉','👆','👇',
    '👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','🙏','❤️','🧡','💛','💚','💙','💜',
    '🖤','🤍','🤎','💔','❣','💕','💞','💓','💗','💖','💘','💝','💯','🔥','⭐','✨',
    '🎉','🎊','🎈','🎁','🎵','🎶','🎮','🏆','🥇','💎','💡','💤','💫','💥','❄','🌈',
    '🌸','🌺','🌻','🌹','🌙','☀','🌟','🍕','🍔','🍣','🍩','🍰','🍺','🥂','☕','🎂',
    '🐱','🐶','🦊','🐺','🐻','🐼','🐨','🐯','🦁','🐸','🐧','🐦','🦋','🐝','🐠','🦄',
    '🚀','✈','🚗','🏠','💻','📱','🎯','⚽','🏀','🎸','🎹','🎭','🎨','📚','💼','🔑',
  ];

  state.pollVoteCache = {};

  function renderPollWidget(poll, reactionKey, messageRef) {
    const wp = el('div', { cls: 'bcm-poll-container' });
    wp.appendChild(el('div', { cls: 'bcm-poll-question' }, poll.question || 'Poll'));

    const options = poll.options || [];
    const body = el('div', { cls: 'bcm-poll-body' });
    wp.appendChild(body);

    const cachedVote = state.pollVoteCache[messageRef];
    const myVote = (cachedVote && cachedVote.myVote !== null && cachedVote.myVote !== undefined) ? cachedVote.myVote : null;
    const hasVoted = myVote !== null;

    options.forEach((opt, i) => {
      const isMine = myVote === i;
      const row = el('div', {
        cls: `bcm-poll-option${isMine ? ' bcm-poll-my-vote' : ''}${hasVoted ? ' bcm-poll-voted' : ''}`,
      },
        el('span', { cls: 'bcm-poll-opt-label' }, opt),
        hasVoted ? el('span', { cls: 'bcm-poll-bar-wrap' },
          el('span', { cls: 'bcm-poll-bar', style: { width: isMine ? '100%' : '0%' } }),
          el('span', { cls: 'bcm-poll-pct' }, isMine ? '100%' : '0%'),
        ) : null,
      );
      body.appendChild(row);

      if (!hasVoted) {
        row.addEventListener('click', async (e) => {
          e.stopPropagation();
          body.querySelectorAll('.bcm-poll-option').forEach(r => {
            r.classList.add('bcm-poll-voted');
            r.replaceWith(r.cloneNode(true));
          });
          try {
            await votePoll(messageRef, i);
            state.pollVoteCache[messageRef] = { myVote: i };
            const allRows = body.querySelectorAll('.bcm-poll-option');
            allRows.forEach((r, idx) => {
              const pct = idx === i ? '100%' : '0%';
              const w = idx === i ? '100%' : '0%';
              const barWrap = el('span', { cls: 'bcm-poll-bar-wrap' },
                el('span', { cls: 'bcm-poll-bar', style: { width: w } }),
                el('span', { cls: 'bcm-poll-pct' }, pct),
              );
              r.appendChild(barWrap);
            });
            const oldTotal = body.querySelector('.bcm-poll-votes-total');
            if (oldTotal) oldTotal.remove();
            body.appendChild(el('div', { cls: 'bcm-poll-votes-total' }, '1 vote'));
          } catch (ex) {
            showNote(`Vote failed: ${ex.message}`, true);
            if (state.dialogOpen) redrawCurrentConversation().catch(() => {});
          }
        });
      }
    });

    if (!options.length) {
      body.appendChild(el('div', { cls: 'bcm-poll-votes-total' }, 'No options'));
    }

    (async () => {
      try {
        const data = await getPoll(messageRef);
        if (!data) return;
        const results = data.results || [];
        const totalVotes = data.totalVotes || 0;
        const svMyVote = data.myVote;
        const voted = svMyVote !== null && svMyVote !== undefined;
        const closed = data.closesAt && data.closesAt < Date.now();

        if (voted && !hasVoted) state.pollVoteCache[messageRef] = { myVote: svMyVote };

        const maxCount = Math.max(1, ...results.map(r => r.count || 0));
        const allRows = body.querySelectorAll('.bcm-poll-option');
        allRows.forEach((r, idx) => {
          const count = results[idx]?.count || 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const barWidth = totalVotes > 0 ? Math.round((count / maxCount) * 100) : 0;
          const oldBar = r.querySelector('.bcm-poll-bar-wrap');
          if (oldBar) oldBar.remove();
          if (voted || closed) {
            r.classList.add('bcm-poll-voted');
            const barWrap = el('span', { cls: 'bcm-poll-bar-wrap' },
              el('span', { cls: 'bcm-poll-bar', style: { width: `${barWidth}%` } }),
              el('span', { cls: 'bcm-poll-pct' }, `${pct}%`),
            );
            r.appendChild(barWrap);
            if (closed) r.classList.add('bcm-poll-closed');
          }
          if (svMyVote === idx) r.classList.add('bcm-poll-my-vote');
        });
        const oldTotal = body.querySelector('.bcm-poll-votes-total');
        if (oldTotal) oldTotal.remove();
        let footerText = `${totalVotes} vote${totalVotes !== 1 ? 's' : ''}`;
        if (closed) footerText += ' · Closed';
        else if (data.closesAt) {
          const remain = Math.max(0, data.closesAt - Date.now());
          const mins = Math.floor(remain / 60000);
          footerText += ` · ${mins > 0 ? `${mins}m remaining` : 'closing soon'}`;
        }
        body.appendChild(el('div', { cls: 'bcm-poll-votes-total' }, footerText));
      } catch {}
    })();

    return wp;
  }
  const REACTION_PANEL_OFFSET_X = 90;
  const REACTION_PANEL_OFFSET_Y = 44;
  const PANEL_EDGE_PADDING = 4;

  function isHostedStickerUrl(url) {
    const u = String(url ?? '');
    return u.startsWith(SERVER + '/uploads/') || u.startsWith(SERVER + '/pack/');
  }

  function sanitizeHttpUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl), window.location.origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.href;
    } catch {
      return null;
    }
  }

  function stripUrlQuery(url) {
    return String(url).split('#')[0].split('?')[0];
  }

  function isImageUrl(url) {
    return IMAGE_URL_RE.test(stripUrlQuery(url));
  }

  function isVideoUrl(url) {
    return VIDEO_URL_RE.test(stripUrlQuery(url));
  }

  function extractYouTubeVideoId(url) {
    try {
      const u = new URL(String(url));
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      let id = '';
      if (host === 'youtu.be') {
        id = u.pathname.split('/').filter(Boolean)[0] || '';
      } else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
        else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || '';
        else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2] || '';
      }
      id = id.trim();
      return YOUTUBE_VIDEO_ID_RE.test(id) ? id : '';
    } catch {
      return '';
    }
  }

  function getYouTubeEmbedUrl(url) {
    const id = extractYouTubeVideoId(url);
    if (!id) return '';
    const qp = new URLSearchParams({ rel: '0', modestbranding: '1', playsinline: '1' });
    return `https://www.youtube.com/embed/${id}?${qp.toString()}`;
  }

  function createEmbedNode(url) {
    const ytEmbed = getYouTubeEmbedUrl(url);
    if (ytEmbed) {
      return el('div', { cls: 'bcm-embed-wrap' },
        el('iframe', {
          src: ytEmbed,
          title: 'YouTube video',
          loading: 'lazy',
          allow: YOUTUBE_IFRAME_ALLOW,
          allowfullscreen: 'true'
        }),
      );
    }
    if (isImageUrl(url)) {
      return el('div', { cls: 'bcm-embed-wrap' },
        el('img', { src: url, alt: 'Embedded image', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      );
    }
    if (isVideoUrl(url)) {
      const videoEl = el('video', { src: url, controls: true, preload: 'metadata' });
      videoEl.addEventListener('error', () => {
        videoEl.replaceWith(el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)', padding: '8px' } }, '🎬 Video unavailable'));
      });
      return el('div', { cls: 'bcm-embed-wrap' }, videoEl);
    }
    return null;
  }

  function pushTextWithBreaks(nodes, text) {
    const parts = String(text).split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) nodes.push(document.createTextNode(parts[i]));
      if (i < parts.length - 1) nodes.push(document.createElement('br'));
    }
  }

  function pushMarkdownNodes(nodes, text) {
    const MD = /~~(.+?)~~|\*\*(.+?)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;
    let last = 0, m;
    while ((m = MD.exec(text)) !== null) {
      if (m.index > last) pushTextWithBreaks(nodes, text.slice(last, m.index));
      let node;
      if (m[1] !== undefined)      { node = document.createElement('del');    node.textContent = m[1]; }
      else if (m[2] !== undefined) { node = document.createElement('strong'); node.textContent = m[2]; }
      else if (m[3] !== undefined) { node = document.createElement('em');     node.textContent = m[3]; }
      else if (m[4] !== undefined) { node = document.createElement('code');   node.className = 'bcm-inline-code'; node.textContent = m[4]; }
      if (node) nodes.push(node);
      last = m.index + m[0].length;
    }
    if (last < text.length) pushTextWithBreaks(nodes, text.slice(last));
  }

  function renderMessageContent(text) {
    const nodes = [];

    const trimmed = text.trim();
    if (isHostedStickerUrl(trimmed)) {
      return [el('div', { cls: 'bcm-embed-wrap bcm-sticker-embed' },
        el('img', { src: trimmed, alt: 'Sticker', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      )];
    }
    if (/^\*[^*][\s\S]*[^*]\*$/.test(trimmed) || /^\*[^*]\*$/.test(trimmed)) {
      const span = document.createElement('span');
      span.className = 'bcm-emote';
      span.textContent = trimmed;
      return [span];
    }

    const lines = text.split('\n');
    const processedLines = [];
    let blockLines = [];
    const flushBlock = () => {
      if (!blockLines.length) return;
      const bq = document.createElement('blockquote');
      blockLines.forEach((bl, i) => {
        if (bl) bq.appendChild(document.createTextNode(bl));
        if (i < blockLines.length - 1) bq.appendChild(document.createElement('br'));
      });
      nodes.push(bq);
      blockLines = [];
    };
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('> ')) {
        flushBlock();
        if (processedLines.length) {
          const chunk = processedLines.join('\n');
          processedLines.length = 0;
          let last2 = 0, m2;
          URL_RE.lastIndex = 0;
          while ((m2 = URL_RE.exec(chunk)) !== null) {
            const prefix = chunk.slice(last2, m2.index);
            if (prefix) pushMarkdownNodes(nodes, prefix);
            const safeUrl = sanitizeHttpUrl(m2[0]);
            if (!safeUrl) { pushMarkdownNodes(nodes, m2[0]); }
            else {
              const a = document.createElement('a'); a.href = safeUrl; a.textContent = m2[0]; a.target = '_blank'; a.rel = 'noopener noreferrer'; nodes.push(a);
              const emb = createEmbedNode(safeUrl); if (emb) nodes.push(emb);
            }
            last2 = m2.index + m2[0].length;
          }
          if (last2 < chunk.length) pushMarkdownNodes(nodes, chunk.slice(last2));
        }
        blockLines.push(lines[i].slice(2));
      } else {
        flushBlock();
        processedLines.push(lines[i]);
      }
    }
    flushBlock();
    const remaining = processedLines.join('\n');
    if (!remaining && !nodes.length) return [document.createTextNode(text)];
    if (!remaining) return nodes;

    let last = 0;
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(remaining)) !== null) {
      const prefix = remaining.slice(last, m.index);
      if (prefix) pushMarkdownNodes(nodes, prefix);

      const url = m[0];
      const safeUrl = sanitizeHttpUrl(url);
      if (!safeUrl) {
        pushMarkdownNodes(nodes, url);
        last = m.index + url.length;
        continue;
      }
      const a = document.createElement('a');
      a.href = safeUrl;
      a.textContent = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      nodes.push(a);

      const embed = createEmbedNode(safeUrl);
      if (embed) nodes.push(embed);
      last = m.index + url.length;
    }
    if (last < remaining.length) pushMarkdownNodes(nodes, remaining.slice(last));
    return nodes.length ? nodes : [document.createTextNode(text)];
  }

  function getReactionKey(msg) {
    if (msg?.groupId && msg?.groupMessageRef) return `gref:${msg.groupMessageRef}`;
    if (msg?.serverId) return `sid:${msg.serverId}`;
    if (msg?.id) return `lid:${msg.id}`;
    return null;
  }

  function scrollToMessageByRef(ref) {
    if (!ref || !state.dialogEl) return;
    const bubble = state.dialogEl.querySelector(`.bcm-bubble[data-reaction-key="${CSS.escape(ref)}"]`);
    if (bubble) {
      bubble.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bubble.classList.add('bcm-flash');
      setTimeout(() => bubble.classList.remove('bcm-flash'), 2000);
    } else {
      showNote('Parent message not in current view', false);
    }
  }

  function persistReactions() {
    GM_setValue(state.STORE + 'reactions', JSON.stringify(state.msgReactions));
  }

  function updateBubbleReactionByKey(key) {
    if (!key) return;
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    const bubble = list ? Array.from(list.querySelectorAll('.bcm-bubble')).find(b => b.dataset.reactionKey === key) : null;
    if (!bubble) return;
    const reactionMap = state.msgReactions[key] || {};
    const entries = Object.entries(reactionMap).filter(([, members]) => Array.isArray(members) && members.length);
    const myNum = state.memberNumber;
    const myEmoji = myReactionEmoji(reactionMap);

    bubble.classList.toggle('has-reaction', entries.length > 0);
    const reactBtn = bubble.querySelector('.bcm-react-btn');
    if (reactBtn) {
      reactBtn.textContent = myEmoji || '😊';
      reactBtn.title = myEmoji ? `Your reaction: ${myEmoji}. Click to change` : 'React';
      reactBtn.setAttribute('aria-label', myEmoji ? `Change reaction: ${myEmoji}` : 'React to message');
    }
    const oldRow = bubble.querySelector('.bcm-reaction-row');
    if (oldRow) oldRow.remove();
    if (!entries.length) return;

    const chips = entries.map(([emoji, members]) => {
      const mine = members.includes(myNum);
      const names = members.map(n => getDisplayNameForMember(n, `Member #${n}`));
      const count = members.length;
      return el('button', {
        cls: `bcm-reaction-chip${mine ? ' bcm-reaction-chip-mine' : ''}`,
        type: 'button',
        title: `${emoji} — ${names.join(', ')}${mine ? ' (you)' : ''}`,
        'aria-label': `Reacted by: ${names.join(', ')}. Click to ${mine ? 'remove your' : 'add your'} reaction`,
        onclick: e => { e.stopPropagation(); setReactionByKey(key, mine ? '' : emoji); },
      }, emoji, count > 1 ? el('span', { cls: 'bcm-reaction-count' }, String(count)) : null);
    });

    const addBtn = el('button', {
      cls: 'bcm-reaction-add', type: 'button', title: 'Add a reaction', 'aria-label': 'Add a reaction',
      onclick: e => { e.stopPropagation(); openReactionPanel(bubble.querySelector('.bcm-react-btn') || bubble, key); },
    }, '＋');

    const row = el('div', {
      cls: 'bcm-reaction-row',
      title: 'Click for details',
      onclick: e => {
        if (e.target === row) openReactedByModal(key);
      },
    }, ...chips, addBtn);
    bubble.appendChild(row);
  }

  function openReactedByModal(reactionKey) {
    if (!reactionKey) return;
    const map = state.msgReactions[reactionKey] || {};
    const body = el('div', { cls: 'bcm-seenby-wrap' });
    const entries = Object.entries(map).filter(([, members]) => Array.isArray(members) && members.length);
    if (!entries.length) {
      body.appendChild(el('div', { cls: 'bcm-seenby-empty' }, 'No reactions yet.'));
    } else {
      for (const [emoji, members] of entries) {
        body.appendChild(el('div', { cls: 'bcm-react-who-head' }, `${emoji} × ${members.length}`));
        for (const n of members) {
          const name = getDisplayNameForMember(n, `Member #${n}`);
          body.appendChild(el('div', { cls: 'bcm-seenby-row' },
            createContactAvatar(n, name, false),
            el('div', { cls: 'bcm-seenby-info' },
              el('div', { cls: 'bcm-seenby-name' }, name),
            ),
          ));
        }
      }
    }
    openModal({ title: '😊 Reactions', body, buttons: [{ label: 'Close', value: 'close' }] });
  }

  function closeReactionPanel() {
    state.reactionPanelEl?.remove();
    state.reactionPanelEl = null;
  }

  function openReactionPanel(anchorEl, reactionKey) {
    if (!reactionKey) return;
    closeReactionPanel();

    const reactWith = async emoji => { await setReactionByKey(reactionKey, emoji); closeReactionPanel(); };
    const myEmoji = myReactionEmoji(state.msgReactions[reactionKey] || {});
    const gridEl = el('div', { cls: 'bcm-emoji-grid' });

    const populateGrid = emojis => {
      gridEl.innerHTML = '';
      for (const emoji of emojis) {
        const btn = document.createElement('button');
        btn.className = 'bcm-react-item';
        btn.textContent = emoji;
        btn.setAttribute('aria-label', emoji);
        btn.addEventListener('click', () => reactWith(emoji));
        gridEl.appendChild(btn);
      }
    };

    const searchEl = el('input', { cls: 'bcm-emoji-search', type: 'text', placeholder: '🔍 Search emojis…' });
    searchEl.addEventListener('input', () => {
      const q = searchEl.value.trim().toLowerCase();
      populateGrid(q ? EMOJI_CATALOG.filter(e => (REACTION_LABELS[e] || '').includes(q)) : EMOJI_CATALOG);
    });

    state.reactionPanelEl = el('div', { cls: 'bcm-react-panel bcm-react-panel-full' },
      el('div', { cls: 'bcm-react-quick' },
        ...REACTION_EMOJIS.map(emoji =>
          el('button', { cls: `bcm-react-item${emoji === myEmoji ? ' bcm-react-item-active' : ''}`, 'aria-label': `React with ${REACTION_LABELS[emoji] || emoji}`, title: emoji === myEmoji ? 'Your current reaction — click to remove' : '', onclick: () => reactWith(emoji) }, emoji),
        ),
        el('button', { cls: 'bcm-react-item', title: myEmoji ? `Clear your ${myEmoji} reaction` : 'Clear reaction', 'aria-label': 'Clear reaction', onclick: () => reactWith('') }, '✕'),
      ),
      searchEl,
      gridEl,
    );
    populateGrid(EMOJI_CATALOG);

    const r = anchorEl.getBoundingClientRect();
    const initialLeft = Math.max(PANEL_EDGE_PADDING, r.left - REACTION_PANEL_OFFSET_X);
    const initialTop = Math.max(PANEL_EDGE_PADDING, r.top - REACTION_PANEL_OFFSET_Y);
    state.reactionPanelEl.style.left = initialLeft + 'px';
    state.reactionPanelEl.style.top = initialTop + 'px';
    document.documentElement.appendChild(state.reactionPanelEl);
    const panelRect = state.reactionPanelEl.getBoundingClientRect();
    const containerRect = state.dialogEl?.getBoundingClientRect();
    const minLeft = containerRect ? (containerRect.left + PANEL_EDGE_PADDING) : PANEL_EDGE_PADDING;
    const minTop = containerRect ? (containerRect.top + PANEL_EDGE_PADDING) : PANEL_EDGE_PADDING;
    const maxLeft = containerRect
      ? Math.max(minLeft, containerRect.right - panelRect.width - PANEL_EDGE_PADDING)
      : Math.max(minLeft, window.innerWidth - panelRect.width - PANEL_EDGE_PADDING);
    const maxTop = containerRect
      ? Math.max(minTop, containerRect.bottom - panelRect.height - PANEL_EDGE_PADDING)
      : Math.max(minTop, window.innerHeight - panelRect.height - PANEL_EDGE_PADDING);
    state.reactionPanelEl.style.left = Math.max(minLeft, Math.min(initialLeft, maxLeft)) + 'px';
    state.reactionPanelEl.style.top = Math.max(minTop, Math.min(initialTop, maxTop)) + 'px';
    setTimeout(() => searchEl.focus(), 30);
    setTimeout(() => {
      const handler = e => {
        if (!state.reactionPanelEl?.contains(e.target)) {
          closeReactionPanel();
          document.removeEventListener('mousedown', handler, true);
        }
      };
      document.addEventListener('mousedown', handler, true);
    }, 0);
  }

  function formatLastSeen(ts) {
    if (!ts) return '';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1)  return 'Last seen just now';
    if (mins < 60) return `Last seen ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `Last seen ${hrs}h ago`;
    return `Last seen ${Math.floor(hrs / 24)}d ago`;
  }

  function formatPresenceText(status) {
    if (!status) return '';
    const avail = status.availability ?? 'online';
    const note = String(status.status ?? '').trim();
    if (status.isOnline) {
      if (avail === 'away') return note ? `Away • ${note}` : 'Away';
      if (avail === 'dnd')  return note ? `Do Not Disturb • ${note}` : 'Do Not Disturb';
      const room = String(status.room ?? '').trim();
      if (room) return `📍 ${room}`;
    }
    const base = status.isOnline ? 'Online' : formatLastSeen(status.lastSeen);
    return note ? `${base || 'Offline'} • ${note}` : (base || 'Offline');
  }

  function refreshHeaderOnlineStatus(num) {
    if (state.selectedContact !== num) return;
    const n = Number(num);
    const online = isMemberOnlineForUi(n);
    const hDot    = state.dialogEl?.querySelector('.bcm-msghead-dot');
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    if (!hDot) return;
    const dotClass = memberAvailClass(n, online);
    hDot.className = `bcm-msghead-dot${dotClass ? ' ' + dotClass : ''}`;
    syncHeaderAvatarForContact(n, state.contactMeta[n]?.name, online);
    if (hStatus && hStatus.className !== 'bcm-msghead-status bcm-typing') {
      const room = state.bcFriendCache[n]?.room || '';
      const cur = hStatus.textContent ?? '';
      if (!cur || cur === 'Online' || cur === 'Away' || cur === 'Do Not Disturb' || cur === 'Offline' || cur.startsWith('Last seen') || cur.startsWith('📍')) {
        hStatus.textContent = formatPresenceText({ isOnline: online, room, lastSeen: state.contactMeta[n]?.lastSeen, status: state.contactMeta[n]?.status, availability: state.contactMeta[n]?.availability });
        hStatus.className   = `bcm-msghead-status${dotClass ? ' ' + dotClass : ''}`;
      }
    }
  }

  function scrollMsgs() {
    const l = state.dialogEl?.querySelector('.bcm-msglist');
    if (l) l.scrollTop = l.scrollHeight;
  }


  function sendTypingIndicator(rn) {
    try {
      const W = unsafeWindow;
      if (typeof W.ServerSend !== 'function' || !state.loggedIn) return;
      W.ServerSend('AccountBeep', { MemberNumber: rn, Message: '', BeepType: 'BCMTyping' });
    } catch {}
  }

  function showTypingIndicator(senderNum) {
    if (state.selectedContact !== senderNum) return;
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    if (!hStatus) return;

    clearTimeout(state.typingTimers[senderNum]);

    if (!hStatus.dataset.prevText) {
      hStatus.dataset.prevText  = hStatus.textContent;
      hStatus.dataset.prevClass = hStatus.className;
    }
    hStatus.textContent = 'typing…';
    hStatus.className   = 'bcm-msghead-status bcm-typing';

    state.typingTimers[senderNum] = setTimeout(() => {
      if (hStatus && hStatus.dataset.prevText !== undefined) {
        hStatus.textContent = hStatus.dataset.prevText;
        hStatus.className   = hStatus.dataset.prevClass ?? 'bcm-msghead-status';
        delete hStatus.dataset.prevText;
        delete hStatus.dataset.prevClass;
      }
      delete state.typingTimers[senderNum];
    }, 5000);
  }

  function showGroupTypingIndicator(groupId, senderNum, senderName) {
    if (state.selectedGroup !== groupId) return;
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    if (!hStatus) return;
    const key = `g_${groupId}`;
    clearTimeout(state.typingTimers[key]);
    if (!hStatus.dataset.prevText) {
      hStatus.dataset.prevText = hStatus.textContent;
      hStatus.dataset.prevClass = hStatus.className;
    }
    const name = getSafeDisplayName(senderName, senderNum, '') || getDisplayNameForMember(senderNum, `Member #${senderNum}`);
    hStatus.textContent = `${name} typing…`;
    hStatus.className = 'bcm-msghead-status bcm-typing';
    state.typingTimers[key] = setTimeout(() => {
      if (hStatus && hStatus.dataset.prevText !== undefined) {
        hStatus.textContent = hStatus.dataset.prevText;
        hStatus.className = hStatus.dataset.prevClass ?? 'bcm-msghead-status';
        delete hStatus.dataset.prevText;
        delete hStatus.dataset.prevClass;
      } else {
        updateGroupHeaderStatus(groupId);
      }
      delete state.typingTimers[key];
    }, 5000);
  }


  function saveDraft(contactNum, text) {
    GM_setValue(state.STORE + 'draft_' + contactNum, text ?? '');
  }

  function loadDraft(contactNum) {
    return GM_getValue(state.STORE + 'draft_' + contactNum, '');
  }

  function hasDraft(contactNum) {
    return !!GM_getValue(state.STORE + 'draft_' + contactNum, '').trim();
  }


  async function exportConversation(contactNum) {
    const isGroup = contactNum == null && state.selectedGroup != null;
    const groupId = isGroup ? state.selectedGroup : null;
    const msgs = isGroup ? await getGroupMessages(groupId) : await getMessages(contactNum);
    if (!msgs.length) { showNote('No messages to export', false); return; }
    const name  = isGroup
      ? (state.groups[groupId]?.name ?? `Group #${groupId}`)
      : (state.contactMeta[contactNum]?.name ?? `Member #${contactNum}`);
    const lines = msgs.map(m => {
      const d  = new Date(m.sentAt || 0);
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const sender = isGroup
        ? getDisplayNameForMember(m.senderNum, m.senderName || (m.fromUs ? (state.memberName ?? `Member #${state.memberNumber}`) : `Member #${m.senderNum}`))
        : (m.fromUs ? (state.memberName ?? `Member #${state.memberNumber}`) : name);
      return `[${hh}:${mm} ${mo}/${dd}] ${sender}: ${m.deleted ? '[Message deleted]' : (m.content ?? '')}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `bcm-${name.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.txt`;
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function embedHtmlForUrl(url) {
    const safeUrl = sanitizeHttpUrl(url);
    if (!safeUrl) return '';
    const ytEmbed = getYouTubeEmbedUrl(safeUrl);
    if (ytEmbed)
      return `<div class="embed"><iframe src="${escapeHtml(ytEmbed)}" title="YouTube video" loading="lazy" allow="${escapeHtml(YOUTUBE_IFRAME_ALLOW)}" allowfullscreen></iframe></div>`;
    if (isImageUrl(safeUrl))
      return `<div class="embed"><img src="${escapeHtml(safeUrl)}" alt="Embedded image" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'"></div>`;
    if (isVideoUrl(safeUrl))
      return `<div class="embed"><video src="${escapeHtml(safeUrl)}" controls preload="metadata" referrerpolicy="no-referrer" onerror="this.outerHTML='<div style=\\'font-size:12px;color:#888;padding:8px\\'>🎬 Video unavailable</div>'"></video></div>`;
    return '';
  }

  function formatMessageHtml(text) {
    let html = '';
    let last = 0;
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      const prefix = text.slice(last, m.index);
      if (prefix) html += escapeHtml(prefix).replace(/\n/g, '<br>');
      const url = m[0];
      const safeUrl = sanitizeHttpUrl(url);
      if (safeUrl) {
        html += `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
        html += embedHtmlForUrl(safeUrl);
      } else {
        html += escapeHtml(url);
      }
      last = m.index + url.length;
    }
    if (last < text.length) html += escapeHtml(text.slice(last)).replace(/\n/g, '<br>');
    return html || '&nbsp;';
  }

  async function exportConversationHtml(contactNum) {
    const isGroup = contactNum == null && state.selectedGroup != null;
    const groupId = isGroup ? state.selectedGroup : null;
    const msgs = isGroup ? await getGroupMessages(groupId) : await getMessages(contactNum);
    if (!msgs.length) { showNote('No messages to export', false); return; }
    const name = isGroup
      ? (state.groups[groupId]?.name ?? `Group #${groupId}`)
      : (state.contactMeta[contactNum]?.name ?? `Member #${contactNum}`);
    const meName = state.memberName ?? `Member #${state.memberNumber}`;
    const bubbles = msgs.map(m => {
      const isMine = !!m.fromUs;
      const time = new Date(m.sentAt || 0).toLocaleString();
      const sender = isGroup
        ? getDisplayNameForMember(m.senderNum, m.senderName || (isMine ? meName : `Member #${m.senderNum}`))
        : (isMine ? meName : name);
      return `
        <div class="bubble ${isMine ? 'mine' : 'other'}">
          <div class="meta">${escapeHtml(sender)} • ${escapeHtml(time)}</div>
          <div class="content">${formatMessageHtml(m.deleted ? '[Message deleted]' : (m.content ?? ''))}</div>
        </div>
      `;
    }).join('\n');

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BC Messenger - ${escapeHtml(name)}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#f5f6fa;color:#222;margin:0;padding:18px}
    .wrap{max-width:900px;margin:0 auto}
    h1{font-size:18px;margin:0 0 14px}
    .bubble{max-width:78%;padding:10px 12px;border-radius:14px;margin:6px 0;line-height:1.45;word-break:break-word}
    .mine{margin-left:auto;background:#fce8f0;border:1px solid #f0b0c8}
    .other{margin-right:auto;background:#eef1f6;border:1px solid #dde2ea}
    .meta{font-size:11px;opacity:.75;margin-bottom:4px}
    .content a{color:#c43060;word-break:break-all}
    .embed{margin-top:6px}
    .embed img,.embed video{max-width:100%;max-height:360px;border-radius:8px;display:block}
    .embed iframe{width:min(100%,420px);height:236px;border:0;border-radius:8px;display:block;background:#000}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(isGroup ? `Group: ${name}` : `Chat with ${name}`)}</h1>
    ${bubbles}
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bcm-${name.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.html`;
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }


  const EMOJIS = '😊 😂 😍 🥺 😭 😘 😎 🔥 ❤️ 👍 👎 🙏 😅 😏 🤔 😈 💀 👀 🎉 🥰 😡 💔 ✨ 🌸 💕 😴 🤣 👋 🫡 🤗 😤 💬'.split(' ');

  function closeEmojiPanel() {
    state.emojiPanelEl?.remove();
    state.emojiPanelEl = null;
  }

  function toggleEmojiPanel(inputEl) {
    if (state.emojiPanelEl && document.documentElement.contains(state.emojiPanelEl)) {
      closeEmojiPanel(); return;
    }
    state.emojiPanelEl = el('div', { cls: 'bcm-emoji-panel' },
      ...EMOJIS.map(emoji =>
        el('span', { cls: 'bcm-emoji-item',
          onclick: e => {
            e.stopPropagation();
            const start = inputEl.selectionStart ?? inputEl.value.length;
            const end   = inputEl.selectionEnd   ?? inputEl.value.length;
            inputEl.value = inputEl.value.slice(0, start) + emoji + inputEl.value.slice(end);
            inputEl.selectionStart = inputEl.selectionEnd = start + emoji.length;
            inputEl.focus();
            autoResize({ target: inputEl });
          }
        }, emoji)
      )
    );
    const btn = state.dialogEl?.querySelector('.bcm-emoji-btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      state.emojiPanelEl.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      state.emojiPanelEl.style.left   = Math.max(4, r.left - 100) + 'px';
    }
    document.documentElement.appendChild(state.emojiPanelEl);
    setTimeout(() => {
      const handler = e => {
        if (!state.emojiPanelEl?.contains(e.target) && !e.target.closest?.('.bcm-emoji-btn')) {
          closeEmojiPanel(); document.removeEventListener('mousedown', handler, true);
        }
      };
      document.addEventListener('mousedown', handler, true);
    }, 0);
  }

  // ── Sticker & GIF picker ────────────────────────────────────────────────────

  state.stickerPanelEl = null;

  function insertAtCursor(inputEl, text) {
    if (!inputEl) return;
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end   = inputEl.selectionEnd   ?? inputEl.value.length;
    inputEl.value = inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
    inputEl.selectionStart = inputEl.selectionEnd = start + text.length;
    inputEl.focus();
    autoResize({ target: inputEl });
  }

  function closeStickerPanel() {
    state.stickerPanelEl?.remove();
    state.stickerPanelEl = null;
  }

  function toggleStickerPanel(inputEl) {
    if (state.stickerPanelEl && document.documentElement.contains(state.stickerPanelEl)) {
      closeStickerPanel();
      return;
    }
    openStickerPicker(inputEl);
  }

  async function openStickerPicker(inputEl) {
    closeStickerPanel();
    closeEmojiPanel();

    const insert = url => {
      insertAtCursor(inputEl, url);
      closeStickerPanel();
      inputEl?.focus();
    };

    const body = el('div', { cls: 'bcm-sticker-panel' });
    const tabs = el('div', { cls: 'bcm-sticker-tabs' },
      el('button', { cls: 'bcm-sticker-tab active', type: 'button' }, '🖼 Stickers'),
      el('button', { cls: 'bcm-sticker-tab', type: 'button' }, '🎞 GIFs'),
    );

    const stickerGrid = el('div', { cls: 'bcm-sticker-grid' },
      el('div', { cls: 'bcm-sticker-loading' }, '⏳ Loading stickers…'));
    const stickerTab = el('div', { cls: 'bcm-sticker-tabpage' },
      el('div', { cls: 'bcm-sticker-toolbar' },
        el('label', { cls: 'bcm-sticker-upload', title: 'Upload your own sticker (PNG, GIF, WebP, max 2MB)' },
          '＋ Upload',
          el('input', { type: 'file', accept: 'image/png,image/gif,image/webp', style: { display: 'none' }, onchange: e => onPickFile(e) }),
        ),
        el('span', { cls: 'bcm-sticker-hint' }, 'Click a sticker to insert it'),
      ),
      stickerGrid,
    );

    const gifNote = el('div', { cls: 'bcm-gif-note', style: { display: 'none' } });
    const gifGrid = el('div', { cls: 'bcm-gif-grid' });
    const gifTab = el('div', { cls: 'bcm-sticker-tabpage', style: { display: 'none' } },
      el('div', { cls: 'bcm-gif-searchrow' },
        el('input', { cls: 'bcm-gif-search', type: 'text', placeholder: '🔍 Search GIFs… (Enter to search)' }),
      ),
      gifGrid,
      gifNote,
    );

    body.appendChild(tabs);
    body.appendChild(stickerTab);
    body.appendChild(gifTab);

    let gifRun = 0;
    gifTab.querySelector('.bcm-gif-search').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.stopPropagation();
      const q = e.target.value.trim();
      const run = ++gifRun;
      gifGrid.innerHTML = '';
      gifNote.style.display = 'none';
      if (!q) return;
      gifGrid.appendChild(el('div', { cls: 'bcm-sticker-loading' }, '🔎 Searching…'));
      gifSearch(q, 24)
        .then(res => {
          if (run !== gifRun) return;
          gifGrid.innerHTML = '';
          if (res?.error) {
            gifNote.textContent = res.error;
          } else {
            const results = res?.results || [];
            if (!results.length) {
              gifNote.textContent = 'No GIFs found for that search.';
            } else {
              for (const g of results) {
                const img = el('img', { cls: 'bcm-gif-item', src: g.previewUrl || g.url, alt: g.title || 'GIF', loading: 'lazy' });
                img.addEventListener('click', () => insert(g.url));
                gifGrid.appendChild(img);
              }
            }
          }
          if (gifNote.textContent) gifNote.style.display = '';
        })
        .catch(() => {
          if (run !== gifRun) return;
          gifGrid.innerHTML = '';
          gifNote.textContent = 'GIF search failed — try again.';
          gifNote.style.display = '';
        });
    });

    tabs.querySelectorAll('.bcm-sticker-tab').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        tabs.querySelectorAll('.bcm-sticker-tab').forEach(b => b.classList.toggle('active', b === btn));
        stickerTab.style.display = i === 0 ? '' : 'none';
        gifTab.style.display     = i === 1 ? '' : 'none';
      });
    });

    async function loadStickerGrid(putMyUploadsFirst) {
      stickerGrid.innerHTML = '';
      stickerGrid.appendChild(el('div', { cls: 'bcm-sticker-loading' }, '⏳ Loading stickers…'));
      let data = null;
      try { data = await fetchStickers(); } catch {}
      stickerGrid.innerHTML = '';
      const all = (data?.stickers || []).filter(s => s?.url);
      const mine = all.filter(s => s.owner === state.memberNumber);
      const pack = all.filter(s => s.owner !== state.memberNumber);
      const ordered = putMyUploadsFirst ? [...mine, ...pack] : [...pack, ...mine];
      if (!ordered.length) {
        stickerGrid.appendChild(el('div', { cls: 'bcm-sticker-loading' }, 'No stickers yet — upload one with ＋ Upload'));
        return;
      }
      for (const s of ordered) {
        const img = el('img', { cls: 'bcm-sticker-item', src: s.url, alt: s.name || 'Sticker', loading: 'lazy', referrerpolicy: 'no-referrer' });
        img.title = s.name || 'Sticker';
        img.addEventListener('click', () => insert(s.url));
        stickerGrid.appendChild(img);
      }
    }

    const onPickFile = e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      if (file.size > MAX_STICKER_UPLOAD_BYTES) {
        showNote('Sticker must be 2MB or smaller', true);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          showNote('Uploading sticker…');
          const r = await uploadSticker(reader.result, file.name);
          if (!r?.url) throw new Error(r?.error || 'Upload failed');
          showNote('✅ Sticker uploaded', false);
          await loadStickerGrid(true);
        } catch (ex) {
          showNote(`Upload failed: ${ex.message}`, true);
        }
      };
      reader.onerror = () => showNote('Could not read that file', true);
      reader.readAsDataURL(file);
    };

    // Position the panel below the sticker button, like the emoji panel
    body.style.position = 'fixed';
    const btn = state.dialogEl?.querySelector('.bcm-sticker-btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      body.style.bottom = (window.innerHeight - r.top + 4) + 'px';
      body.style.left   = Math.max(4, r.left - 130) + 'px';
    }
    state.stickerPanelEl = body;
    document.documentElement.appendChild(body);
    setTimeout(() => {
      const handler = e => {
        if (!state.stickerPanelEl?.contains(e.target) && !e.target.closest?.('.bcm-sticker-btn')) {
          closeStickerPanel(); document.removeEventListener('mousedown', handler, true);
        }
      };
      document.addEventListener('mousedown', handler, true);
    }, 0);

    loadStickerGrid(false);
  }


  const ACTIVITY_ACTIONS = [
    { label: '👋 Wave',       verb: 'waves at' },
    { label: '🤗 Hug',        verb: 'hugs' },
    { label: '😘 Kiss',       verb: 'gives a kiss to' },
    { label: '👉 Poke',       verb: 'pokes' },
    { label: '🙇 Bow',        verb: 'bows to' },
    { label: '💃 Dance',      verb: 'dances with' },
    { label: '✋ High-five',  verb: 'high-fives' },
    { label: '🤝 Handshake',  verb: 'shakes hands with' },
  ];

  state.activityPanelEl = null;

  function closeActivityPanel() {
    state.activityPanelEl?.remove();
    state.activityPanelEl = null;
  }

  function toggleActivityPanel() {
    if (state.activityPanelEl && document.documentElement.contains(state.activityPanelEl)) {
      closeActivityPanel(); return;
    }
    state.activityPanelEl = el('div', { cls: 'bcm-activity-panel' },
      ...ACTIVITY_ACTIONS.map(a =>
        el('div', { cls: 'bcm-activity-item', onclick: e => {
          e.stopPropagation();
          sendInGameEmote(a.verb);
          closeActivityPanel();
        }}, a.label)
      )
    );
    const btn = state.dialogEl?.querySelector('.bcm-activity-btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      state.activityPanelEl.style.bottom = (window.innerHeight - r.top + 6) + 'px';
      state.activityPanelEl.style.left   = Math.max(4, r.left) + 'px';
    }
    document.documentElement.appendChild(state.activityPanelEl);
    setTimeout(() => {
      const handler = e => {
        if (!state.activityPanelEl?.contains(e.target) && !e.target.closest?.('.bcm-activity-btn')) {
          closeActivityPanel(); document.removeEventListener('mousedown', handler, true);
        }
      };
      document.addEventListener('mousedown', handler, true);
    }, 0);
  }

  function sendInGameEmote(verb) {
    const W = unsafeWindow;
    if (!W.ChatRoomData?.Name || !state.selectedContact) return;
    const targetChar = [...(W.ChatRoomCharacter ?? []), ...(W.Character ?? [])].find(
      c => Number(c?.MemberNumber) === Number(state.selectedContact)
    );
    if (!targetChar) return;
    const targetName = targetChar.Name ?? `Member #${state.selectedContact}`;
    try {
      W.ServerSend('ChatRoomChat', { Type: 'Emote', Content: `${verb} ${targetName}` });
    } catch (e) {}
  }

  async function updateE2EIndicator(memberNum) {
    const ind = state.dialogEl?.querySelector('.bcm-e2e-indicator');
    if (!ind) return;
    ind.classList.remove('bcm-e2e-changed', 'bcm-e2e-verified');
    if (!memberNum || state.selectedGroup) { ind.textContent = ''; ind.title = ''; return; }
    const r = await getContactSharedKey(memberNum).catch(() => ({ key: null, status: 'no-key' }));
    if (r.status === 'changed') {
      ind.textContent = '⚠️ key changed';
      ind.title = 'Encryption key changed since last seen — click to verify or reject';
      ind.classList.add('bcm-e2e-changed');
    } else if (r.status === 'ok' && r.key) {
      const verified = !!getPinnedFor(memberNum)?.verified;
      ind.textContent = verified ? '🔒✓' : '🔒';
      ind.title = verified ? 'End-to-end encrypted (verified)' : 'End-to-end encrypted — click to verify';
      if (verified) ind.classList.add('bcm-e2e-verified');
    } else {
      ind.textContent = '🔓';
      ind.title = 'No encryption key on record — click for options';
    }
  }

  async function openE2EInfoDialog(memberNum) {
    if (!memberNum) return;
    memberNum = Number(memberNum);
    const r = await getContactSharedKey(memberNum).catch(() => ({ status: 'no-key' }));

    if (r.status === 'changed') {
      const sn = await safetyNumberFor(memberNum); // old pin's safety number
      const ok = confirm(
        `⚠️ The encryption key for member #${memberNum} has changed.\n\n` +
        `This may mean they reinstalled the plugin, OR that the server is impersonating them.\n\n` +
        `Old safety number (pinned): ${sn || '(none)'}\n\n` +
        `Click OK to ACCEPT the new key (only do this if you've confirmed it with them out-of-band).\n` +
        `Click Cancel to keep blocking encrypted messages with this contact.`
      );
      if (ok) {
        await acceptKeyChange(memberNum);
        const newSn = await safetyNumberFor(memberNum);
        const verify = confirm(`New key accepted.\n\nNew safety number: ${newSn}\n\nClick OK to mark this contact as verified, or Cancel to leave unverified.`);
        if (verify) markContactVerified(memberNum, true);
      }
      updateE2EIndicator(memberNum);
      return;
    }

    if (r.status === 'no-key' || !r.key) {
      const allowed = getAllowPlaintext(memberNum);
      const msg = `Member #${memberNum} has no encryption key on record.\n\n` +
        `Current setting for this contact: ${allowed ? 'ALLOW plaintext (no prompt)' : 'WARN before sending plaintext (default)'}\n\n` +
        `Click OK to TOGGLE the setting, Cancel to leave it as-is.`;
      if (confirm(msg)) {
        setAllowPlaintext(memberNum, !allowed);
      }
      return;
    }

    // status === 'ok'
    const sn = await safetyNumberFor(memberNum);
    const verified = !!getPinnedFor(memberNum)?.verified;
    const action = confirm(
      `End-to-end encrypted with member #${memberNum}.\n\n` +
      `Safety number:\n${sn}\n\n` +
      `Compare this with the other person (in-game whisper, voice, etc). If it matches on both sides, the connection is genuine.\n\n` +
      `Status: ${verified ? '✓ Verified' : 'Not yet verified'}\n\n` +
      `Click OK to ${verified ? 'UN-mark' : 'mark'} as verified, Cancel to close.`
    );
    if (action) {
      markContactVerified(memberNum, !verified);
      updateE2EIndicator(memberNum);
    }
  }

  function updateActivityButtonVisibility() {
    const btn = state.dialogEl?.querySelector('.bcm-activity-btn');
    if (!btn) return;
    if (!state.selectedContact || state.selectedGroup) { btn.style.display = 'none'; return; }
    const W = unsafeWindow;
    const inRoom = W.ChatRoomData?.Name && [...(W.ChatRoomCharacter ?? []), ...(W.Character ?? [])].some(
      c => Number(c?.MemberNumber) === Number(state.selectedContact)
    );
    btn.style.display = inRoom ? '' : 'none';
  }

  function onRoomSearchResult(data) {
    const list = Array.isArray(data) ? data
                : Array.isArray(data?.rooms)   ? data.rooms
                : Array.isArray(data?.Results) ? data.Results
                : [];
    state.lobbyRooms = list;
    if (state.lobbyOpen) renderLobbyPanel(list);
  }
  function closeAllPanels() {
    state.lobbyOpen   = false;
    state.roomTabOpen = false;
    state.friendsPanelOpen = false;
    state.starredPanelOpen = false;
    state.collectionsPanelOpen = false;
    state.unreadPanelOpen = false;
    state.mediaPanelOpen = false;
    const main       = state.dialogEl?.querySelector('.bcm-main');
    const friendsEl  = state.dialogEl?.querySelector('.bcm-friends-panel');
    const lobbyEl    = state.dialogEl?.querySelector('.bcm-lobby-panel');
    const roomUsersEl= state.dialogEl?.querySelector('.bcm-roomusers-panel');
    const starredEl  = state.dialogEl?.querySelector('.bcm-starred-panel');
    const collEl     = state.dialogEl?.querySelector('.bcm-collections-panel');
    const unreadEl   = state.dialogEl?.querySelector('.bcm-state.unread-panel');
    const mediaEl    = state.dialogEl?.querySelector('.bcm-media-panel');
    if (main)        main.style.display        = '';
    if (friendsEl)   friendsEl.style.display   = 'none';
    if (lobbyEl)     lobbyEl.style.display     = 'none';
    if (roomUsersEl) roomUsersEl.style.display = 'none';
    if (starredEl)   starredEl.style.display   = 'none';
    if (collEl)      collEl.style.display      = 'none';
    if (unreadEl)    unreadEl.style.display    = 'none';
    if (mediaEl)     mediaEl.style.display     = 'none';
    state.dialogEl?.querySelectorAll('.bcm-tab-btn, .bcm-strip-btn').forEach(b => b.classList.remove('active'));
  }

  function toggleFriendsPanel() {
    state.friendsPanelOpen = !state.friendsPanelOpen;
    if (state.friendsPanelOpen) {
      closeAllPanels();
      state.friendsPanelOpen = true;
      const friendsEl = state.dialogEl?.querySelector('.bcm-friends-panel');
      const mainEl = state.dialogEl?.querySelector('.bcm-main');
      const tabBtn = state.dialogEl?.querySelector('.bcm-friends-tab');
      if (!friendsEl || !mainEl) return;
      mainEl.style.display = 'none';
      friendsEl.style.display = 'flex';
      tabBtn?.classList.add('active');
      renderFriendsPanel();
      resolveUnknownFriends();
    } else {
      closeAllPanels();
      const mainEl = state.dialogEl?.querySelector('.bcm-main');
      if (mainEl) mainEl.style.display = '';
    }
  }

  function renderFriendsPanel() {
    const panel = state.dialogEl?.querySelector('.bcm-friends-panel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(el('div', { cls: 'bcm-friends-header' },
      el('span', {}, '👥 Friends'),
      el('button', { cls: 'bcm-roomusers-refresh', onclick: () => {
        try { unsafeWindow.ServerSend('AccountQuery', { Query: 'FriendList' }); } catch {}
        resolveUnknownFriends();
        renderFriendsPanel();
      } }, '↻'),
    ));
    const searchInput = el('input', {
      cls: 'bcm-friends-search',
      type: 'text',
      placeholder: 'Search friends…',
      value: state.friendsPanelSearch,
      oninput: e => {
        state.friendsPanelSearch = String(e.target.value || '');
        renderFriendsPanel();
      },
    });
    const countEl = el('span', { cls: 'bcm-friends-count' }, '');
    panel.appendChild(el('div', { cls: 'bcm-friends-search-row' }, searchInput, countEl));

    const list = el('div', { cls: 'bcm-friends-list' });
    const q = state.friendsPanelSearch.trim().toLowerCase();
    const friends = getFriendListCandidates()
      .filter(f => !q
        || String(f.name || '').toLowerCase().includes(q)
        || String(f.username || '').toLowerCase().includes(q)
        || String(f.memberNum || '').includes(q));
    countEl.textContent = `${friends.length} friend${friends.length !== 1 ? 's' : ''}`;
    if (!friends.length) {
      panel.appendChild(el('div', { cls: 'bcm-empty' }, 'No friends found'));
      return;
    }
    for (const f of friends) {
      const name = String(f.name || '').trim() || `Member #${f.memberNum}`;
      const username = getSafeDisplayName(f.username, f.memberNum, '');
      const online = isMemberOnlineForUi(f.memberNum);
      const room = state.bcFriendCache[f.memberNum]?.room || '';
      const secondary = room
        ? `📍 ${room}`
        : username && String(username).toLowerCase() !== String(name).toLowerCase()
          ? `@${username}`
          : (state.contactMeta[f.memberNum]?.status || (online ? 'Online' : 'Offline'));
      const subCls = room ? 'bcm-friends-sub-room'
        : String(secondary).startsWith('@') ? 'bcm-friends-sub-user'
        : 'bcm-friends-sub';
      list.appendChild(el('div', {
        cls: 'bcm-friends-card',
        onclick: () => {
          closeAllPanels();
          const mainEl = state.dialogEl?.querySelector('.bcm-main');
          if (mainEl) mainEl.style.display = '';
          selectContact(f.memberNum, name);
        },
      },
      createContactAvatar(f.memberNum, name, online),
      el('div', { cls: 'bcm-friends-meta' },
        el('div', { cls: 'bcm-friends-name' }, name),
        el('div', { cls: subCls }, secondary),
      )));
    }
    panel.appendChild(list);
  }

  function toggleStarredPanel() {
    state.starredPanelOpen = !state.starredPanelOpen;
    if (state.starredPanelOpen) {
      closeAllPanels();
      state.starredPanelOpen = true;
      const starredEl = state.dialogEl?.querySelector('.bcm-starred-panel');
      const mainEl = state.dialogEl?.querySelector('.bcm-main');
      const tabBtn = state.dialogEl?.querySelector('.bcm-starred-tab');
      if (!starredEl || !mainEl) return;
      mainEl.style.display = 'none';
      starredEl.style.display = 'flex';
      tabBtn?.classList.add('active');
      renderStarredPanel();
    } else {
      closeAllPanels();
      const mainEl = state.dialogEl?.querySelector('.bcm-main');
      if (mainEl) mainEl.style.display = '';
    }
  }

  async function renderStarredPanel() {
    const panel = state.dialogEl?.querySelector('.bcm-starred-panel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(el('div', { cls: 'bcm-starred-header' }, '⭐ Starred messages'));
    const list = el('div', { cls: 'bcm-starred-list' });
    const contacts = await getAllContacts();
    const contactNameByNum = Object.fromEntries(contacts.map(c => [c.memberNum, c.memberName]));
    const items = [];
    for (const c of contacts) {
      const msgs = await getMessages(c.memberNum);
      for (const m of msgs) {
        const key = getReactionKey(m);
        if (isStarred(key)) items.push({ ...m, partnerName: contactNameByNum[c.memberNum] ?? `Member #${c.memberNum}` });
      }
    }
    for (const gid of Object.keys(state.groups)) {
      const msgs = await getGroupMessages(Number(gid));
      for (const m of msgs) {
        const key = getReactionKey(m);
        if (isStarred(key)) items.push({ ...m, groupName: state.groups[gid]?.name ?? `Group #${gid}` });
      }
    }
    items.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
    if (!items.length) {
      list.appendChild(el('div', { cls: 'bcm-empty' }, 'No starred messages yet'));
      panel.appendChild(list);
      return;
    }
    for (const item of items.slice(0, MAX_STARRED_PANEL_ITEMS)) {
      const parsed = parseQuotePayload(item.content ?? '');
      const text = item.deleted ? '[deleted]' : (parsed.text || '').replace(/\s+/g, ' ').trim();
      const scope = item.groupId ? (item.groupName ?? `Group #${item.groupId}`) : (item.partnerName ?? `Member #${item.partnerNum}`);
      list.appendChild(el('div', { cls: 'bcm-starred-item', onclick: () => {
        closeAllPanels();
        const mainEl = state.dialogEl?.querySelector('.bcm-main');
        if (mainEl) mainEl.style.display = '';
        if (item.groupId) selectGroup(item.groupId);
        else selectContact(item.partnerNum, item.partnerName ?? `Member #${item.partnerNum}`);
      } },
      el('div', { cls: 'bcm-starred-meta' }, `${scope} · ${new Date(item.sentAt || Date.now()).toLocaleString()}`),
      el('div', { cls: 'bcm-starred-text' }, text || '(empty)')));
    }
    panel.appendChild(list);
  }

  function toggleUnreadPanel() {
    state.unreadPanelOpen = !state.unreadPanelOpen;
    if (state.unreadPanelOpen) {
      closeAllPanels();
      state.unreadPanelOpen = true;
      const unreadEl = state.dialogEl?.querySelector('.bcm-state.unread-panel');
      const mainEl   = state.dialogEl?.querySelector('.bcm-main');
      const tabBtn   = state.dialogEl?.querySelector('.bcm-state.unread-tab');
      if (!unreadEl || !mainEl) return;
      mainEl.style.display   = 'none';
      unreadEl.style.display = 'flex';
      tabBtn?.classList.add('active');
      renderUnreadPanel();
    } else {
      closeAllPanels();
      if (state.dialogEl) { const m = state.dialogEl.querySelector('.bcm-main'); if (m) m.style.display = ''; }
    }
  }

  function renderUnreadPanel() {
    const panel = state.dialogEl?.querySelector('.bcm-state.unread-panel');
    if (!panel) return;
    panel.innerHTML = '';
    panel.appendChild(el('div', { cls: 'bcm-starred-header' }, '📬 Unread messages'));

    const rows = [];
    for (const c of state.allContacts) {
      const n = c.memberNum;
      if (n === state.memberNumber) continue;
      const cnt = state.unread[n] || 0;
      if (!cnt) continue;
      const name = getSafeDisplayName(state.contactMeta[n]?.name, n, '') || c.memberName || `Member #${n}`;
      const online = isMemberOnlineForUi(n);
      const preview = getMessagePreviewText(c.lastMsg || '', false);
      rows.push({ type: 'dm', num: n, name, online, preview, cnt, at: c.lastMsgAt || 0 });
    }
    for (const [gid, cnt] of Object.entries(state.groupUnread)) {
      if (!cnt) continue;
      const g = state.groups[gid];
      if (!g) continue;
      const preview = state.groupLastMsgCache[gid]?.text || '';
      rows.push({ type: 'group', gid: Number(gid), name: g.name, preview, cnt, at: state.groupLastMsgCache[gid]?.at || 0 });
    }
    rows.sort((a, b) => b.at - a.at);

    if (!rows.length) {
      panel.appendChild(el('div', { cls: 'bcm-empty' }, 'No state.unread messages'));
      return;
    }

    const markAllBtn = el('button', { cls: 'bcm-mark-all-btn', onclick: () => {
      for (const r of rows) {
        if (r.type === 'dm') delete state.unread[r.num];
        else delete state.groupUnread[r.gid];
      }
      updateHTMLBadge();
      refreshContactList();
      renderUnreadPanel();
    }}, '✓ Mark all read');
    panel.appendChild(markAllBtn);

    const list = el('div', { cls: 'bcm-starred-list', style: { padding: '0', gap: '0' } });
    for (const r of rows) {
      const avatar = r.type === 'dm'
        ? createContactAvatar(r.num, r.name, r.online)
        : el('div', { cls: 'bcm-group-icon', style: { background: state.groups[r.gid]?.avatarColor || '#8b7fa8', flexShrink: '0' } }, '👥');
      const row = el('div', { cls: 'bcm-state.unread-row', onclick: () => {
        closeAllPanels();
        const mainEl = state.dialogEl?.querySelector('.bcm-main');
        if (mainEl) mainEl.style.display = '';
        if (r.type === 'dm') selectContact(r.num, r.name);
        else selectGroup(r.gid);
      }},
        avatar,
        el('div', { cls: 'bcm-state.unread-info' },
          el('div', { cls: 'bcm-state.unread-name' }, r.name),
          el('div', { cls: 'bcm-state.unread-prev' }, r.preview || ' '),
        ),
        el('div', { cls: 'bcm-state.unread-count' }, r.cnt > 99 ? '99+' : String(r.cnt)),
      );
      list.appendChild(row);
    }
    panel.appendChild(list);
  }

  // ── Media Gallery ──────────────────────────────────────────────────────────────
  function toggleMediaPanel() {
    state.mediaPanelOpen = !state.mediaPanelOpen;
    if (state.mediaPanelOpen) {
      closeAllPanels();
      state.mediaPanelOpen = true;
      const mediaEl = state.dialogEl?.querySelector('.bcm-media-panel');
      const mainEl  = state.dialogEl?.querySelector('.bcm-main');
      if (!mediaEl || !mainEl) return;
      mainEl.style.display  = 'none';
      mediaEl.style.display = 'flex';
      renderMediaPanel();
    } else {
      closeAllPanels();
    }
  }

  async function renderMediaPanel() {
    const panel = state.dialogEl?.querySelector('.bcm-media-panel');
    if (!panel) return;
    panel.innerHTML = '';
    const header = el('div', { cls: 'bcm-starred-header' },
      el('button', { cls: 'bcm-back-btn', onclick: () => { closeAllPanels(); const m = state.dialogEl?.querySelector('.bcm-main'); if (m) m.style.display = ''; }}, '← Back'),
      '🖼 Media',
    );
    panel.appendChild(header);

    if (!state.selectedContact && !state.selectedGroup) {
      panel.appendChild(el('div', { cls: 'bcm-media-empty' }, 'Open a conversation to see its media.'));
      return;
    }
    panel.appendChild(el('div', { cls: 'bcm-media-empty' }, '⏳ Loading…'));

    let msgs = [];
    try {
      msgs = state.selectedContact ? await getMessages(state.selectedContact) : [];
    } catch {}
    panel.removeChild(panel.lastChild);

    const items = [];
    for (const m of msgs) {
      if (m.deleted) continue;
      const raw = String(m.content ?? '');
      const urlMatches = [...raw.matchAll(/https?:\/\/[^\s<>"]+/g)].map(x => x[0]);
      for (const url of urlMatches) {
        const clean = url.replace(/[?#].*$/, '');
        const ytId = extractYouTubeVideoId(url);
        if (ytId) {
          items.push({ type: 'youtube', url, thumb: `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`, sentAt: m.sentAt });
        } else if (IMAGE_URL_RE.test(clean)) {
          items.push({ type: 'image', url, thumb: url, sentAt: m.sentAt });
        } else if (VIDEO_URL_RE.test(clean)) {
          items.push({ type: 'video', url, thumb: null, sentAt: m.sentAt });
        }
      }
    }
    items.reverse();

    if (!items.length) {
      panel.appendChild(el('div', { cls: 'bcm-media-empty' }, 'No images, videos, or YouTube links in this conversation yet.'));
      return;
    }
    const grid = el('div', { cls: 'bcm-media-grid' });
    for (const item of items) {
      const cell = el('div', { cls: 'bcm-media-cell', title: new Date(item.sentAt).toLocaleString(), onclick: () => window.open(item.url, '_blank') });
      if (item.thumb) {
        cell.appendChild(el('img', { src: item.thumb, cls: 'bcm-media-thumb', loading: 'lazy' }));
      } else {
        cell.appendChild(el('div', { cls: 'bcm-media-video-placeholder' }, '▶ Video'));
      }
      grid.appendChild(cell);
    }
    panel.appendChild(grid);
  }

  // ── Conversation Stats ─────────────────────────────────────────────────────────
  function statRow(label, value) {
    return el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--bcm-border)' } },
      el('span', { style: { color: 'var(--bcm-text-muted)', fontSize: '11px' } }, label),
      el('span', { style: { color: 'var(--bcm-text)', fontWeight: '600', fontSize: '12px' } }, value),
    );
  }

  async function openConversationStats(contactNum) {
    const msgs = (await getMessages(contactNum)).filter(m => !m.deleted);
    if (!msgs.length) { showNote('No messages yet', false); return; }
    const total  = msgs.length;
    const mine   = msgs.filter(m => m.fromUs).length;
    const theirs = total - mine;
    const first  = new Date(Math.min(...msgs.map(m => m.sentAt))).toLocaleDateString();
    const dayCounts = Array(7).fill(0);
    msgs.forEach(m => dayCounts[new Date(m.sentAt).getDay()]++);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const busiest = days[dayCounts.indexOf(Math.max(...dayCounts))];
    const responses = [];
    for (let i = 1; i < msgs.length; i++) {
      if (msgs[i].fromUs && !msgs[i - 1].fromUs) responses.push(msgs[i].sentAt - msgs[i - 1].sentAt);
    }
    responses.sort((a, b) => a - b);
    const medResp = responses.length ? responses[Math.floor(responses.length / 2)] : null;
    const fmtDur = ms => ms < 60000 ? '<1 min' : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 3600000)} hr`;

    const body = el('div', { style: { display: 'flex', flexDirection: 'column', minWidth: '220px' } },
      statRow('Total messages', String(total)),
      statRow('Your messages', `${mine} (${Math.round(mine / total * 100)}%)`),
      statRow('Their messages', `${theirs} (${Math.round(theirs / total * 100)}%)`),
      statRow('First message', first),
      statRow('Most active day', busiest),
      ...(medResp !== null ? [statRow('Avg response time', fmtDur(medResp))] : []),
    );
    openModal({ title: '📊 Conversation Stats', body, buttons: [{ label: 'Close', value: 'close' }] });
  }

  // ── Import contacts from current room ─────────────────────────────────────────
  async function openRoomImportDialog() {
    const W = unsafeWindow;
    const chars = [...(W.ChatRoomCharacter ?? []), ...(W.Character ?? [])];
    const inRoom = chars
      .map(c => ({ num: parseInt(c.MemberNumber ?? c.ID ?? 0, 10), name: String(c.Name ?? '').trim() }))
      .filter(c => c.num && c.num !== state.memberNumber);
    const existing = new Set(Object.keys(state.contactMeta).map(Number).filter(Boolean));
    const newOnes = inRoom.filter(c => !existing.has(c.num));

    if (!newOnes.length) {
      await openAlert(inRoom.length
        ? 'Everyone in the room is already in your contacts.'
        : "You're not in a room right now, or no other members are present.");
      return;
    }

    const selected = new Set(newOnes.map(c => c.num));
    const countEl = el('button', { cls: 'bcm-settings-btn', style: { background: 'var(--bcm-accent)', color: '#fff', borderColor: 'var(--bcm-accent)' } });
    const updateCount = () => { countEl.textContent = `Import ${selected.size} contact${selected.size !== 1 ? 's' : ''}`; };
    updateCount();

    const rows = newOnes.map(c => {
      const chk = el('input', { type: 'checkbox' });
      chk.checked = true;
      chk.addEventListener('change', () => { chk.checked ? selected.add(c.num) : selected.delete(c.num); updateCount(); });
      return el('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', cursor: 'pointer', fontSize: '12px' } },
        chk,
        createContactAvatar(c.num, c.name, true),
        el('span', { style: { color: 'var(--bcm-text)', flex: '1' } }, c.name || `Member #${c.num}`),
        el('span', { style: { color: 'var(--bcm-text-muted)', fontSize: '11px' } }, `#${c.num}`),
      );
    });
    const body = el('div', { style: { display: 'flex', flexDirection: 'column', maxHeight: '240px', overflowY: 'auto', gap: '0' } }, ...rows);

    countEl.addEventListener('click', async () => {
      if (!selected.size) return;
      for (const c of newOnes) {
        if (selected.has(c.num)) await upsertContact(c.num, c.name || `Member #${c.num}`);
      }
      showNote(`✅ Imported ${selected.size} contact${selected.size !== 1 ? 's' : ''}`, false);
      refreshContactList();
      // close the modal overlay
      document.querySelector('.bcm-modal-overlay')?.remove();
    });

    const overlay = document.querySelector('.bcm-modal-overlay');
    openModal({ title: '📍 Import from Room', body, buttons: [{ label: 'Cancel', value: 'cancel' }] });
    // Prepend the import button before Cancel in the button row
    setTimeout(() => {
      const btnRow = document.querySelector('.bcm-modal-overlay .bcm-modal-btns');
      if (btnRow) btnRow.insertBefore(countEl, btnRow.firstChild);
    }, 0);
  }

  function toggleCollectionsPanel() {
    state.collectionsPanelOpen = !state.collectionsPanelOpen;
    if (state.collectionsPanelOpen) {
      closeAllPanels();
      state.collectionsPanelOpen = true;
      const collEl = state.dialogEl?.querySelector('.bcm-collections-panel');
      const mainEl = state.dialogEl?.querySelector('.bcm-main');
      const tabBtn = state.dialogEl?.querySelector('.bcm-collections-tab');
      if (!collEl || !mainEl) return;
      mainEl.style.display = 'none';
      collEl.style.display = 'flex';
      tabBtn?.classList.add('active');
      renderCollectionsPanel();
    } else {
      closeAllPanels();
      if (state.dialogEl) { const m = state.dialogEl.querySelector('.bcm-main'); if (m) m.style.display = ''; }
    }
  }

  async function renderCollectionsPanel(detailName = null) {
    const panel = state.dialogEl?.querySelector('.bcm-collections-panel');
    if (!panel) return;
    panel.innerHTML = '';

    if (detailName !== null) {
      panel.appendChild(el('button', { cls: 'bcm-back-btn', onclick: () => renderCollectionsPanel() }, '← Back'));
      panel.appendChild(el('div', { cls: 'bcm-starred-header' }, `📁 ${detailName}`));
      const list = el('div', { cls: 'bcm-starred-list', style: { padding: '0', gap: '0' } });
      panel.appendChild(list);
      try {
        const result = await getCollectionMessages(detailName);
        const msgs = Array.isArray(result?.messages) ? result.messages : [];
        if (!msgs.length) {
          list.appendChild(el('div', { cls: 'bcm-empty' }, 'Collection is empty'));
          return;
        }
        const refMap = {};
        for (const c of await getAllContacts()) {
          for (const m of await getMessages(c.memberNum)) {
            const key = getReactionKey(m);
            if (key) refMap[key] = { ...m, _partnerNum: c.memberNum };
          }
        }
        for (const gid of Object.keys(state.groups)) {
          for (const m of await getGroupMessages(Number(gid))) {
            const key = getReactionKey(m);
            if (key) refMap[key] = { ...m, _groupId: Number(gid) };
          }
        }
        for (const item of msgs) {
          const ref = item.messageRef;
          const localMsg = refMap[ref];
          const parsed = localMsg ? parseQuotePayload(localMsg.content ?? '') : null;
          const text = localMsg?.deleted ? '[deleted]' : (parsed?.text || localMsg?.content || '').replace(/\s+/g, ' ').trim();
          const senderName = localMsg?.senderName || (localMsg?._groupId ? `Group #${localMsg._groupId}` : localMsg?._partnerNum ? `Member #${localMsg._partnerNum}` : ref);
          const ts = item.addedAt ? new Date(item.addedAt).toLocaleDateString() : '';
          list.appendChild(el('div', { cls: 'bcm-coll-item' },
            el('div', { cls: 'bcm-coll-meta' },
              el('span', {}, senderName),
              el('span', {}, ts),
            ),
            el('div', { cls: 'bcm-coll-text' }, text || ref),
            el('button', { cls: 'bcm-coll-remove', title: 'Remove from collection', onclick: async () => {
              try {
                await removeFromCollection(detailName, ref);
                renderCollectionsPanel(detailName);
              } catch (e) { showNote(`Remove failed: ${e.message}`, true); }
            }}, '✕ Remove'),
          ));
        }
      } catch {
        list.appendChild(el('div', { cls: 'bcm-empty' }, 'Could not load collection'));
      }
      return;
    }

    panel.appendChild(el('div', { cls: 'bcm-starred-header' }, '📁 Message collections'));
    const list = el('div', { cls: 'bcm-starred-list' });
    try {
      const result = await getCollections();
      const cols = Array.isArray(result?.collections) ? result.collections : [];
      if (!cols.length) {
        list.appendChild(el('div', { cls: 'bcm-empty' }, 'No collections yet — right-click a message and choose "Save to collection"'));
        panel.appendChild(list);
        return;
      }
      for (const col of cols) {
        list.appendChild(el('div', { cls: 'bcm-starred-item', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' },
          onclick: () => renderCollectionsPanel(col.name) },
          el('span', { style: { fontWeight: '700', fontSize: '13px', color: 'var(--bcm-text)' } }, `📁 ${col.name}`),
          el('span', { style: { fontSize: '11px', color: 'var(--bcm-text-muted)' } }, `${col.count} msg${col.count !== 1 ? 's' : ''} →`),
        ));
      }
    } catch {
      list.appendChild(el('div', { cls: 'bcm-empty' }, 'Could not load collections'));
    }
    panel.appendChild(list);
  }

  function toggleRoomUsersPanel() {
    state.roomTabOpen = !state.roomTabOpen;
    if (state.roomTabOpen) {
      closeAllPanels();
      state.roomTabOpen = true;
      const roomUsersEl = state.dialogEl?.querySelector('.bcm-roomusers-panel');
      const mainEl      = state.dialogEl?.querySelector('.bcm-main');
      const tabBtn      = state.dialogEl?.querySelector('.bcm-roomusers-tab');
      if (!roomUsersEl || !mainEl) return;
      mainEl.style.display        = 'none';
      roomUsersEl.style.display   = 'flex';
      tabBtn?.classList.add('active');
      renderRoomUsersPanel();
    } else {
      closeAllPanels();
      const mainEl = state.dialogEl?.querySelector('.bcm-main');
      if (mainEl) mainEl.style.display = '';
    }
  }

  function renderRoomUsersPanel() {
    const panel = state.dialogEl?.querySelector('.bcm-roomusers-panel');
    if (!panel) return;
    panel.innerHTML = '';
    const W       = unsafeWindow;
    const chars   = W.ChatRoomCharacter ?? [];
    const roomName= W.ChatRoomData?.Name ?? 'Current Room';

    panel.appendChild(el('div', { cls: 'bcm-roomusers-header' },
      el('div', { cls: 'bcm-roomusers-title' }, '👥 ' + roomName),
      el('button', { cls: 'bcm-roomusers-refresh', onclick: renderRoomUsersPanel }, '↻'),
    ));

    if (!chars.length) {
      panel.appendChild(el('div', { cls: 'bcm-empty' }, 'Not in a room'));
      return;
    }

    const list = el('div', { cls: 'bcm-roomusers-list' });
    for (const char of chars) {
      const num  = parseInt(char.MemberNumber ?? char.ID ?? 0, 10);
      const name = char.Name ?? `Member #${num}`;
      const isMe = num === state.memberNumber;

      const chatBtn = el('button', { cls: 'bcm-roomuser-chat', title: 'Open in Messenger',
        onclick: () => {
          closeAllPanels();
          const mainEl = state.dialogEl?.querySelector('.bcm-main');
          if (mainEl) mainEl.style.display = '';
          selectContact(num, name);
        }
      }, '💬 Chat');

      const whisperBtn = el('button', { cls: 'bcm-roomuser-whisper', title: 'Whisper in room',
        onclick: () => {
          closeAllPanels();
          const mainEl = state.dialogEl?.querySelector('.bcm-main');
          if (mainEl) mainEl.style.display = '';
          selectContact(num, name).then(() => {
            state.sendMode = 'whisper';
            const radio = state.dialogEl?.querySelector('input[name="bcm-sendmode"][value="whisper"]');
            if (radio) radio.checked = true;
            state.dialogEl?.querySelector('.bcm-input')?.focus();
          });
        }
      }, '💌 Whisper');

      list.appendChild(
        el('div', { cls: `bcm-roomuser${isMe ? ' bcm-roomuser-me' : ''}` },
          el('div', { cls: 'bcm-roomuser-name' }, (isMe ? '(you) ' : '') + name),
          el('div', { cls: 'bcm-roomuser-num' }, `#${num}`),
          ...(isMe ? [] : [chatBtn, whisperBtn]),
        )
      );
    }
    panel.appendChild(list);
  }

  function toggleLobbyPanel() {
    state.lobbyOpen = !state.lobbyOpen;
    const lobbyEl = state.dialogEl?.querySelector('.bcm-lobby-panel');
    const mainEl  = state.dialogEl?.querySelector('.bcm-main');
    const tabBtn  = state.dialogEl?.querySelector('.bcm-lobby-tab');
    if (!lobbyEl || !mainEl) return;
    if (state.lobbyOpen) {
      closeAllPanels();
      state.lobbyOpen = true;
      lobbyEl.style.display = 'flex';
      tabBtn?.classList.add('active');
      fetchRooms();
    } else {
      closeAllPanels();
      mainEl.style.display = '';
    }
  }

  function togglePinnedRoom(name) {
    const i = state.pinnedRooms.indexOf(name);
    if (i >= 0) state.pinnedRooms.splice(i, 1); else state.pinnedRooms.push(name);
    GM_setValue(state.STORE + 'pinnedRooms', JSON.stringify(state.pinnedRooms));
    if (state.lobbyRooms) renderLobbyPanel(state.lobbyRooms);
  }

  async function fetchRooms() {
    if (state.lobbyRooms !== null) {
      renderLobbyPanel(state.lobbyRooms);
    } else {
      renderLobbyPanel(null);
    }
    const W = unsafeWindow;
    try {
      if (typeof W.ServerRoomSearch === 'function') {
        const res = await W.ServerRoomSearch(state.lobbySearch, {
          Language: '',
          Space:    W.ChatRoomSpace ?? '',
          Game:     '',
          FullRooms: true,
        });
        if (res && !res.err) {
          onRoomSearchResult(res.value ?? []);
        } else {
          renderLobbyPanel(state.lobbyRooms ?? []);
        }
      } else {
        W.ServerSend('ChatRoomSearch', {
          Query:    state.lobbySearch,
          Space:    W.ChatRoomSpace ?? '',
          Game:     '',
          Language: '',
          Full:     true,
          Limit:    25,
        });
        setTimeout(() => {
          if (state.lobbyOpen && state.lobbyRooms === null) {
            renderLobbyPanel('noresponse');
          }
        }, 4000);
      }
    } catch { renderLobbyPanel(state.lobbyRooms ?? []); }
  }

  function renderLobbyPanel(rooms) {
    const panel = state.dialogEl?.querySelector('.bcm-lobby-panel');
    if (!panel) return;
    panel.innerHTML = '';

    const W           = unsafeWindow;
    const currentRoom = W.ChatRoomData?.Name ?? W.Player?.ChatRoomSpace ?? null;
    if (currentRoom) {
      panel.appendChild(el('div', { cls: 'bcm-lobby-current' },
        '📍',
        el('div', { cls: 'bcm-lobby-current-name' }, currentRoom),
      ));
    }

    const searchBox = el('input', {
      cls: 'bcm-lobby-searchbox', type: 'text',
      placeholder: 'Filter rooms…', value: state.lobbySearch,
    });
    searchBox.addEventListener('input', () => {
      state.lobbySearch = searchBox.value;
      if (state.lobbyRooms !== null) {
        const W2 = unsafeWindow;
        const freshCurrentRoom = W2.ChatRoomData?.Name ?? W2.Player?.ChatRoomSpace ?? null;
        renderLobbyFiltered(panel, state.lobbyRooms, freshCurrentRoom, searchBox);
      }
    });
    const countEl = el('span', { cls: 'bcm-lobby-count' }, '');
    panel.appendChild(el('div', { cls: 'bcm-lobby-search-row' },
      searchBox,
      el('button', { cls: 'bcm-lobby-refresh', onclick: fetchRooms }, '↻'),
      countEl,
    ));

    if (rooms === null) {
      panel.appendChild(el('div', { cls: 'bcm-empty' }, 'Loading…'));
      return;
    }
    if (rooms === 'noresponse') {
      panel.appendChild(el('div', { cls: 'bcm-empty', style: { flexDirection: 'column', gap: '8px', fontSize: '12px' } },
        el('div', {}, '🏠 Room list unavailable'),
        el('div', { style: { color: 'var(--bcm-text-muted)', fontSize: '11px', textAlign: 'center', maxWidth: '200px' } },
          'BC only allows room search from the lobby screen. Leave your current room to browse rooms.'),
      ));
      return;
    }
    renderLobbyFiltered(panel, rooms, currentRoom, searchBox, countEl);
  }

  function renderLobbyFiltered(panel, rooms, currentRoom, searchBox, countEl) {
    panel.querySelector('.bcm-lobby-list')?.remove();
    panel.querySelector('.bcm-empty')?.remove();

    const q           = (searchBox?.value ?? state.lobbySearch).toLowerCase().trim();
    const friendNums  = new Set(getBCFriendEntries().map(f => Number(f.memberNum)).filter(Boolean));
    const filtered    = q ? rooms.filter(r => {
      const name = (r.Name ?? r.name ?? '').toLowerCase();
      const desc = (r.Description ?? r.description ?? '').toLowerCase();
      return name.includes(q) || desc.includes(q);
    }) : rooms;

    if (countEl) countEl.textContent = `${filtered.length} room${filtered.length !== 1 ? 's' : ''}`;

    if (!filtered.length) {
      panel.appendChild(el('div', { cls: 'bcm-empty' }, q ? 'No rooms match your search' : 'No rooms found'));
      return;
    }

    function buildRoomRow(room, forPinnedSection) {
      const name      = room.Name        ?? room.name        ?? '(unnamed)';
      const desc      = room.Description ?? room.description ?? '';
      const members   = Array.isArray(room.Members) ? room.Members.map(m => parseInt(m.MemberNumber ?? m, 10)) : [];
      const count     = room.MemberCount ?? room.memberCount ?? members.length;
      const limit     = room.Limit ?? room.MemberLimit ?? null;
      const isPrivate = !!(room.Private || room.Locked);
      const hasFriend = members.some(n => friendNums.has(n));
      const isCurrent = name === currentRoom;
      const isPinned  = state.pinnedRooms.includes(name);
      let cls = 'bcm-room-item';
      if (isCurrent) cls += ' bcm-room-current';
      else if (!forPinnedSection && hasFriend) cls += ' bcm-room-friend';

      const lockIcon = isPrivate ? ' 🔒' : '';
      const label = (isCurrent ? '📍 ' : hasFriend ? '⭐ ' : '') + name + lockIcon;
      const capacityStr = limit ? `${count}/${limit}` : `${count}`;
      const meta  = `${capacityStr} member${count !== 1 ? 's' : ''}${isPrivate ? ' · Private' : ''}${desc ? ' · ' + desc.slice(0, 50) : ''}`;

      return el('div', { cls },
        el('div', { cls: 'bcm-room-info' },
          el('div', { cls: 'bcm-room-name' }, label),
          el('div', { cls: 'bcm-room-meta' }, meta),
        ),
        el('button', { cls: `bcm-room-pin-btn${isPinned ? ' active' : ''}`, title: isPinned ? 'Unpin room' : 'Pin room',
          onclick: e => { e.stopPropagation(); togglePinnedRoom(name); }
        }, isPinned ? '★' : '☆'),
        isCurrent
          ? el('button', { cls: 'bcm-room-join', disabled: 'true' }, 'Here')
          : (state.pendingJoinTarget === name)
            ? el('button', { cls: 'bcm-room-join', disabled: 'true' }, 'Joining...')
            : el('button', { cls: 'bcm-room-join', onclick: () => joinRoom(name) }, 'Join'),
      );
    }

    const list = el('div', { cls: 'bcm-lobby-list' });

    if (state.pinnedRooms.length) {
      list.appendChild(el('div', { cls: 'bcm-pinned-rooms-header' }, '★ Pinned'));
      for (const pName of state.pinnedRooms) {
        const pRoom = rooms.find(r => (r.Name ?? r.name) === pName);
        if (pRoom) list.appendChild(buildRoomRow(pRoom, true));
        else list.appendChild(el('div', { cls: 'bcm-room-item' },
          el('div', { cls: 'bcm-room-info' }, el('div', { cls: 'bcm-room-name' }, pName), el('div', { cls: 'bcm-room-meta' }, 'offline')),
          el('button', { cls: 'bcm-room-pin-btn active', title: 'Unpin room', onclick: () => togglePinnedRoom(pName) }, '★'),
        ));
      }
    }

    const sorted = [...filtered].sort((a, b) => {
      const aName   = a.Name ?? a.name ?? '';
      const bName   = b.Name ?? b.name ?? '';
      const aCur    = aName === currentRoom ? 1 : 0;
      const bCur    = bName === currentRoom ? 1 : 0;
      const aMs     = Array.isArray(a.Members) ? a.Members.map(m => parseInt(m.MemberNumber ?? m, 10)) : [];
      const bMs     = Array.isArray(b.Members) ? b.Members.map(m => parseInt(m.MemberNumber ?? m, 10)) : [];
      const aFriend = aMs.some(n => friendNums.has(n)) ? 1 : 0;
      const bFriend = bMs.some(n => friendNums.has(n)) ? 1 : 0;
      if (bFriend !== aFriend) return bFriend - aFriend;
      if (bCur    !== aCur)    return bCur    - aCur;
      const ac = a.MemberCount ?? a.memberCount ?? aMs.length ?? 0;
      const bc2 = b.MemberCount ?? b.memberCount ?? bMs.length ?? 0;
      return bc2 - ac;
    });

    for (const room of sorted) {
      list.appendChild(buildRoomRow(room, false));
    }
    panel.appendChild(list);
  }

  state.pendingJoinTarget = null;
  state.leavingForJoin = false;
  state.lastChatRoomJoinSent = { name: null, timestamp: 0 };
  state.joinOperationToken = 0;

  function refreshLobbyJoinButtons() {
    try {
      if (state.lobbyOpen && state.lobbyRooms !== null) renderLobbyPanel(state.lobbyRooms);
    } catch {}
  }

  function joinRoom(name) {
    try {
      const W = unsafeWindow;

      if (state.pendingJoinTarget === name) {
        return;
      }
      if (state.pendingJoinTarget && state.pendingJoinTarget !== name) {
        return;
      }

      const currentRoomName = W.ChatRoomData?.Name ?? '';
      if (currentRoomName === name) {
        return;
      }

      state.pendingJoinTarget = name;
      const operationToken = ++state.joinOperationToken;
      refreshLobbyJoinButtons();

      if (typeof W.ChatRoomSetLastChatRoom === 'function') {
        W.ChatRoomSetLastChatRoom('');
      }
      state.leavingForJoin = true;

      const inRoom = (typeof W.ServerPlayerIsInChatRoom === 'function')
        ? !!W.ServerPlayerIsInChatRoom()
        : (W.CurrentScreen === 'ChatRoom');
      if (inRoom) {
        W.ServerSend('ChatRoomLeave', '');
      }
      if (W.ChatRoomData) W.ChatRoomData = null;
      if (W.Player) W.Player.ChatRoomSpace = '';
      if (W.RelogData) W.RelogData = null;

      if (typeof W.CommonSetScreen === 'function') {
        W.CommonSetScreen('Online', 'ChatSearch');
      }

      const startTime = Date.now();
      const maxWait = 5000;
      const attemptJoin = () => {
        const elapsed = Date.now() - startTime;
        if (elapsed > maxWait) {
          console.warn('[BCM] Timeout waiting for lobby before join:', name);
          if (state.pendingJoinTarget === name) state.pendingJoinTarget = null;
          state.leavingForJoin = false;
          refreshLobbyJoinButtons();
          return;
        }
        if (state.pendingJoinTarget !== name) return;

        const isLobby = W.CurrentScreen === 'ChatSearch' || W.CurrentScreen === 'MainHall';
        const stillInRoom = (typeof W.ServerPlayerIsInChatRoom === 'function')
          ? !!W.ServerPlayerIsInChatRoom()
          : false;
        const roomDataExists = !!W.ChatRoomData?.Name;
        const playerInRoom = !!(W.Player?.ChatRoomSpace && W.Player.ChatRoomSpace !== '');

        if (!isLobby || stillInRoom || roomDataExists || playerInRoom) {
          if (roomDataExists && W.ChatRoomData) W.ChatRoomData = null;
          if (playerInRoom && W.Player) W.Player.ChatRoomSpace = '';
          setTimeout(attemptJoin, 100);
          return;
        }

        const sendJoin = () => {
          state.lastChatRoomJoinSent = { name: null, timestamp: 0 };
          W.ServerSend('ChatRoomJoin', { Name: name });
        };

        sendJoin();

        [700, 1400].forEach((delay, index) => {
          setTimeout(() => {
            if (state.joinOperationToken !== operationToken) return;
            if (state.pendingJoinTarget && state.pendingJoinTarget !== name) return;
            sendJoin();
          }, delay);
        });
      };

      setTimeout(attemptJoin, 200);
    } catch (e) {
      console.error('[BCM] joinRoom error:', e);
      state.pendingJoinTarget = null;
      state.leavingForJoin = false;
      refreshLobbyJoinButtons();
    }
  }


  async function doSend() {
    if (!state.loggedIn) return;

    const input   = state.dialogEl?.querySelector('.bcm-input');
    const btn     = state.dialogEl?.querySelector('.bcm-sendbtn');
    const content = input?.value.trim();
    if (!content) return;

    if (!state.selectedContact && !state.selectedGroup) { showNote('Select a contact or group first', true); return; }
    if (state.selectedContact && Number(state.selectedContact) === Number(state.memberNumber)) {
      // Saved messages — local-only, no server send
      const content2 = input?.value.trim();
      if (!content2) return;
      input.value = '';
      autoResize({ target: input });
      if (btn) btn.disabled = true;
      const sentAt2 = Date.now();
      let msg2 = { partnerNum: state.memberNumber, senderNum: state.memberNumber, content: content2, sentAt: sentAt2, fromUs: true, serverId: null, status: 'delivered' };
      try { msg2 = await saveMessage(state.memberNumber, state.memberNumber, content2, sentAt2, true, null, 'delivered'); } catch {}
      appendBubble(msg2);
      scrollMsgs();
      if (btn) btn.disabled = false;
      return;
    }
    const outgoingContent = encodeMessagePayload(content, state.currentQuote, { spoiler: state.composeSpoiler, oneTime: state.composeOneTime });

    if (state.selectedContact && !state.selectedGroup) {
      const usedBCMFeature = state.composeSpoiler || state.composeOneTime || !!state.currentQuote;
      if (usedBCMFeature && !state.contactMeta[state.selectedContact]?.hasBCM) {
        const featureList = [
          state.composeSpoiler  && 'spoiler message',
          state.composeOneTime  && 'one-time message',
          state.currentQuote    && 'reply quote',
        ].filter(Boolean).join(', ');
        const choice = await openModal({
          title: '⚠️ Contact may not have BC Messenger',
          body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px', color: 'var(--bcm-text)' } },
            el('p', {}, `You are using: ${featureList}. This contact hasn't been detected as a BC Messenger user, so these features will appear as unreadable text on their end.`),
            el('p', {}, 'You can send an invite so they can install BC Messenger, then resend your message.'),
          ),
          buttons: [
            { label: '📨 Invite & Send', primary: true,  value: 'invite' },
            { label: 'Send anyway',      primary: false, value: 'send'   },
            { label: 'Cancel',           primary: false, value: 'cancel' },
          ],
        });
        if (choice !== 'send' && choice !== 'invite') {
          if (btn) btn.disabled = false;
          return;
        }
        if (choice === 'invite') {
          await sendBCMInvite(state.selectedContact);
        }
      }
    }

    input.value = '';
    autoResize({ target: input });
    if (btn) btn.disabled = true;
    if (state.selectedContact) saveDraft(state.selectedContact, '');
    if (state.selectedGroup) saveDraft('g_' + state.selectedGroup, '');
    clearQuote();
    clearComposeModes();

    if (state.selectedGroup) {
      try {
        const sentAt = Date.now();
        const result = await sendGroupMessage(state.selectedGroup, outgoingContent, [], state.currentParentMessageRef);
        if (result?.success) {
          const status = deriveStatusFromGroupReceipt(result?.receipt) || 'sent';
          let msg = {
            groupId: state.selectedGroup, senderNum: state.memberNumber, senderName: state.memberName || `Member #${state.memberNumber}`,
            content: outgoingContent, sentAt, fromUs: true, serverId: null, status, messageType: 'group',
            groupMessageRef: result?.groupMessageRef ?? null,
          };
          msg = updateGroupReceiptForMessage(msg, result?.receipt, result?.groupMessageRef ?? null);
          try { msg = await saveGroupMessage(state.selectedGroup, state.memberNumber, state.memberName || `Member #${state.memberNumber}`, outgoingContent, sentAt, true, null, status, false, result?.groupMessageRef ?? null, result?.receipt ?? null); } catch {}
          if (result?.senderMessageId) {
            updateMessageServerId(msg, result.senderMessageId).catch(() => {});
          }
          scheduleDisappearingForMessage(msg);
          appendBubble(msg);
          scrollMsgs();
        } else {
          input.value = content;
          showNote(`Send failed — ${explainSendFailure(result?.error)}`, true);
        }
      } catch (e) {
        input.value = content;
        showNote(`Send failed: ${explainSendFailure(e.message)}`, true);
        console.error('[BCM] Group send error:', e);
      } finally {
        if (btn) btn.disabled = false;
      }
      return;
    }

    const rn = state.selectedContact;
    try {
      const W = unsafeWindow;
      if (typeof W.ServerSend !== 'function') throw new Error('BC not ready');

      if (state.sendMode === 'whisper') {
        const inRoom = (typeof W.ServerPlayerIsInChatRoom === 'function')
          ? !!W.ServerPlayerIsInChatRoom()
          : (W.CurrentScreen === 'ChatRoom');
        if (!inRoom) throw new Error('Cannot send whisper: join a chat room or switch to beep mode');
        const targetInRoom = (W.Character ?? []).some(c => parseInt(c?.MemberNumber, 10) === rn);
        if (!targetInRoom) throw new Error('Cannot send whisper: target is not in this room (use beep mode instead)');
        markLocalSendBypass('whisper', rn, outgoingContent);
        W.ServerSend('ChatRoomChat', { Type: 'Whisper', Content: outgoingContent, Target: rn });
        const sentAt = Date.now();
        let msg = { partnerNum: rn, senderNum: state.memberNumber, content: outgoingContent, sentAt, fromUs: true, serverId: null, status: 'delivered' };
        try { msg = await saveMessage(rn, state.memberNumber, outgoingContent, sentAt, true, null, 'delivered'); } catch {}
        scheduleDisappearingForMessage(msg);
        appendBubble(msg);
        scrollMsgs();
        refreshContactList();
        sendToServer(rn, outgoingContent, false, state.currentParentMessageRef, true).then(r => {
          if (r?.success && r.id) {
            updateMessageServerId(msg, r.id).catch(() => {});
          }
        }).catch(() => {});
        return;
      }

      const isBcFriend = (W.Player?.FriendList ?? []).some(n => parseInt(n, 10) === rn);
      if (isBcFriend) {
        markLocalSendBypass('beep', rn, outgoingContent);
        W.ServerSend('AccountBeep', { MemberNumber: rn, Message: outgoingContent, BeepType: '', IsSecret: true });
      }
      const sentAt = Date.now();
      const status = await getStatus(rn);
      const initialStatus = isMemberOnlineForUi(rn, status?.isOnline) ? 'delivered' : 'sent';
      if (initialStatus === 'sent') showNote('Recipient appears offline — message queued', false);
      let msg = { partnerNum: rn, senderNum: state.memberNumber, content: outgoingContent, sentAt, fromUs: true, serverId: null, status: initialStatus };
      try { msg = await saveMessage(rn, state.memberNumber, outgoingContent, sentAt, true, null, initialStatus); } catch {}
      scheduleDisappearingForMessage(msg);
      appendBubble(msg);
      scrollMsgs();
      refreshContactList();
      sendToServer(rn, outgoingContent, true, state.currentParentMessageRef).then(r => {
        if (r?.success && r.id) {
          updateMessageServerId(msg, r.id).catch(() => {});
          if (r.delivered === true && initialStatus !== 'delivered') {
            updateMsgStatus(r.id, 'delivered').then(updated => { if (updated) updateBubbleTick(r.id, 'delivered'); }).catch(() => {});
          }
        }
      }).catch(() => {});
    } catch (e) {
      input.value = content;
      showNote(`Send failed: ${explainSendFailure(e.message)}`, true);
      console.error('[BCM] Send error:', e);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function showNote(text, isError) {
    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;
    const note = el('div', { cls: isError ? 'bcm-errnote' : 'bcm-offnote' }, text);
    list.appendChild(note);
    scrollMsgs();
    setTimeout(() => note.remove(), 8000);
  }

  function explainSendFailure(rawError) {
    const msg = String(rawError || '').trim();
    if (!msg) return 'server returned an error';
    if (/blocked/i.test(msg)) return 'message not delivered — this member has blocked you';
    return msg;
  }

  function onInputChange(e) {
    autoResize(e);
    const draftKey = state.selectedContact ? String(state.selectedContact) : (state.selectedGroup ? ('g_' + state.selectedGroup) : null);
    if (draftKey) {
      clearTimeout(state.draftSaveTimers[draftKey]);
      state.draftSaveTimers[draftKey] = setTimeout(() => saveDraft(draftKey, e.target.value.trim()), 500);
    }
    if (state.sendTypingIndicators && state.selectedContact && !state.typingSendTimer && e.target.value.trim()) {
      sendTypingIndicator(state.selectedContact);
      state.typingSendTimer = setTimeout(() => { state.typingSendTimer = null; }, 3000);
    } else if (state.sendTypingIndicators && state.selectedGroup && !state.typingSendTimer && e.target.value.trim() && state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: 'typing', groupId: state.selectedGroup }));
      state.typingSendTimer = setTimeout(() => { state.typingSendTimer = null; }, 3000);
    }
    const cc = state.dialogEl?.querySelector('.bcm-charcount');
    if (cc) {
      const len = e.target.value.length;
      cc.textContent = `${len} / 5000`;
      cc.classList.toggle('warn', len > 4500);
    }
    if (state.selectedGroup) {
      const val = e.target.value;
      const caret = e.target.selectionStart ?? val.length;
      const textBefore = val.slice(0, caret);
      const atMatch = textBefore.match(/@(\w*)$/);
      if (atMatch) {
        const query = atMatch[1].toLowerCase();
        const group = state.groups[state.selectedGroup];
        const members = group?.members
          ? normalizeGroupMembers(group.members)
              .map(m => ({ num: Number(m.member_number), name: getDisplayNameForMember(Number(m.member_number), `Member #${m.member_number}`) }))
              .filter(m => m.num !== state.memberNumber && (!query || m.name.toLowerCase().includes(query)))
              .slice(0, 8)
          : [];
        if (members.length) {
          closeMentionPanel();
          const inputRect = e.target.getBoundingClientRect();
          state.mentionPanelEl = el('div', { cls: 'bcm-mention-panel', style: {
            left: inputRect.left + 'px',
            bottom: (window.innerHeight - inputRect.top + 4) + 'px',
          }});
          for (const m of members) {
            const mName = m.name;
            const mNum = m.num;
            state.mentionPanelEl.appendChild(el('div', { cls: 'bcm-mention-item', onclick: ev => {
              ev.stopPropagation();
              const before = val.slice(0, caret - atMatch[0].length);
              const after = val.slice(caret);
              const ins = '@' + mName + ' ';
              e.target.value = before + ins + after;
              e.target.selectionStart = e.target.selectionEnd = (before + ins).length;
              if (!state.pendingMentions.includes(mNum)) state.pendingMentions.push(mNum);
              closeMentionPanel();
              e.target.focus();
              autoResize({ target: e.target });
            }}, mName));
          }
          document.documentElement.appendChild(state.mentionPanelEl);
          setTimeout(() => document.addEventListener('click', closeMentionPanel, { once: true }), 0);
        } else {
          closeMentionPanel();
        }
      } else {
        closeMentionPanel();
      }
    }
  }

  function onInputKeydown(e) {
    stopProp(e);
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  }

  function autoResize(e) {
    const t = e.target;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }

  function stopProp(e) { e.stopPropagation(); }


  async function promptAddContact() {
    state.selectedContact = null;
    state.selectedGroup = null;
    const leaveBtn = state.dialogEl?.querySelector('.bcm-leave-group-btn');
    if (leaveBtn) leaveBtn.style.display = 'none';
    const manageBtn = state.dialogEl?.querySelector('.bcm-manage-group-btn');
    if (manageBtn) manageBtn.style.display = 'none';
    updateDisappearingHeaderButton();
    updateReadReceiptHeaderButton();

    const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    const hDot = state.dialogEl?.querySelector('.bcm-msghead-dot');
    if (hName) hName.textContent = 'New Message';
    if (hStatus) hStatus.textContent = '';
    if (hDot) hDot.style.display = 'none';
    syncHeaderAvatarForContact(null, '', false);

    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;

    list.innerHTML = '';
    list.appendChild(
      el('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' } },
        el('div', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--bcm-accent)' } }, 'Start a new conversation'),
        el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'Enter username or nickname (member # optional)'),
        el('div', { cls: 'bcm-friend-label' }, 'Friends (click to start chat)'),
        el('div', { cls: 'bcm-friend-list' }),
        el('input', {
          cls: 'bcm-add-contact-input',
          type: 'text',
          placeholder: 'Username or nickname (e.g., Alice)',
          style: {
            padding: '8px 12px',
            border: '1px solid var(--bcm-border)',
            borderRadius: '6px',
            fontSize: '13px',
            background: 'var(--bcm-bg-input)',
            color: 'var(--bcm-text)',
            outline: 'none'
          },
          onkeydown: e => {
            if (e.key === 'Enter') {
              doAddContact(e.target.value.trim());
            }
          }
        }),
        el('div', { cls: 'bcm-member-results' }),
        el('div', { style: { display: 'flex', gap: '8px' } },
          el('button', {
            style: {
              flex: '1',
              padding: '8px',
              background: 'var(--bcm-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold'
            },
            onclick: () => {
              const input = list.querySelector('.bcm-add-contact-input');
              doAddContact(input?.value.trim());
            }
          }, 'Start Chat'),
          el('button', {
            style: {
              padding: '8px 16px',
              background: 'var(--bcm-bg-input)',
              color: 'var(--bcm-text)',
              border: '1px solid var(--bcm-border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            },
            onclick: () => {
              list.innerHTML = '';
              list.appendChild(el('div', { cls: 'bcm-empty' }, 'Select a contact to start messaging'));
              if (hName) hName.textContent = 'Select a contact';
            }
          }, 'Cancel')
        )
      )
    );

    const input = list.querySelector('.bcm-add-contact-input');
    const friendList = list.querySelector('.bcm-friend-list');
    const results = list.querySelector('.bcm-member-results');

    renderFriendListPicker(friendList, c => doAddContact(c.memberNum));

    try {
      const W = unsafeWindow;
      if (typeof W.ServerSend === 'function') W.ServerSend('AccountQuery', { Query: 'FriendList' });
    } catch {}
    setTimeout(() => renderFriendListPicker(friendList, c => doAddContact(c.memberNum)), 1500);

    if (input) {
      input.focus();
      input.addEventListener('input', () => {
        renderMemberLookupResults(results, input.value, c => {
          input.value = String(c.memberNum);
          doAddContact(c.memberNum);
        });
      });
    }
  }

  async function doAddContact(rawValue) {
    const resolved = await resolveMemberIdentifierWithChoice(rawValue);
    if (!resolved?.memberNum) {
      alert('Please enter a valid member number or known username/nickname.');
      return;
    }
    const num = resolved.memberNum;
    if (Number(num) === Number(state.memberNumber)) {
      await openAlert('You cannot start a conversation with yourself.');
      return;
    }
    const status = await getStatus(num);
    const statusName = getSafeDisplayName(status?.state.memberName, num, '');
    if (!statusName) {
      if (!confirm(`Member #${num} hasn't installed BC Messenger yet. Continue anyway?`)) return;
    }
    const name = getDisplayNameForMember(num, statusName || resolved?.name || `Member #${num}`);
    state.contactMeta[num] = { ...state.contactMeta[num], name, online: isMemberOnlineForUi(num, status?.isOnline), availability: status?.availability ?? 'online', lastSeen: status?.lastSeen ?? state.contactMeta[num]?.lastSeen, status: status?.status ?? state.contactMeta[num]?.status ?? '' };
    upsertContact(num, name);
    await refreshContactList();
    selectContact(num, name);
  }

  async function promptCreateGroup() {
    state.selectedContact = null;
    state.selectedGroup = null;
    const leaveBtn = state.dialogEl?.querySelector('.bcm-leave-group-btn');
    if (leaveBtn) leaveBtn.style.display = 'none';

    const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
    const hStatus = state.dialogEl?.querySelector('.bcm-msghead-status');
    const hDot = state.dialogEl?.querySelector('.bcm-msghead-dot');
    if (hName) hName.textContent = 'New Group';
    if (hStatus) hStatus.textContent = '';
    if (hDot) hDot.style.display = 'none';
    syncHeaderAvatarForContact(null, '', false);

    const list = state.dialogEl?.querySelector('.bcm-msglist');
    if (!list) return;

    list.innerHTML = '';
    list.appendChild(
      el('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' } },
        el('div', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--bcm-accent)' } }, 'Create a new group'),
        el('div', { style: { fontSize: '12px', color: 'var(--bcm-text-muted)' } }, 'Enter a group name and add members (# or username/nickname)'),
        el('input', {
          cls: 'bcm-group-name-input',
          type: 'text',
          placeholder: 'Group name',
          style: {
            padding: '8px 12px',
            border: '1px solid var(--bcm-border)',
            borderRadius: '6px',
            fontSize: '13px',
            background: 'var(--bcm-bg-input)',
            color: 'var(--bcm-text)',
            outline: 'none'
          }
        }),
        el('textarea', {
          cls: 'bcm-group-members-input',
          placeholder: 'Members (comma-separated, e.g., 12345, Alice, Bob)',
          style: {
            padding: '8px 12px',
            border: '1px solid var(--bcm-border)',
            borderRadius: '6px',
            fontSize: '13px',
            background: 'var(--bcm-bg-input)',
            color: 'var(--bcm-text)',
            outline: 'none',
            resize: 'vertical',
            minHeight: '60px',
            fontFamily: 'inherit'
          },
          oninput: async (e) => {
            const ta = e.target;
            const val = ta.value;
            const resultsEl = list.querySelector('.bcm-group-member-results');
            if (!resultsEl) return;
            const caret = ta.selectionStart ?? val.length;
            const textBefore = val.slice(0, caret);
            const lastComma = textBefore.lastIndexOf(',');
            const currentToken = textBefore.slice(lastComma + 1).trim();
            if (!currentToken || currentToken.length < 2) {
              resultsEl.innerHTML = '';
              return;
            }
            const tokenStart = lastComma >= 0 ? lastComma + 1 : 0;
            const candidates = await findMemberCandidates(currentToken, 6);
            resultsEl.innerHTML = '';
            for (const c of candidates) {
              const label = getSafeDisplayName(c.name, c.memberNum, '') || `Member #${c.memberNum}`;
              resultsEl.appendChild(el('div', {
                cls: 'bcm-member-result',
                onclick: () => {
                  const before = val.slice(0, tokenStart);
                  const after = val.slice(caret);
                  ta.value = before + label + after;
                  ta.focus();
                  const newCaret = before.length + label.length;
                  ta.selectionStart = ta.selectionEnd = newCaret;
                  resultsEl.innerHTML = '';
                },
              },
              el('div', {}, label),
              el('div', { cls: 'bcm-member-result-sub' }, buildMemberSearchLabel(c))));
            }
          },
        }),
        el('div', { cls: 'bcm-group-member-results', style: { maxHeight: '140px', overflowY: 'auto' } }),
        el('div', { style: { display: 'flex', gap: '8px' } },
          el('button', {
            style: {
              flex: '1',
              padding: '8px',
              background: 'var(--bcm-accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 'bold'
            },
            onclick: () => doCreateGroup(list)
          }, 'Create Group'),
          el('button', {
            style: {
              padding: '8px 16px',
              background: 'var(--bcm-bg-input)',
              color: 'var(--bcm-text)',
              border: '1px solid var(--bcm-border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px'
            },
            onclick: () => {
              list.innerHTML = '';
              list.appendChild(el('div', { cls: 'bcm-empty' }, 'Select a contact to start messaging'));
              if (hName) hName.textContent = 'Select a contact';
            }
          }, 'Cancel')
        )
      )
    );

    const nameInput = list.querySelector('.bcm-group-name-input');
    if (nameInput) nameInput.focus();
  }

  function extractJoinToken(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    // If a full URL was pasted, take the last path segment; otherwise the code itself.
    const m = s.match(/(?:^|\/)([A-Za-z0-9_-]{10,64})$/);
    if (m && (/^https?:\/\//i.test(s) || s.includes('/j/'))) return m[1];
    return s;
  }

  async function openJoinGroupDialog() {
    const raw = await openPrompt('Enter a group join code (or paste the invite link):', '');
    if (!raw) return;
    const token = extractJoinToken(raw);
    if (!token) {
      await openAlert('That doesn\'t look like a join code.');
      return;
    }

    let preview = null;
    try { preview = await getGroupJoinPreview(token); } catch {}
    if (!preview || preview?.error) {
      await openAlert(preview?.error || 'That join code is invalid or has expired.');
      return;
    }

    const ok = await openConfirm(
      `Join "${preview.groupName}"? (${preview.memberCount} member${preview.memberCount === 1 ? '' : 's'} — created by ${preview.createdByName || 'someone'}). An admin must approve your request.`
    );
    if (!ok) return;

    try {
      const r = await requestGroupJoin(token, '');
      if (r?.alreadyMember) {
        showNote(`You're already a member of ${preview.groupName}`, false);
      } else if (r?.error) {
        await openAlert(r.error);
      } else {
        showNote(`📨 Join request sent to "${preview.groupName}" — an admin will review it`, false);
      }
    } catch (ex) {
      await openAlert(`Failed to request join: ${ex.message}`);
    }
  }

  async function doCreateGroup(list) {
    const nameInput = list.querySelector('.bcm-group-name-input');
    const membersInput = list.querySelector('.bcm-group-members-input');

    const groupName = nameInput?.value.trim();
    if (!groupName) {
      alert('Please enter a group name.');
      nameInput?.focus();
      return;
    }

    const memberInput = membersInput?.value.trim();
    if (!memberInput) {
      alert('Please enter at least one member number.');
      membersInput?.focus();
      return;
    }

    const tokens = memberInput.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    const memberNumbers = [];
    const unresolved = [];
    for (const token of tokens) {
      const resolved = await resolveMemberIdentifierWithChoice(token);
      const n = Number(resolved?.memberNum);
      if (!n || n === state.memberNumber) {
        unresolved.push(token);
        continue;
      }
      if (!memberNumbers.includes(n)) memberNumbers.push(n);
    }
    if (memberNumbers.length === 0) {
      alert('Please enter at least one valid member (# or known username/nickname).');
      membersInput?.focus();
      return;
    }
    if (unresolved.length) {
      const proceed = confirm(`Could not resolve: ${unresolved.join(', ')}\nContinue without them?`);
      if (!proceed) {
        membersInput?.focus();
        return;
      }
    }

    try {
      const result = await createGroup(groupName, memberNumbers);
      if (result?.success) {
        list.innerHTML = '';
        list.appendChild(el('div', { cls: 'bcm-empty' }, `Group "${groupName}" created! Waiting for server update...`));
      } else {
        alert(`Failed to create group: ${result?.error ?? 'Unknown error'}`);
      }
    } catch (e) {
      alert(`Failed to create group: ${e.message}`);
      console.error('[BCM] Create group error:', e);
    }
  }

  async function confirmLeaveGroup(groupId) {
    const group = state.groups[groupId];
    if (!group) return;

    if (!confirm(`Are you sure you want to leave "${group.name}"? You won't be able to see messages anymore.`)) {
      return;
    }

    try {
      const result = await removeGroupMember(groupId, state.memberNumber);
      if (result?.success) {
        delete state.groups[groupId];
        await deleteGroup(groupId);
        state.selectedGroup = null;
        state.selectedContact = null;
        refreshContactList();
        const list = state.dialogEl?.querySelector('.bcm-msglist');
        if (list) list.innerHTML = '';
        const hName = state.dialogEl?.querySelector('.bcm-msghead-name');
        if (hName) hName.textContent = 'Select a contact';
        syncHeaderAvatarForContact(null, '', false);
        alert(`You have left "${group.name}"`);
      } else {
        alert(`Failed to leave group: ${result?.error ?? 'Unknown error'}`);
      }
    } catch (e) {
      alert(`Failed to leave group: ${e.message}`);
      console.error('[BCM] Leave group error:', e);
    }
  }


  function updateHTMLBadge() {
    const dmTotal = Object.values(state.unread).reduce((a, b) => a + b, 0);
    const groupTotal = Object.values(state.groupUnread).reduce((a, b) => a + b, 0);
    const total = dmTotal + groupTotal;
    if (state.htmlBadgeEl) {
      state.htmlBadgeEl.textContent = total > 9 ? '9+' : String(total);
      state.htmlBadgeEl.style.setProperty('display', total > 0 ? 'block' : 'none', 'important');
    }
    const clearBtn = state.dialogEl?.querySelector('.bcm-clearall-btn');
    if (clearBtn) clearBtn.style.display = total > 0 ? 'inline-block' : 'none';
    updateTabTitle();
    if (state.loggedIn) {
      GM_setValue(state.STORE + 'unread', JSON.stringify(state.unread));
      GM_setValue(state.STORE + 'groupUnread', JSON.stringify(state.groupUnread));
    }
  }

  function updateTabTitle() {
    const dmTotal = Object.values(state.unread).reduce((a, b) => a + b, 0);
    const groupTotal = Object.values(state.groupUnread).reduce((a, b) => a + b, 0);
    const total = dmTotal + groupTotal;
    document.title = total > 0 ? `\u{1F4AC}(${total}) ${state.origTitle}` : state.origTitle;
  }


  function onLogin() {
    state.loggedIn     = true;
    state.origTitle    = document.title;
    state.memberNumber = unsafeWindow.Player.MemberNumber;
    state.memberName   = unsafeWindow.Player.Name || `Member ${state.memberNumber}`;
    applyAccountScope(state.memberNumber);
    loadAccountScopedSettings();
    loadFromExtensionSettings();
    initE2E().catch(() => {});
    setupHtmlTrigger();
    registerAwayActivityTracking();
    updateAwayIndicator();
    requestNotificationPermission();
    // Fix any legacy invite messages that got stored as 'sent' so they never re-beep
    fixLegacyInviteMessages();

    if (!state.roomHookRegistered) {
      state.roomHookRegistered = true;
      let modHooked = false;
      try {
        mod.hookFunction('ChatRoomSearchResponse', 0, (args, next) => {
          try { onRoomSearchResult(args[0]); } catch {}
          return next(args);
        });
        modHooked = true;
      } catch {}
      try {
        const sock = unsafeWindow.ServerSocket;
        if (sock) {
          for (const evt of ['ChatRoomSearchResult', 'ChatRoomSearchResponse']) {
            sock.off(evt, onRoomSearchResult);
            sock.on(evt,  onRoomSearchResult);
          }
        }
      } catch {}
    }

    if (!state.friendHookRegistered) {
      state.friendHookRegistered = true;
      try {
        const sock = unsafeWindow.ServerSocket;
        if (sock) {
          sock.off('AccountQueryResult', onAccountQueryResult);
          sock.on('AccountQueryResult',  onAccountQueryResult);
        }
      } catch {}
      setTimeout(() => {
        try { unsafeWindow.ServerSend('AccountQuery', { Query: 'FriendList' }); } catch {}
      }, 2000);
      setTimeout(() => resolveUnknownFriends(), 3500);
    }

    if (!state.keyShortcutRegistered) {
      state.keyShortcutRegistered = true;
      window.addEventListener('keydown', e => {
        const tag = (e.target?.tagName || '').toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable;
        const mod = e.ctrlKey || e.metaKey;

        if (e.altKey && (e.key === 'm' || e.key === 'M')) {
          e.preventDefault(); e.stopPropagation(); toggleDialog(); return;
        }

        if (!state.dialogOpen) return;

        if (e.key === 'Escape') {
          closeContextMenu(); closeMentionPanel();
          if (state.friendsPanelOpen || state.roomTabOpen || state.lobbyOpen || state.starredPanelOpen || state.collectionsPanelOpen) {
            closeAllPanels();
            const mainEl = state.dialogEl?.querySelector('.bcm-main');
            if (mainEl) mainEl.style.display = '';
          }
          return;
        }

        if (mod && e.key === 'k') {
          e.preventDefault(); state.dialogEl?.querySelector('.bcm-search')?.focus(); return;
        }
        if (mod && e.key === 'n' && !e.shiftKey) {
          e.preventDefault(); promptAddContact(); return;
        }
        if (mod && e.key === 'n' && e.shiftKey) {
          e.preventDefault(); promptCreateGroup(); return;
        }
        if ((mod || e.ctrlKey) && e.key === 'Enter' && isInput) {
          e.preventDefault(); sendMessage(); return;
        }
      }, true);
    }

    processScheduledMessages();
    processReminders();

    setTimeout(checkForUpdates, 5000);

    setTimeout(() => {
      const W = unsafeWindow;
      const friends = W.Player?.FriendList ?? [];
      for (const rawNum of friends) {
        const num = parseInt(rawNum, 10);
        if (num && state.bcFriendCache[num]?.online) pingBCMPresence(num);
      }
      // Initial relay-status poll so contacts show correct online state right away
      pollBulkRelayStatus();
    }, 3000);

    if (!GM_getValue(state.STORE + 'onboarded', false)) {
      setTimeout(async () => {
        buildDialog();
        applyTheme(state.currentTheme);
        await openModal({
          title: 'Welcome to BC Messenger',
          body: el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px', color: 'var(--bcm-text)' } },
            el('p', {}, 'BC Messenger adds persistent private messaging to Bondage Club with offline delivery, group chat, and modern messaging tools.'),
            el('p', {}, el('strong', {}, 'Getting started:'), ' Click a contact on the left sidebar or use the + New message button.'),
            el('p', {}, el('strong', {}, 'Settings:'), ' Open gear icon (⚙) to customize theme, notifications, privacy controls, and your profile.'),
            el('p', {}, el('strong', {}, 'Keyboard shortcuts:'), ' Alt+M to toggle the messenger, Ctrl+K to search, Ctrl+N for new message, Escape to close panels.'),
            el('p', {}, el('strong', {}, 'Privacy:'), ' Use "Hide last-seen" and the blocked members list under Settings → Privacy & Safety.'),
          ),
          buttons: [
            { label: 'Got it!', primary: true, value: true },
          ],
        });
      }, 2000);
      GM_setValue(state.STORE + 'onboarded', true);
    }

    function checkDndSchedule() {
      if (!state.dndStartTime || !state.dndEndTime) return;
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = state.dndStartTime.split(':').map(Number);
      const [eh, em] = state.dndEndTime.split(':').map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;
      const startMinutes = sh * 60 + sm;
      const endMinutes = eh * 60 + em;
      let inDndWindow;
      if (endMinutes > startMinutes) {
        inDndWindow = currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        inDndWindow = currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }
      if (inDndWindow && state.availabilityState !== 'dnd') {
        state.previousAvailability = state.availabilityState;
        state.availabilityState = 'dnd';
        if (state.loggedIn) setAvailability('dnd', state.dndStartTime, state.dndEndTime).catch(() => {});
      } else if (!inDndWindow && state.availabilityState === 'dnd') {
        state.availabilityState = state.previousAvailability || 'online';
        if (state.loggedIn) setAvailability(state.availabilityState, state.dndStartTime, state.dndEndTime).catch(() => {});
      }
    }
    checkDndSchedule();
    setInterval(checkDndSchedule, 60000);

    setInterval(() => {
      if (!state.loggedIn || !state.selectedContact || !state.dialogOpen) return;
      getStatus(state.selectedContact).then(s => updateContactHeader(state.selectedContact, s));
    }, 30000);

    setInterval(() => {
      if (!state.loggedIn) return;
      // Force BC to refresh its friend list so online/offline status stays current
      try { unsafeWindow.ServerSend?.('AccountQuery', { Query: 'FriendList' }); } catch {}
      // Also poll the relay for BCM-specific online status
      pollBulkRelayStatus();
    }, 30000);

    // Poll W.Character every 3 seconds to detect when someone leaves the current room.
    // This is the most reliable way to catch disconnects regardless of BC version.
    let prevRoomNums = new Set();
    setInterval(() => {
      if (!state.loggedIn) return;
      try {
        const W = unsafeWindow;
        const chars = W.Character ?? [];
        const currentNums = new Set(chars.map(c => Number(c?.MemberNumber)).filter(Boolean));
        for (const n of prevRoomNums) {
          if (!currentNums.has(n) && n !== state.memberNumber) {
            // This person just left the room — mark them offline immediately
            markMemberOffline(n);
          }
        }
        prevRoomNums = currentNums;
      } catch {}
    }, 3000);

    const scheduleConnectivityRetry = (delayMs = INITIAL_RECONNECT_RETRY_MS) => {
      setTimeout(async () => {
        if (!state.loggedIn) return scheduleConnectivityRetry(INITIAL_RECONNECT_RETRY_MS);
        if (state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING)) {
          return scheduleConnectivityRetry(delayMs);
        }
        try {
          await ensureDbReady();
        } catch (e) {
          console.warn('[BCM] IndexedDB not ready yet:', e?.message ?? e);
          return scheduleConnectivityRetry(Math.min(delayMs * 2, MAX_RECONNECT_RETRY_MS));
        }
        const ok = await register();
        if (ok) {
          if (!state.ws) connectWs();
          const wsStarted = !!state.ws && (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING);
          return scheduleConnectivityRetry(wsStarted ? INITIAL_RECONNECT_RETRY_MS : Math.min(delayMs * 2, MAX_RECONNECT_RETRY_MS));
        }
        return scheduleConnectivityRetry(Math.min(delayMs * 2, MAX_RECONNECT_RETRY_MS));
      }, delayMs);
    };
    scheduleConnectivityRetry(INITIAL_RECONNECT_RETRY_MS);

    ensureDbReady()
      .then(async () => { await refreshContactList(); return register(); })
      .then(async ok => {
        if (ok) { connectWs(); }
        else console.warn('[BCM] Registration failed — messages will not send');
        if (ok) {
          await refreshBlockedMembersCache();
          try { await syncServerBackedState(); } catch {}
          const localContacts = await getAllContacts();
          if (!localContacts.length) {
            try {
              await syncHistoryFromServer(500);
              await refreshContactList();
            } catch {}
          }
        }
      })
      .catch(e => {
        console.error('[BCM] Init error:', e);
      });
  }

  function pollForLogin() {
    const W = unsafeWindow;
    if (W.Player?.MemberNumber && !state.loggedIn) { onLogin(); return; }
    setTimeout(pollForLogin, 1000);
  }


  GM_registerMenuCommand('BCM: Toggle messenger', toggleDialog);
  GM_registerMenuCommand('BCM: Status', () => {
    const s = ['CONNECTING','OPEN','CLOSING','CLOSED'];
    openAlert(`BC Offline Messenger v${SCRIPT_VERSION}\nMember: ${state.memberNumber ?? 'not logged in'}\nServer: ${SERVER}\nWS: ${state.ws ? s[state.ws.readyState] : 'disconnected'}\nIDB: ${getDb() ? 'open' : 'closed'}`);
  });
  GM_registerMenuCommand('BCM: Reset identity', () => {
    if (!confirm('Generate a new client secret?\nYou will be treated as a new user on the server.')) return;
    GM_setValue(state.STORE + 'secret', '');
    location.reload();
  });


  loadModSDK().then(sdk => {
    try {
      if (sdk) {
        const mod = sdk.registerMod({
          name: 'BCOfflineMessenger', fullName: 'BC Offline Messenger',
          version: '1.0.0', repository: 'https://github.com/khiles/BC-Messenger',
        });
        registerHooks(mod);
      } else {
        console.warn('[BCM] ModSDK not available — canvas button will not work');
      }
    } catch (e) {
      console.error('[BCM] Hook registration failed:', e);
    }
    scheduleBCExtensionRegistration();
    pollForLogin();
  });
