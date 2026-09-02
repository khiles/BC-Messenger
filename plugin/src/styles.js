// Static CSS for the messenger UI. Themed via CSS variables defined by themes.js

export const DIALOG_CSS = `
  .bcm-dialog-wrap {
    position:fixed!important; top:80px!important; left:50%!important;
    transform:translateX(-50%)!important; width:680px!important; max-width:95vw!important;
    height:500px!important; max-height:90vh!important;
    background:var(--bcm-bg)!important; border:1px solid var(--bcm-border)!important;
    border-radius:12px!important; display:none; flex-direction:column!important;
    z-index:2147483600!important; box-shadow:0 8px 40px rgba(0,0,0,.25)!important;
    font-family:Arial,sans-serif!important; color:var(--bcm-text)!important;
    overflow:hidden!important; pointer-events:all!important;
    font-size:var(--bcm-font-size)!important;
  }
  .bcm-dialog-wrap.bcm-open { display:flex!important; }
  .bcm-titlebar {
    background:var(--bcm-bg-title); padding:10px 14px;
    display:flex; align-items:center; justify-content:space-between;
    cursor:grab; border-bottom:1px solid var(--bcm-border); flex-shrink:0; gap:8px;
  }
  .bcm-titlebar:active{cursor:grabbing}
  .bcm-dtitle{font-size:14px;font-weight:bold;color:var(--bcm-accent)}
  .bcm-dclose{cursor:pointer;font-size:20px;color:var(--bcm-text-muted);padding:0 6px;border-radius:4px;line-height:1}
  .bcm-dclose:hover{color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-body{display:flex;flex:1;overflow:hidden;gap:0}
  .bcm-sidebar{width:220px;flex-shrink:0;border-right:1px solid var(--bcm-border);display:flex;flex-direction:column;background:var(--bcm-bg-side)}
  .bcm-search-wrap{display:flex;align-items:center;gap:6px;padding:10px 10px 8px;border-bottom:1px solid var(--bcm-border);flex-shrink:0}
  .bcm-search{flex:1;min-width:0;box-sizing:border-box;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:6px;padding:6px 8px;font-size:12px;outline:none}
  .bcm-search:focus{border-color:var(--bcm-accent)}
  .bcm-clearall-btn{padding:2px 5px;background:none;border:1px solid var(--bcm-border);color:var(--bcm-text-muted);border-radius:4px;cursor:pointer;font-size:10px;flex-shrink:0;white-space:nowrap;display:none}
  .bcm-clearall-btn:hover{border-color:var(--bcm-accent);color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-tab-row{display:flex;gap:6px;padding:7px 10px 2px;flex-shrink:0}
  .bcm-tab-btn{flex:1;padding:6px 4px;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text-muted);border-radius:7px;cursor:pointer;font-size:11px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-tab-btn:hover,.bcm-tab-btn.active{border-color:var(--bcm-accent);color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-friends-panel{flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--bcm-bg)}
  .bcm-friends-header{padding:8px 14px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);font-size:12px;font-weight:bold;color:var(--bcm-accent);display:flex;align-items:center;justify-content:space-between;gap:8px}
  .bcm-friends-search-row{padding:8px 10px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side)}
  .bcm-friends-search{flex:1;min-width:0;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:6px;padding:6px 8px;font-size:12px;outline:none}
  .bcm-friends-search:focus{border-color:var(--bcm-accent)}
  .bcm-friends-count{font-size:10px;color:var(--bcm-text-muted);flex-shrink:0}
  .bcm-friends-list{flex:1;overflow-y:auto;padding:10px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .bcm-friends-card{padding:10px;border:1px solid var(--bcm-border);border-radius:9px;background:var(--bcm-bg-side);display:flex;align-items:center;gap:8px;cursor:pointer}
  .bcm-friends-card:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-friends-meta{min-width:0;flex:1}
  .bcm-friends-name{font-size:13px;font-weight:bold;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-friends-sub{font-size:11px;color:var(--bcm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .bcm-friends-sub-user{font-size:10px;color:var(--bcm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;opacity:.9}
  .bcm-friends-sub-room{font-size:10px;color:#4a9eff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;opacity:.95}
  .bcm-starred-panel{flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--bcm-bg)}
  .bcm-collections-panel{flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--bcm-bg)}
  .bcm-starred-header{padding:8px 14px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);font-size:12px;font-weight:bold;color:var(--bcm-accent)}
  .bcm-starred-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px}
  .bcm-starred-item{padding:8px 10px;border:1px solid var(--bcm-border);border-radius:8px;background:var(--bcm-bg-side);cursor:pointer}
  .bcm-starred-item:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-starred-meta{font-size:10px;color:var(--bcm-text-muted);margin-bottom:2px}
  .bcm-starred-text{font-size:12px;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-clist{flex:1;overflow-y:auto}
  .bcm-contact{padding:10px 11px;cursor:pointer;border-bottom:1px solid var(--bcm-border);display:flex;align-items:center;gap:8px;transition:background .1s}
  .bcm-contact:hover{background:var(--bcm-bg-title)}
  .bcm-contact.active{background:var(--bcm-accent-bg)}
  .bcm-dot{width:8px;height:8px;border-radius:50%;background:var(--bcm-border);flex-shrink:0}
  .bcm-dot.online{background:var(--bcm-online)}
  .bcm-dot.away{background:#f5a623}
  .bcm-dot.dnd{background:#e03030}
  .bcm-group-icon{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
  .bcm-cinfo{flex:1;min-width:0}
  .bcm-cname{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--bcm-text);display:flex;align-items:center;gap:4px}
  .bcm-bcm-badge{flex-shrink:0;background:var(--bcm-accent);color:#fff;border-radius:4px;font-size:8px;font-weight:700;padding:1px 4px;letter-spacing:.3px;line-height:1.4;opacity:.85}
  .bcm-cprev{font-size:11px;color:var(--bcm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .bcm-cbadge{background:var(--bcm-accent);color:#fff;border-radius:10px;font-size:10px;font-weight:bold;padding:1px 5px;min-width:16px;text-align:center;flex-shrink:0}
  .bcm-pin-icon{font-size:10px;flex-shrink:0;opacity:0.7}
  .bcm-mute-icon{font-size:10px;flex-shrink:0;opacity:0.6}
  .bcm-scheduled-badge{font-size:10px;flex-shrink:0;opacity:0.7}
  .bcm-draft-icon{font-size:11px;flex-shrink:0;color:var(--bcm-accent);opacity:0.9}
  .bcm-profile-avatar{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden}
  .bcm-addbtn{margin:10px;padding:8px;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-accent);border-radius:7px;cursor:pointer;font-size:12px;flex-shrink:0}
  .bcm-addbtn:hover{background:var(--bcm-accent-bg);border-color:var(--bcm-accent)}
  .bcm-lobby-panel{flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--bcm-bg)}
  .bcm-lobby-current{padding:7px 14px;background:var(--bcm-accent-bg);border-bottom:1px solid var(--bcm-bubble-sent-b);font-size:11px;color:var(--bcm-accent);flex-shrink:0;display:flex;align-items:center;gap:6px}
  .bcm-lobby-current-name{font-weight:bold;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bcm-lobby-search-row{padding:7px 10px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);flex-shrink:0}
  .bcm-lobby-searchbox{flex:1;min-width:0;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none}
  .bcm-lobby-searchbox:focus{border-color:var(--bcm-accent)}
  .bcm-lobby-refresh{cursor:pointer;background:none;border:1px solid var(--bcm-border);border-radius:4px;padding:3px 8px;font-size:13px;color:var(--bcm-accent);flex-shrink:0}
  .bcm-lobby-count{font-size:10px;color:var(--bcm-text-muted);flex-shrink:0}
  .bcm-lobby-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px}
  .bcm-lobby-list::-webkit-scrollbar{width:3px}
  .bcm-lobby-list::-webkit-scrollbar-thumb{background:var(--bcm-border);border-radius:2px}
  .bcm-roomusers-panel{flex:1;display:none;flex-direction:column;overflow:hidden;background:var(--bcm-bg)}
  .bcm-roomusers-header{padding:8px 14px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .bcm-roomusers-title{font-size:12px;font-weight:bold;color:var(--bcm-accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
  .bcm-roomusers-refresh{cursor:pointer;background:none;border:1px solid var(--bcm-border);border-radius:4px;padding:3px 8px;font-size:13px;color:var(--bcm-accent);flex-shrink:0}
  .bcm-roomusers-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:4px}
  .bcm-roomusers-list::-webkit-scrollbar{width:3px}
  .bcm-roomusers-list::-webkit-scrollbar-thumb{background:var(--bcm-border);border-radius:2px}
  .bcm-roomuser{padding:7px 10px;border:1px solid var(--bcm-border);border-radius:8px;display:flex;align-items:center;gap:8px;background:var(--bcm-bg-side)}
  .bcm-roomuser.bcm-roomuser-me{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-roomuser-name{flex:1;font-size:12px;font-weight:bold;color:var(--bcm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bcm-roomuser-num{font-size:10px;color:var(--bcm-text-muted)}
  .bcm-roomuser-chat{background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-accent);padding:3px 8px;border-radius:5px;cursor:pointer;font-size:11px;flex-shrink:0}
  .bcm-roomuser-chat:hover{background:var(--bcm-accent-bg)}
  .bcm-roomuser-whisper{background:var(--bcm-gradient);border:none;color:#fff;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:11px;flex-shrink:0}
  .bcm-roomuser-whisper:hover{background:var(--bcm-gradient-h)}
  .bcm-room-item{padding:8px 10px;border:1px solid var(--bcm-border);border-radius:8px;display:flex;align-items:center;gap:8px;background:var(--bcm-bg-side)}
  .bcm-room-item.bcm-room-friend{border-color:var(--bcm-bubble-sent-b);background:var(--bcm-bubble-sent)}
  .bcm-room-item.bcm-room-current{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-room-info{flex:1;min-width:0}
  .bcm-room-name{font-size:12px;font-weight:bold;color:var(--bcm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bcm-room-meta{font-size:11px;color:var(--bcm-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
  .bcm-room-join{background:var(--bcm-gradient);border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;flex-shrink:0}
  .bcm-room-join:hover{background:var(--bcm-gradient-h)}
  .bcm-room-join:disabled{opacity:.5;cursor:default}
  .bcm-room-pin-btn{background:none;border:none;cursor:pointer;font-size:13px;color:var(--bcm-text-muted);padding:2px 4px;flex-shrink:0;line-height:1}
  .bcm-room-pin-btn:hover{color:#f5a623}
  .bcm-room-pin-btn.active{color:#f5a623}
  .bcm-pinned-rooms-header{font-size:10px;color:var(--bcm-text-muted);padding:4px 10px 2px;text-transform:uppercase;letter-spacing:.5px}
  .bcm-room-invite-card{display:flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;border:1px solid var(--bcm-border);background:var(--bcm-bg-side);cursor:pointer;font-size:12px;color:var(--bcm-text);text-align:left;width:100%}
  .bcm-room-invite-card:hover{border-color:var(--bcm-accent);color:var(--bcm-accent)}
  .bcm-main{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}
  .bcm-msghead{padding:11px 14px;border-bottom:1px solid var(--bcm-border);flex-shrink:0;background:var(--bcm-bg-side);display:flex;align-items:center;gap:9px}
  .bcm-msghead-avatar{width:28px;height:28px;border-radius:50%;border:1px solid var(--bcm-border);object-fit:cover;flex-shrink:0;background:var(--bcm-bg-input)}
  .bcm-msghead-avatar.online{outline:2px solid var(--bcm-online);outline-offset:1px}
  .bcm-msghead-avatar.away{outline:2px solid #f5a623;outline-offset:1px}
  .bcm-msghead-avatar.dnd{outline:2px solid #e03030;outline-offset:1px}
  .bcm-msghead-dot{width:9px;height:9px;border-radius:50%;background:var(--bcm-border);flex-shrink:0}
  .bcm-msghead-dot.online{background:var(--bcm-online)}
  .bcm-msghead-dot.away{background:#f5a623}
  .bcm-msghead-dot.dnd{background:#e03030}
  .bcm-msghead-main{display:flex;flex-direction:column;min-width:0;flex:1}
  .bcm-msghead-top{display:flex;align-items:center;gap:6px;min-width:0}
  .bcm-msghead-name{font-size:13px;font-weight:bold;color:var(--bcm-accent)}
  .bcm-e2e-indicator{font-size:11px;opacity:.85;margin-left:4px;flex-shrink:0;cursor:pointer;user-select:none}
  .bcm-e2e-indicator.bcm-e2e-changed{color:#d6334d;opacity:1;font-weight:600}
  .bcm-e2e-indicator.bcm-e2e-verified{color:#34c468}
  .bcm-msghead-status{font-size:11px;color:var(--bcm-text-muted);margin-top:1px}
  .bcm-msghead-status.online{color:var(--bcm-online)}
  .bcm-msghead-status.away{color:#f5a623}
  .bcm-msghead-status.dnd{color:#e03030}
  .bcm-header-btn,.bcm-export-btn,.bcm-search-btn,.bcm-leave-group-btn{cursor:pointer;font-size:15px;color:var(--bcm-text-muted);padding:2px 4px;border-radius:4px;line-height:1;flex-shrink:0;background:none;border:none}
  .bcm-header-btn:hover,.bcm-export-btn:hover,.bcm-search-btn:hover,.bcm-leave-group-btn:hover{color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-header-btn.active{color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-header-btn:disabled,.bcm-export-btn:disabled,.bcm-search-btn:disabled{opacity:.45;cursor:default}
  .bcm-notes-btn.has-note{color:var(--bcm-accent);font-weight:bold;background:var(--bcm-accent-bg)}
  .bcm-leave-group-btn{display:none}
  .bcm-notes-bar{display:none;padding:10px 12px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);flex-shrink:0}
  .bcm-notes-bar.open{display:block}
  .bcm-notes-text{width:100%;min-height:58px;max-height:120px;resize:vertical;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:8px;padding:8px 10px;font-size:12px;font-family:Arial,sans-serif;outline:none;box-sizing:border-box}
  .bcm-notes-text:focus{border-color:var(--bcm-accent)}
  .bcm-msgsearch-bar{display:none;padding:6px 10px;gap:6px;align-items:center;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);flex-shrink:0}
  .bcm-msgsearch-bar.open{display:flex}
  .bcm-msgsearch-input{flex:1;border:1px solid var(--bcm-border);border-radius:6px;padding:4px 8px;font-size:12px;background:var(--bcm-bg-input);color:var(--bcm-text);outline:none}
  .bcm-msgsearch-input:focus{border-color:var(--bcm-accent)}
  .bcm-msgsearch-nav{background:none;border:1px solid var(--bcm-border);color:var(--bcm-text-muted);border-radius:4px;padding:2px 7px;cursor:pointer;font-size:12px;flex-shrink:0}
  .bcm-msgsearch-nav:hover{border-color:var(--bcm-accent);color:var(--bcm-accent)}
  .bcm-msgsearch-count{font-size:11px;color:var(--bcm-text-muted);flex-shrink:0;min-width:40px;text-align:center}
  .bcm-msgsearch-close{background:none;border:none;color:var(--bcm-text-muted);cursor:pointer;font-size:16px;flex-shrink:0;padding:0 2px}
  .bcm-msgsearch-close:hover{color:var(--bcm-accent)}
  .bcm-highlight{background:#ffe066;border-radius:2px;padding:0 1px;color:#1a1a1a}
  .bcm-highlight.active{background:#ffb020;color:#1a1a1a}
  .bcm-msglist{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:6px;background:var(--bcm-bg)}
  .bcm-quote-bar{display:none;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side)}
  .bcm-quote-text{flex:1;font-size:11px;color:var(--bcm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-quote-clear{background:none;border:none;color:var(--bcm-text-muted);font-size:14px;cursor:pointer}
  .bcm-quote-clear:hover{color:var(--bcm-accent)}
  .bcm-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--bcm-text-muted);font-size:13px;text-align:center;padding:20px}
  .bcm-date-sep{text-align:center;font-size:11px;color:var(--bcm-text-muted);padding:6px 0 2px;position:relative;margin:2px 0;flex-shrink:0}
  .bcm-date-sep::before,.bcm-date-sep::after{content:'';position:absolute;top:50%;width:calc(50% - 40px);height:1px;background:var(--bcm-border)}
  .bcm-date-sep::before{left:0}
  .bcm-date-sep::after{right:0}
  .bcm-bubble{max-width:72%;padding:8px 12px;border-radius:14px;line-height:1.45;word-break:break-word;font-size:var(--bcm-font-size);position:relative}
  .bcm-bubble.is-starred{box-shadow:0 0 0 1px #ffcf5a inset}
  .bcm-bubble.has-reaction{margin-bottom:10px}
  .bcm-bubble.sent{align-self:flex-end;background:var(--bcm-bubble-sent);border:1px solid var(--bcm-bubble-sent-b);color:var(--bcm-text);border-bottom-right-radius:4px}
  .bcm-bubble.recv{align-self:flex-start;background:var(--bcm-bubble-recv);border:1px solid var(--bcm-bubble-recv-b);color:var(--bcm-text);border-bottom-left-radius:4px}
  .bcm-bubble a{color:var(--bcm-accent);word-break:break-all}
  .bcm-msg-content{white-space:normal}
  .bcm-embed-wrap{margin-top:6px;max-width:100%}
  .bcm-embed-wrap img{max-width:100%;max-height:260px;border-radius:8px;display:block}
  .bcm-embed-wrap video{max-width:100%;max-height:260px;border-radius:8px;display:block;background:#000}
  .bcm-embed-wrap iframe{width:min(100%,420px);height:236px;border:0;border-radius:8px;display:block;background:#000}
  .bcm-react-btn{position:absolute;top:-10px;right:-10px;border:1px solid var(--bcm-border);background:var(--bcm-bg);color:var(--bcm-text);border-radius:999px;padding:1px 6px;font-size:12px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .12s ease}
  .bcm-bubble:hover .bcm-react-btn{opacity:1;pointer-events:auto}
  .bcm-reaction-row{position:absolute;bottom:-11px;right:10px;display:flex;align-items:center;gap:3px;padding:2px;border-radius:999px;background:var(--bcm-bg);border:1px solid var(--bcm-border);box-shadow:0 1px 4px rgba(0,0,0,.2);cursor:pointer}
  .bcm-bubble.recv .bcm-reaction-row{left:10px;right:auto}
  .bcm-reaction-chip{display:flex;align-items:center;gap:2px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;border:1px solid transparent;background:none;color:var(--bcm-text);font-size:12px;line-height:1;cursor:pointer}
  .bcm-reaction-chip:hover{background:var(--bcm-accent-bg)}
  .bcm-reaction-chip-mine{background:var(--bcm-accent-bg);border-color:var(--bcm-accent)}
  .bcm-reaction-count{font-size:10px;color:var(--bcm-text-muted)}
  .bcm-reaction-add{display:flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;border:1px dashed var(--bcm-border);background:none;color:var(--bcm-text-muted);font-size:12px;line-height:1;cursor:pointer;padding:0}
  .bcm-reaction-add:hover{border-color:var(--bcm-accent);color:var(--bcm-accent)}
  .bcm-react-item-active{background:var(--bcm-accent);color:#fff}
  .bcm-react-who-head{font-size:12px;font-weight:600;color:var(--bcm-accent);margin:6px 0 2px}
  .bcm-star-chip{position:absolute;top:-8px;left:-8px;font-size:12px}
  .bcm-quote-inline{margin-bottom:6px;padding:5px 7px;border-left:3px solid var(--bcm-accent);background:var(--bcm-bg-side);border-radius:6px;font-size:11px}
  .bcm-quote-clickable{cursor:pointer;transition:background .15s}
  .bcm-quote-clickable:hover{background:var(--bcm-accent-bg)}
  .bcm-poll-container{border:1px solid var(--bcm-border);border-radius:10px;padding:12px;margin-bottom:6px;background:var(--bcm-bg-side)}
  .bcm-poll-question{font-weight:bold;font-size:14px;margin-bottom:10px;color:var(--bcm-text)}
  .bcm-poll-body{display:flex;flex-direction:column;gap:6px}
  .bcm-poll-option{padding:10px 14px;border:2px solid var(--bcm-border);border-radius:8px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:10px;position:relative;overflow:hidden;min-height:42px;transition:border-color .15s,background .15s}
  .bcm-poll-option:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-poll-option.bcm-poll-voted{cursor:default}
  .bcm-poll-option.bcm-poll-my-vote{border-color:var(--bcm-accent)!important;background:var(--bcm-accent-bg)!important;box-shadow:0 0 0 2px var(--bcm-accent);font-weight:600}
  .bcm-poll-option.bcm-poll-closed{opacity:.6;cursor:default}
  .bcm-poll-opt-label{font-size:13px;color:var(--bcm-text);position:relative;z-index:1;flex-shrink:0}
  .bcm-poll-bar-wrap{flex:1;height:28px;background:var(--bcm-bg-input);border-radius:6px;position:relative;overflow:hidden;min-width:60px}
  .bcm-poll-bar{position:absolute;left:0;top:0;bottom:0;background:var(--bcm-accent);opacity:.35;border-radius:6px;transition:width .4s ease}
  .bcm-poll-pct{position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:12px;font-weight:700;color:var(--bcm-text);z-index:1}
  .bcm-poll-votes-total{font-size:11px;color:var(--bcm-text-muted);text-align:center;margin-top:6px}
  .bcm-bubble.bcm-flash{animation:bcm-flash-anim .6s ease 2}
  @keyframes bcm-flash-anim{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 3px var(--bcm-accent)}}
  .bcm-quote-inline-sender{display:block;font-weight:bold;color:var(--bcm-accent);margin-bottom:1px}
  .bcm-react-panel{position:fixed;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:2147483610;padding:6px;display:flex;gap:4px;align-items:center;font-family:Arial,sans-serif}
  .bcm-react-item{border:none;background:none;cursor:pointer;font-size:17px;line-height:1;padding:4px;border-radius:6px}
  .bcm-react-item:hover{background:var(--bcm-accent-bg)}
  .bcm-sticker-btn{cursor:pointer;font-size:18px;padding:0 2px;border-radius:4px;flex-shrink:0;align-self:flex-end;background:none;border:none;line-height:34px;color:var(--bcm-text-muted)}
  .bcm-sticker-btn:hover{background:var(--bcm-accent-bg)}
  .bcm-sticker-panel{position:fixed;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:2147483610;padding:8px;font-family:Arial,sans-serif;pointer-events:all;width:300px}
  .bcm-sticker-tabs{display:flex;gap:4px;margin-bottom:6px}
  .bcm-sticker-tab{border:1px solid var(--bcm-border);background:var(--bcm-bg-side);color:var(--bcm-text-muted);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer}
  .bcm-sticker-tab.active{color:var(--bcm-accent);border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-sticker-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .bcm-sticker-upload{font-size:12px;color:var(--bcm-accent);border:1px dashed var(--bcm-accent);border-radius:6px;padding:2px 8px;cursor:pointer}
  .bcm-sticker-upload:hover{background:var(--bcm-accent-bg)}
  .bcm-sticker-hint{font-size:10px;color:var(--bcm-text-muted)}
  .bcm-sticker-grid,.bcm-gif-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-height:260px;overflow-y:auto}
  .bcm-sticker-item{width:100%;aspect-ratio:1;object-fit:contain;border:1px solid var(--bcm-border);border-radius:8px;background:var(--bcm-bg-side);cursor:pointer;padding:4px}
  .bcm-sticker-item:hover{border-color:var(--bcm-accent)}
  .bcm-sticker-loading{grid-column:1/-1;font-size:11px;color:var(--bcm-text-muted);text-align:center;padding:12px}
  .bcm-gif-searchrow{display:flex;gap:6px;margin-bottom:6px}
  .bcm-gif-search{flex:1;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none}
  .bcm-gif-search:focus{border-color:var(--bcm-accent)}
  .bcm-gif-item{width:100%;aspect-ratio:1;object-fit:cover;border:1px solid var(--bcm-border);border-radius:8px;cursor:pointer;background:var(--bcm-bg-side)}
  .bcm-gif-item:hover{border-color:var(--bcm-accent)}
  .bcm-gif-note{font-size:11px;color:var(--bcm-text-muted);text-align:center;padding:10px}
  .bcm-sticker-embed img{max-width:160px;max-height:160px;object-fit:contain}
  .bcm-sender-name{font-size:10px;font-weight:bold;color:var(--bcm-accent);margin-bottom:2px}
  .bcm-friend-label{font-size:11px;font-weight:bold;color:var(--bcm-text-muted);margin-top:2px}
  .bcm-friend-list{display:flex;flex-direction:column;gap:4px;max-height:170px;overflow-y:auto}
  .bcm-member-results{display:flex;flex-direction:column;gap:4px;max-height:130px;overflow-y:auto}
  .bcm-member-result{padding:6px 8px;border:1px solid var(--bcm-border);border-radius:6px;background:var(--bcm-bg-side);cursor:pointer;font-size:12px}
  .bcm-member-result:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-member-result-sub{font-size:10px;color:var(--bcm-text-muted);margin-top:2px}
  .bcm-join-code{padding:10px 14px;border:1px dashed var(--bcm-accent);border-radius:8px;font-family:monospace;font-size:15px;color:var(--bcm-accent);text-align:center;user-select:all;word-break:break-all}
  .bcm-btime{font-size:10px;color:var(--bcm-text-muted);margin-top:3px}
  .bcm-disappear-mark{margin-left:4px;color:var(--bcm-accent);font-weight:bold}
  .bcm-edited-mark{margin-left:4px;color:var(--bcm-text-muted);font-style:italic;font-size:10px}
  .bcm-bubble.sent .bcm-btime{text-align:right}
  .bcm-typing{color:var(--bcm-accent)!important;font-style:italic;animation:bcm-blink 1.2s ease-in-out infinite}
  @keyframes bcm-blink{0%,100%{opacity:1}50%{opacity:0.35}}
  .bcm-search-section-title{padding:8px 14px 4px 14px;font-size:11px;font-weight:600;color:#5a4870;text-transform:uppercase;letter-spacing:.5px}
  .bcm-search-result{padding:8px 14px;border-top:1px solid rgba(0,0,0,.04);cursor:pointer}
  .bcm-search-result:hover{background:var(--bcm-accent-bg)}
  .bcm-search-result-meta{font-size:10px;color:var(--bcm-text-muted);margin-bottom:2px}
  .bcm-search-result-text{font-size:12px;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-bubble.bcm-search-jump{animation:bcm-search-jump-flash 1.4s ease}
  @keyframes bcm-search-jump-flash{0%{box-shadow:0 0 0 2px rgba(196,48,96,.45)}100%{box-shadow:none}}
  .bcm-pin-banner{display:none;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);cursor:pointer;flex-shrink:0}
  .bcm-pin-banner.visible{display:flex!important}
  .bcm-pin-banner-icon{font-size:12px;flex-shrink:0;color:var(--bcm-accent)}
  .bcm-pin-banner-text{flex:1;font-size:11px;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-pin-banner-close{background:none;border:none;color:var(--bcm-text-muted);cursor:pointer;font-size:13px;flex-shrink:0;padding:0 3px;line-height:1}
  .bcm-pin-banner-close:hover{color:var(--bcm-accent)}
  .bcm-pin-all-btn{background:none;border:none;font-size:10px;color:var(--bcm-accent);cursor:pointer;flex-shrink:0;padding:0 2px;white-space:nowrap;text-decoration:underline}
  .bcm-pin-all-btn:hover{opacity:.75}
  .bcm-schedule-btn{cursor:pointer;font-size:14px;padding:0 6px;border-radius:4px;flex-shrink:0;align-self:flex-end;background:none;border:1px solid var(--bcm-border);line-height:30px;color:var(--bcm-text-muted)}
  .bcm-schedule-btn:hover{background:var(--bcm-accent-bg);border-color:var(--bcm-accent)}
  .bcm-scheduled-badge{display:inline-block;font-size:9px;font-weight:bold;color:#fff;background:var(--bcm-accent);border-radius:3px;padding:1px 3px;margin-left:3px;vertical-align:middle;line-height:1.3}
  .bcm-scheduled-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px}
  .bcm-scheduled-item{padding:8px 10px;border:1px solid var(--bcm-border);border-radius:8px;background:var(--bcm-bg-side);display:flex;gap:8px;align-items:flex-start}
  .bcm-scheduled-item-meta{font-size:10px;color:var(--bcm-text-muted);margin-bottom:2px}
  .bcm-scheduled-item-text{font-size:12px;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-scheduled-item-del{background:none;border:none;color:var(--bcm-text-muted);cursor:pointer;font-size:13px;flex-shrink:0;padding:0;line-height:1}
  .bcm-scheduled-item-del:hover{color:#e03030}
  .bcm-inputbar{padding:10px 12px 8px;border-top:1px solid var(--bcm-border);display:flex;flex-direction:column;gap:6px;flex-shrink:0;background:var(--bcm-bg-side)}
  .bcm-inputrow{display:flex;gap:8px;align-items:flex-end}
  .bcm-compose-toolbar{display:flex;align-items:center;gap:6px;padding-left:2px}
  .bcm-toolbar-spacer{flex:1}
  .bcm-compose-toolbar label{display:flex;align-items:center;gap:3px;cursor:pointer;user-select:none;font-size:11px;color:var(--bcm-text-muted)}
  .bcm-compose-toolbar input[type=radio]{accent-color:var(--bcm-accent);cursor:pointer}
  .bcm-emoji-btn{cursor:pointer;font-size:18px;padding:0 2px;border-radius:4px;flex-shrink:0;align-self:flex-end;background:none;border:none;line-height:34px;color:var(--bcm-text-muted)}
  .bcm-emoji-btn:hover{background:var(--bcm-accent-bg)}
  .bcm-qr-btn{cursor:pointer;font-size:16px;padding:0 2px;border-radius:4px;flex-shrink:0;align-self:flex-end;background:none;border:none;line-height:34px;color:var(--bcm-text-muted)}
  .bcm-qr-btn:hover{background:var(--bcm-accent-bg)}
  .bcm-compose-flag-btn{cursor:pointer;font-size:13px;padding:0 6px;border-radius:4px;flex-shrink:0;align-self:flex-end;background:none;border:1px solid var(--bcm-border);line-height:30px;color:var(--bcm-text-muted)}
  .bcm-compose-flag-btn:hover{background:var(--bcm-accent-bg);border-color:var(--bcm-accent)}
  .bcm-compose-flag-btn.active{color:var(--bcm-accent);border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-spoiler-wrap{display:flex;flex-direction:column;gap:6px}
  .bcm-spoiler-reveal{font-size:11px;align-self:flex-start;border:1px solid var(--bcm-border);background:var(--bcm-bg-side);color:var(--bcm-text-muted);border-radius:6px;padding:2px 8px;cursor:pointer}
  .bcm-spoiler-content{filter:blur(4px);user-select:none;pointer-events:none;opacity:.85}
  .bcm-spoiler-wrap.revealed .bcm-spoiler-content{filter:none;opacity:1;user-select:text;pointer-events:auto}
  .bcm-spoiler-wrap.revealed .bcm-spoiler-reveal{display:none}
  .bcm-onetime-view-btn{font-size:11px;border:1px solid var(--bcm-border);background:var(--bcm-bg-side);color:var(--bcm-text-muted);border-radius:6px;padding:2px 8px;cursor:pointer;margin-top:6px}
  .bcm-onetime-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:2147483640}
  .bcm-onetime-card{max-width:min(680px,94vw);max-height:84vh;overflow:auto;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);padding:12px;display:flex;flex-direction:column;gap:10px}
  .bcm-onetime-title{font-size:13px;font-weight:bold;color:var(--bcm-accent)}
  .bcm-onetime-actions{display:flex;justify-content:flex-end;gap:8px}
  .bcm-onetime-actions button{border:1px solid var(--bcm-border);background:var(--bcm-bg-side);color:var(--bcm-text);border-radius:6px;padding:4px 10px;cursor:pointer}
  .bcm-emoji-panel,.bcm-qr-panel{position:fixed;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:2147483610;padding:8px;font-family:Arial,sans-serif;pointer-events:all}
  .bcm-emoji-panel{display:grid;grid-template-columns:repeat(8,28px);gap:2px}
  .bcm-emoji-item{font-size:18px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;border-radius:4px;transition:background .1s}
  .bcm-emoji-item:hover{background:var(--bcm-bg-side)}
  .bcm-qr-panel{min-width:200px;max-width:300px;display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto}
  .bcm-qr-item{padding:7px 10px;cursor:pointer;border-radius:6px;font-size:12px;color:var(--bcm-text);background:var(--bcm-bg-side);border:1px solid var(--bcm-border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-qr-item:hover{background:var(--bcm-accent-bg);border-color:var(--bcm-accent);color:var(--bcm-accent)}
  .bcm-input{flex:1;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:8px;padding:8px 10px;font-size:var(--bcm-font-size);font-family:Arial,sans-serif;resize:none;outline:none;min-height:36px;max-height:120px;line-height:1.4;overflow-y:auto}
  .bcm-input:focus{border-color:var(--bcm-accent)}
  .bcm-sendbtn{background:var(--bcm-gradient);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;flex-shrink:0;align-self:flex-end}
  .bcm-sendbtn:hover{background:var(--bcm-gradient-h)}
  .bcm-sendbtn:disabled{opacity:.45;cursor:default}
  .bcm-errnote{font-size:11px;color:var(--bcm-accent);text-align:center;padding:4px}
  .bcm-offnote{font-size:11px;color:var(--bcm-text-muted);text-align:center;padding:4px}
  .bcm-clist::-webkit-scrollbar,.bcm-msglist::-webkit-scrollbar{width:3px}
  .bcm-clist::-webkit-scrollbar-thumb,.bcm-msglist::-webkit-scrollbar-thumb{background:var(--bcm-border);border-radius:2px}
  .bcm-tick{font-size:11px;margin-left:3px}
  .bcm-tick-sent{color:var(--bcm-text-muted)}
  .bcm-tick-delivered{color:var(--bcm-text-muted)}
  .bcm-tick-read{color:var(--bcm-accent)}
  .bcm-group-receipt{margin-left:6px;font-size:10px;color:var(--bcm-text-muted)}
  .bcm-gear{cursor:pointer;font-size:15px;color:var(--bcm-text-muted);padding:0 6px;border-radius:4px;line-height:1;flex-shrink:0;background:none;border:none}
  .bcm-gear:hover{color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-ctx-menu{position:fixed;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:2147483620;min-width:155px;padding:4px 0;font-family:Arial,sans-serif;font-size:13px;pointer-events:all}
  .bcm-ctx-item{padding:8px 14px;cursor:pointer;color:var(--bcm-text);transition:background .1s;white-space:nowrap}
  .bcm-ctx-item:hover{background:var(--bcm-bg-side)}
  .bcm-ctx-danger{color:#e03030}
  .bcm-ctx-danger:hover{background:#fde8e8}
  .bcm-resize-handle{position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:se-resize;background:linear-gradient(135deg,transparent 50%,var(--bcm-border) 50%);border-bottom-right-radius:12px;z-index:10}
  .bcm-settings-wrap{
    position:fixed!important; top:50%!important; left:50%!important;
    transform:translate(-50%,-50%)!important; width:500px!important; max-width:96vw!important;
    background:var(--bcm-bg)!important; border:1px solid var(--bcm-border)!important;
    border-radius:12px!important; display:none; flex-direction:column!important;
    z-index:2147483630!important; box-shadow:0 8px 40px rgba(0,0,0,.25)!important;
    font-family:Arial,sans-serif!important; color:var(--bcm-text)!important;
    overflow:hidden!important; pointer-events:all!important;
  }
  .bcm-settings-wrap.bcm-open{display:flex!important}
  .bcm-settings-titlebar{background:var(--bcm-bg-title);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;cursor:grab;border-bottom:1px solid var(--bcm-border);flex-shrink:0}
  .bcm-settings-titlebar:active{cursor:grabbing}
  .bcm-settings-title{font-size:14px;font-weight:bold;color:var(--bcm-accent)}
  .bcm-settings-close{cursor:pointer;font-size:20px;color:var(--bcm-text-muted);padding:0 6px;border-radius:4px;line-height:1;background:none;border:none}
  .bcm-settings-close:hover{color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-settings-layout{display:flex;flex:1;overflow:hidden;min-height:0}
  .bcm-stab-nav{width:110px;flex-shrink:0;border-right:1px solid var(--bcm-border);background:var(--bcm-bg-side);display:flex;flex-direction:column;padding:8px 0;gap:2px;overflow-y:auto}
  .bcm-stab-btn{background:none;border:none;text-align:left;padding:9px 14px;font-size:12px;color:var(--bcm-text-muted);cursor:pointer;border-radius:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:Arial,sans-serif}
  .bcm-stab-btn:hover{color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-stab-btn.active{color:var(--bcm-accent);background:var(--bcm-accent-bg);font-weight:600;border-right:2px solid var(--bcm-accent)}
  .bcm-stab-pane{display:none;flex:1;overflow-y:auto;padding:14px 16px;flex-direction:column;gap:13px}
  .bcm-stab-pane.active{display:flex}
  .bcm-settings-body{padding:18px;display:flex;flex-direction:column;gap:13px;overflow-y:auto;flex:1;min-height:0}
  .bcm-settings-section{font-size:11px;font-weight:bold;color:var(--bcm-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
  .bcm-settings-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 0}
  .bcm-settings-label{font-size:13px;color:var(--bcm-text)}
  .bcm-settings-val{font-size:12px;color:var(--bcm-text-muted);text-align:right;flex:1}
  .bcm-toggle{position:relative;width:36px;height:20px;flex-shrink:0;cursor:pointer}
  .bcm-toggle input{opacity:0;width:0;height:0;position:absolute}
  .bcm-toggle-track{position:absolute;inset:0;background:var(--bcm-border);border-radius:10px;transition:background .2s}
  .bcm-toggle input:checked+.bcm-toggle-track{background:var(--bcm-accent)}
  .bcm-toggle-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
  .bcm-toggle input:checked~.bcm-toggle-thumb{left:18px}
  .bcm-settings-divider{border:none;border-top:1px solid var(--bcm-border);margin:4px 0}
  .bcm-settings-btn{flex:1;padding:8px 12px;border:1px solid var(--bcm-border);background:var(--bcm-bg-input);color:var(--bcm-text);border-radius:8px;cursor:pointer;font-size:12px;font-family:Arial,sans-serif}
  .bcm-settings-btn:hover{border-color:var(--bcm-accent);color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-settings-btn.danger:hover{border-color:#e03030;color:#e03030;background:#fde8e8}
  .bcm-settings-btnrow{display:flex;gap:8px}
  .bcm-settings-ver{font-size:11px;color:var(--bcm-text-muted);text-align:center;padding-top:4px}
  .bcm-theme-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
  .bcm-theme-swatch{border-radius:8px;padding:8px 4px;cursor:pointer;border:2px solid transparent;display:flex;flex-direction:column;align-items:center;gap:4px;transition:border-color .15s}
  .bcm-theme-swatch.active{border-color:var(--bcm-accent)}
  .bcm-theme-dot{width:24px;height:24px;border-radius:50%;flex-shrink:0}
  .bcm-theme-label{font-size:10px;color:var(--bcm-text-muted);text-align:center}
  .bcm-fontsize-row{display:flex;gap:6px}
  .bcm-fontsize-btn{flex:1;padding:6px;border:1px solid var(--bcm-border);background:var(--bcm-bg-input);color:var(--bcm-text-muted);border-radius:6px;cursor:pointer;text-align:center}
  .bcm-fontsize-btn.active{border-color:var(--bcm-accent);color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-qr-settings-list{display:flex;flex-direction:column;gap:4px}
  .bcm-qr-settings-item{display:flex;align-items:center;gap:6px;padding:4px 0}
  .bcm-qr-settings-text{flex:1;font-size:12px;color:var(--bcm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bcm-qr-settings-del{background:none;border:none;color:#e03030;cursor:pointer;font-size:14px;flex-shrink:0;padding:0 4px}
  .bcm-qr-add-row{display:flex;gap:6px;margin-top:4px}
  .bcm-qr-add-input{flex:1;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:6px;padding:5px 8px;font-size:12px;outline:none}
  .bcm-qr-add-input:focus{border-color:var(--bcm-accent)}
  .bcm-qr-add-btn{padding:5px 10px;background:var(--bcm-gradient);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;flex-shrink:0}
  .bcm-modal-body{font-size:13px;color:var(--bcm-text);white-space:pre-wrap;line-height:1.5}
  .bcm-modal-btn{padding:5px 14px;border-radius:6px;cursor:pointer;font-size:13px;border:1px solid var(--bcm-border);background:var(--bcm-bg-input);color:var(--bcm-text);font-family:Arial,sans-serif}
  .bcm-modal-btn:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-modal-btn.primary{background:var(--bcm-gradient);border-color:var(--bcm-accent);color:#fff}
  .bcm-modal-btn.primary:hover{background:var(--bcm-gradient-h)}
  .bcm-modal-btn.danger{border-color:#e03030;color:#e03030}
  .bcm-modal-btn.danger:hover{background:#fde8e8}
  .bcm-modal-input{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--bcm-border);border-radius:6px;background:var(--bcm-bg-input);color:var(--bcm-text);font-size:13px;outline:none;font-family:Arial,sans-serif;margin-top:8px}
  .bcm-modal-input:focus{border-color:var(--bcm-accent)}
  .bcm-member-row{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bcm-border);font-size:12px}
  .bcm-member-row:last-child{border-bottom:none}
  .bcm-member-row-name{flex:1;color:var(--bcm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bcm-member-row-role{font-size:11px;color:var(--bcm-text-muted);flex-shrink:0}
  .bcm-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:#fff;flex-shrink:0;text-transform:uppercase;overflow:hidden;border:1px solid rgba(0,0,0,.08)}
  .bcm-avatar.online{outline:2px solid var(--bcm-online);outline-offset:1px}
  .bcm-avatar.away{outline:2px solid #f5a623;outline-offset:1px}
  .bcm-avatar.dnd{outline:2px solid #e03030;outline-offset:1px}
  .bcm-avatar-img{width:100%;height:100%;object-fit:cover;display:block}
  .bcm-msglist-wrap{position:relative;flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0}
  .bcm-scroll-bottom-btn{position:absolute;bottom:12px;right:14px;width:30px;height:30px;border-radius:50%;background:var(--bcm-gradient);border:none;color:#fff;cursor:pointer;font-size:15px;display:none;align-items:center;justify-content:center;z-index:10;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:all}
  .bcm-scroll-bottom-btn.visible{display:flex}
  .bcm-charcount{font-size:10px;color:var(--bcm-text-muted);align-self:flex-end;padding-bottom:4px;flex-shrink:0;min-width:52px;text-align:right}
  .bcm-charcount.warn{color:var(--bcm-accent);font-weight:bold}
  .bcm-mention-panel{position:fixed;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.2);z-index:2147483610;min-width:160px;max-height:200px;overflow-y:auto;padding:4px 0;font-family:Arial,sans-serif}
  .bcm-mention-item{padding:7px 12px;cursor:pointer;font-size:12px;color:var(--bcm-text);white-space:nowrap}
  .bcm-mention-item:hover{background:var(--bcm-accent-bg);color:var(--bcm-accent)}
  .bcm-loadmore-btn{display:block;width:100%;padding:6px 10px;font-size:11px;color:var(--bcm-accent);background:var(--bcm-bg-side);border:1px solid var(--bcm-border);border-radius:6px;cursor:pointer;text-align:center;margin-bottom:6px;font-family:Arial,sans-serif;box-sizing:border-box}
  .bcm-loadmore-btn:hover{background:var(--bcm-accent-bg)}
  .bcm-loadmore-btn:disabled{opacity:.5;cursor:default}
  .bcm-globalsearch-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:flex-start;justify-content:center;padding-top:60px;z-index:2147483640;pointer-events:all}
  .bcm-globalsearch-card{width:min(560px,95vw);max-height:72vh;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.3);font-family:Arial,sans-serif}
  .bcm-globalsearch-header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--bcm-border);flex-shrink:0}
  .bcm-globalsearch-input{flex:1;background:var(--bcm-bg-input);border:1px solid var(--bcm-border);color:var(--bcm-text);border-radius:6px;padding:7px 10px;font-size:13px;outline:none;font-family:Arial,sans-serif}
  .bcm-globalsearch-input:focus{border-color:var(--bcm-accent)}
  .bcm-globalsearch-close{cursor:pointer;background:none;border:none;color:var(--bcm-text-muted);font-size:20px;padding:0 4px;flex-shrink:0;line-height:1}
  .bcm-globalsearch-close:hover{color:var(--bcm-accent)}
  .bcm-globalsearch-results{flex:1;overflow-y:auto;padding:8px}
  .bcm-globalsearch-group-label{font-size:10px;font-weight:bold;color:var(--bcm-text-muted);text-transform:uppercase;letter-spacing:.05em;padding:4px 4px 2px;margin-top:6px}
  .bcm-globalsearch-item{padding:7px 10px;border:1px solid var(--bcm-border);border-radius:8px;margin-bottom:4px;cursor:pointer;background:var(--bcm-bg-side)}
  .bcm-globalsearch-item:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  .bcm-globalsearch-item-text{font-size:12px;color:var(--bcm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bcm-globalsearch-item-meta{font-size:10px;color:var(--bcm-text-muted);margin-top:1px}
  .bcm-inline-edit-ta{width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid var(--bcm-accent);border-radius:6px;background:var(--bcm-bg-input);color:var(--bcm-text);font-family:Arial,sans-serif;font-size:var(--bcm-font-size);resize:none;outline:none;min-height:50px;line-height:1.4}
  .bcm-inline-edit-actions{display:flex;gap:6px;margin-top:4px;justify-content:flex-end}
  @media (max-width:540px){
    .bcm-dialog-wrap{width:98vw!important;height:94vh!important;top:3vh!important;left:1vw!important;transform:none!important;border-radius:8px!important}
    .bcm-sidebar{width:48px!important;min-width:48px!important;overflow:hidden!important}
    .bcm-sidebar.bcm-sidebar-expanded{width:220px!important;min-width:220px!important;position:absolute!important;left:0!important;top:0!important;bottom:0!important;z-index:10!important;box-shadow:4px 0 16px rgba(0,0,0,.25)!important;overflow:visible!important}
    .bcm-sidebar.bcm-sidebar-expanded .bcm-search-wrap{display:flex!important}
    .bcm-sidebar.bcm-sidebar-expanded .bcm-cname,.bcm-sidebar.bcm-sidebar-expanded .bcm-cprev{display:block!important}
    .bcm-sidebar.bcm-sidebar-expanded .bcm-addbtn-label{display:inline!important}
    .bcm-sidebar.bcm-sidebar-expanded .bcm-tab-btn{font-size:11px!important}
    .bcm-search-wrap{display:none!important}
    .bcm-cname,.bcm-cprev{display:none!important}
    .bcm-tab-row{flex-direction:column!important;gap:2px!important;padding:4px 4px!important}
    .bcm-tab-btn{padding:4px 2px!important;font-size:10px!important;overflow:hidden!important;text-overflow:clip!important}
    .bcm-addbtn{justify-content:center!important;padding:8px 4px!important}
    .bcm-addbtn-label{display:none!important}
    .bcm-mobile-expand-btn{display:block!important}
    .bcm-inputbar{padding:6px 6px!important}
    .bcm-msghead{padding:8px 8px!important;gap:6px!important}
  }
  /* ── WOL richer rows ─────────────────────────────────────────────────────── */
  .bcm-cstatus{font-size:10px;color:var(--bcm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
  .bcm-contact-actions{display:none;gap:3px;margin-left:auto;flex-shrink:0;align-items:center}
  .bcm-contact:hover .bcm-contact-actions{display:flex}
  .bcm-cact-btn{background:var(--bcm-accent-bg);border:none;border-radius:4px;padding:2px 5px;font-size:10px;color:var(--bcm-accent);cursor:pointer}
  .bcm-cact-btn:hover{background:var(--bcm-accent);color:#fff}
  /* ── WOL sort button ─────────────────────────────────────────────────────── */
  .bcm-section-hdr{display:flex;align-items:center;gap:4px;padding:8px 14px 4px 14px;font-size:11px;font-weight:600;color:#5a4870;text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;user-select:none}
  .bcm-sort-btn{background:none;border:1px solid var(--bcm-border);border-radius:4px;padding:1px 6px;font-size:9px;color:var(--bcm-text-muted);cursor:pointer;flex-shrink:0;margin-left:auto}
  .bcm-sort-btn:hover{color:var(--bcm-accent);border-color:var(--bcm-accent)}
  /* ── Markdown formatting ─────────────────────────────────────────────────── */
  .bcm-emote{font-style:italic;color:var(--bcm-text-muted)}
  .bcm-inline-code{font-family:monospace;background:var(--bcm-bg-side);padding:1px 4px;border-radius:3px;font-size:0.9em}
  .bcm-bubble blockquote{border-left:3px solid var(--bcm-accent);margin:2px 0 2px 0;padding:2px 8px;color:var(--bcm-text-muted);font-style:italic;background:none}
  /* ── Folder filter tabs ──────────────────────────────────────────────────── */
  .bcm-folder-tabs{display:flex;gap:4px;padding:5px 8px;border-bottom:1px solid var(--bcm-border);flex-wrap:wrap;flex-shrink:0}
  .bcm-folder-tab{background:var(--bcm-bg-side);border:1px solid var(--bcm-border);border-radius:10px;padding:2px 8px;font-size:10px;cursor:pointer;color:var(--bcm-text-muted);white-space:nowrap}
  .bcm-folder-tab.active{background:var(--bcm-accent);color:#fff;border-color:var(--bcm-accent)}
  /* ── Unread panel ────────────────────────────────────────────────────────── */
  .bcm-state.unread-panel{display:none;flex-direction:column;flex:1;overflow:hidden;background:var(--bcm-bg)}
  .bcm-state.unread-panel.active{display:flex}
  .bcm-state.unread-row{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--bcm-border)}
  .bcm-state.unread-row:hover{background:var(--bcm-accent-bg)}
  .bcm-state.unread-info{flex:1;min-width:0}
  .bcm-state.unread-name{font-size:12px;font-weight:600;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-state.unread-prev{font-size:11px;color:var(--bcm-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-state.unread-count{background:var(--bcm-accent);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px;font-weight:700;flex-shrink:0}
  .bcm-mark-all-btn{margin:8px;padding:5px 10px;background:var(--bcm-accent-bg);border:1px solid var(--bcm-accent);color:var(--bcm-accent);border-radius:6px;cursor:pointer;font-size:11px;align-self:flex-start}
  /* ── Collections drill-down ──────────────────────────────────────────────── */
  .bcm-back-btn{background:none;border:none;color:var(--bcm-accent);cursor:pointer;padding:6px 12px;font-size:12px;text-align:left;display:block}
  .bcm-coll-item{display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-bottom:1px solid var(--bcm-border)}
  .bcm-coll-meta{display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--bcm-text-muted)}
  .bcm-coll-text{font-size:12px;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-coll-remove{background:none;border:none;color:var(--bcm-text-muted);cursor:pointer;padding:0 4px;font-size:12px}
  .bcm-coll-remove:hover{color:#e03030}
  /* ── Update banner ── */
  .bcm-update-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#1a6b3a;color:#fff;font-size:11px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.15)}
  .bcm-update-bar a{color:#7fffb2;font-weight:700;text-decoration:underline;cursor:pointer;white-space:nowrap}
  .bcm-update-bar a:hover{color:#fff}
  .bcm-update-dismiss{margin-left:auto;background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:14px;line-height:1;padding:0 2px;flex-shrink:0}
  .bcm-update-dismiss:hover{color:#fff}
  /* ── Icon strip (replaces more-panel) ── */
  .bcm-icon-strip{display:flex;align-items:center;flex-wrap:wrap;gap:3px;padding:5px 8px;border-bottom:1px solid var(--bcm-border);flex-shrink:0;background:var(--bcm-bg-side)}
  .bcm-strip-btn{background:none;border:1px solid transparent;border-radius:5px;width:26px;height:26px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;line-height:1;opacity:.55;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}
  .bcm-strip-btn:hover{border-color:var(--bcm-accent);background:var(--bcm-accent-bg);opacity:1}
  .bcm-strip-btn.active{border-color:var(--bcm-accent);background:var(--bcm-accent-bg);opacity:1}
  .bcm-strip-sep{width:1px;height:18px;background:var(--bcm-border);margin:0 3px;flex-shrink:0;align-self:center}
  /* ── Header overflow dropdown ── */
  .bcm-overflow-wrap{position:relative;flex-shrink:0}
  .bcm-overflow-btn{font-weight:700;letter-spacing:1px;font-size:15px}
  .bcm-header-overflow{display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:170px;background:var(--bcm-bg);border:1px solid var(--bcm-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);z-index:100;padding:4px;flex-direction:column;gap:2px}
  .bcm-overflow-wrap.open .bcm-header-overflow{display:flex}
  .bcm-overflow-item{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:5px;border:none;background:none;cursor:pointer;font-size:12px;color:var(--bcm-text);text-align:left;white-space:nowrap;width:100%}
  .bcm-overflow-item:hover{background:var(--bcm-accent-bg);color:var(--bcm-accent)}
  /* ── Phase B: Keyword Alerts ── */
  .bcm-kw-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;min-height:24px}
  .bcm-kw-chip{display:flex;align-items:center;gap:4px;background:var(--bcm-accent-bg);border:1px solid var(--bcm-accent);border-radius:10px;padding:2px 8px;font-size:11px;color:var(--bcm-accent)}
  .bcm-kw-remove{background:none;border:none;color:var(--bcm-accent);cursor:pointer;font-size:11px;padding:0 2px;line-height:1}
  /* ── Phase B: Auto-Responder ── */
  .bcm-rule-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px;background:var(--bcm-bg-side);border-radius:6px;font-size:11px;margin-bottom:3px}
  .bcm-rule-label{flex:1;color:var(--bcm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  /* ── Phase B: Multi-select ── */
  .bcm-selection-bar{display:none;align-items:center;gap:8px;padding:6px 12px;background:var(--bcm-accent-bg);border-top:1px solid var(--bcm-accent);flex-shrink:0}
  .bcm-sel-count{font-size:11px;color:var(--bcm-accent);font-weight:600;margin-right:auto}
  .bcm-bubble.bcm-selected{outline:2px solid var(--bcm-accent);outline-offset:2px}
  /* ── Phase B: Emoji picker ── */
  .bcm-react-panel-full{width:230px!important;display:flex!important;flex-direction:column;gap:4px;padding:8px!important}
  .bcm-react-quick{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--bcm-border);padding-bottom:6px;margin-bottom:2px}
  .bcm-emoji-search{width:100%;box-sizing:border-box;border:1px solid var(--bcm-border);border-radius:6px;padding:4px 8px;font-size:12px;background:var(--bcm-bg);color:var(--bcm-text);outline:none}
  .bcm-emoji-search:focus{border-color:var(--bcm-accent)}
  .bcm-emoji-grid{display:grid;grid-template-columns:repeat(8,1fr);gap:1px;max-height:150px;overflow-y:auto}
  /* ── Phase B: Link Previews ── */
  .bcm-link-preview{display:flex;flex-direction:column;border:1px solid var(--bcm-border);border-radius:8px;overflow:hidden;cursor:pointer;margin:4px 0;max-width:260px;background:var(--bcm-bg)}
  .bcm-link-preview:hover{border-color:var(--bcm-accent)}
  .bcm-lp-img{width:100%;max-height:100px;object-fit:cover}
  .bcm-lp-body{padding:5px 8px;display:flex;flex-direction:column;gap:2px}
  .bcm-lp-title{font-size:11px;font-weight:600;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-lp-desc{font-size:10px;color:var(--bcm-text-muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .bcm-lp-domain{font-size:10px;color:var(--bcm-accent)}
  /* ── Seen by panel ── */
  .bcm-seenby-wrap{display:flex;flex-direction:column;max-height:320px;overflow-y:auto;margin:-4px -8px}
  .bcm-seenby-loading,.bcm-seenby-empty{padding:16px;text-align:center;color:var(--bcm-text-muted);font-size:12px}
  .bcm-seenby-row{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--bcm-border)}
  .bcm-seenby-row:last-child{border-bottom:none}
  .bcm-seenby-info{display:flex;flex-direction:column;gap:2px;min-width:0}
  .bcm-seenby-name{font-size:12px;font-weight:600;color:var(--bcm-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bcm-seenby-status{font-size:11px;color:var(--bcm-text-muted);display:flex;align-items:center;gap:2px}
  .bcm-seenby-read{color:var(--bcm-accent)}
  .bcm-seenby-time{color:var(--bcm-text-muted)}
  .bcm-group-receipt{cursor:pointer}.bcm-group-receipt:hover{text-decoration:underline}
  /* ── Contact online heatmap ── */
  .bcm-heat-row{display:flex;flex-direction:column;gap:4px;padding:6px 0}
  .bcm-heat-label{font-size:10px;color:var(--bcm-text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
  .bcm-heat-bars{display:flex;gap:2px;height:28px;align-items:flex-end}
  .bcm-heat-bar{flex:1;min-height:4px;background:var(--bcm-accent-bg);border-radius:2px;transition:height .15s}
  /* ── Unread separator ── */
  .bcm-state.unread-sep{text-align:center;font-size:10px;color:var(--bcm-accent);padding:4px 0;position:relative;margin:4px 0;flex-shrink:0}
  .bcm-state.unread-sep::before,.bcm-state.unread-sep::after{content:'';position:absolute;top:50%;width:calc(50% - 60px);height:1px;background:var(--bcm-accent);opacity:.4}
  .bcm-state.unread-sep::before{left:0}.bcm-state.unread-sep::after{right:0}
  .bcm-load-more{display:block;width:calc(100% - 24px);margin:8px 12px;padding:6px 0;background:none;border:1px dashed var(--bcm-border);border-radius:6px;color:var(--bcm-text-muted);font-size:12px;cursor:pointer;flex-shrink:0;transition:color .15s,border-color .15s}
  .bcm-load-more:hover{color:var(--bcm-accent);border-color:var(--bcm-accent)}
  .bcm-activity-panel{position:absolute;bottom:calc(100% + 6px);left:0;background:var(--bcm-surface);border:1px solid var(--bcm-border);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:6px;display:flex;flex-wrap:wrap;gap:4px;width:220px;z-index:10001}
  .bcm-activity-item{flex:0 0 calc(50% - 2px);padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--bcm-text);transition:background .12s}
  .bcm-activity-item:hover{background:var(--bcm-accent-bg);color:var(--bcm-accent)}
  /* ── Density button ── */
  .bcm-density-btn{flex:1;padding:6px;border:1px solid var(--bcm-border);background:var(--bcm-bg-input);color:var(--bcm-text-muted);border-radius:6px;cursor:pointer;text-align:center}
  .bcm-density-btn.active{border-color:var(--bcm-accent);color:var(--bcm-accent);background:var(--bcm-accent-bg)}
  /* ── Compact mode overrides ── */
  .bcm-compact .bcm-bubble{padding:4px 8px;border-radius:10px}
  .bcm-compact .bcm-msglist{gap:3px;padding:8px}
  .bcm-compact .bcm-contact{padding:6px 11px}
  .bcm-compact .bcm-avatar{width:22px;height:22px;font-size:9px}
  .bcm-compact .bcm-cname{font-size:11px}
  .bcm-compact .bcm-cprev{font-size:10px}
  .bcm-compact .bcm-btime{font-size:9px}
  /* ── Media gallery panel ── */
  .bcm-media-panel{display:none;flex-direction:column;flex:1;overflow:hidden;background:var(--bcm-bg)}
  .bcm-media-panel.active{display:flex}
  .bcm-media-panel-header{padding:8px 14px;border-bottom:1px solid var(--bcm-border);background:var(--bcm-bg-side);display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
  .bcm-media-panel-title{font-size:12px;font-weight:700;color:var(--bcm-accent)}
  .bcm-media-empty{padding:20px;text-align:center;color:var(--bcm-text-muted);font-size:12px}
  .bcm-media-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;padding:6px;overflow-y:auto;flex:1}
  .bcm-media-cell{aspect-ratio:1;overflow:hidden;border-radius:4px;cursor:pointer;background:var(--bcm-bg-side);display:flex;align-items:center;justify-content:center}
  .bcm-media-cell:hover{opacity:.8}
  .bcm-media-thumb{width:100%;height:100%;object-fit:cover}
  .bcm-media-video-placeholder{font-size:11px;color:var(--bcm-text-muted)}
  /* ── Keyboard shortcuts panel ── */
  .bcm-shortcuts-table{width:100%;border-collapse:collapse}
  .bcm-shortcuts-table tr+tr td{border-top:1px solid var(--bcm-border)}
  .bcm-shortcuts-table td{padding:7px 4px;vertical-align:middle}
  .bcm-kbd{display:inline-block;background:var(--bcm-bg-side);border:1px solid var(--bcm-border);border-bottom-width:2px;border-radius:5px;padding:2px 7px;font-size:11px;font-family:monospace;color:var(--bcm-accent);white-space:nowrap}
  .bcm-settings-hint{font-size:11px;color:var(--bcm-text-muted);padding:1px 0}
`;
