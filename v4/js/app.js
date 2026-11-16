/* T计划 v4 UI. State lives in one object; every change goes through commit(), which saves first
   and only then re-renders, so a failed save never leaves the screen ahead of the stored data. */
(function () {
  'use strict';

  const C = window.TPlanCore;
  const Agent = window.TPlanAgent;
  const Files = window.TPlanFiles;
  const platform = window.TPlanPlatform;
  const Providers = window.TPlanProviders;
  const $ = (selector) => document.querySelector(selector);

  let state = loadState();
  // Settings from the first v4 build are mapped onto the provider presets; its single key moves to that provider.
  state.settings.agent = Providers.migrate(state.settings.agent);
  try {
    const key = platform.loadKey(state.settings.agent.provider, state.settings.agent.provider);
    if (key) platform.saveKey(state.settings.agent.provider, key, state.settings.agent.provider);
  } catch { /* keys stay as they were */ }
  const ui = { panelSection: 'model', mode: state.settings.prefs.onboarded ? 'home' : 'planner', // the first-run interview happens in the chat
     space: null, tag: null, tabs: {}, busy: false, busyText: '', draft: '', attachments: [], parsing: 0, search: '', abort: null };
  const library = new Map(); // files read during this session, by name; kept out of saved state because they are large
  let pip = null; // floating timer window, when open
  let dueNotified = null;
  let editing = null; // the proposal step whose title is being edited: { message, action, step }
  const answers = new Map(); // unsent picks in question forms, by message id
  let lastChatKey = '';

  /* ---------- storage ---------- */
  function loadState() {
    try {
      const raw = platform.loadState();
      return raw ? C.normalize(JSON.parse(raw)) : C.emptyState();
    } catch (error) {
      alert('数据读取失败：' + error.message + '\n为了不覆盖原记录，本次不会保存任何修改。');
      platform.saveState = () => { throw new Error('数据读取失败，已停止保存'); };
      return C.emptyState();
    }
  }
  function commit(next) {
    try {
      platform.saveState(JSON.stringify(next));
    } catch (error) {
      toast('没有保存：' + error.message);
      return false;
    }
    state = next;
    render();
    return true;
  }
  /* Convenience for small edits: mutate a copy, then commit it. */
  function change(mutate) {
    const next = C.clone(state);
    mutate(next);
    return commit(next);
  }

  /* ---------- DOM helpers (text is always set as text, never as HTML) ---------- */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'style') el.style.cssText = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key in el && key !== 'list') el[key] = value;
      else el.setAttribute(key, value);
    }
    for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
    return el;
  }
  const ICONS = {
    gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-3.5c0-.5 0-.9-.1-1.3l2-1.5-2-3.4-2.3.9c-.7-.6-1.5-1-2.3-1.3L14.3 3h-4l-.4 2.4c-.8.3-1.6.7-2.3 1.3l-2.3-.9-2 3.4 2 1.5a8 8 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9c.7.6 1.5 1 2.3 1.3l.4 2.4h4l.4-2.4c.8-.3 1.6-.7 2.3-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.3Z',
    plus: 'M12 5v14M5 12h14',
    send: 'M12 19V5M5 12l7-7 7 7',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    brain: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5v4l3 2',
    clip: 'M20 11.5l-8.2 8.2a5 5 0 0 1-7-7L13 4.400a3.300 3.300 0 0 1 4.700 4.700l-8.200 8.200a1.700 1.700 0 0 1-2.400-2.400L14.600 7.500',
    play: 'M8 5.500v13l10.500-6.500Z',
    pause: 'M8 5v14M16 5v14',
    close: 'M6 6l12 12M18 6L6 18',
    pop: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7Zm0 0v4h4',
    bars: 'M5 19v-8M12 19V5M19 19v-5',
    chip: 'M8 8h8v8H8zM4 10h4M4 14h4M16 10h4M16 14h4M10 4v4M14 4v4M10 16v4M14 16v4',
    note: 'M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm2 5h6M9 13h6',
    data: 'M5 7c0-1.700 3.100-3 7-3s7 1.300 7 3-3.100 3-7 3-7-1.300-7-3Zm0 0v10c0 1.700 3.100 3 7 3s7-1.300 7-3V7M5 12c0 1.700 3.100 3 7 3s7-1.300 7-3',
    minus: 'M6 12h12',
    up: 'M6 14l6-6 6 6',
    shrink: 'M5 19h14',
    grow: 'M8 4H4v4M16 20h4v-4M4 4l6 6M20 20l-6-6',
    stop: 'M7 7h10v10H7z',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
    edit: 'M4 20h4L19 9l-4-4L4 16v4Zm10-14 4 4',
    chev: 'M7 10l5 5 5-5',
    sidebar: 'M4 5h16v14H4zM9.500 5v14M15 10l-2 2 2 2',
    fire: 'M12 21c-3.900 0-6.500-2.600-6.500-6.200 0-3.400 2.600-5.400 3.800-8.800 1.700 1.400 2.300 3.200 2.200 4.800 1.100-.6 1.900-1.900 2-3.400 2.400 1.900 5 4.600 5 7.700 0 3.400-2.700 5.900-6.500 5.900Z',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }
  let toastTimer;
  function hideToast() {
    const el = $('#toast');
    try { if (el.matches(':popover-open')) el.hidePopover(); } catch { /* not a popover here */ }
    el.hidden = true;
  }
  function toast(text, action) {
    const el = $('#toast');
    el.replaceChildren(h('span', {}, text), ...(action ? [h('button', { class: 'toast-action', onclick: () => { hideToast(); action.run(); } }, action.label)] : []));
    el.hidden = false;
    // Shown again as a popover so it sits above any open dialog instead of behind its backdrop.
    try { el.popover = 'manual'; if (el.matches(':popover-open')) el.hidePopover(); el.showPopover(); } catch { /* older engines keep the plain fixed toast */ }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 9000 : 3200);
  }
  /* Runs a change and offers to take it back. The offer only holds while nothing else has changed since. */
  function undoable(label, apply) {
    const before = state;
    if (!apply()) return false;
    const after = state;
    toast(label, { label: '撤销', run: () => {
      if (state !== after) return toast('之后又有新的修改，不能撤销了');
      if (commit(before)) toast('已撤销');
    } });
    return true;
  }

  /* ---------- formatting ---------- */
  const today = () => C.todayISO();
  const space = (id) => state.spaces.find((x) => x.id === id) || null;
  const plainDate = (date) => Number(date.slice(5, 7)) + '月' + Number(date.slice(8)) + '日';
  function dateLabel(date) {
    if (!date) return '未定日期';
    const t = today();
    if (date === t) return '今天';
    if (date === C.addDays(t, 1)) return '明天';
    if (date === C.addDays(t, -1)) return '昨天';
    return plainDate(date) + ' 周' + '日一二三四五六'[new Date(date + 'T12:00:00').getDay()];
  }
  const minutesLabel = (m) => (m >= 60 ? (m % 60 ? Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分' : m / 60 + ' 小时') : m + ' 分钟');
  const timeLabel = (ms) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const clock = (ms) => {
    const seconds = Math.floor(Math.abs(ms) / 1000);
    return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  };
  const modelName = () => {
    const a = state.settings.agent;
    return a.modelId && a.baseUrl ? a.modelId : null;
  };
  const inThread = (m) => (m.spaceId || null) === ui.space; // each space has its own conversation; null is the general one
  const say = (s, text, extra) => s.messages.push({ id: C.uid('msg'), role: 'assistant', at: Date.now(), source: 'local', spaceId: ui.space, text, ...extra });

  const fileChip = (f, onRemove) => h('span', { class: 'file-chip' + (f.thumb ? ' has-thumb' : '') },
    f.thumb ? h('img', { class: 'thumb', src: f.thumb, alt: '' }) : icon('file'),
    h('span', { class: 'file-name' }, f.name), h('span', { class: 'sub' }, f.kind + ' · ' + f.units),
    onRemove ? h('button', { class: 'chip-x', 'aria-label': '移除 ' + f.name, onclick: onRemove }, icon('close')) : null);

  /* ---------- interaction patterns ----------
     The page is rebuilt on every change, so anything that should animate between two renders
     remembers its previous value here. */
  const fills = new Map(); // progress shown as a background fill, by item id
  const trayState = new Map(); // peek trays the user has opened or closed, by key
  const openStacks = new Set(); // file stacks the user has fanned out
  let summaryOpen = false;

  /* Progress as the item's own background: fills from the left, and glows once on reaching 100%. */
  function fill(el, key, value, color) {
    const target = Math.max(0, Math.min(1, value || 0));
    const from = fills.has(key) ? fills.get(key) : target;
    fills.set(key, target);
    el.classList.add('fillable');
    el.style.setProperty('--p', String(from));
    if (color) el.style.setProperty('--fill', 'color-mix(in srgb, ' + color + ' 20%, transparent)');
    if (from !== target) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.setProperty('--p', String(target));
        if (target >= 1) el.classList.add('glow');
      }));
    }
    return el;
  }

  /* A lighter tray tucked under an item. One line shows by default; a click slides the rest out
     while the item above stays where it is. */
  function tray(key, summary, body, startOpen = false) {
    const isOpen = () => (trayState.has(key) ? trayState.get(key) : startOpen);
    const open = isOpen();
    const el = h('div', { class: 'tray' + (open ? ' open' : '') });
    el.append(
      h('button', { class: 'tray-peek', 'aria-expanded': String(open), onclick: (e) => {
        const now = !isOpen();
        trayState.set(key, now);
        el.classList.toggle('open', now);
        e.currentTarget.setAttribute('aria-expanded', String(now));
      } }, h('span', { class: 'tray-summary' }, summary), icon('up')),
      h('div', { class: 'tray-body' }, h('div', { class: 'tray-inner' }, body)));
    return el;
  }

  /* Files of a sent message as overlapping circles. A click fans them out one after another with their names. */
  const FILE_COLORS = { PDF: '#E8825A', Word: '#5B8DEF', PPT: '#D9A441', Excel: '#4FA37A', 图片: '#B079D6', 文本: '#4BA3B5' };
  function fileStack(key, files) {
    const open = openStacks.has(key);
    const shown = Math.min(files.length, 4);
    const el = h('button', {
      class: 'stack' + (open ? ' open' : ''), 'aria-expanded': String(open), 'aria-label': files.length + ' 个文件：' + files.map((f) => f.name).join('、'),
      style: '--n:' + files.length,
      onclick: () => {
        const now = !openStacks.has(key);
        if (now) openStacks.add(key); else openStacks.delete(key);
        el.classList.toggle('open', now);
        el.setAttribute('aria-expanded', String(now));
      },
    });
    files.forEach((f, i) => el.append(h('span', { class: 'stack-item' + (i >= shown ? ' extra' : ''), style: '--i:' + i },
      f.thumb ? h('img', { class: 'stack-face', src: f.thumb, alt: '' })
        : h('span', { class: 'stack-face', style: 'background:' + (FILE_COLORS[f.kind] || '#8a8f9c') }, (f.name.split('.').pop() || f.kind).slice(0, 4).toUpperCase()),
      h('span', { class: 'stack-name' }, f.name))));
    if (files.length > shown) el.append(h('span', { class: 'stack-item more', style: '--i:' + shown }, h('span', { class: 'stack-face' }, '+' + (files.length - shown))));
    return el;
  }

  /* ---------- first-run interview: three questions answered by clicking ---------- */
  const ONBOARDING = [
    { key: 'segment', text: '你好，我是你的规划助手。先问三个小问题，点一下就行。\n\n你一次能专注多久？', options: [['15 分钟', 15], ['25 分钟', 25], ['30 分钟', 30], ['45 分钟', 45]] },
    { key: 'dailyMinutes', text: '平时每天大约有多少时间可以自己安排（学习、项目）？', options: [['1 小时', 60], ['2 小时', 120], ['3 小时', 180], ['4 小时以上', 240]] },
    { key: 'bestTime', text: '一天中什么时候效率最高？', options: [['早上', '早上'], ['下午', '下午'], ['晚上', '晚上'], ['深夜', '深夜']] },
  ];
  const STARTERS = ['帮我规划今天', '我现在有 2 小时，想学习一份课件', '我有一个大目标，帮我拆开'];
  const STARTERS_BY_TYPE = {
    study: ['帮我安排今天的学习', '我现在有 2 小时，想学习一份课件', '帮我定一个这门课的目标'],
    project: ['帮我把这个项目拆成几个阶段', '这周这个项目该做什么？', '我卡住了，帮我找下一步'],
    habit: ['我想养成一个新习惯', '记录今天的体重', '看看我这周的打卡情况'],
    life: ['帮我记几件要办的事', '这周有哪些事要办？', '提醒我下周要交的东西'],
  };
  const askOnboarding = (s, index) => say(s, ONBOARDING[index].text, { options: ONBOARDING[index].options.map(([label, value]) => ({ label, pref: { index, value } })) });
  function answerOnboarding(option) {
    change((s) => {
      s.messages.push({ id: C.uid('msg'), role: 'user', text: option.label, at: Date.now(), spaceId: ui.space });
      s.settings.prefs[ONBOARDING[option.pref.index].key] = option.pref.value;
      if (option.pref.index + 1 < ONBOARDING.length) return askOnboarding(s, option.pref.index + 1);
      s.settings.prefs.onboarded = true;
      say(s, '好了，我记住了。以后我会根据你真实的计时记录慢慢调整安排。\n\n现在你可以把课件（PDF、PPT、Word、Excel）或代码文件拖进聊天框，告诉我你有多少时间，我来拆成一段一段并帮你计时。也可以直接点下面的选项。\n\n两件事会让我有用得多：导入课表（我安排时会避开上课时间），以及连接一个 AI 模型（没有模型时我只能把每一行变成任务）。', { options: [...STARTERS.map((label) => ({ label })), { label: '导入课表', go: 'timetable' }, { label: '连接 AI 模型', go: 'model' }] });
    });
  }

  /* ---------- rail: views and spaces, grouped and foldable ----------
     The fixed views form one group and the spaces are grouped by type. A folded group shrinks to its
     avatars stacked on top of each other; a click opens it again. The whole rail can also be narrowed
     to icons only. Both choices are kept in the preferences. */
  const SPACE_GROUPS = [['study', '学习'], ['project', '项目'], ['habit', '习惯'], ['life', '生活']];
  const spaceType = (sp) => (SPACE_GROUPS.some(([key]) => key === sp.type) ? sp.type : 'study');
  function setRailPref(mutate) { change((s) => { s.settings.prefs.railFolded = { ...(s.settings.prefs.railFolded || {}) }; mutate(s.settings.prefs); }); }
  function renderRail() {
    const prefs = state.settings.prefs;
    const folded = prefs.railFolded || {};
    const compact = !!prefs.railCompact;
    $('#shell').classList.toggle('rail-compact', compact);
    const go = (mode, spaceId) => () => { ui.mode = mode; if (spaceId !== undefined) ui.space = spaceId; render(); };
    const views = [
      { label: '工作台', title: '工作台：今天、本周和各个分区的概况', color: 'var(--ink)', face: '台', ink: true, active: ui.mode === 'home' || (ui.mode === 'planner' && ui.space === null), onclick: go('home') },
      { label: '课表', title: '课表', color: '#567897', face: '课', active: ui.mode === 'timetable', onclick: go('timetable') },
      { label: '本周', title: '本周安排：七天的任务、周重点和可投入时间', color: '#8a6f5a', face: '周', active: ui.mode === 'week', onclick: go('week') },
      { label: '收支', title: '收支：收入、支出、余额走势和存钱罐', color: '#b0564a', face: '收', active: ui.mode === 'money', onclick: go('money') },
      { label: '回看', title: '回看：每周的时间记录、完成情况和反思', color: '#7a8496', face: icon('bars'), active: ui.mode === 'review', onclick: go('review') },
    ];
    const item = (x) => h('button', { class: 'rail-item' + (x.active ? ' active' : ''), title: x.title || x.label, 'aria-label': x.label, 'aria-current': x.active ? 'page' : null, onclick: x.onclick },
      h('span', { class: 'avatar' + (x.ink ? ' ink' : ''), style: 'background:' + x.color }, x.face), h('span', { class: 'rail-label' }, x.label));
    const group = (key, name, items) => {
      const isFolded = !!folded[key];
      const active = items.some((x) => x.active);
      const shown = items.slice(0, compact ? 1 : 3);
      const head = h('button', { class: 'rail-group-head', 'aria-expanded': String(!isFolded), title: (isFolded ? '展开' : '折叠') + '「' + name + '」', onclick: () => setRailPref((p) => { p.railFolded[key] = !isFolded; }) },
        h('span', { class: 'rail-group-name' }, name), icon('chev'));
      const body = isFolded
        ? h('button', { class: 'rail-item rail-stack' + (active ? ' active' : ''), title: name + '：' + items.map((x) => x.label).join('、') + '（点一下展开）', 'aria-label': '展开「' + name + '」，共 ' + items.length + ' 项' + (active ? '，当前页面在里面' : ''),
          onclick: () => setRailPref((p) => { p.railFolded[key] = false; }) },
          h('span', { class: 'rail-stack-faces' }, shown.map((x, i) => h('span', { class: 'avatar' + (x.ink ? ' ink' : ''), style: 'background:' + x.color + ';z-index:' + (10 - i) }, x.face)),
            items.length > shown.length ? h('span', { class: 'avatar more', style: 'z-index:1' }, '+' + (items.length - shown.length)) : null),
          h('span', { class: 'rail-label' }, name + ' · ' + items.length))
        : items.map(item);
      return h('div', { class: 'rail-group' + (isFolded ? ' folded' : ''), role: 'group', 'aria-label': name }, head, body);
    };
    const spaceItems = (type) => state.spaces.filter((sp) => spaceType(sp) === type).map((sp) => ({
      label: sp.name, color: sp.color, face: sp.name.slice(0, 1), active: ui.mode === 'planner' && ui.space === sp.id, onclick: go('planner', sp.id) }));
    $('#rail').replaceChildren(
      h('button', { class: 'rail-toggle', 'aria-pressed': String(compact), title: compact ? '展开导航（显示名称）' : '收起导航（只显示头像）', 'aria-label': compact ? '展开导航' : '收起导航',
        onclick: () => setRailPref((p) => { p.railCompact = !compact; }) }, icon('sidebar')),
      group('views', '视图', views),
      ...SPACE_GROUPS.map(([type, name]) => { const items = spaceItems(type); return items.length ? group(type, name, items) : null; }),
      h('button', { class: 'rail-item', title: '新分区', 'aria-label': '新分区', onclick: () => openSpaceDialog(null) },
        h('span', { class: 'avatar dashed' }, icon('plus')), h('span', { class: 'rail-label' }, '新分区')),
    );
  }

  /* ---------- list: tasks, habits, goals ---------- */
  function visibleTasks(tab) {
    const t = today();
    const weekEnd = C.addDays(C.weekStart(t), 6);
    const mine = state.tasks.filter((x) => (!ui.space || x.spaceId === ui.space) && inTag(x));
    if (tab === 'done') return mine.filter((x) => x.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 60);
    return mine
      .filter((x) => {
        if (tab === 'todo') return !x.done;
        if (tab === 'today') return x.date && (x.date === t || (x.date < t && !x.done));
        const looseThisWeek = !x.date && x.week === C.weekStart(t);
        if (tab === 'week') return looseThisWeek || (x.date && x.date > t && x.date <= weekEnd);
        return (!x.date && !looseThisWeek) || x.date > weekEnd;
      })
      .sort(byWhen);
  }
  /* Tags are the user's own labels on tasks. A row of them above the tabs narrows every list to one tag. */
  const TAG_COLORS = ['#E8825A', '#5B8DEF', '#4FA37A', '#B079D6', '#D9A441', '#4BA3B5', '#D9667A', '#7A8496'];
  function tagColor(tag) { let n = 0; for (const ch of tag) n = (n * 31 + ch.codePointAt(0)) >>> 0; return TAG_COLORS[n % TAG_COLORS.length]; }
  const inTag = (x) => !ui.tag || (x.tags || []).includes(ui.tag);
  /* Every tag in use, most used first, counted over unfinished tasks in the current space. */
  function tagsInUse(scope) {
    const counts = new Map();
    for (const t of state.tasks) if (scope(t)) for (const tag of t.tags || []) counts.set(tag, (counts.get(tag) || 0) + (t.done ? 0 : 1));
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'));
  }
  function tagChips(scope) {
    const tags = tagsInUse(scope);
    if (ui.tag && !tags.some(([tag]) => tag === ui.tag)) ui.tag = null;
    if (!tags.length) return null;
    const chip = (tag, label, color, n) => {
      const on = (ui.tag || null) === tag;
      return h('button', { class: 'cat-chip' + (on ? ' on' : ''), 'aria-pressed': String(on), title: tag ? '只看带「#' + tag + '」的任务' : '不按标签筛选',
        onclick: () => { ui.tag = on ? null : tag; render(); } }, h('i', { style: 'background:' + color }), label, n ? h('small', {}, String(n)) : null);
    };
    return h('div', { class: 'cat-chips', role: 'toolbar', 'aria-label': '按标签筛选' }, chip(null, '全部', 'var(--ink)'), tags.map(([tag, n]) => chip(tag, '#' + tag, tagColor(tag), n)));
  }
  const tagList = (tags) => (tags || []).map((tag) => h('span', { class: 'utag', style: '--tag:' + tagColor(tag) }, '#' + tag));
  const byWhen = (a, b) => a.done - b.done || (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99:99').localeCompare(b.time || '99:99') || a.createdAt - b.createdAt;
  const whenLabel = (t) => (!t.date && t.week ? (t.week === C.weekStart(today()) ? '本周未定' : plainDate(t.week) + ' 那一周未定') : dateLabel(t.date) + (t.time ? ' ' + t.time : ''));
  /* After a task is finished with its timer, one click of feedback goes into the profile. */
  function askFeel(s, task) {
    const actual = s.sessions.filter((x) => x.taskId === task.id).reduce((n, x) => n + x.actual, 0);
    say(s, '完成了「' + task.title + '」。' + (actual ? '实际用时 ' + minutesLabel(actual) + '，计划 ' + minutesLabel(task.minutes) + '。' : '') + '\n感觉怎么样？点一下，我下次会安排得更合适。', {
      options: [['太简单', 'easy'], ['正好', 'ok'], ['太难', 'hard']].map(([label, value]) => ({ label, feel: { taskId: task.id, value } })),
    });
  }
  function toggleDone(taskId) {
    try {
      const result = C.toggleTask(state, taskId, Date.now());
      if (result.wasTiming) {
        askFeel(result.state, result.state.tasks.find((t) => t.id === taskId));
        if (pip) pip.close();
      }
      if (commit(result.state) && result.wasTiming && result.session) openWrapUp(taskId, result.session.id);
    } catch (error) { toast(error.message); }
  }
  /* When a sitting ends: what was done, where it got stuck, where to pick up. All optional, one screen. */
  function openWrapUp(taskId, sessionId) {
    const task = state.tasks.find((t) => t.id === taskId);
    const session = state.sessions.find((x) => x.id === sessionId);
    if (!task || !session) return;
    const form = openDialog('这一轮记一笔', [
      h('p', { class: 'sub' }, '「' + task.title + '」· 这一段 ' + minutesLabel(session.actual) + '。都可以不填。'),
      field('做了什么', h('textarea', { name: 'did', rows: 2, maxLength: 600, value: session.note || '' })),
      field('卡在哪 / 想法', h('textarea', { name: 'stuck', rows: 2, maxLength: 600, value: session.stuck || '' })),
      task.done ? null : field('下次从哪里继续', h('input', { name: 'next', maxLength: 300, value: task.next || '', placeholder: '例如：从第 3 章例 5 开始' })),
    ], [
      h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn ghost', onclick: closeDialog }, '跳过'),
      h('button', { class: 'btn dark', onclick: () => {
        try { if (commit(C.wrapUp(state, { taskId, sessionId, did: form.did.value, stuck: form.stuck.value, next: form.next ? form.next.value : '' }))) { closeDialog(); toast('已记下，在「回看」的时间记录里能看到'); } }
        catch (error) { toast(error.message); }
      } }, '保存'),
    ]);
    form.did.focus();
  }
  /* Stops the timer without finishing the step; a minute or more of work is recorded and can be written up. */
  function stopTimerNow() {
    const timer = state.timer;
    if (!timer) return;
    const before = state.sessions.length;
    if (pip) pip.close();
    if (!commit(C.stopTimer(state, Date.now()))) return;
    if (state.sessions.length > before) openWrapUp(timer.taskId, state.sessions[state.sessions.length - 1].id);
  }
  const stepLines = (steps) => h('ol', { class: 'steps' }, steps.map((x, i) => h('li', { class: x.done ? 'done' : '' },
    h('span', { class: 'num' }, i + 1 + '.'), h('span', { class: 'step-title' }, x.title), h('span', { class: 'sub' }, x.minutes + ' 分'))));
  function taskRow(t) {
    const sp = space(t.spaceId);
    const overdue = !t.done && t.date && t.date < today();
    const timing = state.timer && state.timer.taskId === t.id;
    const stepsDone = t.steps ? t.steps.filter((x) => x.done).length : 0;
    const row = h('div', { class: 'task' + (t.done ? ' done' : '') + (timing ? ' timing' : '') },
      h('button', {
        class: 'check', 'aria-label': t.done ? '标记为未完成' : '标记为完成', 'aria-pressed': String(t.done),
        onclick: () => toggleDone(t.id),
      }, t.done ? icon('check') : null),
      h('button', { class: 'task-body', onclick: () => openTaskDialog(t) },
        h('span', { class: 'task-title' }, t.title),
        t.next && !t.done ? h('span', { class: 'task-next' }, '继续：' + t.next) : null,
        h('span', { class: 'task-meta' },
          sp ? h('span', { class: 'dot', style: 'background:' + sp.color }) : null,
          sp && !ui.space ? h('span', { class: 'task-space' }, sp.name + ' ·') : null,
          h('span', { class: overdue ? 'overdue' : '' }, overdue ? '已过期 · ' + whenLabel(t) : whenLabel(t)),
          h('span', {}, '· ' + minutesLabel(t.minutes)),
          t.steps ? h('span', {}, '· ' + stepsDone + '/' + t.steps.length + ' 段') : null),
        t.tags ? h('span', { class: 'task-tags' }, tagList(t.tags)) : null),
      !t.done && !state.timer ? h('button', { class: 'play', 'aria-label': '开始计时：' + t.title, title: '开始计时', onclick: () => beginTimer(t.id) }, icon('play')) : null);
    fill(row, t.id, t.done ? 1 : t.steps ? stepsDone / t.steps.length : 0, sp && sp.color);
    if (!t.steps || t.steps.length < 2) return row;
    const next = t.steps.find((x) => !x.done);
    return h('div', { class: 'with-tray' }, row,
      tray('task:' + t.id, next ? '下一段：' + next.title + ' · ' + next.minutes + ' 分' : '全部 ' + t.steps.length + ' 段已完成', stepLines(t.steps)));
  }
  function habitRow(habit) {
    const t = today();
    const count = C.habitWeekCount(habit, t);
    const done = !!habit.log[t];
    const row = h('div', { class: 'habit' },
      h('button', {
        class: 'check round' + (done ? ' on' : ''), 'aria-label': '今天' + (done ? '已完成' : '未完成') + '：' + habit.title, 'aria-pressed': String(done),
        onclick: () => change((s) => { const x = s.habits.find((y) => y.id === habit.id); if (x.log[t]) delete x.log[t]; else x.log[t] = true; }),
      }, done ? icon('check') : null),
      h('button', { class: 'task-body', onclick: () => openHabitDialog(habit) },
        h('span', { class: 'task-title' }, habit.title),
        h('span', { class: 'task-meta' }, '本周 ' + count + ' / ' + habit.perWeek)));
    return fill(row, habit.id, count / habit.perWeek, (space(habit.spaceId) || {}).color);
  }
  function goalCard(goal, startOpen = false) {
    const tasks = state.tasks.filter((t) => t.goalId === goal.id);
    const done = tasks.filter((t) => t.done).length;
    const stages = goal.milestones.map((m, index) => {
      const mine = tasks.filter((t) => t.milestone === index);
      return { title: m.title, done: mine.filter((t) => t.done).length, total: mine.length };
    });
    const current = stages.find((m) => m.total === 0 || m.done < m.total);
    const card = h('div', { class: 'goal' },
      h('div', { class: 'goal-head' },
        h('strong', {}, goal.title),
        h('button', { class: 'icon-btn small', 'aria-label': '删除目标', title: '删除目标', onclick: () => {
          if (confirm('删除目标「' + goal.title + '」？它的任务会保留。')) undoable('目标已删除', () => commit(C.normalize({ ...C.clone(state), goals: state.goals.filter((g) => g.id !== goal.id) })));
        } }, icon('trash'))),
      h('span', { class: 'task-meta' }, (goal.deadline ? '截止 ' + plainDate(goal.deadline) + ' · ' : '') + done + ' / ' + tasks.length + ' 项完成'));
    fill(card, goal.id, tasks.length ? done / tasks.length : 0, (space(goal.spaceId) || {}).color);
    return h('div', { class: 'with-tray' }, card,
      tray('goal:' + goal.id, current ? '现在：' + current.title + ' · ' + current.done + '/' + current.total : '全部阶段已完成',
        h('ol', { class: 'milestones' }, stages.map((m) => h('li', { class: m.total > 0 && m.done === m.total ? 'done' : '' }, h('span', {}, m.title), h('span', { class: 'sub' }, m.done + '/' + m.total)))), startOpen));
  }

  /* Today's key numbers, shown in the capsule and the pull-down panel. */
  function todayNumbers(inSpace) {
    const t = today();
    const week = C.weekStart(t);
    const dated = state.tasks.filter((x) => inSpace(x) && x.date === t);
    const sessions = state.sessions.filter((x) => inSpace(x));
    const minutes = (list) => list.reduce((n, x) => n + x.actual, 0);
    const habits = state.habits.filter(inSpace);
    const budget = ui.space ? null : state.settings.prefs.dailyMinutes || null; // the daily budget is for everything, not one space
    const planned = dated.reduce((a, x) => a + x.minutes, 0);
    return {
      planned, budget, over: budget && planned > budget ? planned - budget : 0,
      done: state.tasks.filter((x) => inSpace(x) && x.done && x.doneAt && C.todayISO(new Date(x.doneAt)) === t).length,
      focus: minutes(sessions.filter((x) => x.date === t)),
      rate: dated.length ? Math.round((dated.filter((x) => x.done).length / dated.length) * 100) : null,
      left: state.tasks.filter((x) => inSpace(x) && !x.done && x.date && x.date <= t),
      weekFocus: minutes(sessions.filter((x) => x.date >= week)),
      habitsDone: habits.filter((x) => x.log[t]).length, habits: habits.length,
      overdue: state.tasks.filter((x) => inSpace(x) && !x.done && x.date && x.date < t).length,
    };
  }
  /* The capsule opens into a panel by clicking it or by pulling it down; the list below is pushed down and dimmed. */
  function summary(n) {
    const short = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');
    const cell = (value, label) => h('div', { class: 'sum-cell' }, h('strong', {}, value), h('span', { class: 'sub' }, label));
    const capsule = h('button', { class: 'capsule', 'aria-expanded': String(summaryOpen), title: '点一下或往下拉，展开今天的统计' },
      h('span', {}, icon('check'), n.done + ' 完成'), h('span', {}, icon('brain'), short(n.focus)), n.over ? h('span', { class: 'over' }, '超出 ' + short(n.over)) : h('span', {}, n.rate === null ? '今天无安排' : n.rate + '%'));
    const panel = h('div', { class: 'sum-panel' }, h('div', { class: 'sum-grid' },
      cell(String(n.left.length), '今天还剩（项）'), cell(minutesLabel(n.left.reduce((a, x) => a + x.minutes, 0)), '还需要的时间'),
      cell(minutesLabel(n.weekFocus), '本周专注'), cell(n.habits ? n.habitsDone + ' / ' + n.habits : '—', '今天的习惯'),
      cell(String(n.overdue), '已过期（项）'), cell(minutesLabel(n.planned) + (n.budget ? ' / ' + minutesLabel(n.budget) : ''), n.over ? '今天已安排，超出每天可安排的 ' + minutesLabel(n.over) : n.budget ? '今天已安排 / 每天可安排' : '今天已安排')));
    const box = h('div', { class: 'summary' + (summaryOpen ? ' open' : ''), style: '--open:' + (summaryOpen ? 1 : 0) }, capsule, panel);
    const set = (value, dragging) => {
      box.style.setProperty('--open', String(value));
      box.classList.toggle('dragging', !!dragging);
      box.parentElement.style.setProperty('--dim', String(value));
    };
    const settle = (value) => {
      summaryOpen = value;
      box.classList.toggle('open', value);
      capsule.setAttribute('aria-expanded', String(value));
      set(value ? 1 : 0, false);
    };
    const drag = (e) => {
      if (e.button) return;
      const startY = e.clientY;
      const from = summaryOpen ? 1 : 0;
      const height = panel.firstElementChild.offsetHeight || 1;
      let moved = false;
      let value = from;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 4) moved = true;
        value = Math.max(0, Math.min(1, from + dy / height));
        if (moved) set(value, true);
      };
      const stop = () => {
        target.removeEventListener('pointermove', move);
        settle(moved ? value > 0.4 : !summaryOpen);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', stop, { once: true });
      target.addEventListener('pointercancel', stop, { once: true });
    };
    requestAnimationFrame(() => box.style.setProperty('--h', panel.firstElementChild.offsetHeight + 'px'));
    capsule.addEventListener('pointerdown', drag);
    panel.addEventListener('pointerdown', drag);
    capsule.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); settle(!summaryOpen); } });
    return box;
  }

  /* A habit with the whole week visible: any day up to today can be ticked. */
  function habitWeekRow(habit) {
    const t = today();
    const start = C.weekStart(t);
    const count = C.habitWeekCount(habit, t);
    const row = h('div', { class: 'habit week' },
      h('button', { class: 'task-body', onclick: () => openHabitDialog(habit) },
        h('span', { class: 'task-title' }, habit.title),
        h('span', { class: 'task-meta' }, '本周 ' + count + ' / ' + habit.perWeek)),
      h('div', { class: 'week-cells' }, Array.from({ length: 7 }, (_, i) => {
        const d = C.addDays(start, i);
        const on = !!habit.log[d];
        return h('button', {
          class: 'day-cell' + (on ? ' on' : '') + (d === t ? ' today' : ''), disabled: d > t, 'aria-pressed': String(on),
          'aria-label': habit.title + '，周' + '一二三四五六日'[i] + (on ? '，已完成' : '，未完成'), title: plainDate(d),
          onclick: () => change((s) => { const x = s.habits.find((y) => y.id === habit.id); if (x.log[d]) delete x.log[d]; else x.log[d] = true; }),
        }, '一二三四五六日'[i]);
      })));
    return fill(row, habit.id, count / habit.perWeek, (space(habit.spaceId) || {}).color);
  }
  /* A measurement: latest value, change since the first entry, a small trend line, and a box to log today's number. */
  function metricCard(metric) {
    const entries = metric.entries;
    const latest = entries[entries.length - 1];
    const unit = metric.unit ? ' ' + metric.unit : '';
    const delta = entries.length > 1 ? Math.round((latest.value - entries[0].value) * 100) / 100 : null;
    const input = h('input', { class: 'metric-input', type: 'number', step: 'any', inputMode: 'decimal', placeholder: '今天的' + metric.name, 'aria-label': '记录今天的' + metric.name,
      onkeydown: (e) => { if (e.key === 'Enter') log(); } });
    const log = () => {
      const value = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(value)) return toast('请输入一个数字');
      change((s) => C.logMetric(s, { name: metric.name, value: Math.round(value * 100) / 100, spaceId: metric.spaceId, date: null }, Date.now()));
    };
    let line = null;
    if (entries.length > 1) {
      const values = entries.slice(-30).map((e) => e.value);
      const low = Math.min(...values);
      const span = Math.max(...values) - low || 1;
      const points = values.map((v, i) => ((i / (values.length - 1)) * 116 + 2).toFixed(1) + ',' + (26 - ((v - low) / span) * 24).toFixed(1)).join(' ');
      line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      line.setAttribute('viewBox', '0 0 120 28');
      line.setAttribute('class', 'spark');
      line.setAttribute('role', 'img');
      line.setAttribute('aria-label', metric.name + '最近 ' + values.length + ' 次记录的变化');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      path.setAttribute('points', points);
      line.append(path);
    }
    return h('div', { class: 'metric' },
      h('div', { class: 'metric-head' },
        h('div', {}, h('span', { class: 'task-meta' }, metric.name + (latest ? ' · ' + dateLabel(latest.date) : '')),
          h('strong', { class: 'metric-value' }, latest ? latest.value + unit : '还没有记录')),
        line,
        h('button', { class: 'icon-btn small', 'aria-label': '删除记录项 ' + metric.name, title: '删除这个记录项', onclick: () => {
          if (confirm('删除「' + metric.name + '」和它的全部 ' + entries.length + ' 条记录？')) undoable('记录项已删除', () => change((s) => { s.metrics = s.metrics.filter((m) => m.id !== metric.id); }));
        } }, icon('trash'))),
      delta !== null ? h('span', { class: 'sub' }, '从 ' + plainDate(entries[0].date) + ' 的 ' + entries[0].value + unit + ' 到现在：' + (delta > 0 ? '+' : '') + delta + unit + '，共 ' + entries.length + ' 次记录') : null,
      h('div', { class: 'row tight' }, input, h('button', { class: 'btn outline slim', onclick: log }, '记录')));
  }
  function openMetricDialog() {
    const form = openDialog('新记录项', [
      field('记录什么（例如体重、睡眠）', h('input', { name: 'name', maxLength: 30, required: true })),
      field('单位（可以不填）', h('input', { name: 'unit', maxLength: 10, placeholder: 'kg、小时…' })),
    ], [
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const name = form.name.value.trim();
        if (!name) return toast('请填写名称');
        if (state.metrics.some((m) => m.name === name && (m.spaceId || null) === ui.space)) return toast('已经有同名的记录项');
        if (change((s) => s.metrics.push({ id: C.uid('k'), name, unit: form.unit.value.trim(), spaceId: ui.space, entries: [] }))) closeDialog();
      } }, '保存'),
    ]);
    form.name.focus();
  }

  /* What each kind of space shows, and in which order. "all" is the overview across spaces. */
  const TABS = {
    all: [['today', '今天'], ['week', '本周'], ['later', '之后'], ['goals', '目标'], ['cards', '卡片'], ['done', '完成']],
    study: [['today', '今天'], ['week', '本周'], ['later', '之后'], ['cards', '卡片'], ['goals', '目标'], ['done', '完成']],
    project: [['goals', '目标'], ['today', '今天'], ['week', '本周'], ['later', '之后'], ['done', '完成']],
    habit: [['checkin', '打卡'], ['today', '任务'], ['goals', '目标']],
    life: [['todo', '待办'], ['done', '已完成']],
  };
  function renderList() {
    const current = space(ui.space);
    const type = current ? current.type : 'all';
    const tabs = TABS[type];
    const tab = tabs.some(([key]) => key === ui.tabs[type]) ? ui.tabs[type] : tabs[0][0];
    const inSpace = (x) => !ui.space || x.spaceId === ui.space;
    const habits = state.habits.filter(inSpace);
    const goals = state.goals.filter(inSpace);
    const metrics = state.metrics.filter((m) => (m.spaceId || null) === ui.space);
    const button = (cls, label, onclick) => h('button', { class: 'btn ' + cls, onclick }, icon('plus'), label);
    const emptyText = { today: '今天还没有安排。告诉助手你想做什么，或者拖一份课件进来。', week: '本周后面几天还没有安排。', later: '没有以后的任务或未定日期的任务。', todo: '没有待办的事。在上面写一件，按回车就加进来。', done: '还没有完成的事。' };
    let body;
    const query = ui.search.trim().toLowerCase();
    if (query) {
      const tagQuery = query.replace(/^[#＃]/, '');
      const found = state.tasks.filter((x) => inSpace(x) && inTag(x) && (x.title.toLowerCase().includes(query) || (x.tags || []).some((tag) => tag.toLowerCase().includes(tagQuery)))).sort(byWhen).slice(0, 80);
      body = [h('h3', { class: 'group-title' }, '搜索到 ' + found.length + ' 项' + (current ? '（只在这个分区里）' : '')), found.length ? found.map(taskRow) : h('p', { class: 'empty' }, '没有标题里包含「' + ui.search.trim() + '」的任务。')];
    } else if (tab === 'goals') {
      body = goals.length ? goals.map((g) => goalCard(g, type === 'project'))
        : h('p', { class: 'empty' }, type === 'project' ? '这个项目还没有目标。在聊天里说说这个项目要做成什么、什么时候要，助手会拆成阶段和任务。' : '还没有目标。在聊天里说「我想在 12 月底前学完单片机」，助手会拆成每周和每天的任务。');
    } else if (tab === 'cards') {
      body = cardsBody();
    } else if (tab === 'checkin') {
      body = [
        h('h3', { class: 'group-title' }, '本周打卡'),
        habits.length ? habits.map(habitWeekRow) : h('p', { class: 'empty' }, '还没有习惯。点下面的「新习惯」，或者在聊天里说「我想每周运动三次」。'),
        h('h3', { class: 'group-title' }, '数字记录'),
        metrics.length ? metrics.map(metricCard) : h('p', { class: 'empty' }, '体重、睡眠这类数字可以记在这里，看它怎么变化。点下面的「新记录项」，或者在聊天里说「今天体重 72 公斤」。'),
      ];
    } else {
      const tasks = visibleTasks(tab);
      const quick = tab === 'todo' ? h('input', { class: 'quick-add', placeholder: '写一件要办的事，按回车', maxLength: 150, 'aria-label': '添加待办',
        onkeydown: (e) => {
          if (e.key !== 'Enter' || e.isComposing || !e.target.value.trim()) return;
          const title = e.target.value.trim();
          change((s) => s.tasks.push({ id: C.uid('t'), title, date: null, minutes: 30, spaceId: ui.space, done: false, doneAt: null, createdAt: Date.now(), origin: 'user' }));
          const again = $('.quick-add');
          if (again) again.focus();
        } }) : null;
      body = [tab === 'today' && !ui.space ? timetable.daily(today()) : null, quick, tasks.length ? tasks.map(taskRow) : h('p', { class: 'empty' }, emptyText[tab]),
        tab === 'today' && type !== 'habit' && habits.length ? [h('h3', { class: 'group-title' }, '习惯'), ...habits.map(habitRow)] : null];
    }
    const foot = tab === 'cards' && !query ? [button('outline', '新卡片', () => openCardDialog(null))] : type === 'habit' ? [button('outline', '新习惯', () => openHabitDialog(null)), button('ghost', '新记录项', openMetricDialog)]
      : type === 'life' ? [button('outline', '新建任务', () => openComposer('task'))]
        : type === 'project' ? [button('outline', '新建任务', () => openComposer('task'))]
          : [button('outline', '新建任务', () => openComposer('task')), button('ghost', '新习惯', () => openHabitDialog(null))];
    $('#list').style.setProperty('--dim', summaryOpen ? '1' : '0');
    $('#list').replaceChildren(
      h('header', { class: 'list-head' },
        h('h2', {}, current ? current.name : '全部安排'),
        current ? null : h('button', { class: 'text-btn', title: '回到工作台', onclick: () => { ui.mode = 'home'; render(); } }, '‹ 工作台'),
        current ? h('button', { class: 'icon-btn', 'aria-label': '编辑分区', title: '编辑分区', onclick: () => openSpaceDialog(current) }, icon('gear')) : null),
      summary(todayNumbers(inSpace)),
      h('label', { class: 'list-search' }, icon('search'), h('input', { type: 'search', value: ui.search, placeholder: '搜索任务或 #标签（包括已完成的）', 'aria-label': '搜索任务', maxLength: 60,
        // The list is rebuilt on every keystroke, so focus is put back; an input method's unfinished text is left alone.
        oninput: (e) => { if (e.isComposing) return; searchFor(e.target.value); }, oncompositionend: (e) => searchFor(e.target.value) })),
      query ? '' : upNext(current),
      tagChips(inSpace),
      query ? '' : h('div', { class: 'segmented', role: 'tablist' }, tabs.map(([key, label]) =>
        h('button', { role: 'tab', 'aria-selected': String(tab === key), class: tab === key ? 'on' : '', onclick: () => { ui.tabs[type] = key; render(); } }, label))),
      h('div', { class: 'list-scroll' }, body),
      h('div', { class: 'list-foot' }, foot));
  }

  /* ---------- what is coming: the class now or next, exams and deadlines counted down, cards due ---------- */
  const T = window.TPlanTimetable;
  const courseTitles = () => [...new Set(T.normalize(state.schedule).courses.map((c) => c.title).filter(Boolean))];
  const spaceForCourse = (title) => state.spaces.find((x) => x.course === title) || state.spaces.find((x) => !x.course && x.name === title.slice(0, 20)) || null;
  /* The class in progress, or else the next one within a week. In a space tied to a course, only that course. */
  function nextClass(current) {
    if (current && !current.course) return null;
    const t = today();
    const now = new Date();
    const clockNow = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const events = T.events(state.schedule, t, C.addDays(t, 7)).filter((e) => !current || e.title === current.course);
    const hit = events.find((e) => e.date > t || e.endTime > clockNow);
    return hit ? { ...hit, running: hit.date === t && hit.startTime <= clockNow } : null;
  }
  function upNext(current) {
    const t = today();
    const lesson = nextClass(current);
    const dates = C.upcomingDates(state, t, ui.space || undefined).slice(0, 3);
    const due = C.dueCards(state, t, ui.space).length;
    const days = (n) => (n === 0 ? h('b', { class: 'soon' }, '今天') : h('b', { class: n <= 7 ? 'soon' : '' }, String(n), h('small', {}, ' 天')));
    const rows = [
      lesson ? h('button', { class: 'next-row', onclick: () => timetable.details(lesson), title: '查看这节课' },
        h('b', { class: lesson.running ? 'live' : '' }, lesson.running ? '上课中' : lesson.date === t ? lesson.startTime : dateLabel(lesson.date).split(' ')[0]),
        h('span', { class: 'next-text' }, lesson.title, h('small', {}, (lesson.running ? '到 ' + lesson.endTime : lesson.date === t ? '下一节 · 到 ' + lesson.endTime : lesson.startTime + '–' + lesson.endTime) + (lesson.room ? ' · ' + lesson.room : '')))) : null,
      ...dates.map((d) => h('button', { class: 'next-row', title: d.kind === 'goal' ? '这是一个目标的期限' : '修改这个日期',
        onclick: () => { if (d.kind === 'goal') { ui.tabs[current ? current.type : 'all'] = 'goals'; render(); } else openDateDialog(state.dates.find((x) => x.id === d.id)); } },
        days(d.daysLeft), h('span', { class: 'next-text' }, d.title, h('small', {}, plainDate(d.date) + (d.time ? ' ' + d.time : '') + (d.place ? ' · ' + d.place : '') + (d.kind === 'goal' ? ' · 目标期限' : ''))))),
      due ? h('button', { class: 'next-row', onclick: () => startReview(), title: '开始复习' }, h('b', { class: 'soon' }, String(due), h('small', {}, ' 张')), h('span', { class: 'next-text' }, '复习卡片到期', h('small', {}, '点这里开始复习'))) : null,
    ].filter(Boolean);
    return h('section', { class: 'up-next', id: 'upNext', 'aria-label': '接下来' },
      h('div', { class: 'up-next-head' }, h('span', {}, '接下来'), h('button', { class: 'text-btn', onclick: () => openDateDialog(null) }, '+ 考试 / 截止日期')),
      rows.length ? rows : h('p', { class: 'sub' }, '记下考试或截止日期，这里会显示倒计时。'));
  }
  // The clock moves on without any change to the data, so this one block is refreshed on its own.
  setInterval(() => { const old = $('#upNext'); if (old && !ui.search.trim()) old.replaceWith(upNext(space(ui.space))); }, 60000);

  function openDateDialog(item, preset = {}) {
    const form = openDialog(item ? '修改日期' : '考试 / 截止日期', [
      field('是什么（例如 操作系统期末考试、六级报名截止）', h('input', { name: 'title', maxLength: 80, required: true, value: item ? item.title : preset.title || '' })),
      h('div', { class: 'row' },
        field('日期', h('input', { name: 'date', type: 'date', required: true, value: item ? item.date : '' })),
        field('时间（可以留空）', h('input', { name: 'time', type: 'time', value: item ? item.time || '' : '' }))),
      whenHelp(() => form, { kind: 'deadline', time: true }),
      field('地点（可以留空）', h('input', { name: 'place', maxLength: 40, value: item ? item.place || '' : '' })),
      field('分区', spaceSelect(item ? item.spaceId : preset.spaceId !== undefined ? preset.spaceId : ui.space)),
    ], [
      item ? h('button', { type: 'button', class: 'btn danger', onclick: () => { undoable('日期已删除', () => change((s) => { s.dates = s.dates.filter((x) => x.id !== item.id); })); closeDialog(); } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const title = form.title.value.replace(/\s+/g, ' ').trim();
        if (!title) return toast('请填写名称');
        if (!C.validDate(form.date.value)) return toast('请选择日期');
        const values = { title, date: form.date.value, place: form.place.value.trim(), spaceId: form.space.value || null };
        const ok = change((s) => {
          const target = item ? s.dates.find((x) => x.id === item.id) : { id: C.uid('d'), createdAt: Date.now() };
          Object.assign(target, values);
          if (C.validTime(form.time.value)) target.time = form.time.value; else delete target.time;
          if (!item) s.dates.push(target);
        });
        if (ok) closeDialog();
      } }, '保存'),
    ]);
    form.title.focus();
  }

  /* ---------- review cards ---------- */
  function cardsBody() {
    const t = today();
    const mine = state.cards.filter((c) => !ui.space || c.spaceId === ui.space).sort((a, b) => a.due.localeCompare(b.due) || a.createdAt - b.createdAt);
    const due = C.dueCards(state, t, ui.space);
    const stats = C.cardStats(state, t, ui.space);
    const dueText = (c) => (c.due <= t ? '今天复习' : dateLabel(c.due) + '再复习');
    return [
      h('div', { class: 'cards-head' },
        h('div', {}, h('strong', {}, due.length ? '今天要复习 ' + due.length + ' 张' : mine.length ? '今天没有到期的卡片' : '还没有复习卡片'),
          mine.length ? h('span', { class: 'sub' }, '共 ' + stats.total + ' 张' + (stats.recentAnswers ? ' · 最近 14 天回答 ' + stats.recentAnswers + ' 次，记住 ' + stats.recentRemembered + ' 次' : ' · 还没有回答记录')) : null),
        due.length ? h('button', { class: 'btn dark', onclick: () => startReview() }, '开始复习') : null),
      mine.length ? mine.map((c) => h('button', { class: 'card-row' + (c.due <= t ? ' due' : ''), onclick: () => openCardDialog(c) },
        h('span', { class: 'task-title' }, c.front),
        h('span', { class: 'task-meta' }, (!ui.space && space(c.spaceId) ? space(c.spaceId).name + ' · ' : '') + dueText(c) + (c.reviews.length ? ' · 已连续记住 ' + c.stage + ' 次' : ' · 新卡片'))))
        : h('p', { class: 'empty' }, '一张卡片是一问一答。记住了就隔 1、2、4、7、15、30 天再出现，没记住第二天再来。点下面的「新卡片」，或者把笔记、课件拖给助手说「帮我出复习卡片」。'),
    ];
  }
  function openCardDialog(card, keepSpace) {
    const answers = card ? card.reviews.length : 0;
    const form = openDialog(card ? '修改卡片' : '新卡片', [
      field('问题（只考一个知识点）', h('textarea', { name: 'front', rows: 3, maxLength: 300, value: card ? card.front : '' })),
      field('答案', h('textarea', { name: 'back', rows: 5, maxLength: 800, value: card ? card.back : '' })),
      field('分区', spaceSelect(card ? card.spaceId : keepSpace !== undefined ? keepSpace : ui.space)),
      card ? h('p', { class: 'sub' }, (answers ? '回答过 ' + answers + ' 次，记住 ' + card.reviews.filter((r) => r.ok).length + ' 次。' : '还没有复习过。') + (card.due <= today() ? '今天到期。' : '下次复习：' + dateLabel(card.due) + '。')) : null,
    ], [
      card ? h('button', { type: 'button', class: 'btn danger', onclick: () => { undoable('卡片已删除', () => change((s) => { s.cards = s.cards.filter((x) => x.id !== card.id); })); closeDialog(); } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      !card ? h('button', { type: 'button', class: 'btn outline slim', onclick: () => save(true) }, '保存并再加一张') : null,
      h('button', { class: 'btn dark', onclick: () => save(false) }, '保存'),
    ]);
    function save(again) {
      const front = form.front.value.trim();
      const back = form.back.value.trim();
      if (!front || !back) return toast('问题和答案都要填');
      const spaceId = form.space.value || null;
      const ok = change((s) => {
        if (card) Object.assign(s.cards.find((x) => x.id === card.id), { front, back, spaceId });
        else s.cards.push(C.newCard({ front, back }, spaceId, Date.now(), 'user'));
      });
      if (!ok) return;
      if (again) openCardDialog(null, spaceId || ''); else closeDialog();
    }
    form.front.focus();
  }
  /* Goes through the cards due today one at a time: recall first, then look, then say honestly which it was. */
  function startReview() {
    const queue = C.dueCards(state, today(), ui.space).map((c) => c.id);
    if (!queue.length) return toast('今天没有到期的卡片');
    let index = 0;
    let shown = false;
    let remembered = 0;
    const answer = (ok) => {
      try { if (!commit(C.reviewCard(state, queue[index], ok, Date.now()))) return; } catch (error) { toast(error.message); }
      if (ok) remembered++;
      index++; shown = false; draw();
    };
    const onKey = (e) => {
      if (e.target.closest('button')) return;
      if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); shown = true; draw(); }
      else if (shown && e.key === '1') answer(false);
      else if (shown && e.key === '2') answer(true);
    };
    function draw() {
      const card = state.cards.find((c) => c.id === queue[index]);
      if (index >= queue.length || !card) {
        const form = openDialog('复习完了', [h('p', {}, '这次复习了 ' + index + ' 张，记住 ' + remembered + ' 张。'), index > remembered ? h('p', { class: 'sub' }, '没记住的 ' + (index - remembered) + ' 张明天会再出现。') : null], [h('span', { class: 'grow' }), h('button', { class: 'btn dark', onclick: closeDialog }, '好')]);
        form.querySelector('.btn.dark').focus();
        return;
      }
      const sp = space(card.spaceId);
      const form = openDialog('复习卡片 ' + (index + 1) + ' / ' + queue.length, [
        sp ? h('span', { class: 'sub' }, sp.name) : null,
        h('div', { class: 'review-face' }, card.front),
        shown ? h('div', { class: 'review-face back' }, card.back) : h('p', { class: 'sub' }, '先在心里答一遍，再看答案。'),
      ], shown ? [
        h('button', { type: 'button', class: 'btn outline slim', onclick: () => answer(false) }, '没记住（1）'), h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn dark', onclick: () => answer(true) }, '记住了（2）'),
      ] : [
        h('button', { type: 'button', class: 'btn ghost', onclick: closeDialog }, '先到这里'), h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'btn dark', onclick: () => { shown = true; draw(); } }, '看答案（空格）'),
      ]);
      form.tabIndex = -1;
      form.addEventListener('keydown', onKey);
      form.focus();
    }
    draw();
  }

  function searchFor(value) {
    ui.search = value;
    renderList();
    const box = $('.list-search input');
    if (box) { box.focus(); box.setSelectionRange(value.length, value.length); }
  }

  /* ---------- chat ---------- */
  function taskSummary(a) {
    const sp = a.spaceId ? ' · ' + (space(a.spaceId) || {}).name : '';
    return whenLabel(a) + ' · ' + minutesLabel(a.minutes) + sp;
  }
  const stepList = (steps) => h('ol', { class: 'steps' }, steps.map((s, i) => h('li', {}, h('span', { class: 'num' }, i + 1 + '.'), h('span', { class: 'step-title' }, s.title), h('span', { class: 'sub' }, s.minutes + ' 分钟'))));
  /* The same list with controls: rename, change minutes, reorder, remove, add. */
  function editableSteps(message, index, a) {
    const steps = a.steps || [{ title: a.title, minutes: a.minutes }];
    const edit = (op) => { try { commit(C.editProposal(state, message.id, index, op)); } catch (error) { toast(error.message); } };
    const mini = (label, glyph, onclick, disabled) => h('button', { class: 'mini', 'aria-label': label, title: label, onclick, disabled }, icon(glyph));
    const isEditing = (i) => editing && editing.message === message.id && editing.action === index && editing.step === i;
    const titleInput = (s, i) => h('input', {
      class: 'step-input', value: s.title, maxLength: 100, 'aria-label': '第 ' + (i + 1) + ' 步的内容',
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { editing = null; render(); } },
      onblur: (e) => { if (!editing) return; editing = null; if (e.target.value.trim() && e.target.value.trim() !== s.title) edit({ kind: 'title', step: i, title: e.target.value }); else render(); },
    });
    return h('div', { class: 'steps-edit' },
      h('ol', { class: 'steps' }, steps.map((s, i) => h('li', {},
        h('span', { class: 'num' }, i + 1 + '.'),
        isEditing(i) ? titleInput(s, i) : h('button', { class: 'step-title editable', title: '点击修改', onclick: () => { editing = { message: message.id, action: index, step: i }; render(); } }, s.title),
        h('span', { class: 'step-tools' },
          mini('减少 5 分钟', 'minus', () => edit({ kind: 'minutes', step: i, delta: -5 }), s.minutes <= 5),
          h('span', { class: 'step-min' }, s.minutes + ' 分'),
          mini('增加 5 分钟', 'plus', () => edit({ kind: 'minutes', step: i, delta: 5 })),
          mini('上移', 'up', () => edit({ kind: 'move', step: i, dir: -1 }), i === 0),
          mini('删除这一步', 'close', () => edit({ kind: 'remove', step: i }), steps.length <= 1))))),
      h('div', { class: 'steps-foot' },
        h('button', { class: 'pill soft', onclick: () => edit({ kind: 'add' }) }, icon('plus'), '加一步'),
        h('span', { class: 'sub' }, '共 ' + minutesLabel(steps.reduce((n, s) => n + s.minutes, 0)) + ' · 点文字可以修改')));
  }
  function actionItem(a, index, message) {
    const name = (id) => (state.tasks.find((t) => t.id === id) || {}).title || '（任务已不存在）';
    const line = (kind, title, meta, extra) => h('li', {},
      h('div', { class: 'p-line' }, h('span', { class: 'tag t-' + a.type }, kind), h('span', { class: 'p-title' }, title), meta ? h('span', { class: 'sub' }, meta) : null), extra);
    if (a.type === 'add_task') return line('新任务', a.title, taskSummary(a), message.proposal.status === 'pending' ? editableSteps(message, index, a) : a.steps ? stepList(a.steps) : null);
    if (a.type === 'update_task') {
      const parts = [];
      if (a.title !== undefined) parts.push('改名为「' + a.title + '」');
      if (a.date !== undefined) parts.push('改到 ' + dateLabel(a.date));
      if (a.time !== undefined) parts.push(a.time ? '开始时间 ' + a.time : '去掉开始时间');
      if (a.minutes !== undefined) parts.push('时长 ' + minutesLabel(a.minutes));
      return line('修改', name(a.taskId), parts.join(' · '));
    }
    if (a.type === 'complete_task') return line('完成', name(a.taskId));
    if (a.type === 'delete_task') return line('删除', name(a.taskId));
    if (a.type === 'add_habit') return line('新习惯', a.title, '每周 ' + a.perWeek + ' 次');
    if (a.type === 'add_goal') {
      return line('新目标', a.title, a.deadline ? '截止 ' + plainDate(a.deadline) : '', h('div', { class: 'goal-plan' }, a.milestones.map((m) => h('div', { class: 'milestone' },
        h('div', { class: 'milestone-title' }, m.title, m.due ? h('span', { class: 'sub' }, ' · ' + plainDate(m.due) + ' 前') : null),
        h('ul', {}, m.tasks.map((t) => h('li', {}, h('span', {}, t.title), h('span', { class: 'sub' }, taskSummary(t) + (t.steps ? ' · ' + t.steps.length + ' 段' : '')))))))));
    }
    if (a.type === 'add_reflection') {
      const pending = message.proposal.status === 'pending';
      return line('反思', a.date ? dateLabel(a.date) : '今天', pending ? '可以先改正识别错的字' : '', pending
        ? h('textarea', { class: 'reflection-edit', rows: Math.min(12, a.text.split('\n').length + 2), maxLength: 4000, value: a.text, 'aria-label': '反思内容',
          onchange: (e) => { try { commit(C.editProposal(state, message.id, index, { kind: 'text', text: e.target.value })); } catch (error) { toast(error.message); } } })
        : h('p', { class: 'reflection-text' }, a.text));
    }
    if (a.type === 'log_money') return line({ in: '收入', out: '支出', saved: '忍住没花' }[a.kind], a.note || a.category, money(a.amount) + ' · ' + a.category + ' · ' + (a.date ? dateLabel(a.date) : '今天'));
    if (a.type === 'log_time') return line('补记', a.title, minutesLabel(a.minutes) + ' · ' + (a.date ? dateLabel(a.date) : '今天'));
    if (a.type === 'add_date') return line('日期', a.title, plainDate(a.date) + (a.time ? ' ' + a.time : '') + (a.place ? ' · ' + a.place : '') + ' · ' + (C.daysBetween(today(), a.date) >= 0 ? '还有 ' + C.daysBetween(today(), a.date) + ' 天' : '已经过去'));
    if (a.type === 'add_cards') return line('卡片', a.cards.length + ' 张复习卡片', a.spaceId ? (space(a.spaceId) || {}).name : '', h('ol', { class: 'card-preview' }, a.cards.map((c) => h('li', {}, h('span', {}, c.front), h('small', {}, c.back)))));
    if (a.type === 'log_metric') return line('记录', a.name + ' ' + a.value + (a.unit ? ' ' + a.unit : ''), a.date ? dateLabel(a.date) : '今天');
    return line('记住', a.text);
  }
  function proposalCard(message) {
    const p = message.proposal;
    const status = { pending: '等待你确认 · 还没有写入', accepted: '已确认并写入', dismissed: '已放弃' }[p.status];
    const canTime = p.startTimer && !state.timer && p.actions.some((a) => a.type === 'add_task');
    const resolve = (accept, withTimer) => {
      try {
        let next = C.resolveProposal(state, message.id, accept);
        if (accept && withTimer) {
          const created = next.messages.find((m) => m.id === message.id).proposal.created.map((id) => next.tasks.find((t) => t.id === id));
          const first = created.find((t) => t.steps) || created[0];
          if (first) { next = C.startTimer(next, first.id, Date.now()); openFloating(); }
        }
        if (!accept || withTimer) { if (commit(next) && accept) toast('已写入，计时开始'); }
        else undoable('已写入', () => commit(next));
      } catch (error) { toast(error.message); }
    };
    return h('div', { class: 'proposal ' + p.status },
      h('div', { class: 'proposal-head' }, h('strong', {}, '提议 · ' + p.actions.length + ' 项'), h('span', { class: 'sub' }, (p.edited ? '你修改过 · ' : '') + status)),
      h('ul', { class: 'p-list' }, p.actions.map((a, i) => actionItem(a, i, message))),
      p.status === 'pending' ? h('div', { class: 'proposal-actions' },
        canTime ? h('button', { class: 'btn dark', onclick: () => resolve(true, true) }, icon('play'), '确认并开始计时') : null,
        h('button', { class: canTime ? 'btn outline slim' : 'btn dark', onclick: () => resolve(true, false) }, canTime ? '只确认' : '确认写入'),
        h('button', { class: 'btn ghost', onclick: () => resolve(false) }, '放弃')) : null);
  }
  function chooseOption(option) {
    if (ui.busy) return;
    if (option.pref) return answerOnboarding(option);
    if (option.go === 'timetable') { ui.mode = 'timetable'; return render(); }
    if (option.go === 'model') return openSettings('model');
    if (option.feel) {
      return change((s) => {
        const task = s.tasks.find((t) => t.id === option.feel.taskId);
        if (task) task.feel = option.feel.value;
        s.messages.push({ id: C.uid('msg'), role: 'user', text: option.label, at: Date.now(), spaceId: ui.space });
        say(s, { easy: '记下了。下次类似的内容我会安排得紧一些。', ok: '记下了，这个节奏适合你。', hard: '记下了。下次类似的内容我会拆得更小，时间留得更多。' }[option.feel.value]);
      });
    }
    send(option.label);
  }
  /* A form the assistant can ask with: pick options, optionally add a note, send once. */
  function questionCard(m, isLast) {
    const live = isLast && !m.answered && !ui.busy;
    if (!answers.has(m.id)) answers.set(m.id, { picks: m.questions.map(() => []), note: '' });
    const draft = answers.get(m.id);
    const ready = () => draft.picks.every((p) => p.length) || draft.note.trim();
    const submit = () => {
      if (!ready()) return toast('请先选择，或者写一句补充');
      const lines = m.questions.map((q, i) => (draft.picks[i].length ? q.question + ' ' + draft.picks[i].join('、') : null)).filter(Boolean);
      if (draft.note.trim()) lines.push(draft.note.trim());
      answers.delete(m.id);
      if (change((s) => { s.messages.find((x) => x.id === m.id).answered = true; })) send(lines.join('\n'));
    };
    return h('div', { class: 'ask' + (live ? '' : ' closed') },
      m.questions.map((q, i) => h('fieldset', { class: 'ask-q', disabled: !live },
        h('legend', {}, h('span', { class: 'num' }, i + 1 + '.'), q.question, q.multi ? h('span', { class: 'sub' }, ' 可多选') : null),
        h('div', { class: 'ask-options' }, q.options.map((option) => {
          const on = draft.picks[i].includes(option);
          return h('button', { class: 'pill pick' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => {
            draft.picks[i] = q.multi ? (on ? draft.picks[i].filter((x) => x !== option) : [...draft.picks[i], option]) : (on ? [] : [option]);
            render();
          } }, on ? icon('check') : null, option);
        })))),
      live ? h('div', { class: 'ask-foot' },
        h('input', { class: 'ask-note', placeholder: '想补充的话写在这里（可以不写）', maxLength: 300, value: draft.note,
          oninput: (e) => { draft.note = e.target.value; }, onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) submit(); } }),
        h('button', { class: 'btn dark', onclick: submit }, '发送')) : h('span', { class: 'sub' }, m.answered ? '已回答' : '已跳过'));
  }
  function messageRow(m, isLast) {
    const mine = m.role === 'user';
    return h('div', { class: 'msg ' + (mine ? 'mine' : 'theirs') },
      h('div', { class: 'msg-meta' }, h('strong', {}, mine ? '你' : '规划助手'), h('span', {}, timeLabel(m.at)),
        m.source === 'local' && m.proposal ? h('span', { class: 'chip' }, '本地模式') : null,
        m.toolCalls ? h('span', { class: 'chip' }, '读取了 ' + m.toolCalls + ' 次资料') : null),
      m.attachments ? (m.attachments.length > 1 ? fileStack(m.id, m.attachments) : h('div', { class: 'files' }, m.attachments.map((f) => fileChip(f)))) : null,
      m.text ? h('div', { class: 'bubble' + (m.error ? ' error' : '') }, m.text) : null,
      m.learned ? h('div', { class: 'learned' }, icon('brain'), '已记住：' + m.learned.join('；')) : null,
      m.proposal ? proposalCard(m) : null,
      m.questions ? questionCard(m, isLast) : null,
      isLast && m.options && !ui.busy ? h('div', { class: 'options' }, m.options.map((o) => h('button', { class: 'pill option', onclick: () => chooseOption(o) }, o.label))) : null);
  }
  function renderChat() {
    const model = modelName();
    const thread = state.messages.filter(inThread);
    const last = thread.length - 1;
    const previous = $('#chatScroll');
    const offset = previous ? previous.scrollTop : 0;
    const chatKey = ui.space + ':' + thread.length + ':' + ui.busy + ':' + ui.busyText;
    const scroller = h('div', { class: 'chat-scroll', id: 'chatScroll' },
      thread.map((m, i) => messageRow(m, i === last)),
      !thread.length && !ui.busy ? h('div', { class: 'welcome' },
        h('h3', {}, space(ui.space) ? '在「' + space(ui.space).name + '」里想推进什么？' : (state.settings.prefs.name ? state.settings.prefs.name + '，' : '') + '今天想推进什么？'),
        h('p', { class: 'sub' }, '告诉我你的任务、目标或者困难，也可以把课件、图片拖进来。我会先看你的安排和记录，再提出修改，你确认之后才会写入。'),
        h('div', { class: 'starters' }, (space(ui.space) ? STARTERS_BY_TYPE[space(ui.space).type] : STARTERS).map((text) => h('button', { class: 'pill soft', onclick: () => send(text) }, text)))) : null,
      ui.busy ? h('div', { class: 'msg theirs' }, h('div', { class: 'bubble typing', role: 'status' }, h('i'), h('i'), h('i'), ui.busyText ? h('span', { class: 'sub' }, ui.busyText) : null)) : null);
    const input = h('textarea', {
      id: 'composer', rows: 2, maxLength: 4000, value: ui.draft,
      placeholder: model ? '说说你想做什么，或把课件、图片、代码文件拖进来' : '本地模式：例如「单片机 2小时」。连接模型后可以读课件',
      oninput: (e) => { ui.draft = e.target.value; updateSend(); },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } },
      onpaste: (e) => { const files = [...(e.clipboardData ? e.clipboardData.files : [])]; if (files.length) { e.preventDefault(); addFiles(files); } },
    });
    const picker = h('input', { type: 'file', multiple: true, hidden: true, onchange: (e) => { addFiles(e.target.files); e.target.value = ''; } });
    const main = $('#main');
    const here = space(ui.space);
    main.replaceChildren(
      h('header', { class: 'main-head' },
        h('div', {}, h('h2', {}, here ? here.name + ' · 规划助手' : '规划助手'), h('p', { class: 'sub' }, (here ? '这个分区自己的对话 · ' : '总对话 · ') + (model ? '模型：' + model : '本地模式，还没有连接 AI 模型'))),
        h('div', { class: 'head-actions' },
          h('button', { class: 'pill soft', onclick: () => openSettings('memory') }, icon('note'), h('span', {}, '记忆 ' + state.memory.length + ' 条')),
          !model ? h('button', { class: 'pill soft', onclick: () => openSettings('model') }, icon('plus'), h('span', {}, '连接模型')) : null)),
      scroller,
      h('div', { class: 'composer' },
        ui.attachments.length || ui.parsing ? h('div', { class: 'files' },
          ui.attachments.map((f) => fileChip(f, () => { ui.attachments = ui.attachments.filter((x) => x !== f); render(); })),
          ui.parsing ? h('span', { class: 'file-chip' }, '正在读取文件…') : null) : null,
        input,
        h('div', { class: 'composer-bar' },
          h('button', { class: 'icon-btn small', 'aria-label': '添加文件', title: '添加课件、图片或代码文件', onclick: () => picker.click() }, icon('clip')), picker,
          h('span', { class: 'sub grow' }, here ? '新建的任务和目标会放进「' + here.name + '」' : '助手只会提议，你确认后才写入'),
          ui.busy && ui.abort ? h('button', { class: 'send stop', 'aria-label': '停止回答', title: '停止回答', onclick: () => ui.abort.abort() }, icon('stop'))
            : h('button', { class: 'send', id: 'send', 'aria-label': '发送', onclick: () => send() }, icon('send')))),
      h('div', { class: 'drop-hint' }, icon('file'), '松开，把文件交给助手'));
    updateSend();
    scroller.scrollTop = previous && chatKey === lastChatKey ? offset : scroller.scrollHeight;
    lastChatKey = chatKey;
    const stepInput = main.querySelector('.step-input');
    if (stepInput) { stepInput.focus(); stepInput.select(); }
  }
  function updateSend() {
    const button = $('#send');
    if (button) button.disabled = ui.busy || ui.parsing > 0 || !(ui.draft.trim() || ui.attachments.length);
  }

  async function addFiles(fileList) {
    if (ui.mode === 'timetable') { timetable.openImport(fileList); return; }
    if (ui.mode === 'home' || ui.mode === 'week' || ui.mode === 'review' || ui.mode === 'money') { ui.mode = 'planner'; ui.space = null; } // files go to the general chat
    const files = [...fileList].slice(0, 6);
    if (!files.length) return;
    if (files.some((f) => /课表|课程表|timetable|schedule/i.test(f.name))) toast('这像是课表。聊天里只会当作资料读，不会排进日程', { label: '去课表导入', run: () => {
      ui.attachments = ui.attachments.filter((x) => !files.some((f) => f.name === x.name));
      ui.mode = 'timetable'; render(); timetable.openImport(files);
    } });
    ui.parsing += files.length;
    render();
    for (const file of files) {
      try {
        const parsed = await Files.parseFile(file);
        if (!parsed.image) library.set(parsed.name, parsed);
        ui.attachments = ui.attachments.filter((x) => x.name !== parsed.name).concat(parsed);
      } catch (error) {
        toast(file.name + '：' + error.message);
      }
      ui.parsing--;
      render();
    }
    const box = $('#composer');
    if (box) box.focus();
  }

  const TOOL_LABELS = {
    read_attachment: (a) => '正在读取 ' + (a.name || '附件') + '…',
    get_history: () => '正在查看你的记录…',
  };
  async function send(preset) {
    const attachments = preset ? [] : ui.attachments;
    const pictures = attachments.filter((f) => f.image);
    const text = (preset || ui.draft).trim() || (pictures.length ? '请读一下图片里的内容，并帮我记录下来。' : attachments.length ? '请根据这些文件帮我安排学习。' : '');
    if (!text || ui.busy) return;
    if (pictures.length) {
      if (!modelName()) return toast('读图片需要先连接 AI 模型');
      if (!platform.canSeeImages) return toast('桌面版暂时不能发送图片');
      if (state.settings.agent.vision === false) return toast('测试时这个模型不能识图。请在设置里换一个能识图的模型。');
    }
    const threadSpace = ui.space; // fixed now: the reply belongs to the conversation it was asked in, even if the user switches space meanwhile
    const context = C.buildContext(state, today(), text, threadSpace);
    if (threadSpace) { context.currentSpace = space(threadSpace).name; context.currentSpaceType = space(threadSpace).type; }
    const sent = { id: C.uid('msg'), role: 'user', text, at: Date.now(), spaceId: threadSpace };
    if (attachments.length) sent.attachments = attachments.map((f) => ({ name: f.name, kind: f.kind, units: f.units, ...(f.thumb ? { thumb: f.thumb } : {}) }));
    if (!change((s) => s.messages.push(sent))) return;
    if (!preset) { ui.draft = ''; ui.attachments = []; }
    const useModel = !!modelName();
    let answer;
    let error = null;
    let stopped = false;
    const control = useModel ? new AbortController() : null;
    ui.abort = control;
    ui.busy = true;
    ui.busyText = '';
    render();
    try {
      if (useModel) {
        answer = await Agent.run({
          context, attachments, library,
          signal: control.signal,
          chat: (system, user, images) => platform.chat(state.settings.agent, system, user, images, undefined, control.signal),
          tools: {
            get_history: (a) => C.history(state, today(), a.days),
          },
          onStep: (name, args) => { ui.busyText = (TOOL_LABELS[name] || (() => '正在查资料…'))(args); render(); },
        });
      } else {
        answer = C.localReply(text, today(), state.settings.prefs);
      }
    } catch (e) {
      if (e.name === 'AbortError') stopped = true; else error = e.message;
    }
    ui.busy = false;
    ui.abort = null;
    change((s) => {
      const now = Date.now();
      if (stopped) { s.messages.push({ id: C.uid('msg'), role: 'assistant', at: now, source: 'local', spaceId: threadSpace, text: '已停止这次回答，没有写入任何内容。' }); return; }
      const message = { id: C.uid('msg'), role: 'assistant', at: now, source: useModel ? 'ai' : 'local', spaceId: threadSpace, text: error || answer.reply };
      if (error) { message.error = true; s.messages.push(message); return; }
      // Inside a space, everything new goes to that space; the model's own choice only counts in the general chat.
      const withSpace = answer.actions.map((a) => (a && typeof a === 'object' && threadSpace ? { ...a, spaceId: threadSpace } : a));
      const checked = C.validateActions(s, withSpace);
      // Memory notes are saved right away (they are easy to review and delete); everything else waits for confirmation.
      const notes = [...answer.memory, ...checked.actions.filter((a) => a.type === 'remember').map((a) => a.text)];
      const learned = notes.filter((note) => C.addMemory(s, note, now, message.source));
      if (learned.length) message.learned = learned;
      const actions = checked.actions.filter((a) => a.type !== 'remember');
      if (actions.length) message.proposal = { status: 'pending', source: message.source, actions, startTimer: answer.startTimer };
      if (checked.rejected.length) message.text += '\n（有 ' + checked.rejected.length + ' 项提议格式不对，已忽略。）';
      if (answer.questions.length) message.questions = answer.questions;
      else if (answer.options.length) message.options = answer.options.map((label) => ({ label }));
      if (answer.toolCalls) message.toolCalls = answer.toolCalls;
      s.messages.push(message);
      if (s.messages.length > 400) s.messages = s.messages.slice(-400);
    });
  }

  /* ---------- timer dock and floating window ---------- */
  function beginTimer(taskId) {
    try { if (commit(C.startTimer(state, taskId, Date.now()))) openFloating(); }
    catch (error) { toast(error.message); }
  }
  /* A real always-on-top window where the browser supports it; otherwise the dock stays in the page. */
  async function openFloating() {
    if (platform.openFloating) { platform.openFloating(); tick(); return; }
    if (pip || !('documentPictureInPicture' in window)) return;
    try {
      const compact = state.settings.prefs.timerCompact;
      const win = await window.documentPictureInPicture.requestWindow({ width: compact ? 300 : 340, height: compact ? 84 : 250 });
      for (const link of document.querySelectorAll('link[rel=stylesheet]')) win.document.head.append(link.cloneNode());
      win.document.documentElement.className = 'light'; // the floating timer stays light whatever the system theme
      win.document.title = '计时';
      win.document.body.className = 'pip-body';
      win.addEventListener('pagehide', () => { pip = null; renderDock(); });
      pip = win;
      renderDock();
    } catch { /* the user or the browser declined; the in-page dock is still there */ }
  }
  function beep() {
    try {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.8);
      tone.connect(gain).connect(audio.destination);
      tone.start();
      tone.stop(audio.currentTime + 0.8);
    } catch { /* sound is optional */ }
  }
  function finishCurrentStep() {
    const result = C.finishStep(state, Date.now());
    if (result.finishedTask) {
      askFeel(result.state, result.state.tasks.find((t) => t.id === result.finishedTask));
      if (pip) pip.close();
    }
    if (commit(result.state) && result.finishedTask && result.session) openWrapUp(result.finishedTask, result.session.id);
  }
  function renderDock() {
    const inPage = $('#dock');
    const view = C.timerView(state, Date.now());
    if (!view && platform.updateTimer) platform.updateTimer(null);
    if (!view) { inPage.hidden = true; inPage.replaceChildren(); return; }
    const button = (label, cls, onclick, glyph) => h('button', { class: 'btn ' + cls, onclick }, glyph ? icon(glyph) : null, label);
    const last = view.index === view.total - 1;
    const compact = state.settings.prefs.timerCompact;
    const setCompact = (value) => {
      if (pip) { try { pip.resizeTo(value ? 300 : 340, value ? 84 + (pip.outerHeight - pip.innerHeight) : 250 + (pip.outerHeight - pip.innerHeight)); } catch { /* size stays as the user left it */ } }
      change((s) => { s.settings.prefs.timerCompact = value; });
    };
    const iconButton = (label, glyph, onclick, cls) => h('button', { class: 'icon-btn small ' + (cls || ''), 'aria-label': label, title: label, onclick }, icon(glyph));
    const content = compact ? h('div', { class: 'dock-card compact' },
      h('div', { class: 'dock-row' },
        h('div', { class: 'dock-time', id: 'dockTime' }),
        h('div', { class: 'dock-titles' }, h('span', { class: 'sub' }, '第 ' + (view.index + 1) + '/' + view.total + ' 段'), h('strong', { class: 'dock-step', title: view.step.title }, view.step.title)),
        view.running ? iconButton('暂停', 'pause', () => commit(C.pauseTimer(state, Date.now()))) : iconButton('继续', 'play', () => commit(C.resumeTimer(state, Date.now()))),
        iconButton(last ? '完成' : '下一段', 'check', finishCurrentStep, 'solid'),
        iconButton('展开', 'grow', () => setCompact(false))),
      h('div', { class: 'dock-dots', 'aria-hidden': 'true' }, view.task.steps.map((s, i) => h('span', { class: s.done ? 'done' : i === view.index ? 'now' : '', style: 'flex:' + s.minutes }, i === view.index ? h('i', { id: 'dockFill' }) : null))))
    : h('div', { class: 'dock-card' },
      h('div', { class: 'dock-head' },
        h('div', { class: 'dock-titles' },
          h('span', { class: 'sub' }, view.task.title + ' · 第 ' + (view.index + 1) + '/' + view.total + ' 段'),
          h('strong', { class: 'dock-step' }, view.step.title),
          view.task.next ? h('span', { class: 'sub dock-next', title: view.task.next }, '上次停在：' + view.task.next) : null),
        h('div', { class: 'dock-corner' },
          iconButton('最小化', 'shrink', () => setCompact(true)),
          !pip && (platform.openFloating || 'documentPictureInPicture' in window) ? iconButton('打开悬浮窗', 'pop', openFloating) : null)),
      h('div', { class: 'dock-time', id: 'dockTime' }),
      h('div', { class: 'dock-dots', 'aria-hidden': 'true' }, view.task.steps.map((s, i) => h('span', { class: s.done ? 'done' : i === view.index ? 'now' : '', style: 'flex:' + s.minutes }, i === view.index ? h('i', { id: 'dockFill' }) : null))),
      h('div', { class: 'dock-actions' },
        view.running ? button('暂停', 'outline slim', () => commit(C.pauseTimer(state, Date.now())), 'pause') : button('继续', 'outline slim', () => commit(C.resumeTimer(state, Date.now())), 'play'),
        button(last ? '完成' : '下一段', 'dark', finishCurrentStep, 'check'),
        button('+5 分', 'ghost', () => commit(C.extendTimer(state, 5))),
        button('结束', 'ghost', stopTimerNow)));
    // A running timer must stay visible: if the task column is closed and there is no floating window, open the column.
    if (!pip && state.settings.prefs.listWidth === 0) showListWidth(LIST.min);
    if (pip) { pip.document.body.replaceChildren(content); inPage.hidden = true; inPage.replaceChildren(); }
    else { inPage.replaceChildren(content); inPage.hidden = false; }
    tick();
  }
  /* Runs twice a second: updates the clock text only, and announces the end of a step once. */
  function tick() {
    const view = C.timerView(state, Date.now());
    if (platform.updateTimer) platform.updateTimer(view ? { title: view.task.title, step: view.step.title, index: view.index, total: view.total, running: view.running, due: view.due, remainingMs: view.remainingMs, at: Date.now() } : null);
    if (!view) return;
    const doc = pip ? pip.document : document;
    for (const mirror of document.querySelectorAll('.clock-mirror')) { // the workbench shows the same clock
      mirror.textContent = view.due ? '+' + clock(view.remainingMs) : clock(view.remainingMs);
      mirror.classList.toggle('due', view.due);
    }
    const time = doc.getElementById('dockTime');
    if (!time) return;
    time.textContent = view.due ? '+' + clock(view.remainingMs) : clock(view.remainingMs);
    time.className = 'dock-time' + (view.due ? ' due' : '') + (view.running ? '' : ' paused');
    const fill = doc.getElementById('dockFill');
    if (fill) fill.style.width = Math.min(100, (view.elapsedMs / (view.step.minutes * 60000)) * 100) + '%';
    document.title = (view.due ? '到时间了 · ' : clock(view.remainingMs) + ' · ') + view.step.title;
    const key = view.task.id + ':' + view.index + ':' + view.step.minutes;
    if (view.due && view.running && dueNotified !== key) {
      dueNotified = key;
      beep();
      toast('「' + view.step.title + '」到时间了');
    }
  }
  setInterval(() => { if (state.timer) tick(); else if (document.title !== 'T计划') document.title = 'T计划'; }, 500);

  /* Reminders: a class or a task with a start time is announced once, a few minutes ahead.
     Always shown in the window with a sound; also as a system notification where that is allowed. */
  const reminded = new Set();
  const canNotify = () => typeof Notification === 'function';
  function checkReminders() {
    const lead = Number(state.settings.prefs.remindMinutes) || 0;
    if (!lead) return;
    const now = new Date();
    const t = today();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (clockTime) => Number(clockTime.slice(0, 2)) * 60 + Number(clockTime.slice(3));
    const due = [
      ...window.TPlanTimetable.events(state.schedule, t, t).map((e) => ({ key: 'c:' + e.courseId + ':' + t + ':' + e.startTime, start: e.startTime, text: '上课：' + e.title + (e.room ? '（' + e.room + '）' : '') })),
      ...state.tasks.filter((x) => !x.done && x.date === t && x.time && !(state.timer && state.timer.taskId === x.id)).map((x) => ({ key: 't:' + x.id + ':' + t + ':' + x.time, start: x.time, text: x.title })),
    ].filter((item) => { const ahead = toMinutes(item.start) - nowMinutes; return ahead >= 0 && ahead <= lead && !reminded.has(item.key); });
    if (!due.length) return;
    for (const item of due) reminded.add(item.key);
    const text = due.map((item) => item.start + ' ' + item.text).join('；');
    beep();
    toast('快到时间了：' + text);
    try { if (canNotify() && Notification.permission === 'granted') new Notification('T计划 · 快到时间了', { body: text }); } catch { /* the in-window reminder was already shown */ }
  }
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 1500);
  if (platform.onTimerCommand) platform.onTimerCommand((command) => {
    if (!state.timer) return;
    if (command === 'pause') commit(C.pauseTimer(state, Date.now()));
    else if (command === 'resume') commit(C.resumeTimer(state, Date.now()));
    else if (command === 'extend') commit(C.extendTimer(state, 5));
    else if (command === 'next') finishCurrentStep();
    else if (command === 'stop') stopTimerNow();
  });

  /* ---------- review ---------- */
  function profileLines() {
    const p = C.buildProfile(state, today());
    const prefs = state.settings.prefs;
    const lines = [];
    lines.push('你说：一次专注 ' + prefs.segment + ' 分钟' + (prefs.dailyMinutes ? '，每天可安排 ' + minutesLabel(prefs.dailyMinutes) : '') + (prefs.bestTime ? '，' + prefs.bestTime + '效率最高' : '') + '。');
    if (p.actualVsPlanned) lines.push('实际用时是计划的 ' + Math.round(p.actualVsPlanned * 100) + '%' + (p.actualVsPlanned > 1.15 ? '，你通常比计划慢，助手会把时间留多一些。' : p.actualVsPlanned < 0.85 ? '，你通常比计划快。' : '，估计比较准。'));
    if (p.typicalFocusMinutes) lines.push('你真实的一段专注大约 ' + p.typicalFocusMinutes + ' 分钟。');
    if (p.focusMinutesByTimeOfDay) {
      const [best, minutes] = Object.entries(p.focusMinutesByTimeOfDay).sort((a, b) => b[1] - a[1])[0];
      lines.push('记录里你在' + best + '专注得最多（' + minutesLabel(minutes) + '）。');
    }
    if (p.last14Days) lines.push('最近 14 天安排了 ' + p.last14Days.planned + ' 项，完成 ' + p.last14Days.done + ' 项。');
    if (p.difficultyFeedback) lines.push('你的反馈：太简单 ' + p.difficultyFeedback.easy + ' 次，正好 ' + p.difficultyFeedback.ok + ' 次，太难 ' + p.difficultyFeedback.hard + ' 次。');
    if (p.sessionsRecorded < 3) lines.push('计时记录还只有 ' + p.sessionsRecorded + ' 段。用计时完成 3 段以上，助手就能开始根据你的真实速度调整。');
    return lines;
  }
  /* Seven narrow day strips side by side. Clicking one widens it while the others narrow together;
     its details fade in only after the width has settled, so text is never squeezed mid-animation. */
  let reviewDay = null;
  function dayAccordion(days, sessions, max) {
    const t = today();
    if (!days.includes(reviewDay)) reviewDay = days.includes(t) ? t : days[0];
    const box = h('div', { class: 'accordion', role: 'tablist', 'aria-label': '本周每天' });
    days.forEach((d, i) => {
      const mine = sessions.filter((x) => x.date === d);
      const minutes = mine.reduce((n, x) => n + x.actual, 0);
      const done = state.tasks.filter((x) => x.done && x.doneAt && C.todayISO(new Date(x.doneAt)) === d);
      const planned = state.tasks.filter((x) => x.date === d);
      const open = d === reviewDay;
      const strip = h('button', {
        class: 'strip' + (open ? ' open' : '') + (d === t ? ' today' : ''), role: 'tab', 'aria-selected': String(open),
        'aria-label': plainDate(d) + '，专注 ' + minutes + ' 分钟，完成 ' + done.length + ' 项',
        style: '--level:' + (minutes / max).toFixed(3),
        onclick: () => {
          reviewDay = d;
          for (const other of box.children) { other.classList.toggle('open', other === strip); other.setAttribute('aria-selected', String(other === strip)); }
        },
      },
        h('span', { class: 'strip-top' }, h('span', { class: 'strip-day' }, '一二三四五六日'[i]), h('span', { class: 'strip-min' }, minutes ? String(minutes) : '')),
        // One character per line: a plain column reads upright in every browser.
        h('span', { class: 'strip-name', 'aria-hidden': 'true' }, [...(d === t ? '今天' : '周' + '一二三四五六日'[i])].map((ch) => h('span', {}, ch))),
        h('span', { class: 'strip-content' },
          h('strong', {}, plainDate(d) + ' 周' + '一二三四五六日'[i] + (d === t ? '（今天）' : '')),
          h('span', { class: 'strip-stats' },
            h('span', {}, h('b', {}, minutesLabel(minutes)), '专注'),
            h('span', {}, h('b', {}, String(mine.length)), '计时段'),
            h('span', {}, h('b', {}, done.length + (planned.length ? ' / ' + planned.length : '')), planned.length ? '完成 / 安排' : '完成')),
          done.length ? h('span', { class: 'strip-list' }, done.slice(0, 4).map((x) => h('span', {}, '✓ ' + x.title)), done.length > 4 ? h('span', { class: 'sub' }, '还有 ' + (done.length - 4) + ' 项') : null)
            : h('span', { class: 'sub' }, d > t ? '这一天还没到。' : '这一天没有完成的任务记录。')));
      box.append(strip);
    });
    return box;
  }
  let reviewOffset = 0; // 0 is this week, -1 the week before, and so on
  /* ---------- the longer view on the review page: a calendar of recorded time, weekly totals, and where the time went ---------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) if (value != null && value !== false) el.setAttribute(key, value);
    for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
    return el;
  }
  /* Runs of days with recorded time: the longest one, and the one that reaches today (or yesterday,
     since today may simply not be over yet). */
  function streaks(days, t) {
    let longest = 0, run = 0;
    for (const d of days) { if (d.minutes === null) break; run = d.minutes > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
    const past = days.filter((d) => d.minutes !== null);
    let i = past.length - 1;
    if (i >= 0 && past[i].date === t && !past[i].minutes) i--;
    let current = 0;
    for (; i >= 0 && past[i].minutes > 0; i--) current++;
    return { longest, current };
  }
  const shortTime = (m) => (m >= 60 ? (m % 60 ? Math.floor(m / 60) + 'h' + (m % 60) + 'm' : m / 60 + 'h') : m + 'm');
  function trajectoryCard(goToWeek) {
    const t = today();
    const data = C.trajectory(state, t);
    const root = h('section', { class: 'card viz' });
    const tip = h('div', { class: 'viz-tip', role: 'status', hidden: true });
    /* One tooltip for every mark in the card: shown on hover and on keyboard focus. */
    const hint = (el, lines) => {
      const show = () => {
        tip.replaceChildren(...lines.map((line, i) => h(i ? 'span' : 'strong', {}, line)));
        tip.hidden = false;
        const box = el.getBoundingClientRect(), home = root.getBoundingClientRect();
        const left = Math.min(Math.max(box.left + box.width / 2 - home.left, 80), home.width - 80);
        tip.style.left = left + 'px';
        tip.style.top = box.top - home.top - 8 + 'px';
      };
      el.addEventListener('pointerenter', show); el.addEventListener('focus', show);
      el.addEventListener('pointerleave', () => { tip.hidden = true; }); el.addEventListener('blur', () => { tip.hidden = true; });
      return el;
    };
    const weekdayOf = (date) => '周' + '日一二三四五六'[new Date(date + 'T12:00:00').getDay()];
    const block = (title, extra, ...body) => h('div', { class: 'viz-block' }, h('header', { class: 'viz-block-head' }, h('h4', {}, title), extra || null), body);

    // --- the numbers behind the calendar, all read from recorded time
    const past = data.heat.filter((d) => d.minutes !== null);
    const total = past.reduce((n, d) => n + d.minutes, 0);
    const best = past.reduce((b, d) => (d.minutes > b.minutes ? d : b), { minutes: 0 });
    const runs = streaks(data.heat, t);
    const figure = (value, label, note, cls) => h('div', { class: 'viz-fig' + (cls ? ' ' + cls : '') }, h('strong', {}, value), h('span', {}, label), note ? h('small', {}, note) : null);
    const figures = h('div', { class: 'viz-figs' },
      figure(total ? minutesLabel(total) : '0', '20 周累计记录', data.recordedDays ? '有记录的日子平均 ' + minutesLabel(Math.round(total / data.recordedDays)) : null, 'lead'),
      figure(String(data.recordedDays), '有记录的天数', '共 ' + past.length + ' 天'),
      figure(runs.current + ' 天', '当前连续', runs.current ? '到' + (past.length && past[past.length - 1].minutes ? '今天' : '昨天') : '今天记一段就开始', runs.current ? 'hot' : ''),
      figure(runs.longest + ' 天', '最长连续'),
      figure(best.minutes ? minutesLabel(best.minutes) : '—', '记录最多的一天', best.minutes ? plainDate(best.date) + ' ' + weekdayOf(best.date) : null));

    // --- calendar: one cell per day, darker for more recorded time; it stretches to the width it is given
    const level = (m) => (m === null ? 'future' : m === 0 ? 0 : m <= 15 ? 1 : m <= 30 ? 2 : m <= 60 ? 3 : m <= 120 ? 4 : 5);
    const columns = Array.from({ length: 20 }, (_, w) => data.heat.slice(w * 7, w * 7 + 7));
    const heat = h('div', { class: 'viz-heat', role: 'group', 'aria-label': '最近 20 周每天已记录的时间' },
      h('span', { class: 'viz-heat-corner', 'aria-hidden': 'true' }),
      columns.map((week, w) => h('span', { class: 'viz-heat-month', 'aria-hidden': 'true', style: 'grid-column:' + (w + 2) },
        (w === 0 ? columns[1][0].date.slice(5, 7) === week[0].date.slice(5, 7) : week[0].date.slice(5, 7) !== columns[w - 1][0].date.slice(5, 7)) ? Number(week[0].date.slice(5, 7)) + '月' : '')),
      ['一', '', '三', '', '五', '', '日'].map((x, r) => h('span', { class: 'viz-heat-day', 'aria-hidden': 'true', style: 'grid-row:' + (r + 2) }, x)),
      columns.map((week, w) => week.map((d, r) => {
        const place = 'grid-column:' + (w + 2) + ';grid-row:' + (r + 2);
        return d.minutes === null ? h('span', { class: 'viz-cell future', style: place, 'aria-hidden': 'true' })
          : hint(h('button', { type: 'button', class: 'viz-cell l' + level(d.minutes) + (d.date === t ? ' today' : ''), style: place, 'aria-label': plainDate(d.date) + ' ' + weekdayOf(d.date) + '，' + (d.minutes ? '已记录 ' + minutesLabel(d.minutes) : '没有记录'), onclick: () => goToWeek(d.date) }),
            [plainDate(d.date) + ' ' + weekdayOf(d.date) + (d.date === t ? '（今天）' : ''), d.minutes ? '已记录 ' + minutesLabel(d.minutes) : '没有记录', '点一下看这一周']);
      })));
    const heatLegend = h('div', { class: 'viz-scale' }, h('span', {}, '少'), [['l0', '没有记录'], ['l1', '15 分钟以内'], ['l2', '16–30 分钟'], ['l3', '31–60 分钟'], ['l4', '1–2 小时'], ['l5', '2 小时以上']].map(([cls, label]) => hint(h('i', { class: 'viz-cell ' + cls, tabIndex: 0, 'aria-label': label }), [label])), h('span', {}, '多'));

    // --- weekly totals: twelve columns on one scale, with gridlines and the twelve-week average
    const rawTop = Math.max(60, ...data.weeks.map((w) => w.minutes));
    const tick = [15, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 3000].find((s) => rawTop / s <= 4) || 6000;
    const top = Math.ceil(rawTop / tick) * tick;
    const ticks = Array.from({ length: top / tick + 1 }, (_, i) => i * tick).reverse();
    const peak = data.weeks.reduce((b, w) => (w.minutes > b.minutes ? w : b), data.weeks[0]);
    const average = Math.round(data.weeks.reduce((n, w) => n + w.minutes, 0) / data.weeks.length);
    const pct = (m) => ((m / top) * 100).toFixed(1) + '%';
    const weekly = h('div', { class: 'viz-bars' },
      h('div', { class: 'viz-bars-axis', 'aria-hidden': 'true' }, ticks.map((v) => h('span', { style: 'bottom:' + pct(v) }, v ? shortTime(v) : '0'))),
      h('div', { class: 'viz-bars-plot', role: 'group', 'aria-label': '最近 12 周每周已记录的时间' },
        ticks.map((v) => h('i', { class: 'viz-gridline' + (v ? '' : ' base'), style: 'bottom:' + pct(v), 'aria-hidden': 'true' })),
        average ? h('div', { class: 'viz-avg', style: 'bottom:' + pct(average), 'aria-hidden': 'true' }, h('span', {}, '平均 ' + shortTime(average))) : null,
        data.weeks.map((w, i) => {
          const current = i === data.weeks.length - 1;
          const label = current || (w === peak && w.minutes) ? shortTime(w.minutes) : '';
          return hint(h('button', { type: 'button', class: 'viz-week' + (current ? ' current' : '') + (w.minutes ? '' : ' empty'), 'aria-label': plainDate(w.monday) + ' 那一周，已记录 ' + minutesLabel(w.minutes) + '，' + w.activeDays + ' 天有记录', onclick: () => goToWeek(w.monday) },
            h('i', { style: 'height:' + (w.minutes ? pct(w.minutes) : '3px') }, label && w.minutes ? h('span', { class: 'viz-week-value' }, label) : null)),
          [plainDate(w.monday) + ' – ' + plainDate(C.addDays(w.monday, 6)) + (current ? '（本周）' : ''), '已记录 ' + minutesLabel(w.minutes), w.activeDays + ' 天有记录', '点一下看这一周']);
        })),
      h('span', { class: 'viz-bars-corner' }),
      h('div', { class: 'viz-bars-labels', 'aria-hidden': 'true' }, data.weeks.map((w, i) => h('span', { class: i === data.weeks.length - 1 ? 'current' : '' }, i === data.weeks.length - 1 ? '本周' : i % 2 === 1 ? Number(w.monday.slice(5, 7)) + '/' + Number(w.monday.slice(8)) : ''))));
    const thisWeek = data.weeks[data.weeks.length - 1].minutes, lastWeek = data.weeks[data.weeks.length - 2].minutes;
    const trend = !thisWeek && !lastWeek ? null : !lastWeek ? '上周没有记录' : (thisWeek >= lastWeek ? '比上周多 ' : '比上周少 ') + minutesLabel(Math.abs(thisWeek - lastWeek));

    // --- balance: the same unit on every axis, the last four weeks over the four before, then the same as ranked bars
    let balance;
    if (!data.balance) balance = h('p', { class: 'empty' }, '至少有三个分区时，这里会画出时间在各分区之间的分布。');
    else {
      const axes = data.balance.axes, n = axes.length, size = 300, cx = size / 2, cy = size / 2 + 4, R = 96;
      const rawMax = Math.max(30, ...axes.map((a) => Math.max(a.recent, a.previous)));
      const step = rawMax <= 60 ? 15 : rawMax <= 240 ? 60 : rawMax <= 600 ? 120 : 300;
      const max = Math.ceil(rawMax / step) * step;
      const at = (i, value) => { const angle = -Math.PI / 2 + (i / n) * Math.PI * 2, r = (value / max) * R; return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]; };
      const points = (key) => axes.map((a, i) => at(i, a[key]).map((v) => v.toFixed(1)).join(',')).join(' ');
      const color = (a) => (space(a.id) || {}).color || 'var(--t3)';
      const svg = sv('svg', { viewBox: '0 0 ' + size + ' ' + size, class: 'viz-radar', role: 'img', 'aria-label': '各分区已记录时间：最近 4 周与之前 4 周的对比。旁边的条形列出了同样的数字。' },
        [0.25, 0.5, 0.75, 1].map((f, k) => sv('polygon', { class: 'viz-ring' + (k === 3 ? ' outer' : ''), points: axes.map((_, i) => at(i, max * f).map((v) => v.toFixed(1)).join(',')).join(' ') })),
        axes.map((_, i) => { const [x, y] = at(i, max); return sv('line', { class: 'viz-ring', x1: cx, y1: cy, x2: x.toFixed(1), y2: y.toFixed(1) }); }),
        sv('polygon', { class: 'viz-shape previous', points: points('previous') }),
        sv('polygon', { class: 'viz-shape recent', points: points('recent') }),
        axes.map((a, i) => { const [x, y] = at(i, a.previous); return sv('circle', { class: 'viz-dot previous', cx: x.toFixed(1), cy: y.toFixed(1), r: 3.5 }); }),
        axes.map((a, i) => { const [x, y] = at(i, a.recent); return sv('circle', { class: 'viz-dot recent', cx: x.toFixed(1), cy: y.toFixed(1), r: 4.5 }); }),
        axes.map((a, i) => {
          const [x, y] = at(i, max * 1.2);
          const label = sv('text', { class: 'viz-axis', x: x.toFixed(1), y: y.toFixed(1), 'text-anchor': Math.abs(x - cx) < 12 ? 'middle' : x > cx ? 'start' : 'end', 'dominant-baseline': 'middle' });
          label.textContent = a.name.length > 7 ? a.name.slice(0, 6) + '…' : a.name;
          return label;
        }),
        axes.map((a, i) => { const [x, y] = at(i, Math.max(a.recent, a.previous, max * 0.12)); return hint(sv('circle', { class: 'viz-hit', cx: x.toFixed(1), cy: y.toFixed(1), r: 16, tabindex: 0, role: 'img', 'aria-label': a.name + '：最近 4 周 ' + minutesLabel(a.recent) + '，之前 4 周 ' + minutesLabel(a.previous) }),
          [a.name, '最近 4 周 ' + minutesLabel(a.recent), '之前 4 周 ' + minutesLabel(a.previous)]); }));
      const barMax = Math.max(1, ...axes.map((a) => Math.max(a.recent, a.previous)));
      const ranked = [...axes].sort((a, b) => b.recent - a.recent || b.previous - a.previous);
      balance = [
        h('div', { class: 'viz-legend' }, h('span', {}, h('i', { class: 'viz-key recent' }), '最近 4 周 · ' + minutesLabel(data.balance.recentTotal)), h('span', {}, h('i', { class: 'viz-key previous' }), '之前 4 周 · ' + minutesLabel(data.balance.previousTotal))),
        h('div', { class: 'viz-balance' }, svg,
          h('ul', { class: 'viz-rank', 'aria-label': '各分区已记录时间' }, ranked.map((a) => {
            const share = data.balance.recentTotal ? Math.round((a.recent / data.balance.recentTotal) * 100) : 0;
            return h('li', {},
              h('span', { class: 'viz-rank-name' }, h('i', { style: 'background:' + color(a) }), a.name),
              h('span', { class: 'viz-rank-value' }, minutesLabel(a.recent), data.balance.recentTotal ? h('small', {}, share + '%') : null),
              h('span', { class: 'viz-rank-track' }, h('i', { class: 'recent', style: 'width:' + ((a.recent / barMax) * 100).toFixed(1) + '%' }), h('i', { class: 'previous', style: 'width:' + ((a.previous / barMax) * 100).toFixed(1) + '%' })),
              h('small', { class: 'viz-rank-prev' }, '之前 4 周 ' + minutesLabel(a.previous)));
          }))),
        h('p', { class: 'viz-note' }, '雷达图每条轴是一个分区，单位都是已记录的时间；最外圈是 ' + minutesLabel(max) + '。'),
      ];
    }
    root.append(
      h('div', { class: 'card-head' }, h('div', { class: 'viz-title' }, h('h3', {}, '成长轨迹'), h('span', { class: 'sub' }, '最近 20 周里有 ' + data.recordedDays + ' 天留下了记录')),
        h('span', { class: 'viz-badge' }, '只统计计时和补记 · 时长不代表学习效果')),
      h('div', { class: 'viz-top' },
        block('每天已记录的时间 · 最近 20 周', heatLegend, heat),
        figures),
      h('div', { class: 'viz-grid' },
        block('每周已记录的时间 · 最近 12 周', trend ? h('span', { class: 'viz-trend' + (thisWeek >= lastWeek ? ' up' : ' down') }, trend) : null, weekly,
          h('p', { class: 'viz-note' }, (peak.minutes ? '最高的一周是 ' + plainDate(peak.monday) + ' 那周，' + minutesLabel(peak.minutes) + '。' : '这 12 周还没有记录。') + (average ? '虚线是 12 周平均。' : ''))),
        block('时间花在哪些分区', null, balance)),
      tip);
    return root;
  }

  /* ---------- money: income in red, spending in green, the balance as candles, and a piggy bank ----------
     Red for money coming in and green for money going out follows the convention of Chinese market
     software, as the user asked. Every coloured figure also carries a + or − sign or a label, and
     rising candles are hollow while falling ones are filled, so colour is never the only cue. */
  const money = (n) => { const v = Math.abs(n); return (n < 0 ? '−' : '') + state.money.symbol + v.toLocaleString('zh-CN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); };
  const signedMoney = (n) => (n > 0 ? '+' : '') + money(n);
  const KIND_NAME = { in: '收入', out: '支出', saved: '忍住没花' };
  const moneyUi = { unit: 'day', filter: 'all', month: null, query: '', from: null, to: null };
  function openMoneyDialog(entry, preset = {}) {
    let kind = entry ? entry.kind : preset.kind || 'out';
    let category = entry ? entry.category : '';
    const kinds = h('div', { class: 'segmented money-kinds', role: 'group', 'aria-label': '这是哪一种' });
    const cats = h('div', { class: 'when-row' });
    const noteLabel = h('span', {});
    const drawKind = () => {
      kinds.replaceChildren(...[['out', '支出（流出）'], ['in', '收入（流入）'], ['saved', '忍住没花']].map(([id, label]) => h('button', { type: 'button', class: 'k-' + id + (kind === id ? ' on' : ''), 'aria-pressed': String(kind === id), onclick: () => { kind = id; if (!C.MONEY_CATEGORIES[kind].includes(category)) category = ''; drawKind(); } }, label)));
      cats.replaceChildren(...C.MONEY_CATEGORIES[kind].map((c) => h('button', { type: 'button', class: 'when-chip' + (category === c ? ' on' : ''), 'aria-pressed': String(category === c), onclick: () => { category = c; drawKind(); } }, c)));
      noteLabel.textContent = kind === 'saved' ? '本来想买什么' : kind === 'in' ? '从哪来的（可以不填）' : '花在什么上（可以不填）';
    };
    drawKind();
    const form = openDialog(entry ? '修改这一笔' : kind === 'saved' ? '忍住了一次' : '记一笔', [
      kinds,
      field('金额（' + state.money.symbol + '）', h('input', { name: 'amount', type: 'number', min: 0.01, step: 'any', inputMode: 'decimal', value: entry ? entry.amount : preset.amount || '', placeholder: '例如 15' })),
      h('div', { class: 'field' }, h('span', {}, '类别'), cats),
      h('label', { class: 'field' }, noteLabel, h('input', { name: 'note', maxLength: 120, value: entry ? entry.note || '' : preset.note || '' })),
      h('div', { class: 'row' },
        field('日期', h('input', { name: 'date', type: 'date', max: today(), value: entry ? entry.date : today() })),
        field('时间（可以留空）', h('input', { name: 'time', type: 'time', value: entry ? entry.time || '' : '' }))),
      whenHelp(() => form, { kind: 'past', time: true }),
      h('p', { class: 'sub' }, '「忍住没花」不改变余额，只记进存钱罐。'),
    ], [
      entry ? h('button', { type: 'button', class: 'btn danger', onclick: () => { undoable('这一笔已删除', () => change((s) => { s.money.entries = s.money.entries.filter((x) => x.id !== entry.id); })); closeDialog(); } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const values = { kind, amount: form.amount.value, category: category || '其他', note: form.note.value, date: form.date.value, time: form.time.value };
        if (values.date > today()) return toast('不能记还没到的日期');
        try { if (commit(entry ? C.updateMoney(state, entry.id, values) : C.addMoney(state, values, Date.now()))) { closeDialog(); if (!entry && kind === 'saved') toast('忍住了，存钱罐 +' + money(Number(values.amount))); } }
        catch (error) { toast(error.message); }
      } }, '保存'),
    ]);
    form.amount.focus();
  }
  function openMoneySettings() {
    const m = state.money;
    const form = openDialog('收支设置', [
      h('div', { class: 'row' },
        field('初始资金（开始记账时手里有多少）', h('input', { name: 'opening', type: 'number', step: 'any', value: m.opening || '', placeholder: '0' })),
        field('从哪天起算（可以留空）', h('input', { name: 'openingDate', type: 'date', max: today(), value: m.openingDate || '' }))),
      h('p', { class: 'sub' }, '余额 = 初始资金 + 收入 − 支出。填了起算日期后，这天之前的记录仍然列出，但不计入余额。'),
      h('div', { class: 'row' },
        field('每月生活费（可以留空）', h('input', { name: 'monthly', type: 'number', min: 0, step: 'any', value: m.monthly || '', placeholder: '例如 1500' })),
        field('货币符号', h('input', { name: 'symbol', maxLength: 3, value: m.symbol }))),
      h('p', { class: 'sub' }, '填了每月生活费后，会显示这个月已经花了多少、还剩多少、平均每天还能花多少。它只是一个预算，不会自动记成收入；收到生活费时请自己记一笔收入。'),
      h('label', { class: 'chk-line' }, h('input', { name: 'share', type: 'checkbox', checked: m.share }), h('span', {}, '让规划助手看到收支概况（余额、本月收入和支出、生活费剩余）。不勾选时，这些数字不会发给模型。')),
    ], [
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        try { if (commit(C.setMoneySettings(state, { opening: form.opening.value, openingDate: form.openingDate.value, monthly: form.monthly.value, symbol: form.symbol.value, share: form.share.checked }))) closeDialog(); }
        catch (error) { toast(error.message); }
      } }, '保存'),
    ]);
    form.opening.focus();
  }
  /* The balance as candles over a flow pane, like a stock chart: price above, volume below. */
  function candleChart(root, hint, onPick) {
    const t = today();
    const candles = C.moneyCandles(state, t, moneyUi.unit, moneyUi.unit === 'week' ? 16 : 30);
    const W = 760, H = 300, left = 56, right = 10, top = 10, priceH = 176, gap = 26, flowH = H - top - priceH - gap - 20;
    const lo = Math.min(...candles.map((c) => c.low)), hi = Math.max(...candles.map((c) => c.high));
    const pad = (hi - lo || Math.max(10, Math.abs(hi) * 0.1)) * 0.12;
    const min = lo - pad, max = hi + pad;
    const y = (v) => top + (1 - (v - min) / (max - min)) * priceH;
    const slot = (W - left - right) / candles.length, bodyW = Math.max(3, Math.min(14, slot * 0.6));
    const flowMax = Math.max(1, ...candles.map((c) => Math.max(c.in, c.out)));
    const mid = top + priceH + gap + flowH / 2;
    const short = (v) => (Math.abs(v) >= 10000 ? (Math.round(v / 100) / 100) + '万' : String(Math.round(v)));
    const label = (c) => (moneyUi.unit === 'week' ? plainDate(c.start) + ' – ' + plainDate(c.end) : plainDate(c.start) + (c.start === t ? '（今天）' : ''));
    const ticks = [0, 1, 2, 3].map((i) => min + ((max - min) * i) / 3);
    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'money-chart', role: 'img', 'aria-label': '余额走势：' + (moneyUi.unit === 'week' ? '最近 16 周' : '最近 30 天') + '，从 ' + money(candles[0].open) + ' 到 ' + money(candles[candles.length - 1].close) },
      ticks.map((v) => [sv('line', { class: 'viz-ring', x1: left, x2: W - right, y1: y(v).toFixed(1), y2: y(v).toFixed(1) }), (() => { const text = sv('text', { class: 'viz-axis', x: left - 6, y: y(v).toFixed(1), 'text-anchor': 'end', 'dominant-baseline': 'middle' }); text.textContent = short(v); return text; })()]),
      sv('line', { class: 'viz-ring', x1: left, x2: W - right, y1: mid, y2: mid }),
      (() => { const a = sv('text', { class: 'viz-axis', x: left - 6, y: mid - flowH / 4, 'text-anchor': 'end', 'dominant-baseline': 'middle' }); a.textContent = '流入'; const b = sv('text', { class: 'viz-axis', x: left - 6, y: mid + flowH / 4, 'text-anchor': 'end', 'dominant-baseline': 'middle' }); b.textContent = '流出'; return [a, b]; })(),
      candles.map((c, i) => {
        const cx = left + slot * (i + 0.5), up = c.close >= c.open, flat = c.entries === 0;
        const bodyTop = y(Math.max(c.open, c.close)), bodyH = Math.max(1.5, Math.abs(y(c.open) - y(c.close)));
        const inH = (c.in / flowMax) * (flowH / 2 - 2), outH = (c.out / flowMax) * (flowH / 2 - 2);
        const xLabel = i % (moneyUi.unit === 'week' ? 3 : 5) === (candles.length - 1) % (moneyUi.unit === 'week' ? 3 : 5) ? (() => { const text = sv('text', { class: 'viz-axis', x: cx.toFixed(1), y: H - 6, 'text-anchor': 'middle' }); text.textContent = Number(c.start.slice(5, 7)) + '/' + Number(c.start.slice(8)); return text; })() : null;
        return [
          flat ? sv('line', { class: 'candle-flat', x1: (cx - bodyW / 2).toFixed(1), x2: (cx + bodyW / 2).toFixed(1), y1: y(c.close).toFixed(1), y2: y(c.close).toFixed(1) })
            : [sv('line', { class: 'candle-wick ' + (up ? 'up' : 'down'), x1: cx.toFixed(1), x2: cx.toFixed(1), y1: y(c.high).toFixed(1), y2: y(c.low).toFixed(1) }),
              sv('rect', { class: 'candle-body ' + (up ? 'up' : 'down'), x: (cx - bodyW / 2).toFixed(1), y: bodyTop.toFixed(1), width: bodyW.toFixed(1), height: bodyH.toFixed(1), rx: 1.5 })],
          c.in ? sv('rect', { class: 'flow-in', x: (cx - bodyW / 2).toFixed(1), y: (mid - 1 - inH).toFixed(1), width: bodyW.toFixed(1), height: Math.max(1, inH).toFixed(1), rx: 1.5 }) : null,
          c.out ? sv('rect', { class: 'flow-out', x: (cx - bodyW / 2).toFixed(1), y: (mid + 1).toFixed(1), width: bodyW.toFixed(1), height: Math.max(1, outH).toFixed(1), rx: 1.5 }) : null,
          xLabel,
          hint(sv('rect', { class: 'viz-hit candle-hit', x: (left + slot * i).toFixed(1), y: top, width: slot.toFixed(1), height: H - top - 20, tabindex: 0, role: 'button', 'aria-label': label(c) + '：开 ' + money(c.open) + '，收 ' + money(c.close) + '，流入 ' + money(c.in) + '，流出 ' + money(c.out) }),
            [label(c), '开 ' + money(c.open) + '　收 ' + money(c.close), '高 ' + money(c.high) + '　低 ' + money(c.low), '流入 +' + money(c.in) + '　流出 −' + money(c.out), c.entries ? c.entries + ' 笔 · 点一下看明细' : '没有收支'], (el) => { el.addEventListener('click', () => onPick(c)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c); } }); }),
        ];
      }));
    root.append(h('div', { class: 'chart-scroll' }, svg));
    return candles;
  }
  function renderMoney() {
    const t = today();
    const m = state.money;
    const sum = C.moneySummary(state, t);
    const month = moneyUi.month || t.slice(0, 7);
    const monthStart = month + '-01';
    const monthEnd = month === t.slice(0, 7) ? t : C.todayISO(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12));
    const flow = C.moneyFlow(state, monthStart, monthEnd);
    const old = $('.money-scroll');
    const scrollAt = old ? old.scrollTop : 0;
    const typing = document.activeElement && document.activeElement.classList.contains('money-search');
    const shiftMonth = (n) => { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1, 12); moneyUi.month = C.todayISO(d).slice(0, 7); moneyUi.from = moneyUi.to = null; render(); };
    const root = h('div', { class: 'money-scroll money' });
    const tip = h('div', { class: 'viz-tip', role: 'status', hidden: true });
    const hint = (el, lines, more) => {
      const show = () => {
        tip.replaceChildren(...lines.map((line, i) => h(i ? 'span' : 'strong', {}, line)));
        tip.hidden = false;
        const box = el.getBoundingClientRect(), home = root.getBoundingClientRect();
        tip.style.left = Math.min(Math.max(box.left + box.width / 2 - home.left, 110), home.width - 110) + 'px';
        tip.style.top = box.top - home.top + root.scrollTop + 20 + 'px';
      };
      el.addEventListener('pointerenter', show); el.addEventListener('focus', show);
      el.addEventListener('pointerleave', () => { tip.hidden = true; }); el.addEventListener('blur', () => { tip.hidden = true; });
      if (more) more(el);
      return el;
    };
    const figure = (value, label, cls, sub) => h('div', { class: 'money-fig ' + (cls || '') }, h('strong', {}, value), h('small', {}, label), sub ? h('span', { class: 'sub' }, sub) : null);
    const figures = h('div', { class: 'money-figs' },
      figure(money(sum.balance), '当前余额', '', '初始 ' + money(m.opening) + (m.openingDate ? ' · 从 ' + plainDate(m.openingDate) + ' 起算' : '')),
      figure('+' + money(sum.month.in), '本月流入', 'in'),
      figure('−' + money(sum.month.out), '本月流出', 'out'),
      figure(signedMoney(sum.month.net), '本月净流入', sum.month.net >= 0 ? 'in' : 'out'),
      sum.budget ? figure(money(sum.budget.left), sum.budget.over ? '生活费已超支' : '本月生活费还剩', sum.budget.over ? 'warn' : '', sum.budget.over ? '超出 ' + money(sum.budget.over) : '还有 ' + sum.budget.daysLeft + ' 天，平均每天 ' + money(sum.budget.perDay))
        : h('button', { class: 'money-fig hint', onclick: openMoneySettings }, h('strong', {}, '未设'), h('small', {}, '每月生活费'), h('span', { class: 'sub' }, '点这里设置')),
      figure(money(sum.piggy.total), '存钱罐', 'piggy', sum.piggy.count ? '忍住了 ' + sum.piggy.count + ' 次' : '还没有忍住过'));

    // --- chart
    const chartCard = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, '余额走势'),
        h('div', { class: 'segmented slim', role: 'group', 'aria-label': 'K 线周期' }, [['day', '日 K'], ['week', '周 K']].map(([id, label]) => h('button', { class: moneyUi.unit === id ? 'on' : '', 'aria-pressed': String(moneyUi.unit === id), onclick: () => { moneyUi.unit = id; render(); } }, label)))),
      h('div', { class: 'viz-legend' }, h('span', {}, h('i', { class: 'candle-key up' }), '余额上升（空心红）'), h('span', {}, h('i', { class: 'candle-key down' }), '余额下降（实心绿）'), h('span', {}, h('i', { class: 'flow-key in' }), '流入'), h('span', {}, h('i', { class: 'flow-key out' }), '流出')));
    const candles = candleChart(chartCard, hint, (c) => { moneyUi.month = c.start.slice(0, 7); moneyUi.from = c.start; moneyUi.to = c.end; moneyUi.filter = 'all'; render(); });
    chartCard.append(h('p', { class: 'sub' }, '每根柱是一' + (moneyUi.unit === 'week' ? '周' : '天') + '：上下两端是当' + (moneyUi.unit === 'week' ? '周' : '天') + '余额到过的最高和最低，柱体是开始和结束时的余额。下面一栏是流入（向上）和流出（向下）。'),
      h('details', { class: 'viz-table' }, h('summary', {}, '用表格看'), h('table', {}, h('thead', {}, h('tr', {}, ['日期', '开', '收', '高', '低', '流入', '流出'].map((x) => h('th', {}, x)))),
        h('tbody', {}, [...candles].reverse().filter((c) => c.entries).slice(0, 40).map((c) => h('tr', {}, [moneyUi.unit === 'week' ? plainDate(c.start) + '起' : plainDate(c.start), money(c.open), money(c.close), money(c.high), money(c.low), '+' + money(c.in), '−' + money(c.out)].map((x) => h('td', {}, x))))))));

    // --- flow by category
    const flowList = (group, cls, sign) => (group.items.length ? h('div', { class: 'flow-list' }, group.items.map((x) => h('div', { class: 'flow-row' },
      h('span', { class: 'flow-name' }, x.category), h('span', { class: 'flow-track' }, h('i', { class: cls, style: 'width:' + Math.max(2, x.share * 100).toFixed(1) + '%' })),
      h('b', {}, sign + money(x.amount)), h('small', {}, Math.round(x.share * 100) + '%')))) : h('p', { class: 'empty' }, '这个月还没有。'));
    const monthLabel = Number(month.slice(0, 4)) + ' 年 ' + Number(month.slice(5, 7)) + ' 月';
    const flowCard = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, '资金流向 · ' + monthLabel),
        h('div', { class: 'row tight' }, h('button', { class: 'btn ghost', onclick: () => shiftMonth(-1) }, '‹ 上月'), h('button', { class: 'btn ghost', disabled: month >= t.slice(0, 7), onclick: () => shiftMonth(1) }, '下月 ›'))),
      h('div', { class: 'flow-net ' + (flow.in.total - flow.out.total >= 0 ? 'in' : 'out') }, h('span', {}, '净流入'), h('strong', {}, signedMoney(Math.round((flow.in.total - flow.out.total) * 100) / 100)),
        h('span', { class: 'sub' }, '流入 +' + money(flow.in.total) + ' · 流出 −' + money(flow.out.total))),
      h('div', { class: 'flow-cols' },
        h('div', {}, h('h4', {}, '流出去了哪里'), flowList(flow.out, 'out', '−')),
        h('div', {}, h('h4', {}, '流入从哪里来'), flowList(flow.in, 'in', '+'))));

    // --- piggy bank
    const savedList = m.entries.filter((e) => e.kind === 'saved').sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));
    const piggyCard = h('section', { class: 'card piggy-card' },
      h('div', { class: 'card-head' }, h('h3', {}, '存钱罐'), h('button', { class: 'pill soft', onclick: () => openMoneyDialog(null, { kind: 'saved' }) }, icon('plus'), '忍住了一次')),
      h('div', { class: 'piggy-total' }, h('strong', {}, money(sum.piggy.total)), h('span', { class: 'sub' }, sum.piggy.count ? '想花但忍住了 ' + sum.piggy.count + ' 次 · 本月 ' + money(sum.month.saved) + '（' + sum.month.savedCount + ' 次）' : '想买一样东西但忍住了，就在这里记一笔。它不改变余额，只是让你看到省下了多少。')),
      savedList.length ? h('div', { class: 'ledger' }, savedList.slice(0, 5).map((e) => h('button', { class: 'ledger-row', onclick: () => openMoneyDialog(e) }, h('span', { class: 'sub' }, dateLabel(e.date).split(' ')[0]), h('span', { class: 'ledger-what' }, e.note || e.category), h('b', { class: 'amt piggy' }, money(e.amount)))),
        flow.saved.items.length ? h('p', { class: 'sub' }, '本月忍住最多的是：' + flow.saved.items.slice(0, 3).map((x) => x.category + ' ' + money(x.amount)).join('、')) : null) : null);

    // --- ledger: every entry, traceable
    const q = moneyUi.query.trim().toLowerCase();
    const from = moneyUi.from || monthStart, to = moneyUi.to || monthEnd;
    const rows = m.entries.filter((e) => e.date >= from && e.date <= to && (moneyUi.filter === 'all' || e.kind === moneyUi.filter) && (!q || (e.note + ' ' + e.category).toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.time || '').localeCompare(a.time || '') || (b.createdAt || 0) - (a.createdAt || 0));
    const byDay = [];
    for (const e of rows) { const last = byDay[byDay.length - 1]; if (last && last.date === e.date) last.items.push(e); else byDay.push({ date: e.date, items: [e] }); }
    const amount = (e) => h('b', { class: 'amt ' + (e.kind === 'saved' ? 'piggy' : e.kind) }, e.kind === 'in' ? '+' + money(e.amount) : e.kind === 'out' ? '−' + money(e.amount) : money(e.amount));
    const search = h('input', { class: 'money-search', type: 'search', value: moneyUi.query, placeholder: '搜索备注或类别', 'aria-label': '搜索收支', maxLength: 40,
      oninput: (e) => { if (e.isComposing) return; moneyUi.query = e.target.value; render(); }, oncompositionend: (e) => { moneyUi.query = e.target.value; render(); } });
    const ledgerCard = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, '明细 · ' + (moneyUi.from ? (moneyUi.from === moneyUi.to ? plainDate(moneyUi.from) : plainDate(moneyUi.from) + ' – ' + plainDate(moneyUi.to)) : monthLabel)),
        moneyUi.from ? h('button', { class: 'pill soft', onclick: () => { moneyUi.from = moneyUi.to = null; render(); } }, '看整个月') : h('span', { class: 'sub' }, rows.length + ' 笔')),
      h('div', { class: 'row tight' }, h('div', { class: 'segmented slim', role: 'group', 'aria-label': '筛选' }, [['all', '全部'], ['in', '流入'], ['out', '流出'], ['saved', '存钱罐']].map(([id, label]) => h('button', { class: moneyUi.filter === id ? 'on' : '', 'aria-pressed': String(moneyUi.filter === id), onclick: () => { moneyUi.filter = id; render(); } }, label))), search),
      byDay.length ? h('div', { class: 'ledger' }, byDay.map((day) => {
        const net = day.items.reduce((n, e) => n + (e.kind === 'in' ? e.amount : e.kind === 'out' ? -e.amount : 0), 0);
        return [h('div', { class: 'ledger-day' }, h('span', {}, dateLabel(day.date)), day.items.some((e) => e.kind !== 'saved') ? h('span', { class: 'sub' }, '当天净 ' + signedMoney(Math.round(net * 100) / 100)) : null),
          ...day.items.map((e) => h('button', { class: 'ledger-row', title: '修改这一笔', onclick: () => openMoneyDialog(e) },
            h('i', { class: 'ledger-mark ' + e.kind, 'aria-hidden': 'true' }), h('span', { class: 'sub' }, e.time || KIND_NAME[e.kind]),
            h('span', { class: 'ledger-what' }, e.note || e.category, e.note ? h('small', {}, e.category + (e.time ? ' · ' + KIND_NAME[e.kind] : '')) : null), amount(e)))];
      })) : h('p', { class: 'empty' }, m.entries.length ? '这个范围里没有符合条件的记录。' : '还没有任何记录。点右上角「记一笔」，或者在聊天里写「花了15买奶茶」「收到生活费1500」「忍住没买奶茶 15块」。'));

    root.append(figures, h('div', { class: 'money-grid' }, h('div', { class: 'review-col' }, chartCard, ledgerCard), h('div', { class: 'review-col' }, flowCard, piggyCard)), tip);
    $('#main').replaceChildren(
      h('header', { class: 'tt-header' }, h('div', {}, h('h2', {}, '收支'), h('p', { class: 'sub' }, '红色是流入，绿色是流出。只是记录，不连接银行，也不会动真实的钱。' + (m.share ? '助手可以看到收支概况。' : '这些数字不会发给模型。'))),
        h('div', { class: 'tt-actions' }, h('button', { class: 'btn outline', onclick: openMoneySettings }, '初始资金与生活费'), h('button', { class: 'btn outline', onclick: () => openMoneyDialog(null, { kind: 'saved' }) }, '忍住了一次'), h('button', { class: 'btn dark', onclick: () => openMoneyDialog(null) }, icon('plus'), '记一笔'))),
      root);
    root.scrollTop = scrollAt;
    if (typing) { const box = $('.money-search'); box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }

  /* The review is a page of its own: one week at a time, facts on the left, the user's own words on the right. */
  function renderReview() {
    const t = today();
    const old = $('.review-scroll');
    const scrollAt = old ? old.scrollTop : 0;
    const start = C.addDays(C.weekStart(t), reviewOffset * 7);
    const wk = reviewOffset ? '这一周' : '本周';
    const go = (n) => { reviewOffset = n; reviewDay = null; render(); };
    const earliest = [...state.sessions.map((x) => x.date), ...state.tasks.map((x) => x.date || C.todayISO(new Date(x.createdAt || Date.now())))].sort()[0] || t;
    const days = Array.from({ length: 7 }, (_, i) => C.addDays(start, i));
    const sessions = state.sessions.filter((x) => x.date >= start && x.date <= days[6]);
    const perDay = days.map((d) => sessions.filter((x) => x.date === d).reduce((n, x) => n + x.actual, 0));
    const max = Math.max(60, ...perDay);
    const doneWeek = state.tasks.filter((x) => x.done && x.doneAt && days.includes(C.todayISO(new Date(x.doneAt))));
    const planned = state.tasks.filter((x) => x.date && x.date >= start && x.date <= days[6]);
    const stat = (value, label) => h('div', { class: 'stat' }, h('strong', {}, value), h('span', { class: 'sub' }, label));
    const activeDays = perDay.filter((n) => n > 0).length;
    $('#main').replaceChildren(
      h('header', { class: 'tt-header' }, h('div', {}, h('h2', {}, '回看'), h('p', { class: 'sub' }, '只显示已记录的事实：时间来自计时和补记，完成来自勾选。时间长短不代表学习效果。')),
        h('div', { class: 'tt-week-nav' },
          h('button', { type: 'button', class: 'btn ghost', disabled: start <= earliest, onclick: () => go(reviewOffset - 1) }, '‹ 上一周'),
          h('strong', {}, plainDate(days[0]) + ' – ' + plainDate(days[6]) + (reviewOffset ? '' : '（本周）')),
          h('button', { type: 'button', class: 'btn ghost', disabled: reviewOffset >= 0, onclick: () => go(reviewOffset + 1) }, '下一周 ›'),
          reviewOffset ? h('button', { type: 'button', class: 'btn ghost', onclick: () => go(0) }, '回到本周') : null)),
      h('div', { class: 'review-scroll' },
        h('div', { class: 'stats' },
          stat(minutesLabel(perDay.reduce((a, b) => a + b, 0)), wk + '已记录的时间'),
          stat(String(sessions.length), '时间记录条数'),
          stat(activeDays + ' / 7', '有记录的天数'),
          stat(planned.filter((x) => x.done).length + ' / ' + planned.length, wk + '安排的完成情况')),
        trajectoryCard((date) => { reviewOffset = Math.round(C.daysBetween(C.weekStart(t), C.weekStart(date)) / 7); reviewDay = date; render(); }),
        h('div', { class: 'review-grid' },
          h('div', { class: 'review-col' },
        h('section', { class: 'card' }, h('h3', {}, '这一周的每一天'), dayAccordion(days, sessions, max),
          h('p', { class: 'sub' }, '点一天展开。竖条的高度是那天已记录的时间。')),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, '时间记录'), h('button', { type: 'button', class: 'pill soft', onclick: () => openSessionDialog(null, { date: days.includes(t) ? t : days[0] }) }, icon('plus'), '补记一段')),
          sessions.length ? h('div', { class: 'session-list' }, [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.endedAt || 0) - (a.endedAt || 0)).map((x) => h('button', { type: 'button', class: 'session-row', title: '修改这条记录', onclick: () => openSessionDialog(x) },
            h('span', { class: 'session-when' }, dateLabel(x.date).split(' ')[0] + (x.startTime ? ' ' + x.startTime : '')),
            h('span', { class: 'session-what' }, x.step && x.step !== x.title ? x.title + ' · ' + x.step : x.title,
              x.note || x.stuck ? h('small', {}, [x.note, x.stuck ? '卡在：' + x.stuck : ''].filter(Boolean).join('　')) : null),
            h('span', { class: 'sub' }, [x.manual ? '补记' : x.edited ? '改过' : '', x.partial ? '没做完这一段' : ''].filter(Boolean).join(' · ')),
            h('b', {}, minutesLabel(x.actual)))))
            : h('p', { class: 'empty' }, '这一周还没有时间记录。用计时完成一段会自动记下；没开计时做的事可以补记。')),
        h('section', { class: 'card' }, h('h3', {}, wk + '完成'),
          doneWeek.length ? h('ul', { class: 'plain' }, doneWeek.map((x) => h('li', {}, x.title, h('span', { class: 'sub' }, ' · ' + minutesLabel(x.minutes))))) : h('p', { class: 'empty' }, wk + '没有完成的任务。'))),
          h('div', { class: 'review-col' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, '反思'), h('button', { class: 'pill soft', onclick: () => openReflectionDialog(null) }, icon('plus'), '写一条')),
          state.reflections.length ? h('div', { class: 'reflections' }, [...state.reflections].reverse().slice(0, 30).map((r) => h('article', { class: 'reflection' },
            h('header', {}, h('strong', {}, dateLabel(r.date)), h('span', { class: 'sub' }, r.source === 'user' ? '自己写的' : '助手记录的'),
              h('span', { class: 'grow' }),
              h('button', { class: 'icon-btn small', 'aria-label': '修改这条反思', title: '修改', onclick: () => openReflectionDialog(r) }, icon('gear'))),
            h('p', { class: 'reflection-text' }, r.text))))
            : h('p', { class: 'empty' }, '还没有反思。可以把写在本子上的反思拍照拖进聊天框，助手会读出文字并记录在这里。')),
        h('section', { class: 'card' }, h('h3', {}, '助手对你的了解'),
          h('ul', { class: 'plain' }, profileLines().map((line) => h('li', {}, line))),
          h('div', { class: 'row' }, h('button', { class: 'pill soft', onclick: () => openSettings('memory') }, icon('note'), '查看和修改长期记忆（' + state.memory.length + ' 条）'))),
            state.habits.length ? h('section', { class: 'card' }, h('h3', {}, '习惯'),
          state.habits.length ? h('div', { class: 'habit-grid' }, state.habits.map((habit) => h('div', { class: 'habit-line' },
            h('span', { class: 'task-title' }, habit.title),
            h('span', { class: 'cells' }, days.map((d) => h('span', { class: 'cell' + (habit.log[d] ? ' on' : ''), title: dateLabel(d) }))),
            h('span', { class: 'sub' }, C.habitWeekCount(habit, days[0]) + ' / ' + habit.perWeek)))) : h('p', { class: 'empty' }, '还没有习惯。')) : null))));
    $('.review-scroll').scrollTop = scrollAt;
  }

  /* ---------- dialogs ---------- */
  /* Quicker ways to fill a date (and a start time): one-click choices, and a box that reads
     "明天下午3点 40分钟" the way it is written. `form` is looked up when used, as the dialog is built after this. */
  const DAY_CHIPS = {
    plan: [['今天', 0], ['明天', 1], ['后天', 2], ['周六', 'sat'], ['下周一', 'mon']],
    deadline: [['明天', 1], ['下周一', 'mon'], ['一周后', 7], ['两周后', 14], ['一个月后', 'month']],
    past: [['今天', 0], ['昨天', -1], ['前天', -2]],
  };
  function whenHelp(getForm, { kind = 'plan', time = false, minutes = false, optional = false } = {}) {
    const t = today();
    const note = h('span', { class: 'when-note sub', role: 'status' });
    const resolve = (offset) => {
      if (typeof offset === 'number') return C.addDays(t, offset);
      if (offset === 'mon') return C.addDays(C.weekStart(t), 7);
      if (offset === 'month') { const d = new Date(t + 'T12:00:00'); d.setMonth(d.getMonth() + 1); return C.todayISO(d); }
      const sat = C.addDays(C.weekStart(t), 5); // this week's Saturday, or the next one once it has passed
      return sat < t ? C.addDays(sat, 7) : sat;
    };
    const say = () => { const f = getForm(); note.textContent = (f.date.value ? '已填：' + dateLabel(f.date.value) + (dateLabel(f.date.value).includes('月') ? '' : '（' + plainDate(f.date.value) + '）') : '日期留空') + (time && f.time.value ? ' ' + f.time.value : ''); };
    const setDate = (value) => { getForm().date.value = value; if (!value && time) getForm().time.value = ''; say(); };
    const setTime = (value) => { const f = getForm(); f.time.value = value; if (value && !f.date.value) f.date.value = t; say(); };
    const chip = (label, onclick, title) => h('button', { type: 'button', class: 'when-chip', title: title || '', onclick }, label);
    const nowRounded = () => { const d = new Date(Date.now() + 4 * 60000); const m = d.getHours() * 60 + Math.floor(d.getMinutes() / 5) * 5; return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
    const read = (box) => {
      const text = box.value.trim();
      if (!text) return;
      const f = getForm();
      const r = C.parseWhen(text, t);
      let date = r.date;
      if (kind === 'past') while (date && date > t) date = C.addDays(date, -7); // "周三" in a record means the one just gone
      if (!r.understood) { note.textContent = '没有认出日期或时间。可以写「明天下午3点」「下周一」「11/20 19:00」「三天后」。'; return; }
      if (date) f.date.value = date;
      if (time && r.time) f.time.value = r.time;
      if (minutes && r.minutes && f.minutes && !f.minutes.disabled) f.minutes.value = r.minutes;
      box.value = '';
      say();
      if (minutes && r.minutes && f.minutes && !f.minutes.disabled) note.textContent += ' · ' + minutesLabel(r.minutes);
      if (!time && r.time) note.textContent += '（这里不用填时间，只取了日期）';
    };
    return h('div', { class: 'when-help' },
      h('div', { class: 'when-row' },
        DAY_CHIPS[kind].map(([label, offset]) => chip(label, () => setDate(resolve(offset)), plainDate(resolve(offset)))),
        optional ? chip('不定日期', () => setDate(''), '先不排到哪一天') : null,
        time ? h('span', { class: 'when-sep', 'aria-hidden': 'true' }) : null,
        time && kind === 'plan' ? chip('现在', () => setTime(nowRounded()), '今天，从现在开始') : null,
        time ? [['上午 9 点', '09:00'], ['下午 2 点', '14:00'], ['晚上 7 点', '19:00']].map(([label, value]) => chip(label, () => setTime(value))) : null,
        time ? chip('不定时间', () => setTime(''), '只定日期，不定几点') : null),
      h('div', { class: 'when-row' },
        h('input', { class: 'when-quick', maxLength: 60, 'aria-label': '用文字写日期或时间', placeholder: time ? '也可以直接写：明天下午3点' + (minutes ? ' 40分钟' : '') + '，按回车' : '也可以直接写：' + (kind === 'past' ? '昨天、周三、11/12' : '下周一、12月20日、三天后') + '，按回车',
          onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); read(e.target); } }, onblur: (e) => read(e.target) }),
        note));
  }

  function openDialog(title, fields, buttons) {
    const dialog = $('#dialog');
    const form = h('form', { method: 'dialog', onsubmit: (e) => e.preventDefault() }, h('h2', {}, title), ...fields, h('div', { class: 'dialog-actions' }, buttons));
    dialog.replaceChildren(form);
    if (!dialog.open) dialog.showModal();
    return form;
  }
  const closeDialog = () => $('#dialog').close();
  const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
  const spaceSelect = (selected) => h('select', { name: 'space' }, h('option', { value: '' }, '不分区'),
    state.spaces.map((s) => h('option', { value: s.id, selected: s.id === selected }, s.name)));
  const cancelButton = () => h('button', { type: 'button', class: 'btn ghost', onclick: closeDialog }, '取消');

  /* `draft` carries what was typed so far when the dialog is rebuilt after a step edit. */
  function openTaskDialog(task, draft) {
    const v = draft || { title: task ? task.title : '', date: task ? task.date || '' : (space(ui.space) || {}).type === 'life' ? '' : today(), next: task ? task.next || '' : '', time: task ? task.time || '' : '', minutes: task ? task.minutes : 30, space: task ? task.spaceId || '' : ui.space || '', tags: task ? task.tags || [] : ui.tag ? [ui.tag] : [] };
    const typed = () => ({ next: form.next.value, title: form.title.value, date: form.date.value, time: form.time.value, minutes: form.minutes.value, space: form.space.value, tags: C.cleanTags(form.tags.value) });
    // Tags already used elsewhere, offered with one click so the same word is not spelled two ways.
    const known = tagsInUse(() => true).map(([tag]) => tag);
    const tagBox = h('input', { name: 'tags', maxLength: 90, value: (v.tags || []).join(' '), placeholder: '例如 考试 作业（用空格分开）', oninput: () => drawSuggest() });
    const suggest = h('div', { class: 'tag-suggest' });
    const drawSuggest = () => {
      const have = C.cleanTags(tagBox.value);
      const rest = known.filter((tag) => !have.includes(tag)).slice(0, 12);
      suggest.replaceChildren(...rest.map((tag) => h('button', { type: 'button', class: 'utag', style: '--tag:' + tagColor(tag), title: '加上这个标签', onclick: () => { tagBox.value = [...C.cleanTags(tagBox.value), tag].join(' '); drawSuggest(); } }, '+ #' + tag)));
    };
    drawSuggest();
    const editStep = (op) => {
      try {
        if (!commit(C.editTaskSteps(state, task.id, op))) return;
        const fresh = state.tasks.find((x) => x.id === task.id);
        openTaskDialog(fresh, { ...typed(), minutes: fresh.minutes });
      } catch (error) { toast(error.message); }
    };
    const mini = (label, glyph, onclick, disabled) => h('button', { type: 'button', class: 'mini', 'aria-label': label, title: label, onclick, disabled }, icon(glyph));
    const steps = task && !task.done ? task.steps || [] : [];
    const firstOpen = steps.findIndex((x) => !x.done);
    const stepEditor = !task ? null : task.done ? (task.steps ? h('div', { class: 'field' }, h('span', {}, '分段'),
      h('ol', { class: 'steps boxed' }, task.steps.map((x) => h('li', { class: 'done' }, h('span', {}, x.title), h('span', { class: 'sub' }, x.minutes + ' 分钟'))))) : null)
      : h('div', { class: 'field' }, h('span', {}, steps.length ? '分段（计时按这个顺序进行，可以随时调整）' : '分段'),
        steps.length ? h('div', { class: 'steps-edit boxed' }, h('ol', { class: 'steps' }, steps.map((x, n) => h('li', { class: x.done ? 'done' : '' },
          h('span', { class: 'num' }, n + 1 + '.'),
          h('input', { class: 'step-input', value: x.title, maxLength: 100, 'aria-label': '第 ' + (n + 1) + ' 段的内容',
            onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } },
            onchange: (e) => { if (e.target.value.trim() && e.target.value.trim() !== x.title) editStep({ kind: 'title', step: n, title: e.target.value }); else e.target.value = x.title; } }),
          x.done ? h('span', { class: 'sub' }, x.minutes + ' 分 · 完成') : h('span', { class: 'step-tools' },
            mini('减少 5 分钟', 'minus', () => editStep({ kind: 'minutes', step: n, delta: -5 }), x.minutes <= 5),
            h('span', { class: 'step-min' }, x.minutes + ' 分'),
            mini('增加 5 分钟', 'plus', () => editStep({ kind: 'minutes', step: n, delta: 5 })),
            mini('上移', 'up', () => editStep({ kind: 'move', step: n, dir: -1 }), n <= firstOpen),
            mini('删除这一段', 'close', () => editStep({ kind: 'remove', step: n }), steps.length <= 1)))))) : null,
        h('div', { class: 'steps-foot' },
          h('button', { type: 'button', class: 'pill soft', onclick: () => editStep({ kind: 'add' }) }, icon('plus'), steps.length ? '加一段' : '拆成几段来计时'),
          steps.length ? h('span', { class: 'sub' }, '分段的修改立即保存') : null));
    const form = openDialog(task ? '编辑任务' : '新建任务', [
      field('要做什么', h('input', { name: 'title', maxLength: 150, required: true, value: v.title })),
      h('div', { class: 'row' },
        field('日期（可以留空）', h('input', { name: 'date', type: 'date', value: v.date })),
        field('开始时间（可以留空）', h('input', { name: 'time', type: 'time', value: v.time })),
        field('预计分钟', h('input', { name: 'minutes', type: 'number', min: 1, max: 1440, value: v.minutes, disabled: !!(task && task.steps), title: task && task.steps ? '有分段时，总时长是各段之和' : '' }))),
      whenHelp(() => form, { kind: 'plan', time: true, minutes: true, optional: true }),
      h('p', { class: 'sub' }, '填了开始时间的任务会和课程一起显示在课表的周视图里，并在开始前提醒。'),
      field('分区', h('select', { name: 'space' }, h('option', { value: '' }, '不分区'), state.spaces.map((x) => h('option', { value: x.id, selected: x.id === v.space }, x.name)))),
      h('label', { class: 'field' }, h('span', {}, '标签（可以不填，最多 6 个）'), tagBox, suggest),
      field('下次从哪里继续（可以留空，开始计时时会显示）', h('input', { name: 'next', maxLength: 300, value: v.next || '' })),
      stepEditor,
      task ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'pill soft', onclick: () => openSessionDialog(null, { taskId: task.id }) }, icon('plus'), '补记这个任务花的时间'),
        h('span', { class: 'sub' }, '已记录 ' + minutesLabel(state.sessions.filter((x) => x.taskId === task.id).reduce((n, x) => n + x.actual, 0)))) : null,
    ], [
      task ? h('button', { type: 'button', class: 'btn danger', onclick: () => { if (confirm('删除这个任务？')) { undoable('任务已删除', () => change((s) => { s.tasks = s.tasks.filter((x) => x.id !== task.id); if (s.timer && s.timer.taskId === task.id) s.timer = null; })); closeDialog(); } } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const title = form.title.value.trim();
        const minutes = Math.round(Number(form.minutes.value));
        if (!title) return toast('请填写任务内容');
        if (!(minutes >= 1 && minutes <= 1440)) return toast('预计分钟请填 1–1440');
        const date = C.validDate(form.date.value) ? form.date.value : null;
        const time = C.validTime(form.time.value) ? form.time.value : null;
        if (time && !date) return toast('填了开始时间，请同时选一个日期');
        const values = { title, minutes, date, spaceId: form.space.value || null };
        const ok = change((s) => {
          const target = task ? s.tasks.find((x) => x.id === task.id) : { id: C.uid('t'), done: false, doneAt: null, createdAt: Date.now(), origin: 'user' };
          Object.assign(target, values);
          if (target.steps) target.minutes = target.steps.reduce((n, x) => n + x.minutes, 0);
          if (time) target.time = time; else delete target.time;
          if (date) delete target.week;
          const tags = C.cleanTags(form.tags.value);
          if (tags.length) target.tags = tags; else delete target.tags;
          const next = form.next.value.replace(/\s+/g, ' ').trim();
          if (next) target.next = next; else delete target.next;
          if (!task) s.tasks.push(target);
        });
        if (ok) closeDialog();
      } }, '保存'),
    ]);
    if (!draft) form.title.focus();
  }

  function openHabitDialog(habit) {
    const form = openDialog(habit ? '编辑习惯' : '新习惯', [
      field('习惯名称', h('input', { name: 'title', maxLength: 80, required: true, value: habit ? habit.title : '' })),
      h('div', { class: 'row' },
        field('每周几次', h('input', { name: 'perWeek', type: 'number', min: 1, max: 7, value: habit ? habit.perWeek : 3 })),
        field('分区', spaceSelect(habit ? habit.spaceId : ui.space))),
    ], [
      habit ? h('button', { type: 'button', class: 'btn danger', onclick: () => { if (confirm('删除这个习惯和它的打卡记录？')) { undoable('习惯已删除', () => change((s) => { s.habits = s.habits.filter((x) => x.id !== habit.id); })); closeDialog(); } } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const title = form.title.value.trim();
        const perWeek = Math.round(Number(form.perWeek.value));
        if (!title) return toast('请填写习惯名称');
        if (!(perWeek >= 1 && perWeek <= 7)) return toast('每周次数请填 1–7');
        const values = { title, perWeek, spaceId: form.space.value || null };
        const ok = change((s) => {
          if (habit) Object.assign(s.habits.find((x) => x.id === habit.id), values);
          else s.habits.push({ id: C.uid('h'), ...values, log: {}, createdAt: Date.now() });
        });
        if (ok) closeDialog();
      } }, '保存'),
    ]);
    form.title.focus();
  }

  function openSpaceDialog(current) {
    let color = current ? current.color : C.SPACE_COLORS[state.spaces.length % C.SPACE_COLORS.length];
    const swatches = h('div', { class: 'swatches' }, C.SPACE_COLORS.map((c) =>
      h('button', { type: 'button', class: 'swatch' + (c === color ? ' on' : ''), style: 'background:' + c, 'aria-label': '颜色 ' + c,
        onclick: (e) => { color = c; swatches.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); } })));
    const form = openDialog(current ? '编辑分区' : '新分区', [
      field('名称（例如一门课、一个项目）', h('input', { name: 'name', maxLength: 20, required: true, value: current ? current.name : '' })),
      field('这个分区用来做什么', h('select', { name: 'type' }, C.SPACE_TYPES.map((t) => h('option', { value: t.id, selected: t.id === (current ? current.type : 'study') }, t.name + '：' + t.hint)))),
      courseTitles().length ? field('对应课表里的哪门课（可以不选）', h('select', { name: 'course' }, h('option', { value: '' }, '不对应'),
        courseTitles().map((title) => h('option', { value: title, selected: !!current && current.course === title }, title)))) : null,
      field('颜色', swatches),
    ], [
      current ? h('button', { type: 'button', class: 'btn danger', onclick: () => {
        if (!confirm('删除分区「' + current.name + '」？里面的任务和习惯会保留，变成不分区。')) return;
        ui.space = null;
        undoable('分区已删除', () => commit(C.normalize({ ...C.clone(state), spaces: state.spaces.filter((x) => x.id !== current.id) })));
        closeDialog();
      } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const name = form.name.value.trim();
        if (!name) return toast('请填写分区名称');
        if (state.spaces.some((x) => x.name === name && x !== current)) return toast('已经有同名分区');
        const ok = change((s) => {
          const target = current ? s.spaces.find((x) => x.id === current.id) : { id: C.uid('space') };
          Object.assign(target, { name, color, type: form.type.value });
          if (form.course && form.course.value) target.course = form.course.value; else delete target.course;
          if (!current) s.spaces.push(target);
        });
        if (ok) closeDialog();
      } }, '保存'),
    ]);
    form.name.focus();
  }

  function openReflectionDialog(current) {
    const form = openDialog(current ? '修改反思' : '写一条反思', [
      field('日期', h('input', { name: 'date', type: 'date', value: current ? current.date : today() })),
      whenHelp(() => form, { kind: 'past' }),
      field('内容', h('textarea', { name: 'text', rows: 8, maxLength: 4000, value: current ? current.text : '' })),
    ], [
      current ? h('button', { type: 'button', class: 'btn danger', onclick: () => { if (confirm('删除这条反思？')) { undoable('反思已删除', () => change((s) => { s.reflections = s.reflections.filter((x) => x.id !== current.id); })); closeDialog(); } } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const text = form.text.value.trim();
        const date = C.validDate(form.date.value) ? form.date.value : today();
        if (!text) return toast('请写一点内容');
        const ok = change((s) => {
          if (current) Object.assign(s.reflections.find((x) => x.id === current.id), { text, date });
          else s.reflections.push({ id: C.uid('r'), date, text, at: Date.now(), source: 'user' });
        });
        if (ok) closeDialog();
      } }, '保存'),
    ]);
    form.text.focus();
  }

  /* Adds a time record by hand, or corrects a saved one. */
  function openSessionDialog(session, preset = {}) {
    const taskId = session ? session.taskId : preset.taskId || '';
    const choices = state.tasks.filter((x) => !x.done || x.id === taskId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 80);
    const form = openDialog(session ? '修改时间记录' : '补记一段时间', [
      field('做了什么', h('input', { name: 'title', maxLength: 150, value: session ? session.title : '', placeholder: '选了任务可以不填' })),
      field('关联的任务（可以不选）', h('select', { name: 'task' }, h('option', { value: '' }, '不关联'), choices.map((x) => h('option', { value: x.id, selected: x.id === taskId }, x.title.slice(0, 40))))),
      h('div', { class: 'row' },
        field('日期', h('input', { name: 'date', type: 'date', max: today(), value: session ? session.date : preset.date || today() })),
        field('分钟', h('input', { name: 'minutes', type: 'number', min: 1, max: 1440, value: session ? session.actual : 30 })),
        field('开始时间（可以留空）', h('input', { name: 'time', type: 'time', value: session ? session.startTime || '' : '' }))),
      whenHelp(() => form, { kind: 'past', time: true, minutes: true }),
      field('备注（可以留空）', h('textarea', { name: 'note', rows: 2, maxLength: 600, value: session ? session.note || '' : '' })),
      session && !session.manual ? h('p', { class: 'sub' }, '这是计时产生的记录（计划 ' + session.planned + ' 分钟）。改过之后，它不再用来估计你的实际速度。') : null,
    ], [
      session ? h('button', { type: 'button', class: 'btn danger', onclick: () => { undoable('时间记录已删除', () => change((s) => { s.sessions = s.sessions.filter((x) => x.id !== session.id); })); closeDialog(); } }, '删除') : null,
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const values = { title: form.title.value, taskId: form.task.value || null, date: form.date.value, minutes: form.minutes.value, startTime: form.time.value, note: form.note.value };
        if (values.date > today()) return toast('不能补记还没到的日期');
        try { if (commit(session ? C.updateSession(state, session.id, values) : C.addSession(state, values, Date.now()))) closeDialog(); }
        catch (error) { toast(error.message); }
      } }, '保存'),
    ]);
    (session ? form.minutes : form.title).focus();
  }

  function openMemoryDialog(memory) {
    const form = openDialog('修改这条记忆', [
      field('助手每次回答前都会读到这句话', h('textarea', { name: 'text', rows: 4, maxLength: 300, value: memory.text })),
    ], [
      h('span', { class: 'grow' }), cancelButton(),
      h('button', { class: 'btn dark', onclick: () => {
        const text = form.text.value.replace(/\s+/g, ' ').trim();
        if (!text) return toast('请写一点内容，或者关掉后直接删除这条');
        if (state.memory.some((x) => x.text === text && x.id !== memory.id)) return toast('已经有一条相同的记忆');
        if (change((s) => { Object.assign(s.memory.find((x) => x.id === memory.id), { text, source: 'user' }); })) closeDialog();
      } }, '保存'),
    ]);
    form.text.focus();
  }

  /* A tiny picture with digits in it, used to check whether a model can read images. */
  function probeImage() {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 240, 96);
    ctx.fillStyle = '#111'; ctx.font = 'bold 56px sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('4 2 7', 36, 50);
    return { mediaType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] };
  }

  /* Settings work on a draft. Choosing a provider fills in its address; pasting a key loads its models. */
  function openSettingsDialog(draft) {
    const d = draft && draft.provider ? draft : { ...state.settings.agent, key: '', status: [], busy: '', manual: false, name: state.settings.prefs.name || '', segment: state.settings.prefs.segment, daily: state.settings.prefs.dailyMinutes || '', remind: Number(state.settings.prefs.remindMinutes) || 0 };
    panelDraft = d;
    const preset = Providers.find(d.provider);
    const savedKey = platform.loadKey(d.provider);
    const key = () => d.key || savedKey;
    const again = () => openSettingsDialog(d);
    const run = async (label, job) => {
      if (d.busy) return;
      d.busy = label; d.status = []; again();
      try { await job(); } catch (error) { d.status.push(['bad', error.message]); }
      d.busy = ''; again();
    };
    const loadModels = () => run('正在读取模型…', async () => {
      d.models = await platform.listModels(d, key());
      if (!d.models.length) throw new Error('服务商没有返回可用的模型，请手动填写模型名称。');
      if (!d.models.includes(d.modelId)) d.modelId = d.models[0];
      d.manual = false;
      d.status.push(['ok', '读到 ' + d.models.length + ' 个模型，请在下面选择。']);
    });
    const testConnection = () => run('正在测试…', async () => {
      const started = Date.now();
      const reply = await platform.chat(d, '你是连接测试。', '请只回复两个字：正常', [], key());
      d.status.push(['ok', '连接正常，用时 ' + ((Date.now() - started) / 1000).toFixed(1) + ' 秒。模型回答：' + (reply.trim().slice(0, 40) || '（空）')]);
      if (!platform.canSeeImages) return;
      try {
        const seen = await platform.chat(d, '你是识图测试。', '图片里有三个数字，请只回复这三个数字。', [probeImage()], key());
        d.vision = /4\s*2\s*7/.test(seen);
        d.status.push(d.vision ? ['ok', '这个模型可以识图，可以把照片拖进聊天框。'] : ['warn', '这个模型没有读出测试图片里的数字，可能不能识图。']);
      } catch (error) {
        d.vision = false;
        d.status.push(['warn', '这个模型不能识图（' + error.message + '）。文字功能不受影响。']);
      }
    });
    const importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        let next;
        if (C.isV3Export(raw)) {
          // A v3 backup has other shapes: it is converted, and the user is told what does and does not come across.
          const { state: converted, report: r } = C.convertV3(raw);
          next = converted;
          next.settings.agent = state.settings.agent; // v3 backups carry no key; the model set up here stays
          const skipped = [r.skippedTrees ? r.skippedTrees + ' 棵决策树' : '', r.skippedProposals ? r.skippedProposals + ' 份 AI 草稿' : '', r.skippedSessions ? r.skippedSessions + ' 条无效的时间记录' : '', '任务的置顶和分类标记'].filter(Boolean).join('、');
          if (!confirm('这是 T计划 v3 的备份。\n\n会带过来：' + r.tasks + ' 个任务、' + r.sessions + ' 条时间记录、' + r.reflections + ' 条反思、' + r.spaces + ' 个任务分区、' + r.weekPlans + ' 周的周重点。\n不会带过来：' + skipped + '。\n\n导入会替换现在的全部数据（可以撤销）。继续吗？')) return;
        } else {
          next = C.normalize(raw);
          next.settings.agent = Providers.migrate(next.settings.agent);
          if (!confirm('导入会替换现在的全部数据（' + next.tasks.length + ' 个任务，' + next.habits.length + ' 个习惯）。继续吗？')) return;
        }
        if (undoable('已导入，原来的数据可以撤销找回', () => commit(next))) closePanel();
      } catch (error) { toast('导入失败：' + error.message); }
    } });
    const useList = d.models.length && !d.manual;
    const modelControl = useList
      ? h('select', { name: 'modelId', onchange: (e) => { d.modelId = e.target.value; d.vision = null; } },
        (d.models.includes(d.modelId) || !d.modelId ? d.models : [d.modelId, ...d.models]).map((id) => h('option', { value: id, selected: id === d.modelId }, id)))
      : h('input', { name: 'modelId', value: d.modelId, placeholder: '填写模型名称，或者先读取模型列表', oninput: (e) => { d.modelId = e.target.value.trim(); d.vision = null; } });
    const save = () => {
      const segment = Math.round(Number(d.segment));
      const daily = Math.round(Number(d.daily));
      if (!(segment >= 5 && segment <= 90)) return toast('一段专注请填 5–90 分钟');
      if (d.modelId) { try { Providers.chatRequest(d, 'x', '', ''); } catch (error) { return toast(error.message); } }
      try { if (d.key) platform.saveKey(d.provider, d.key); } catch (error) { return toast('密钥没有保存：' + error.message); }
      const ok = change((s) => {
        s.settings.agent = { provider: d.provider, baseUrl: d.baseUrl, modelId: d.modelId, models: d.models, vision: d.vision };
        Object.assign(s.settings.prefs, { segment, dailyMinutes: daily > 0 ? daily : null, name: String(d.name).trim().slice(0, 20), remindMinutes: Number(d.remind) || 0 });
      });
      if (ok) { d.key = ''; toast('设置已保存'); }
    };
    const saveRow = () => h('div', { class: 'dialog-actions' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn dark', onclick: save }, '保存'));
    const sections = {
      model: ['AI 模型', 'chip', () => [
        field('服务商', h('select', { name: 'provider', onchange: (e) => {
          Object.assign(d, { provider: e.target.value, baseUrl: Providers.find(e.target.value).baseUrl, modelId: '', models: [], vision: null, key: '', status: [], manual: false });
          again();
        } }, Providers.PROVIDERS.map((p) => h('option', { value: p.id, selected: p.id === d.provider }, p.name)))),
        preset.note ? h('p', { class: 'sub' }, preset.note) : null,
        field('API 密钥', h('input', {
          name: 'key', type: 'password', autocomplete: 'off', value: d.key, placeholder: savedKey ? '已保存，留空表示不修改' : '粘贴密钥后会自动读取模型',
          oninput: (e) => { d.key = e.target.value.trim(); },
          onpaste: () => setTimeout(() => { if (d.key && d.baseUrl) loadModels(); }, 0),
        })),
        h('div', { class: 'field' }, h('span', {}, '模型'),
          h('div', { class: 'row tight' }, modelControl,
            h('button', { type: 'button', class: 'btn outline slim', disabled: !!d.busy, onclick: loadModels }, '读取模型'),
            d.models.length ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { d.manual = !d.manual; again(); } }, d.manual ? '从列表选' : '手动填写') : null)),
        h('details', { class: 'advanced', open: d.provider === 'custom' }, h('summary', {}, '接口地址'),
          h('input', { name: 'baseUrl', value: d.baseUrl, placeholder: 'https://…/v1', 'aria-label': '接口地址', oninput: (e) => { d.baseUrl = e.target.value.trim(); } })),
        h('div', { class: 'row tight' },
          h('button', { type: 'button', class: 'btn outline slim', disabled: !!d.busy, onclick: testConnection }, '测试连接'),
          d.busy ? h('span', { class: 'sub', role: 'status' }, d.busy) : d.vision === true ? h('span', { class: 'sub' }, '可以识图') : d.vision === false ? h('span', { class: 'sub' }, '不能识图') : null),
        d.status.length ? h('ul', { class: 'status', role: 'status' }, d.status.map(([kind, text]) => h('li', { class: kind }, text))) : null,
        h('p', { class: 'sub' }, (platform.name === 'desktop' ? '密钥由 Windows 当前账户加密保存。' : '密钥只保存在这个浏览器里，每个服务商分开保存。') + '发送消息时，你的任务、习惯、计时统计、长期记忆、最近的对话，以及附上的文件和图片，会发给这个模型服务。'),
        saveRow(),
      ]],
      rhythm: ['我的节奏', 'brain', () => [
        field('怎么称呼你（显示在问候语里，也会告诉助手）', h('input', { name: 'name', maxLength: 20, value: d.name, placeholder: '可以不填', oninput: (e) => { d.name = e.target.value; } })),
        h('div', { class: 'row' },
          field('一段专注（分钟）', h('input', { name: 'segment', type: 'number', min: 5, max: 90, value: d.segment, oninput: (e) => { d.segment = e.target.value; } })),
          field('每天可安排（分钟）', h('input', { name: 'daily', type: 'number', min: 0, max: 960, value: d.daily, oninput: (e) => { d.daily = e.target.value; } }))),
        h('p', { class: 'sub' }, '助手按这两个数字拆分步骤和安排每天的任务量。计时记录多了以后，它会参考你的真实速度。'),
        field('上课和有开始时间的任务，提前多久提醒', h('select', { name: 'remind', onchange: (e) => { d.remind = Number(e.target.value); } },
          [[0, '不提醒'], [5, '提前 5 分钟'], [10, '提前 10 分钟'], [15, '提前 15 分钟'], [30, '提前 30 分钟']].map(([value, label]) => h('option', { value, selected: value === d.remind }, label)))),
        h('p', { class: 'sub' }, '提醒会在这个窗口里弹出并响一声，所以需要程序开着。' + (canNotify() ? (Notification.permission === 'granted' ? '系统通知已开启，窗口在后台时也能看到。' : Notification.permission === 'denied' ? '系统通知被浏览器或系统拒绝了，只能在窗口里提醒。' : '') : '这个环境不支持系统通知，只能在窗口里提醒。')),
        canNotify() && Notification.permission === 'default' ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn outline slim', onclick: () => { try { Promise.resolve(Notification.requestPermission()).then(again, again); } catch { toast('这个环境不能开启系统通知'); } } }, '开启系统通知')) : null,
        saveRow(),
      ]],
      memory: ['记忆', 'note', () => {
        const input = h('input', { name: 'memory', maxLength: 300, placeholder: '写一条希望助手长期记住的事', 'aria-label': '添加一条记忆',
          onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) add(); } });
        const add = () => { if (input.value.trim()) change((s) => C.addMemory(s, input.value, Date.now(), 'user')); };
        return [
          h('p', { class: 'sub' }, '助手每次回答前都会读这些内容。它在聊天中学到的事会自动记在这里，你可以随时删除或自己添加。'),
          state.memory.length ? h('ul', { class: 'memory' }, state.memory.map((m) => h('li', {},
            h('span', {}, m.text, h('span', { class: 'sub' }, m.source === 'user' ? ' · 你添加的' : ' · 助手记下的')),
            h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '修改这条记忆', title: '修改', onclick: () => openMemoryDialog(m) }, icon('edit')),
            h('button', { type: 'button', class: 'icon-btn small', 'aria-label': '删除这条记忆', title: '删除', onclick: () => change((s) => { s.memory = s.memory.filter((x) => x.id !== m.id); }) }, icon('trash')))))
            : h('p', { class: 'empty' }, '还没有记忆。例如：「我早上效率最高」「周三晚上有课」。'),
          h('div', { class: 'row tight' }, input, h('button', { type: 'button', class: 'btn dark', onclick: add }, '添加')),
        ];
      }],
      data: ['数据', 'data', () => [
        h('p', { class: 'sub' }, '数据保存在' + (platform.name === 'desktop' ? '这台电脑的数据库里' : '这个浏览器里') + '。换电脑或清理浏览器之前，请先导出。'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn outline slim', onclick: () => {
            const link = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })), download: 'tplan-' + today() + '.json' });
            link.click();
            URL.revokeObjectURL(link.href);
          } }, '导出 JSON'),
          h('button', { type: 'button', class: 'btn outline slim', onclick: () => importInput.click() }, '导入 JSON'), importInput),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { if (confirm('清空全部对话？任务、记录和记忆会保留。')) { closePanel(); undoable('对话已清空', () => change((s) => { s.messages = []; })); } } }, '清空对话')),
      ]],
    };
    if (!sections[ui.panelSection]) ui.panelSection = 'model';
    const [title, , body] = sections[ui.panelSection];
    const panel = $('#panel');
    const previous = panel.querySelector('.panel-content');
    const keep = previous && previous.dataset.section === ui.panelSection ? previous.scrollTop : 0;
    const content = h('div', { class: 'panel-content', 'data-section': ui.panelSection }, h('h3', { class: 'panel-title' }, title), body());
    panel.replaceChildren(
      h('header', { class: 'panel-head' }, h('h2', {}, '设置'), h('button', { class: 'icon-btn small', 'aria-label': '关闭', onclick: closePanel }, icon('close'))),
      h('div', { class: 'panel-body' },
        h('nav', { class: 'panel-nav', 'aria-label': '设置分类' }, Object.entries(sections).map(([id, [label, glyph]]) =>
          h('button', { class: id === ui.panelSection ? 'on' : '', 'aria-current': id === ui.panelSection ? 'page' : null, onclick: () => { ui.panelSection = id; again(); } }, icon(glyph), label))),
        content));
    if (!panel.open) panel.showModal();
    content.scrollTop = keep;
  }
  let panelDraft = null;
  function openSettings(section) {
    if (section) ui.panelSection = section;
    openSettingsDialog(panelDraft);
  }
  function closePanel() {
    panelDraft = null;
    $('#panel').close();
  }

  /* ---------- shell ---------- */
  const timetable = window.TPlanTimetableUI({ getState: () => state, commit, toast, h, compose: (text) => openComposer('course', text), openWorkspace: () => { ui.mode = 'timetable'; render(); }, undoable, openTask: (id) => { const task = state.tasks.find((x) => x.id === id); if (task) openTaskDialog(task); },
    courses: {
      spaceFor: spaceForCourse,
      /* One study space per course, tied to it by title. A space that already carries the course's name is tied rather than duplicated. */
      createSpaces: (titles) => undoable('已为 ' + titles.length + ' 门课建好分区', () => change((s) => {
        for (const title of titles) {
          if (s.spaces.some((x) => x.course === title)) continue;
          const same = s.spaces.find((x) => !x.course && x.name === title.slice(0, 20));
          if (same) { same.course = title; continue; }
          let name = title.slice(0, 20);
          for (let n = 2; s.spaces.some((x) => x.name === name); n++) name = title.slice(0, 18) + ' ' + n;
          s.spaces.push({ id: C.uid('space'), name, color: C.SPACE_COLORS[s.spaces.length % C.SPACE_COLORS.length], type: 'study', course: title });
        }
      })),
      addTask: (title) => { const sp = spaceForCourse(title); openTaskDialog(null, { title: '', date: today(), time: '', minutes: 30, space: sp ? sp.id : '' }); },
      addDate: (title) => { const sp = spaceForCourse(title); openDateDialog(null, { title: title + ' 考试', spaceId: sp ? sp.id : null }); },
      openSpace: (id) => { ui.mode = 'planner'; ui.space = id; render(); },
    } });
  /* ---------- quick add: one chat-style box for both courses and tasks ----------
     A line is typed from a template, read on the spot, and shown back as a card before anything
     is saved. Several lines at once become several cards. Nothing is written until "添加". */
  const COMPOSER = {
    course: {
      title: '添加课程', placeholder: '例如：自动控制原理 周四 1-2节 1-16周 @二东402 王老师',
      intro: '一行一门课，按下面的顺序写就行，顺序也可以打乱：\n课程名 · 星期 · 节次或钟点 · 周次 · @教室 · 某某老师\n周次不写就按整个学期；只上一次的课写具体日期。一次可以粘贴多行。',
      templates: [
        ['按节次', '自动控制原理 周四 1-2节 1-16周 @二东402 王老师'],
        ['按钟点', '传感器原理 周二 10:00-11:35 1-16周 @二中520'],
        ['单双周', '电路实验 周五 7-8节 2-16双周 @实验楼'],
        ['只上一次', '期中补课 ' + C.addDays(C.todayISO(), 4) + ' 14:00-15:35 @二东602'],
      ],
    },
    task: {
      title: '安排任务', placeholder: '例如：明天下午3点 复习单片机 40分钟 @学习 #考试',
      intro: '一行一件事，像发消息一样写：\n什么时候 · 做什么 · 多久 · @分区 · #标签\n时间和时长可以不写；标签可以写好几个，之后在任务列表里按标签筛选。',
      templates: [
        ['定时间', '明天下午3点 复习单片机 40分钟 #考试'],
        ['今天做', '今天 整理实验报告 30分钟 #作业'],
        ['下周', '下周一 9:00 小组讨论 1小时 #项目'],
        ['不定日期', '买洗衣液 #生活'],
      ],
    },
  };
  const composer = { mode: 'task', logs: { course: [], task: [] }, el: null };
  function openComposer(mode, prefill = '') {
    if (mode) composer.mode = mode;
    if (!composer.el) {
      composer.el = h('dialog', { class: 'composer', 'aria-label': '快速添加' });
      composer.el.addEventListener('click', (e) => { if (e.target === composer.el) composer.el.close(); });
      document.body.append(composer.el);
    }
    drawComposer(prefill);
    if (!composer.el.open) composer.el.showModal();
    const box = composer.el.querySelector('.composer-input');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }
  const fieldPill = (label, value, cls) => h('span', { class: 'cp-pill' + (cls ? ' ' + cls : '') }, h('small', {}, label), value);
  /* Reads the lines of one message into cards. Courses are checked against the timetable as it is now. */
  function readComposer(mode, text) {
    const lines = text.split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
    if (mode === 'task') return lines.map((line) => ({ line, ...C.parseTaskLine(state, line, today(), ui.space) }));
    const sched = T.normalize(state.schedule);
    const rows = lines.map((line) => T.fromLine(line, sched.settings));
    const p = T.preview(sched, rows);
    return rows.map((row, i) => {
      const r = p.records[i];
      const mine = T.expand(row, sched.settings);
      const clashes = r.errors.length ? [] : p.conflicts.filter((c) => mine.some((e) => T.key(e) === T.key(c.a)));
      return { line: lines[i], row, errors: r.errors, value: r.value, count: r.occurrences, clashes };
    });
  }
  function courseCardView(item) {
    const v = item.value, row = item.row;
    const when = v.date ? plainDate(v.date) : v.weekday ? T.weekdayNames[v.weekday - 1] : null;
    return [
      h('strong', { class: 'cp-title' }, v.title || '（没有课程名）'),
      h('div', { class: 'cp-pills' },
        when ? fieldPill(v.date ? '日期' : '星期', when) : null,
        v.startTime ? fieldPill('时间', v.startTime + '–' + v.endTime + (row.periods ? '（第 ' + row.periods + ' 节）' : '')) : row.periods ? fieldPill('节次', '第 ' + row.periods + ' 节') : null,
        !v.date && row.weeks ? fieldPill('周次', row.weeks + ' 周' + (row.weeksDefaulted ? '（没写，按整个学期）' : ''), row.weeksDefaulted ? 'guess' : '') : null,
        v.room ? fieldPill('教室', v.room) : null, v.teacher ? fieldPill('教师', v.teacher) : null),
      item.errors.length ? h('p', { class: 'cp-error' }, item.errors.join('；'))
        : h('p', { class: 'cp-ok' }, '会排进 ' + item.count + ' 次课' + (item.clashes.length ? ' · 与已有安排有 ' + item.clashes.length + ' 处时间重叠' : '')),
    ];
  }
  function taskCardView(item) {
    if (item.error) return [h('strong', { class: 'cp-title' }, item.line), h('p', { class: 'cp-error' }, item.error)];
    const t = item.task, sp = space(t.spaceId);
    return [
      h('strong', { class: 'cp-title' }, t.title),
      h('div', { class: 'cp-pills' },
        fieldPill('日期', t.date ? dateLabel(t.date) : '未定日期', t.date ? '' : 'guess'),
        t.time ? fieldPill('开始', t.time) : null,
        fieldPill('时长', minutesLabel(t.minutes) + (item.minutesGiven ? '' : '（默认）'), item.minutesGiven ? '' : 'guess'),
        sp ? fieldPill('分区', sp.name) : null,
        ...t.tags.map((tag) => h('span', { class: 'utag', style: '--tag:' + tagColor(tag) }, '#' + tag))),
      item.unknownSpace ? h('p', { class: 'cp-error' }, '没有叫「' + item.unknownSpace + '」的分区，先放在' + (sp ? '「' + sp.name + '」' : '不分区') + '。') : null,
    ];
  }
  function addFromComposer(msg) {
    const mode = msg.mode;
    if (mode === 'task') {
      const tasks = msg.items.filter((x) => x.task).map((x) => x.task);
      if (!tasks.length) return toast('没有能添加的任务');
      const ok = undoable('已添加 ' + tasks.length + ' 件事', () => change((s) => {
        for (const t of tasks) s.tasks.push({ id: C.uid('t'), title: t.title, date: t.date, minutes: t.minutes, spaceId: t.spaceId, done: false, doneAt: null, createdAt: Date.now(), origin: 'user', ...(t.time ? { time: t.time } : {}), ...(t.tags.length ? { tags: t.tags } : {}) });
      }));
      if (ok) { msg.done = tasks.length + ' 件事已加入任务列表'; drawComposer(); }
      return;
    }
    const items = readComposer('course', msg.items.map((x) => x.line).join('\n')); // the timetable may have changed since the card was shown
    const rows = items.filter((x) => !x.errors.length).map((x) => x.row);
    if (!rows.length) return toast('没有能添加的课程');
    try {
      const next = C.clone(state);
      next.schedule = T.applyImport(state.schedule, rows, '快速添加');
      const count = T.preview(state.schedule, rows).added.length;
      if (undoable('已排进 ' + count + ' 次课', () => commit(next))) { msg.done = rows.length + ' 门课已加入课表，共 ' + count + ' 次课'; drawComposer(); }
    } catch (error) { toast(error.message); }
  }
  function sendComposer(text) {
    const mode = composer.mode;
    if (!text.trim()) return;
    const items = readComposer(mode, text);
    composer.logs[mode].push({ role: 'user', text }, { role: 'bot', mode, items, text });
    drawComposer('');
  }
  function drawComposer(prefill) {
    const mode = composer.mode, conf = COMPOSER[mode], log = composer.logs[mode];
    const sched = T.normalize(state.schedule).settings;
    const needsTerm = mode === 'course' && (!T.dateOK(sched.semesterStart) || !sched.periods.length);
    const old = composer.el.querySelector('.composer-input');
    const draft = prefill !== undefined && prefill !== null ? prefill : old ? old.value : '';
    const input = h('textarea', { class: 'composer-input', rows: 1, maxLength: 3000, value: draft, placeholder: conf.placeholder, 'aria-label': conf.title,
      oninput: () => { grow(); hint(); },
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendComposer(input.value); } } });
    const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight) + 'px'; };
    // A live reading of the line being typed, so a mistake shows before it is sent.
    const live = h('div', { class: 'composer-live', 'aria-live': 'polite' });
    const hint = () => {
      const line = input.value.split('\n').filter((x) => x.trim()).pop() || '';
      if (!line.trim()) return live.replaceChildren(h('span', { class: 'sub' }, '回车发送 · Shift+回车换行 · 点上面的模板可以直接改'));
      const item = readComposer(mode, line)[0];
      const bad = mode === 'task' ? item.error : item.errors.length;
      live.replaceChildren(...[h('span', { class: 'sub' }, '识别为：'), ...(mode === 'task' ? taskCardView(item).slice(1, 2) : courseCardView(item).slice(1, 2)),
        bad ? h('span', { class: 'cp-error' }, mode === 'task' ? '还没读到要做的事' : item.errors[0]) : null].filter(Boolean));
    };
    const bubble = (msg, i) => {
      if (msg.role === 'user') return h('div', { class: 'cp-msg me' }, h('div', { class: 'cp-bubble' }, msg.text));
      const good = msg.mode === 'task' ? msg.items.filter((x) => x.task).length : msg.items.filter((x) => !x.errors.length).length;
      const clashes = msg.mode === 'course' && msg.items.some((x) => x.clashes && x.clashes.length);
      return h('div', { class: 'cp-msg bot' }, h('div', { class: 'cp-bubble' },
        h('p', {}, good === msg.items.length ? '读到了 ' + msg.items.length + (msg.mode === 'task' ? ' 件事' : ' 门课') + '，看一下对不对：' : '有 ' + (msg.items.length - good) + ' 行没读懂，标红的地方可以改了再发：'),
        msg.items.map((item) => h('div', { class: 'cp-card' + ((msg.mode === 'task' ? item.error : item.errors.length) ? ' bad' : '') }, msg.mode === 'task' ? taskCardView(item) : courseCardView(item))),
        msg.done ? h('p', { class: 'cp-done' }, icon('check'), msg.done)
          : h('div', { class: 'cp-actions' },
            good ? h('button', { class: 'btn dark slim', onclick: () => addFromComposer(msg) }, clashes ? '仍然添加' : good === msg.items.length ? '添加' : '添加能读懂的 ' + good + (msg.mode === 'task' ? ' 件' : ' 门')) : null,
            h('button', { class: 'btn outline slim', onclick: () => { log.splice(i - 1, 2); drawComposer(msg.text); } }, '改一下'),
            msg.mode === 'task' && msg.items.length === 1 && msg.items[0].task ? h('button', { class: 'btn ghost slim', title: '用完整的表单继续填写（分段、继续点等）', onclick: () => { const t = msg.items[0].task; composer.el.close(); openTaskDialog(null, { title: t.title, date: t.date || '', time: t.time || '', minutes: t.minutes, space: t.spaceId || '', next: '', tags: t.tags }); } }, '详细填写') : null)));
    };
    const switcher = h('div', { class: 'segmented slim composer-switch', role: 'tablist' }, [['course', '课程'], ['task', '任务']].map(([key, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(mode === key), class: mode === key ? 'on' : '', onclick: () => { composer.mode = key; drawComposer(''); composer.el.querySelector('.composer-input').focus(); } }, label)));
    const scroll = h('div', { class: 'composer-log' },
      h('div', { class: 'cp-msg bot' }, h('div', { class: 'cp-bubble intro' }, h('p', {}, conf.intro),
        needsTerm ? h('p', { class: 'cp-error' }, '还没有设置学期第 1 周和每节课的时间：按节次写的课需要它，按钟点写的课和具体日期的课不需要。', h('button', { class: 'text-btn', onclick: () => timetable.settings(() => drawComposer()) }, ' 去设置 ›')) : null)),
      log.map(bubble));
    composer.el.replaceChildren(
      h('header', { class: 'composer-head' }, h('h2', {}, conf.title), switcher, h('span', { class: 'grow' }),
        log.length ? h('button', { class: 'text-btn', onclick: () => { composer.logs[mode] = []; drawComposer(); } }, '清空') : null,
        mode === 'course' ? h('button', { class: 'text-btn', onclick: () => { composer.el.close(); timetable.openImport(); } }, '导入课表文件') : h('button', { class: 'text-btn', onclick: () => { composer.el.close(); openTaskDialog(null); } }, '用表单'),
        h('button', { class: 'icon-btn', 'aria-label': '关闭', onclick: () => composer.el.close() }, icon('close'))),
      scroll,
      h('footer', { class: 'composer-foot' },
        h('div', { class: 'composer-templates' }, h('span', { class: 'sub' }, '模板'), conf.templates.map(([label, text]) =>
          h('button', { class: 'cp-template', title: text, onclick: () => { input.value = text; grow(); hint(); input.focus(); } }, h('b', {}, label), h('span', {}, text)))),
        h('div', { class: 'composer-box' }, input, h('button', { class: 'send', 'aria-label': '发送', onclick: () => sendComposer(input.value) }, icon('send'))),
        live));
    requestAnimationFrame(() => { grow(); scroll.scrollTop = scroll.scrollHeight; });
    hint();
  }

  /* ---------- the workbench: one page that answers "what now, what today, how is the week going" ----------
     Everything here is read from the same data as the other pages; nothing is stored for it. */
  function renderHome() {
    const t = today();
    const now = new Date();
    const clockNow = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const monday = C.weekStart(t);
    const all = () => true;
    const old = $('.home-scroll');
    const scrollAt = old ? old.scrollTop : 0;
    const typing = old ? old.querySelector('.home-ask input') : null;
    const kept = typing ? typing.value : '';
    const open = (mode, spaceId) => { ui.mode = mode; if (spaceId !== undefined) ui.space = spaceId; render(); };
    const ask = (text) => { ui.mode = 'planner'; ui.space = null; render(); send(text); };
    const card = (title, action, ...body) => h('section', { class: 'home-card' }, h('header', {}, h('h3', {}, title), action || null), body);
    const link = (label, onclick) => h('button', { class: 'text-btn', onclick }, label);

    // --- now: the running timer, or the one thing to start
    const view = C.timerView(state, Date.now());
    const lesson = nextClass(null);
    const todays = state.tasks.filter((x) => !x.done && x.date && x.date <= t);
    const overdue = todays.filter((x) => x.date < t);
    const pick = todays.filter((x) => x.date === t && x.time && x.time >= clockNow).sort((a, b) => a.time.localeCompare(b.time))[0]
      || todays.filter((x) => x.next).sort(byWhen)[0] || [...todays].sort((a, b) => (b.date === t) - (a.date === t) || byWhen(a, b))[0] || null;
    const lessonLine = lesson ? h('button', { class: 'home-lesson', onclick: () => timetable.details(lesson) },
      h('b', { class: lesson.running ? 'live' : '' }, lesson.running ? '正在上课' : lesson.date === t ? '下一节课 ' + lesson.startTime : '下一节课 ' + dateLabel(lesson.date).split(' ')[0] + ' ' + lesson.startTime),
      ' ' + lesson.title + (lesson.room ? ' · ' + lesson.room : '') + (lesson.running ? ' · 到 ' + lesson.endTime : '')) : null;
    const hero = view ? h('section', { class: 'home-hero timing' },
      h('div', { class: 'home-hero-main' }, h('span', { class: 'sub' }, (view.running ? '正在计时' : '已暂停') + ' · 第 ' + (view.index + 1) + '/' + view.total + ' 段'),
        h('strong', {}, view.task.title), view.step.title !== view.task.title ? h('span', {}, view.step.title) : null,
        view.task.next ? h('span', { class: 'sub' }, '上次停在：' + view.task.next) : null, lessonLine),
      h('div', { class: 'home-clock clock-mirror' }, clock(view.remainingMs)),
      h('div', { class: 'home-hero-actions' },
        view.running ? h('button', { class: 'btn outline slim', onclick: () => commit(C.pauseTimer(state, Date.now())) }, icon('pause'), '暂停') : h('button', { class: 'btn outline slim', onclick: () => commit(C.resumeTimer(state, Date.now())) }, icon('play'), '继续'),
        h('button', { class: 'btn dark', onclick: finishCurrentStep }, icon('check'), view.index === view.total - 1 ? '完成' : '下一段'),
        h('button', { class: 'btn ghost', onclick: stopTimerNow }, '结束')))
      : h('section', { class: 'home-hero' },
        h('div', { class: 'home-hero-main' }, h('span', { class: 'sub' }, pick ? (pick.date < t ? '有一件过期的事' : pick.time ? '接下来 ' + pick.time : '现在可以做') : '今天没有待办'),
          pick ? h('button', { class: 'home-pick', title: '打开任务', onclick: () => openTaskDialog(pick) }, pick.title) : h('strong', {}, '想推进点什么？'),
          pick ? h('span', { class: 'sub' }, minutesLabel(pick.minutes) + (pick.steps ? ' · ' + pick.steps.filter((x) => x.done).length + '/' + pick.steps.length + ' 段' : '') + (space(pick.spaceId) ? ' · ' + space(pick.spaceId).name : '')) : h('span', { class: 'sub' }, '在下面写一件事，或者让助手帮你安排。'),
          pick && pick.next ? h('span', { class: 'home-next' }, '从这里继续：' + pick.next) : null, lessonLine),
        h('div', { class: 'home-hero-actions' },
          pick ? h('button', { class: 'btn dark', onclick: () => beginTimer(pick.id) }, icon('play'), '开始计时') : h('button', { class: 'btn dark', onclick: () => ask('帮我规划今天') }, '让助手规划今天'),
          overdue.length ? h('button', { class: 'btn outline slim', title: '把过期未完成的任务都改到今天', onclick: () => undoable(overdue.length + ' 项已改到今天', () => change((s) => { for (const x of s.tasks) if (!x.done && x.date && x.date < t) { x.date = t; delete x.time; } })) }, overdue.length + ' 项过期 → 改到今天') : null));

    // --- today
    const n = todayNumbers(all);
    const todayTasks = state.tasks.filter((x) => x.date && (x.date === t || (x.date < t && !x.done))).sort(byWhen);
    const budget = state.settings.prefs.dailyMinutes || null;
    const bar = (value, total, cls) => h('div', { class: 'home-bar ' + (cls || '') }, h('i', { style: 'width:' + Math.min(100, total ? (value / total) * 100 : 0).toFixed(1) + '%' }));
    const quick = h('input', { class: 'quick-add', placeholder: '加一件今天要做的事，按回车', maxLength: 150, 'aria-label': '添加今天的任务', onkeydown: (e) => {
      if (e.key !== 'Enter' || e.isComposing || !e.target.value.trim()) return;
      const title = e.target.value.trim();
      if (change((s) => s.tasks.push({ id: C.uid('t'), title, date: t, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: Date.now(), origin: 'user' }))) { const again = $('.home-today .quick-add'); if (again) again.focus(); }
    } });
    const todayCard = h('section', { class: 'home-card home-today' },
      h('header', {}, h('h3', {}, '今天 · ' + plainDate(t) + ' 周' + '日一二三四五六'[now.getDay()]), link('全部任务 ›', () => open('planner', null))),
      h('div', { class: 'home-figures' },
        h('div', {}, h('strong', {}, n.done + ' / ' + todayTasks.length), h('small', {}, '完成 / 今天的事')),
        h('div', {}, h('strong', {}, minutesLabel(n.focus)), h('small', {}, '今天已记录')),
        h('div', { class: n.over ? 'over' : '' }, h('strong', {}, minutesLabel(n.planned) + (budget ? ' / ' + minutesLabel(budget) : '')), h('small', {}, n.over ? '已安排，超出 ' + minutesLabel(n.over) : budget ? '已安排 / 每天可安排' : '已安排'), budget ? bar(n.planned, budget, n.over ? 'over' : '') : null)),
      timetable.daily(t).slice(1), todayTasks.length ? todayTasks.map(taskRow) : h('p', { class: 'empty' }, '今天还没有任务。'), quick);

    // --- the week
    const week = C.weekSummary(state, monday);
    const days = Array.from({ length: 7 }, (_, i) => C.addDays(monday, i));
    const perDay = days.map((d) => ({ d, planned: state.tasks.filter((x) => x.date === d).reduce((a, x) => a + x.minutes, 0), recorded: state.sessions.filter((x) => x.date === d).reduce((a, x) => a + x.actual, 0) }));
    const top = Math.max(60, ...perDay.map((x) => Math.max(x.planned, x.recorded)));
    const weekCard = card('本周', link('本周安排 ›', () => open('week')),
      week.focus ? h('ul', { class: 'home-focus' }, week.focus.split('\n').filter((x) => x.trim()).slice(0, 3).map((x) => h('li', {}, x))) : h('button', { class: 'home-hint', onclick: () => open('week') }, '还没有写这一周的重点，去写 1–3 件'),
      h('div', { class: 'home-week', role: 'img', 'aria-label': '本周每天的计划和已记录时长' }, perDay.map((x, i) => h('div', { class: 'home-day' + (x.d === t ? ' today' : ''), title: plainDate(x.d) + '：计划 ' + minutesLabel(x.planned) + '，已记录 ' + minutesLabel(x.recorded) },
        h('div', { class: 'home-day-bars' }, h('i', { class: 'plan', style: 'height:' + ((x.planned / top) * 100).toFixed(1) + '%' }), h('i', { class: 'done', style: 'height:' + ((x.recorded / top) * 100).toFixed(1) + '%' })),
        h('small', {}, '一二三四五六日'[i])))),
      h('p', { class: 'sub' }, '浅色是计划，深色是已记录。本周计划 ' + minutesLabel(week.planned) + (week.capacity != null ? ' / 可投入 ' + minutesLabel(week.capacity) : '') + '，已记录 ' + minutesLabel(week.recorded) + (week.unscheduled ? '，其中 ' + minutesLabel(week.unscheduled) + ' 还没定哪天' : '') + '。'),
      week.over ? h('p', { class: 'home-warn' }, '计划比可投入多 ' + minutesLabel(week.over) + '，考虑挪走或删减一些。') : null);

    // --- countdowns and cards
    const dates = C.upcomingDates(state, t).slice(0, 4);
    const datesCard = card('倒计时', link('+ 考试 / 截止日期', () => openDateDialog(null)),
      dates.length ? dates.map((d) => h('button', { class: 'next-row', onclick: () => { if (d.kind === 'goal') { ui.tabs.all = 'goals'; open('planner', null); } else openDateDialog(state.dates.find((x) => x.id === d.id)); } },
        h('b', { class: d.daysLeft <= 7 ? 'soon' : '' }, d.daysLeft === 0 ? '今天' : String(d.daysLeft), d.daysLeft === 0 ? null : h('small', {}, ' 天')),
        h('span', { class: 'next-text' }, d.title, h('small', {}, plainDate(d.date) + (d.time ? ' ' + d.time : '') + (d.place ? ' · ' + d.place : '') + (d.kind === 'goal' ? ' · 目标期限' : '') + (space(d.spaceId) ? ' · ' + space(d.spaceId).name : '')))))
        : h('p', { class: 'empty' }, '记下考试、报名或作业的截止日期，这里会倒数。'));
    const cards = C.cardStats(state, t);
    const cardsCard = cards.total ? card('复习卡片', link('全部卡片 ›', () => { ui.tabs.all = 'cards'; open('planner', null); }),
      h('div', { class: 'home-figures' },
        h('div', { class: cards.dueToday ? 'accent' : '' }, h('strong', {}, String(cards.dueToday)), h('small', {}, '今天到期')),
        h('div', {}, h('strong', {}, String(cards.total)), h('small', {}, '共有卡片')),
        h('div', {}, h('strong', {}, cards.recentAnswers ? cards.recentRemembered + ' / ' + cards.recentAnswers : '—'), h('small', {}, '近 14 天记住 / 回答'))),
      cards.dueToday ? h('button', { class: 'btn dark', onclick: () => { ui.space = null; startReview(); } }, '开始复习 ' + cards.dueToday + ' 张') : h('p', { class: 'sub' }, '今天没有到期的卡片。')) : null;

    // --- money at a glance
    const ms = C.moneySummary(state, t);
    const moneyCard = h('section', { class: 'home-card money' }, h('header', {}, h('h3', {}, '收支'), link('收支 ›', () => open('money'))),
      h('div', { class: 'home-figures' },
        h('div', {}, h('strong', {}, money(ms.balance)), h('small', {}, '余额')),
        h('div', {}, h('strong', {}, h('span', { class: 'amt in' }, '+' + money(ms.today.in)), ' ', h('span', { class: 'amt out' }, '−' + money(ms.today.out))), h('small', {}, '今天流入 / 流出')),
        h('div', { class: ms.budget && ms.budget.over ? 'over' : '' }, h('strong', {}, ms.budget ? money(ms.budget.left) : money(ms.piggy.total)), h('small', {}, ms.budget ? (ms.budget.over ? '生活费已超支' : '生活费还剩 · 日均 ' + money(ms.budget.perDay)) : '存钱罐'))),
      h('div', { class: 'row tight' }, h('button', { class: 'btn outline slim', onclick: () => openMoneyDialog(null) }, icon('plus'), '记一笔'), h('button', { class: 'btn ghost', onclick: () => openMoneyDialog(null, { kind: 'saved' }) }, '忍住了一次'),
        ms.budget ? h('span', { class: 'sub' }, '存钱罐 ' + money(ms.piggy.total)) : null));

    // --- habits, only when there are any
    const habitsCard = state.habits.length ? card('今天的习惯', h('span', { class: 'sub' }, state.habits.filter((x) => x.log[t]).length + ' / ' + state.habits.length), state.habits.map(habitRow)) : null;

    // --- spaces
    const spaceTile = (sp) => {
      const openTasks = state.tasks.filter((x) => x.spaceId === sp.id && !x.done);
      const due = C.dueCards(state, t, sp.id).length;
      const cls = sp.course ? nextClass(sp) : null;
      const date = C.upcomingDates(state, t, sp.id)[0];
      const lines = [openTasks.length ? openTasks.length + ' 项待办' : '没有待办', due ? due + ' 张卡片到期' : '', date ? date.title + ' 还有 ' + date.daysLeft + ' 天' : '',
        cls ? (cls.running ? '正在上课' : '下一节 ' + (cls.date === t ? '今天' : dateLabel(cls.date).split(' ')[0]) + ' ' + cls.startTime) : ''].filter(Boolean);
      return h('button', { class: 'home-space', onclick: () => open('planner', sp.id) }, h('span', { class: 'avatar', style: 'background:' + sp.color }, sp.name.slice(0, 1)),
        h('span', { class: 'home-space-text' }, h('strong', {}, sp.name), h('small', {}, lines.join(' · '))));
    };
    const spacesCard = card('分区', link('+ 新分区', () => openSpaceDialog(null)), h('div', { class: 'home-spaces' }, state.spaces.map(spaceTile)));

    // --- the last seven days: recorded time per day, the running streak and what got finished
    const last7 = Array.from({ length: 7 }, (_, i) => C.addDays(t, i - 6)).map((d) => ({ d, minutes: state.sessions.filter((x) => x.date === d).reduce((a, x) => a + x.actual, 0) }));
    const top7 = Math.max(30, ...last7.map((x) => x.minutes));
    const sum7 = last7.reduce((a, x) => a + x.minutes, 0);
    const heatDays = C.trajectory(state, t).heat;
    const run = streaks(heatDays, t);
    const recentDone = state.tasks.filter((x) => x.done && x.doneAt).sort((a, b) => b.doneAt - a.doneAt).slice(0, 4);
    const doneThisWeek = state.tasks.filter((x) => x.done && x.doneAt && C.todayISO(new Date(x.doneAt)) >= monday).length;
    const progressCard = card('最近 7 天', link('回看 ›', () => open('review')),
      h('div', { class: 'home-streak' },
        h('span', { class: 'home-streak-icon' + (run.current ? ' on' : '') }, icon('fire')),
        h('div', {}, h('strong', {}, run.current ? '连续 ' + run.current + ' 天有记录' : '还没有连续记录'), h('small', {}, '最长连续 ' + run.longest + ' 天 · 本周完成 ' + doneThisWeek + ' 项'))),
      h('div', { class: 'home-spark', role: 'img', 'aria-label': '最近 7 天每天已记录的时间，共 ' + minutesLabel(sum7) },
        last7.map((x) => h('div', { class: 'home-spark-day' + (x.d === t ? ' today' : ''), title: plainDate(x.d) + '：' + (x.minutes ? '已记录 ' + minutesLabel(x.minutes) : '没有记录') },
          h('span', { class: 'home-spark-value' }, x.minutes ? shortTime(x.minutes) : ''),
          h('div', { class: 'home-spark-track' }, h('i', { style: 'height:' + (x.minutes ? Math.max(6, (x.minutes / top7) * 100).toFixed(1) + '%' : '0') })),
          h('small', {}, x.d === t ? '今' : '日一二三四五六'[new Date(x.d + 'T12:00:00').getDay()])))),
      h('p', { class: 'sub' }, sum7 ? '7 天共记录 ' + minutesLabel(sum7) + '，平均每天 ' + minutesLabel(Math.round(sum7 / 7)) + '。' : '这 7 天还没有时间记录。开始一次计时，或者补记一段。'),
      recentDone.length ? h('div', { class: 'home-done' }, h('small', {}, '最近完成'), recentDone.map((x) => h('button', { class: 'home-done-row', onclick: () => openTaskDialog(x) },
        h('span', { class: 'home-done-check' }, icon('check')), h('span', { class: 'home-done-title' }, x.title), h('small', {}, dateLabel(C.todayISO(new Date(x.doneAt))).split(' ')[0])))) : null);

    // --- goals, only when there are any
    const goalRows = state.goals.map((g) => {
      const tasks = state.tasks.filter((x) => x.goalId === g.id);
      return { g, done: tasks.filter((x) => x.done).length, total: tasks.length };
    }).sort((a, b) => (a.g.deadline || '9999').localeCompare(b.g.deadline || '9999')).slice(0, 4);
    const goalsCard = goalRows.length ? card('目标进度', link('全部目标 ›', () => { ui.tabs.all = 'goals'; open('planner', null); }),
      goalRows.map(({ g, done, total }) => {
        const sp = space(g.spaceId);
        const left = g.deadline ? C.daysBetween(t, g.deadline) : null;
        return h('button', { class: 'home-goal', onclick: () => { ui.tabs[sp ? sp.type : 'all'] = 'goals'; open('planner', sp ? sp.id : null); } },
          h('span', { class: 'home-goal-top' }, h('span', { class: 'home-goal-title' }, sp ? h('i', { class: 'dot', style: 'background:' + sp.color }) : icon('target'), g.title),
            h('small', {}, total ? done + ' / ' + total : '还没有任务')),
          bar(done, total || 1, ''),
          left !== null ? h('small', { class: left < 0 ? 'overdue' : left <= 7 ? 'soon' : '' }, left < 0 ? '已过期限 ' + -left + ' 天' : left === 0 ? '今天到期' : '还有 ' + left + ' 天 · ' + plainDate(g.deadline)) : null);
      })) : null;

    // --- assistant
    const lastReply = [...state.messages].reverse().find((m) => m.role === 'assistant' && (m.spaceId || null) === null && m.text);
    const pending = state.messages.filter((m) => m.proposal && m.proposal.status === 'pending').length;
    const askBox = h('input', { value: kept, maxLength: 4000, placeholder: modelName() ? '对助手说点什么，回车发送' : '本地模式：写「单片机 2小时」这样的一行，回车', 'aria-label': '对助手说',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing && e.target.value.trim()) ask(e.target.value.trim()); } });
    const assistantCard = card('规划助手', link('打开对话 ›', () => open('planner', null)),
      pending ? h('button', { class: 'home-warn as-button', onclick: () => open('planner', null) }, '有 ' + pending + ' 份提议在等你确认') : null,
      lastReply ? h('p', { class: 'home-reply' }, lastReply.text.slice(0, 160) + (lastReply.text.length > 160 ? '…' : '')) : h('p', { class: 'sub' }, modelName() ? '告诉我你的任务、目标或者困难，我先看你的安排和记录再提议。' : '还没有连接 AI 模型，现在只能把每一行变成任务。'),
      h('div', { class: 'home-ask' }, askBox, h('button', { class: 'send', 'aria-label': '发送', onclick: () => { if (askBox.value.trim()) ask(askBox.value.trim()); } }, icon('send'))),
      h('div', { class: 'starters' }, STARTERS.map((text) => h('button', { class: 'pill soft', onclick: () => ask(text) }, text)),
        !modelName() ? h('button', { class: 'pill soft', onclick: () => openSettings('model') }, icon('plus'), '连接模型') : null));

    const hour = now.getHours();
    const hello = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    const schedule = T.normalize(state.schedule).settings;
    const weekNo = T.dateOK(schedule.semesterStart) && monday >= schedule.semesterStart ? Math.round(C.daysBetween(schedule.semesterStart, monday) / 7) + 1 : 0;
    $('#main').replaceChildren(h('div', { class: 'home-scroll' },
      h('header', { class: 'home-head' }, h('div', {}, h('h2', {}, (state.settings.prefs.name ? state.settings.prefs.name + '，' : '') + hello), h('p', { class: 'sub' }, plainDate(t) + ' 周' + '日一二三四五六'[now.getDay()] + (weekNo && (!schedule.weekCount || weekNo <= schedule.weekCount) ? ' · 第 ' + weekNo + ' 教学周' : ''))),
        h('div', { class: 'head-actions' }, h('button', { class: 'pill soft', onclick: () => openComposer('task') }, icon('plus'), h('span', {}, '新建任务')), h('button', { class: 'pill soft', onclick: () => openComposer('course') }, icon('plus'), h('span', {}, '添加课程')), h('button', { class: 'pill soft', onclick: () => openSessionDialog(null) }, icon('plus'), h('span', {}, '补记时间')))),
      hero,
      h('div', { class: 'home-grid' })));
    // The cards go into whichever column is shortest at that moment, so the columns end close together
    // instead of one running long beside an empty one. Today stays first in the widest column.
    const grid = $('.home-grid');
    const width = grid.clientWidth;
    const count = width >= 1040 ? 3 : width >= 620 ? 2 : 1;
    homeColumns = count;
    grid.style.setProperty('--cols', String(count));
    grid.classList.toggle('wide-first', count > 1);
    const cols = Array.from({ length: count }, () => grid.appendChild(h('div', { class: 'home-col' })));
    cols[0].append(todayCard);
    for (const el of [weekCard, assistantCard, progressCard, datesCard, habitsCard, goalsCard, cardsCard, moneyCard, spacesCard]) {
      if (!el) continue;
      const shortest = cols.reduce((a, b) => (b.offsetHeight < a.offsetHeight - 8 ? b : a));
      shortest.append(el);
    }
    $('.home-scroll').scrollTop = scrollAt;
    tick();
  }
  let homeColumns = 0;
  // A wider or narrower window, or a dragged task column, can change how many columns the workbench uses.
  let homeResize = null;
  if (window.ResizeObserver) new ResizeObserver(() => {
    clearTimeout(homeResize);
    homeResize = setTimeout(() => {
      const grid = ui.mode === 'home' && $('.home-grid');
      if (!grid) return;
      const width = grid.clientWidth;
      if ((width >= 1040 ? 3 : width >= 620 ? 2 : 1) !== homeColumns) renderHome();
    }, 120);
  }).observe($('#main'));
  // The workbench shows the time of day (the class in progress, what comes next), so it is redrawn each minute when nothing is being typed.
  setInterval(() => { if (ui.mode === 'home' && !$('#dialog').open && !$('#panel').open && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) renderHome(); }, 60000);

  /* ---------- the week page: seven days, the week's undated tasks, its focus and capacity ---------- */
  function renderWeek() {
    const t = today();
    const monday = ui.week || (ui.week = C.weekStart(t));
    const days = Array.from({ length: 7 }, (_, i) => C.addDays(monday, i));
    const sum = C.weekSummary(state, monday);
    const old = $('.wk-scroll');
    const scrollAt = old ? old.scrollTop : 0;
    const go = (date) => { ui.week = C.weekStart(date); render(); };
    const move = (id, target, label) => { try { const next = C.moveTask(state, id, target); undoable(label, () => commit(next)); } catch (error) { toast(error.message); } };
    const dayName = (d) => '周' + '一二三四五六日'[days.indexOf(d)];
    /* Anything that accepts a dragged task card. */
    const dropZone = (el, target, label) => {
      el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/tplan-task')) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
      el.addEventListener('drop', (e) => { const id = e.dataTransfer.getData('text/tplan-task'); el.classList.remove('drop'); if (!id) return; e.preventDefault(); e.stopPropagation(); move(id, target, label); });
      return el;
    };
    const card = (task) => {
      const sp = space(task.spaceId);
      return h('div', { class: 'wk-card' + (task.done ? ' done' : ''), draggable: true, ondragstart: (e) => { e.dataTransfer.setData('text/tplan-task', task.id); e.dataTransfer.effectAllowed = 'move'; } },
        h('button', { class: 'check', 'aria-label': task.done ? '标记为未完成' : '标记为完成', 'aria-pressed': String(task.done), onclick: () => toggleDone(task.id) }, task.done ? icon('check') : null),
        h('button', { class: 'wk-title', title: '打开任务', onclick: () => openTaskDialog(task) }, h('span', {}, task.title),
          h('small', {}, sp ? h('i', { class: 'dot', style: 'background:' + sp.color }) : null, (task.time ? task.time + ' · ' : '') + minutesLabel(task.minutes))),
        h('select', { class: 'wk-move', 'aria-label': '把「' + task.title + '」改到哪一天', title: '改日期（也可以直接拖动）', onchange: (e) => {
          const v = e.target.value;
          if (v === 'week') move(task.id, { week: monday }, '已放到本周未定');
          else if (v === 'none') move(task.id, {}, '已改为不定日期');
          else if (v) move(task.id, { date: v }, '已改到 ' + dayName(v));
        } }, h('option', { value: '' }, '改日期'), days.map((d) => h('option', { value: d, disabled: d === task.date }, dayName(d) + ' ' + Number(d.slice(8)) + '日')),
          h('option', { value: 'week' }, '这一周，先不定哪天'), h('option', { value: 'none' }, '不属于这一周')));
    };
    const quickAdd = (fields, placeholder) => h('input', { class: 'wk-add', placeholder, maxLength: 150, 'aria-label': placeholder, onkeydown: (e) => {
      if (e.key !== 'Enter' || e.isComposing || !e.target.value.trim()) return;
      const title = e.target.value.trim();
      change((s) => s.tasks.push({ id: C.uid('t'), title, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: Date.now(), origin: 'user', date: null, ...fields }));
    } });
    const recordedOn = (d) => state.sessions.filter((x) => x.date === d).reduce((n, x) => n + x.actual, 0);
    const dayColumn = (d) => {
      const tasks = state.tasks.filter((x) => x.date === d).sort(byWhen);
      const classes = T.events(state.schedule, d, d);
      const planned = tasks.reduce((n, x) => n + x.minutes, 0);
      const recorded = recordedOn(d);
      return dropZone(h('section', { class: 'wk-day' + (d === t ? ' today' : '') + (d < t ? ' past' : ''), 'aria-label': dayName(d) },
        h('header', {}, h('strong', {}, dayName(d) + (d === t ? ' · 今天' : '')), h('small', {}, plainDate(d))),
        h('p', { class: 'wk-meta' }, tasks.length ? tasks.filter((x) => x.done).length + '/' + tasks.length + ' 项 · 计划 ' + minutesLabel(planned) : '没有任务', recorded ? ' · 已记录 ' + minutesLabel(recorded) : ''),
        classes.length ? h('div', { class: 'wk-classes' }, classes.map((e) => h('button', { class: 'wk-class', title: e.title + (e.room ? ' · ' + e.room : ''), onclick: () => timetable.details(e) }, e.startTime + ' ' + e.title))) : null,
        tasks.map(card), quickAdd({ date: d }, '加一件事，回车')), { date: d }, '已改到 ' + dayName(d));
    };
    const loose = state.tasks.filter((x) => !x.date && x.week === monday).sort(byWhen);
    const others = state.tasks.filter((x) => !x.date && !x.week && !x.done).sort(byWhen).slice(0, 60);
    const stat = (value, label, cls) => h('div', { class: 'wk-stat ' + (cls || '') }, h('strong', {}, value), h('small', {}, label));
    const saveFocus = (e) => { if (e.target.value.trim() !== sum.focus) try { commit(C.setWeekPlan(state, monday, { focus: e.target.value })); } catch (error) { toast(error.message); } };
    const saveCapacity = (e) => { try { commit(C.setWeekPlan(state, monday, { capacity: e.target.value.trim() === '' ? null : e.target.value })); } catch (error) { toast(error.message); e.target.value = sum.capacityIsDefault ? '' : sum.capacity; } };
    $('#main').replaceChildren(
      h('header', { class: 'tt-header' }, h('div', {}, h('h2', {}, '本周安排'), h('p', { class: 'sub' }, '把任务拖到某一天，或用卡片上的「改日期」。计划时长和已记录时长是两回事，这里分开显示。')),
        h('div', { class: 'tt-week-nav' }, h('button', { class: 'btn ghost', onclick: () => go(C.addDays(monday, -7)) }, '‹ 上周'),
          h('strong', {}, plainDate(days[0]) + ' – ' + plainDate(days[6]) + (monday === C.weekStart(t) ? '（本周）' : '')),
          h('button', { class: 'btn ghost', onclick: () => go(C.addDays(monday, 7)) }, '下周 ›'),
          monday !== C.weekStart(t) ? h('button', { class: 'btn ghost', onclick: () => go(t) }, '回到本周') : null)),
      h('div', { class: 'wk-scroll' },
        h('section', { class: 'wk-top' },
          h('label', { class: 'field wk-focus' }, h('span', {}, '这一周的重点（建议 1–3 件，每行一件）'),
            h('textarea', { rows: 3, maxLength: 400, value: sum.focus, placeholder: '例如：\n操作系统复习到第 5 章\n交实验报告', onchange: saveFocus })),
          h('div', { class: 'field wk-side' }, h('span', {}, '这一周的时间'), h('div', { class: 'wk-stats' },
            h('label', { class: 'wk-stat edit' }, h('input', { type: 'number', min: 0, max: 10080, 'aria-label': '本周可投入分钟', value: sum.capacityIsDefault ? '' : sum.capacity, placeholder: sum.capacity != null ? String(sum.capacity) : '未设', onchange: saveCapacity }),
              h('small', {}, '本周可投入（分钟）' + (sum.capacityIsDefault && sum.capacity != null ? ' · 按每天 ' + state.settings.prefs.dailyMinutes + ' 分钟算' : sum.capacity == null ? ' · 点数字填写' : ''))),
            stat(minutesLabel(sum.scheduled), '已排到某一天'), stat(minutesLabel(sum.unscheduled), '本周未定'), stat(minutesLabel(sum.recorded), '已记录'),
            sum.over ? stat(minutesLabel(sum.over), '计划超出可投入', 'over') : stat(sum.capacity != null ? minutesLabel(Math.max(0, sum.capacity - sum.planned)) : '—', sum.capacity != null ? '还能再安排' : '没有设可投入时间')))),
        h('div', { class: 'wk-days' }, days.map(dayColumn)),
        dropZone(h('section', { class: 'wk-loose' },
          h('header', {}, h('strong', {}, '本周未定'), h('small', {}, '这一周要做、还没定哪天的事 · ' + loose.length + ' 项')),
          h('div', { class: 'wk-loose-cards' }, loose.map(card), quickAdd({ week: monday }, '加一件这周要做的事，回车'))), { week: monday }, '已放到本周未定'),
        others.length ? h('details', { class: 'wk-others' }, h('summary', {}, '其他没定日期的任务（' + others.length + '），可以拖到上面'), h('div', { class: 'wk-loose-cards' }, others.map(card))) : null));
    $('.wk-scroll').scrollTop = scrollAt;
  }

  function render() {
    if (ui.mode === 'home') ui.space = null; // the workbench is about everything, not one space
    renderRail();
    renderList();
    $('#shell').classList.toggle('timetable-mode', ui.mode === 'timetable' || ui.mode === 'week' || ui.mode === 'home' || ui.mode === 'review' || ui.mode === 'money');
    if (ui.mode === 'timetable') timetable.render(); else if (ui.mode === 'money') renderMoney(); else if (ui.mode === 'review') renderReview(); else if (ui.mode === 'week') renderWeek(); else if (ui.mode === 'home') renderHome(); else renderChat();
    renderDock();
    if ($('#panel').open && panelDraft) openSettingsDialog(panelDraft); // keep the open settings panel in step with the data
  }
  $('#openSettings').addEventListener('click', () => openSettings());
  $('#panel').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePanel(); });
  $('#panel').addEventListener('close', () => { panelDraft = null; });
  $('#dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDialog(); });

  /* Space icons grow smoothly as the pointer approaches, largest under the pointer, like a dock. */
  const rail = $('#rail');
  const REACH = 120;
  rail.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const horizontal = getComputedStyle(rail).flexDirection === 'row';
    rail.classList.add('magnify');
    for (const item of rail.querySelectorAll('.rail-item')) {
      const box = item.getBoundingClientRect();
      const distance = horizontal ? Math.abs(e.clientX - (box.left + box.width / 2)) : Math.abs(e.clientY - (box.top + 24));
      const near = Math.max(0, 1 - distance / REACH);
      item.style.setProperty('--near', (0.5 - 0.5 * Math.cos(Math.PI * near)).toFixed(3));
    }
  });
  rail.addEventListener('pointerleave', () => {
    rail.classList.remove('magnify');
    for (const item of rail.querySelectorAll('.rail-item')) item.style.setProperty('--near', '0');
  });

  /* The task column can be dragged wider or narrower. Dragging it very narrow closes it; double-click restores the default. */
  const LIST = { min: 220, max: 640, standard: 320, closeBelow: 150 };
  const shell = $('#shell');
  const splitter = $('#splitter');
  function showListWidth(width) {
    shell.style.setProperty('--list-w', width + 'px');
    shell.classList.toggle('list-closed', width === 0);
    splitter.setAttribute('aria-valuenow', String(width));
  }
  function fitListWidth(raw) {
    if (raw < LIST.closeBelow) return 0;
    return Math.round(Math.min(LIST.max, Math.max(LIST.min, raw), shell.clientWidth - ($(".rail-col").offsetWidth || 96) - 420));
  }
  const saveListWidth = (width) => { if (width !== state.settings.prefs.listWidth) change((s) => { s.settings.prefs.listWidth = width; }); };
  splitter.setAttribute('aria-valuemin', '0');
  splitter.setAttribute('aria-valuemax', String(LIST.max));
  splitter.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    const left = $('.list-col').getBoundingClientRect().left;
    let width = state.settings.prefs.listWidth;
    const move = (ev) => { width = fitListWidth(ev.clientX - left); showListWidth(width); };
    const stop = () => {
      splitter.removeEventListener('pointermove', move);
      splitter.classList.remove('dragging');
      document.body.classList.remove('resizing');
      saveListWidth(width);
    };
    splitter.classList.add('dragging');
    document.body.classList.add('resizing');
    splitter.addEventListener('pointermove', move);
    splitter.addEventListener('pointerup', stop, { once: true });
    splitter.addEventListener('pointercancel', stop, { once: true });
  });
  splitter.addEventListener('dblclick', () => { showListWidth(LIST.standard); saveListWidth(LIST.standard); });
  splitter.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 20;
    const current = state.settings.prefs.listWidth;
    let next = null;
    if (e.key === 'ArrowLeft') next = current <= LIST.min ? 0 : fitListWidth(current - step);
    else if (e.key === 'ArrowRight') next = current === 0 ? LIST.min : fitListWidth(current + step);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = fitListWidth(LIST.max);
    else if (e.key === 'Enter') next = current === 0 ? LIST.standard : 0;
    if (next === null) return;
    e.preventDefault();
    showListWidth(next);
    saveListWidth(next);
    splitter.focus();
  });
  showListWidth(Number.isFinite(state.settings.prefs.listWidth) ? state.settings.prefs.listWidth : LIST.standard);

  /* Files can be dropped anywhere in the window. */
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    addFiles(e.dataTransfer.files);
  });

  if (!state.messages.length && !state.settings.prefs.onboarded) change((s) => askOnboarding(s, 0));
  else render();
})();
