/* Storage and model transport. The UI talks only to window.TPlanPlatform, so the same pages run
   in a plain browser (localStorage + fetch) and inside the Windows WebView2 shell (SQLite + native HTTP). */
(function () {
  'use strict';

  const P = window.TPlanProviders;
  const STATE_KEY = 'tplan.v4';
  const SECRET_KEY = 'tplan.v4.secret';
  const TIMEOUT_MS = 90000;
  const webview = window.chrome && window.chrome.webview;
  const isDesktop = !!(webview && webview.hostObjects);

  /* API keys are kept per provider, so switching provider does not lose a key.
     The first v4 build stored one bare key; it is read as the key of the provider in use then. */
  function readKeys(raw, fallbackProvider) {
    if (!raw) return {};
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === 'object') return value;
    } catch { /* a bare key, not JSON */ }
    return { [fallbackProvider]: raw };
  }

  const stoppedError = () => { const e = new Error('已停止'); e.name = 'AbortError'; return e; };
  /* `signal` is the user's stop button; the timeout is separate, so the two give different messages. */
  async function request(url, options, signal) {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
    const stop = () => control.abort();
    if (signal) { if (signal.aborted) throw stoppedError(); signal.addEventListener('abort', stop, { once: true }); }
    let response;
    try {
      response = await fetch(url, { ...options, signal: control.signal });
    } catch (error) {
      if (signal && signal.aborted) throw stoppedError();
      throw new Error(error.name === 'AbortError' ? '请求超时，请重试。' : '无法连接这个服务。请检查接口地址和网络；有些服务商不允许从浏览器直接访问。');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(P.explain(response.status, body));
    if (!body) throw new Error('模型服务返回的内容不是 JSON。');
    return body;
  }

  /* ---------- browser ---------- */
  const browser = {
    name: 'browser',
    canSeeImages: true,
    loadState: () => localStorage.getItem(STATE_KEY) || '',
    saveState: (json) => localStorage.setItem(STATE_KEY, json),
    loadKey(provider, legacyProvider) {
      return readKeys(localStorage.getItem(SECRET_KEY), legacyProvider || provider)[provider] || '';
    },
    saveKey(provider, value, legacyProvider) {
      const keys = readKeys(localStorage.getItem(SECRET_KEY), legacyProvider || provider);
      if (value) keys[provider] = value; else delete keys[provider];
      localStorage.setItem(SECRET_KEY, JSON.stringify(keys));
    },
    /* A web page cannot open files by path. The Windows shell provides this; here the user drags files in. */
    readPath: async () => { throw new Error('浏览器预览版不能按路径读取本地文件。请用户把文件拖进聊天框。'); },
    listDir: async () => { throw new Error('浏览器预览版不能列出本地文件夹。请用户把文件拖进聊天框。'); },
    async listModels(agent, key) {
      const call = P.modelsRequest(agent, key);
      return P.parseModels(await request(call.url, { headers: call.headers }));
    },
    /* `key` is passed when testing settings that are not saved yet. */
    async chat(agent, system, user, images, key, signal) {
      const call = P.chatRequest(agent, key === undefined ? browser.loadKey(agent.provider) : key, system, user, images);
      return P.parseChat(agent, await request(call.url, { method: 'POST', headers: call.headers, body: JSON.stringify(call.body) }, signal));
    },
  };

  /* Windows v4 shell: separate database, per-provider encrypted keys and native HTTP. */
  function desktopPlatform() {
    const db = webview.hostObjects.sync.database;
    const pending = new Map();
    webview.addEventListener('message', (event) => {
      const m = event.data;
      if (!m || m.kind !== 'http-response') return;
      const p = pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve(m);
    });
    /* Sends a request to the shell and waits for the reply with the same id. */
    function ask(message, timeoutMs, cancelKind, signal) {
      const id = 'rq_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(stoppedError());
        if (signal) signal.addEventListener('abort', () => {
          const p = pending.get(id);
          if (!p) return;
          clearTimeout(p.timer);
          pending.delete(id);
          if (cancelKind) webview.postMessage({ kind: cancelKind, id });
          reject(stoppedError());
        }, { once: true });
        const timer = setTimeout(() => {
          pending.delete(id);
          if (cancelKind) webview.postMessage({ kind: cancelKind, id });
          reject(new Error('请求超时，请重试。'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        webview.postMessage({ ...message, id });
      });
    }
    async function nativeRequest(call, signal) {
      const response = await ask({ kind: 'http-request', url: call.url, method: call.body ? 'POST' : 'GET', headers: call.headers, body: call.body ? JSON.stringify(call.body) : null }, TIMEOUT_MS, 'http-cancel', signal);
      let body;
      try { body = JSON.parse(response.text); } catch { throw new Error('模型服务返回的内容不是 JSON。'); }
      if (response.status < 200 || response.status >= 300) throw new Error(P.explain(response.status, body));
      return body;
    }
    const desktop = {
      name: 'desktop',
      canSeeImages: true,
      loadState: () => db.Read(STATE_KEY),
      saveState: (json) => db.Write(STATE_KEY, json),
      loadKey(provider, legacyProvider) { return readKeys(db.ReadSecret(), legacyProvider || provider)[provider] || ''; },
      saveKey(provider, value, legacyProvider) {
        const keys = readKeys(db.ReadSecret(), legacyProvider || provider);
        if (value) keys[provider] = value; else delete keys[provider];
        db.WriteSecret(JSON.stringify(keys));
      },
      readPath: async () => { throw new Error('请把文件拖进聊天框，或点击附件按钮选择文件。此版本不按任意路径读取文件。'); },
      listDir: async () => { throw new Error('此版本不列出本地文件夹，请把需要的文件拖进聊天框。'); },
      async listModels(agent, key) { return P.parseModels(await nativeRequest(P.modelsRequest(agent, key))); },
      async chat(agent, system, user, images, key, signal) {
        const call = P.chatRequest(agent, key === undefined ? desktop.loadKey(agent.provider) : key, system, user, images);
        return P.parseChat(agent, await nativeRequest(call, signal));
      },
      openFloating: () => webview.postMessage({ kind: 'timer-open' }),
      updateTimer: (view) => webview.postMessage({ kind: 'timer-state', view }),
      onTimerCommand: (callback) => webview.addEventListener('message', (event) => {
        if (event.data && event.data.kind === 'timer-command') callback(event.data.command);
      }),
    };
    return desktop;
  }

  window.TPlanPlatform = isDesktop ? desktopPlatform() : browser;
})();
