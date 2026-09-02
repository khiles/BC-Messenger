# BC Messenger

A Tampermonkey/Greasemonkey userscript that adds a modern private messaging layer to Bondage Club — persistent offline delivery, group chat, rich message controls, and a full inbox UI directly inside the game.

## Installation

Install via Tampermonkey or Greasemonkey:

```
https://raw.githubusercontent.com/khiles/BC-Messenger/main/bc-offline-messenger.user.js
```

Supported hosts: `bondageprojects.com` / `bondageprojects.elementfx.com`

---

## Features

### Core messaging

- Direct messages with **offline queueing** — messages are delivered when the recipient reconnects
- Real-time delivery over WebSocket when both users are online
- Delivery and read states (`sent` / `delivered` / `read`) with tick indicators
- 5000-character message limit with live counter
- Works with both BC send styles: **Beep** and **Whisper** (same-room)

### Group chat

- Create named group conversations
- Persistent group membership stored locally
- Group unread counters in sidebar
- Aggregate delivery/read receipt summary across all members
- Admin controls: rename, add members, remove/kick members, promote/demote roles
- **Join by code** — admins generate a shareable join code; non-members preview the group, request to join, and get approved/declined by an admin
- Leave group
- Group typing indicators
- `@mention` picker with per-mention delivery metadata

### Message composition

- Emoji picker panel
- **Sticker & GIF picker** — tabbed panel with a built-in sticker pack, your own uploads (PNG/GIF/WebP), and optional Giphy-backed GIF search (`GIPHY_API_KEY`)
- Quick replies — editable personal shortcut list
- Reply/quote flow with inline quote display
- Forward message to any contact or group
- Spoiler messages — hidden until the recipient reveals them
- One-time messages — deleted from both sides after first view
- Per-conversation disappearing messages with configurable TTL
- Schedule send with a full scheduled-queue management panel

### Message interaction

- **Reactions** — multiple emoji per message (one per person) shown as `emoji ×N` chips, with a quick-pick row of 8 defaults, a full searchable grid of 140+ emojis, and a "who reacted" viewer
- Star / unstar messages (starred panel in sidebar)
- Pin / unpin messages per conversation with a pinned banner
- All-pinned-messages panel per conversation
- Edit your sent messages with edit history viewer
- Delete your sent messages
- **Multi-select mode** — right-click → "☑️ Select messages", then bulk-delete or bulk-star

### Message rendering

- **Markdown formatting:**
  - `*emote text*` — full-message emote (italic, muted colour)
  - `**bold**`
  - `*italic*`
  - `` `inline code` `` — monospace with subtle background
  - `~~strikethrough~~`
  - `> blockquote` — left-bordered quote block
- **Link previews** — OG title, description, image, and domain fetched and rendered below any URL
- Inline media embeds: images, video files, YouTube links
- URL auto-linking

### Reminders & automation

- **⏰ Remind me** — right-click any message to set a reminder (30 min / 1 h / 4 h / 8 h / 1 day); fires a toast at the chosen time and persists across page reloads
- **🔔 Keyword alerts** — define words that always trigger a highlighted amber toast, even when a conversation is muted or DND is on
- **🤖 Auto-responder rules** — keyword-triggered or any-message auto-replies, independent of AFK mode
- **AFK auto-reply** — configurable timeout, custom message, sent once per sender per AFK session

### Broadcast

- **📣 Broadcast** — write one message and send it to any selection of your contacts at once, via the `⋯` panel

### Conversation organisation

- **Folders** — assign contacts to named folders; filter the sidebar by folder
- **Snooze** — hide a conversation for 30 min / 1 h / 4 h / Tomorrow / 1 week; visible under a Snoozed filter tab
- **Archive** — move conversations out of the main list; restore from Settings
- Sidebar search and filter
- In-conversation message search with next/previous jump
- Global message search across all conversations
- Export conversation as plain text or HTML
- Contact context menu: pin, mute, edit, folder, snooze, archive, block, report, delete history

### Unread panel

- **📬 Unread** — dedicated panel listing every conversation with unread messages, sorted by most recent
- Shows avatar, name, last snippet, timestamp, and unread count badge
- Click any row to jump straight to that conversation
- Mark all as read in one click

### Collections

- Save any message to a named collection (e.g. "favourites", "funny", "read later")
- **Collections panel** with drill-down:
  - List view — all collections with message counts
  - Detail view — saved messages with sender, timestamp, and remove button
  - Back button returns to the list

### Who's Online list

- **Online count chip** on the trigger button showing how many contacts are online right now
- **Sort control** on the Online section — cycle between Recent / Name / Availability
- **Richer contact rows** for online contacts:
  - Availability badge (🟡 Away / 🔴 DND)
  - Custom status text or 📍 current room as a third line
- **Hover quick-actions** on every contact row: 💬 open chat and 👤 view profile

### Contacts & presence

- Start a conversation by member number, username, or nickname
- **📥 Import BC Friends** — one-click modal to bulk-import BC friends not yet in your contacts
- Ambiguous-name resolver for duplicate display names
- Contact profile editing: display name, notes, avatar URL
- Profile card with full presence info
- Presence: online/offline dot, last seen, custom status, room name from BC friend data

### Notifications

- In-app toast pop-ups with click-to-open
- Notification sound toggle
- Browser/system notifications when the tab is hidden
- DND mode — suppresses toasts and sound while still allowing system notifications
- Per-contact override: always notify / never notify
- **Keyword alerts** — amber toasts that bypass mute and DND for important words

### Privacy & safety

- Block / unblock members (context menu and Settings)
- Abuse reporting with submitted report history
- Hide your last-seen timestamp
- Per-conversation read receipt disable
- Trusted contacts list
- One-time and disappearing messages

### Appearance & UX

- **Theme presets:** Light, Dark, Midnight, Lavender
- **Custom theme** — pick any accent, background, and sidebar colour with live preview
- Font size control
- Draggable and resizable window with persisted size
- **Tabbed Settings** — General / Notifications / Profile / Privacy / Connection
- **`⋯` panel** — persistent collapsible bar giving quick access to all panels (Friends, Room, Lobby, Starred, Collections, Unread) and actions (Import, Broadcast); open/closed state saved across sessions
- Unread badge on the trigger button

### BC integration

- Friends panel — BC friend list inside the messenger
- Room users panel
- Lobby browser with room-join helpers
- Typing indicators (send and receive, both toggleable)
- Read receipts (send and display, both toggleable)
- Userscript menu commands: Toggle messenger, Status, Reset identity

### Data & sync

- IndexedDB local storage for messages, contacts, and groups
- Account-scoped — supports multiple BC accounts safely
- Server sync checkpoint with manual "Sync history" action
- Settings backup and restore (JSON export/import)
- Clear local history
- Full account data deletion
- Reset client identity

---

## Server configuration

The relay reads settings from environment variables, or from a `.env` file placed next to `index.js` (`.env` is git-ignored):

- `GIPHY_API_KEY` — enables GIF search in the sticker/GIF picker (free key from developers.giphy.com). Without it, the picker shows a "GIF search is not enabled on this server" message.
- `PORT` — HTTP/WebSocket port (default `3748`).

---

> BC Messenger is a third-party enhancement and is not affiliated with or endorsed by the Bondage Club project.
