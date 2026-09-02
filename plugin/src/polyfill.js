/* global-scope polyfill — var here is in the script/sandbox scope, not inside the IIFE,
   so it never shadows the real GM APIs via hoisting */
if (typeof GM_getValue === 'undefined') {
  var GM_getValue = function(key, def) { try { var v = localStorage.getItem('_gm_' + key); return v === null ? def : JSON.parse(v); } catch(e) { return def; } };
}
if (typeof GM_setValue === 'undefined') {
  var GM_setValue = function(key, val) { try { localStorage.setItem('_gm_' + key, JSON.stringify(val)); } catch(e) {} };
}
if (typeof GM_xmlhttpRequest === 'undefined') {
  var GM_xmlhttpRequest = function(opts) {
    var xhr = new XMLHttpRequest();
    xhr.open(opts.method || 'GET', opts.url);
    var h = opts.headers || {};
    Object.keys(h).forEach(function(k) { xhr.setRequestHeader(k, h[k]); });
    if (opts.timeout) xhr.timeout = opts.timeout;
    xhr.onload = function() { if (opts.onload) opts.onload({ responseText: xhr.responseText, status: xhr.status, finalUrl: opts.url }); };
    xhr.onerror = function() { if (opts.onerror) opts.onerror({ responseText: '', status: 0 }); };
    xhr.ontimeout = function() { if (opts.ontimeout) opts.ontimeout({ responseText: '', status: 0 }); };
    xhr.send(opts.data || null);
  };
}
if (typeof GM_registerMenuCommand === 'undefined') {
  var GM_registerMenuCommand = function() {};
}
if (typeof unsafeWindow === 'undefined') {
  var unsafeWindow = window;
}
