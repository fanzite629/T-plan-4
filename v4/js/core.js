/* T计划 v4 core rules. Pure functions only: no DOM, storage or network access. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./timetable.js'));
  else root.TPlanCore = factory(root.TPlanTimetable);
})(typeof globalThis === 'object' ? globalThis : this, function (Timetable) {
  'use strict';

  const VERSION = 2;
  const MAX_ACTIONS = 20;
  const MAX_STEPS = 12;
  const SPACE_COLORS = ['#E8825A', '#5B8DEF', '#4FA37A', '#B079D6', '#D9A441', '#4BA3B5'];

  /* What a space is for. The type decides what the space shows first, not what it may contain. */
  const SPACE_TYPES = [
    { id: 'study', name: '学习 / 课程', hint: '以今天的学习任务为主，适合一门课或一类学习' },
    { id: 'project', name: '项目', hint: '以目标和阶段为主，任务排在阶段下面' },
    { id: 'habit', name: '习惯 / 健康', hint: '以每周打卡和数字记录（例如体重）为主' },
    { id: 'life', name: '生活事务', hint: '一张简单的待办清单' },
  ];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const uid = (prefix) => prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const sum = (list, pick) => list.reduce((n, x) => n + pick(x), 0);

  /* ---------- dates (local time, YYYY-MM-DD) ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayISO = (now = new Date()) => iso(now);
  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + 'T12:00:00');
    return !isNaN(d) && iso(d) === s;
  }
  function addDays(s, n) {
    const d = new Date(s + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return iso(d);
  }
  const validTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  /* Monday of the week containing s. */
  function weekStart(s) {
    const d = new Date(s + 'T12:00:00');
    return addDays(s, -((d.getDay() + 6) % 7));
  }

  /* ---------- state ---------- */
  function emptyState() {
    const names = ['学习', '项目', '习惯与健康', '生活'];
    return {
      version: VERSION,
      spaces: names.map((name, i) => ({ id: 'space_' + (i + 1), name, color: SPACE_COLORS[i], type: SPACE_TYPES[i].id })),
      tasks: [],
      repeats: [],
      habits: [],
      goals: [],
      sessions: [],
      reflections: [],
      metrics: [],
      dates: [],
      cards: [],
      messages: [],
      memory: [],
      timer: null,
      weekPlans: {},
      money: emptyMoney(),
      schedule: Timetable.empty(),
      settings: {
        agent: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: '', models: [], vision: null },
        prefs: { segment: 25, dailyMinutes: null, bestTime: null, onboarded: false, timerCompact: false, listWidth: 320, name: '', remindMinutes: 10, railCompact: false, railFolded: {}, homeHidden: [], homeOrder: [] },
      },
    };
  }

  /* Money: what came in, what went out, and what was not spent after all. */
  function emptyMoney() { return { opening: 0, openingDate: null, monthly: null, symbol: '¥', share: false, entries: [] }; }

  /* Repairs missing fields so older or hand-edited exports still load. Rejects newer versions. */
  function normalize(raw) {
    if (!isObject(raw)) throw new Error('数据不是有效的对象');
    if ((raw.version || 0) > VERSION) throw new Error('这是更新版本的数据，请使用新版软件打开');
    const base = emptyState();
    const s = { ...base, ...raw, version: VERSION };
    s.schedule = Timetable.normalize(raw.schedule);
    for (const key of ['spaces', 'tasks', 'habits', 'goals', 'sessions', 'reflections', 'metrics', 'dates', 'cards', 'messages', 'memory']) if (!Array.isArray(s[key])) s[key] = base[key];
    s.settings = { ...base.settings, ...(isObject(raw.settings) ? raw.settings : {}) };
    s.settings.agent = { ...base.settings.agent, ...(isObject(s.settings.agent) ? s.settings.agent : {}) };
    s.settings.prefs = { ...base.settings.prefs, ...(isObject(s.settings.prefs) ? s.settings.prefs : {}) };
    if (!isObject(s.settings.prefs.railFolded)) s.settings.prefs.railFolded = {};
    for (const key of ['homeHidden', 'homeOrder']) s.settings.prefs[key] = Array.isArray(s.settings.prefs[key]) ? s.settings.prefs[key].filter((x) => typeof x === 'string').slice(0, 30) : [];
    // Spaces saved before types existed: the four built-in ones get their natural type, others the task-centred one.
    const builtIn = { space_1: 'study', space_2: 'project', space_3: 'habit', space_4: 'life' };
    for (const sp of s.spaces) if (!SPACE_TYPES.some((t) => t.id === sp.type)) sp.type = builtIn[sp.id] || 'study';
    const spaceIds = new Set(s.spaces.map((x) => x.id));
    s.repeats = (Array.isArray(raw.repeats) ? raw.repeats : []).map((r) => {
      if (!isObject(r) || typeof r.id !== 'string' || !r.id) return null;
      const title = cleanText(r.title, 150), rule = cleanRule(r.rule, todayISO());
      if (!title || !rule) return null;
      return { id: r.id, title, minutes: cleanMinutes(r.minutes, 30), spaceId: spaceIds.has(r.spaceId) ? r.spaceId : null, tags: cleanTags(r.tags), rule,
        madeUntil: validDate(r.madeUntil) ? r.madeUntil : null, createdAt: Number(r.createdAt) || 0, ...(validTime(r.time) ? { time: r.time } : {}) };
    }).filter(Boolean);
    const repeatIds = new Set(s.repeats.map((r) => r.id));
    for (const m of s.metrics) {
      if (!Array.isArray(m.entries)) m.entries = [];
      if (!spaceIds.has(m.spaceId)) m.spaceId = null;
    }
    const goalIds = new Set(s.goals.map((x) => x.id));
    for (const t of s.tasks) {
      if (!validDate(t.date)) t.date = null;
      if (!t.date || !validTime(t.time)) delete t.time; // a start time only means something on a dated task
      if (t.date || !validDate(t.week)) delete t.week; // an undated task may belong to one week
      if (typeof t.next !== 'string' || !t.next.trim()) delete t.next;
      if (!spaceIds.has(t.spaceId)) t.spaceId = null;
      if (!goalIds.has(t.goalId)) t.goalId = null;
      if (!Array.isArray(t.steps) || !t.steps.length) delete t.steps;
      const tags = cleanTags(t.tags);
      if (tags.length) t.tags = tags; else delete t.tags;
      if (!repeatIds.has(t.repeatId) || !validDate(t.repeatDate)) { delete t.repeatId; delete t.repeatDate; }
      const note = cardText(t.note, 1000);
      if (note) t.note = note; else delete t.note;
      if (!(Number.isInteger(t.estimate) && t.estimate >= 1 && t.estimate <= 1440)) delete t.estimate;
      t.done = !!t.done;
    }
    for (const h of s.habits) {
      if (!isObject(h.log)) h.log = {};
      if (!spaceIds.has(h.spaceId)) h.spaceId = null;
    }
    for (const g of s.goals) {
      if (!Array.isArray(g.milestones)) g.milestones = [];
      if (!spaceIds.has(g.spaceId)) g.spaceId = null;
    }
    if (!isObject(s.weekPlans)) s.weekPlans = {};
    s.money = { ...emptyMoney(), ...(isObject(raw.money) ? raw.money : {}) };
    s.money.opening = Number.isFinite(Number(s.money.opening)) ? cents(s.money.opening) : 0;
    s.money.monthly = s.money.monthly == null || !(Number(s.money.monthly) > 0) ? null : cents(s.money.monthly);
    if (!validDate(s.money.openingDate)) s.money.openingDate = null;
    s.money.symbol = typeof s.money.symbol === 'string' && s.money.symbol.trim() ? s.money.symbol.trim().slice(0, 3) : '¥';
    s.money.share = s.money.share === true;
    s.money.entries = (Array.isArray(s.money.entries) ? s.money.entries : []).filter((e) => isObject(e) && validDate(e.date) && MONEY_KINDS.includes(e.kind) && Number(e.amount) > 0);
    s.sessions = s.sessions.filter((x) => isObject(x) && validDate(x.date) && Number(x.actual) > 0);
    s.dates = s.dates.filter((d) => isObject(d) && validDate(d.date) && typeof d.title === 'string' && d.title);
    for (const d of s.dates) {
      if (!spaceIds.has(d.spaceId)) d.spaceId = null;
      if (!validTime(d.time)) delete d.time;
    }
    s.cards = s.cards.filter((c) => isObject(c) && typeof c.front === 'string' && c.front);
    for (const c of s.cards) {
      if (!spaceIds.has(c.spaceId)) c.spaceId = null;
      if (typeof c.back !== 'string') c.back = '';
      if (!validDate(c.due)) c.due = todayISO(new Date(c.createdAt || Date.now()));
      c.stage = Number.isInteger(c.stage) && c.stage >= 0 ? Math.min(c.stage, CARD_INTERVALS.length) : 0;
      if (!Array.isArray(c.reviews)) c.reviews = [];
    }
    if (s.timer && !s.tasks.some((t) => t.id === s.timer.taskId)) s.timer = null;
    return s;
  }

  /* ---------- small validators ---------- */
  function cleanText(value, max) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, max);
  }
  /* Tags are the user's own words for a task: short, no spaces, at most six, kept in the order written. */
  const MAX_TAGS = 6;
  function cleanTags(value) {
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,，、;；]+/) : [];
    const out = [];
    for (const part of parts) {
      const tag = typeof part === 'string' ? part.replace(/^[#＃]+/, '').replace(/[#＃\s.,，。;；:：!！?？"'“”‘’()（）[\]【】<>《》]/g, '').slice(0, 12) : '';
      if (tag && !out.includes(tag)) out.push(tag);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }
  /* Pulls "#标签" words out of a line and returns what is left. */
  function takeTags(text) {
    const tags = [];
    const rest = String(text || '').replace(/[#＃]([^\s#＃,，。;；、]{1,12})/g, (_, tag) => { tags.push(tag); return ' '; });
    return { rest: rest.replace(/\s+/g, ' ').trim(), tags: cleanTags(tags) };
  }
  function cleanMinutes(value, fallback, min = 1, max = 1440) {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }
  function spaceIdByName(state, name) {
    const wanted = cleanText(name, 40).toLowerCase();
    if (!wanted) return null;
    const hit = state.spaces.find((x) => x.name.toLowerCase() === wanted || x.id === name);
    return hit ? hit.id : null;
  }

  /* The space of a proposed item. An explicit id (set by the app when the user is chatting inside a
     space) wins over a name chosen by the model. */
  function pickSpace(state, a) {
    if (a.spaceId && state.spaces.some((x) => x.id === a.spaceId)) return a.spaceId;
    return spaceIdByName(state, a.space);
  }

  /* A task as the assistant may describe it. Steps are the timed segments of one sitting. */
  function taskFields(state, a, label = '任务') {
    const title = cleanText(a.title, 150);
    if (!title) throw new Error(label + '缺少标题');
    const out = { title, date: validDate(a.date) ? a.date : null, minutes: cleanMinutes(a.minutes, 30), spaceId: pickSpace(state, a) };
    if (out.date && validTime(a.time)) out.time = a.time;
    const tags = cleanTags(a.tags);
    if (tags.length) out.tags = tags;
    if (Array.isArray(a.steps) && a.steps.length) {
      out.steps = a.steps.slice(0, MAX_STEPS).map((step) => {
        const stepTitle = cleanText(isObject(step) ? step.title : step, 100);
        if (!stepTitle) throw new Error(label + '的步骤缺少内容');
        return { title: stepTitle, minutes: cleanMinutes(isObject(step) ? step.minutes : null, 25, 1, 180) };
      });
      out.minutes = sum(out.steps, (x) => x.minutes);
    }
    return out;
  }

  /* ---------- assistant actions ----------
     The assistant can only propose these. Nothing changes until the user confirms the proposal. */
  function validateActions(state, rawActions) {
    const accepted = [];
    const rejected = [];
    const list = Array.isArray(rawActions) ? rawActions.slice(0, MAX_ACTIONS) : [];
    for (const raw of list) {
      try {
        accepted.push(validateAction(state, raw));
      } catch (error) {
        rejected.push(error.message);
      }
    }
    return { actions: accepted, rejected };
  }

  function validateAction(state, a) {
    if (!isObject(a)) throw new Error('操作格式无效');
    const existing = (id) => {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) throw new Error('引用的任务不存在');
      return t;
    };
    switch (a.type) {
      case 'add_task':
        return { type: 'add_task', ...taskFields(state, a) };
      case 'update_task': {
        const t = existing(a.taskId);
        const out = { type: 'update_task', taskId: t.id };
        if (a.title !== undefined) {
          out.title = cleanText(a.title, 150);
          if (!out.title) throw new Error('任务标题不能为空');
        }
        if (a.date !== undefined) out.date = validDate(a.date) ? a.date : null;
        if (a.minutes !== undefined) out.minutes = cleanMinutes(a.minutes, t.minutes);
        if (a.time !== undefined) out.time = validTime(a.time) ? a.time : null;
        if (a.tags !== undefined) out.tags = cleanTags(a.tags);
        if (Object.keys(out).length === 2) throw new Error('修改任务时没有给出新内容');
        return out;
      }
      case 'complete_task':
        return { type: 'complete_task', taskId: existing(a.taskId).id };
      case 'delete_task':
        return { type: 'delete_task', taskId: existing(a.taskId).id };
      case 'add_repeat': {
        const title = cleanText(a.title, 150);
        if (!title) throw new Error('重复任务缺少内容');
        // A proposal is checked again when it is confirmed, and by then it carries the rule itself.
        const read = isObject(a.rule) ? { ruleRaw: a.rule } : takeRepeat(typeof a.repeat === 'string' ? a.repeat : '', todayISO());
        if (!read || read.error) throw new Error('重复任务的 repeat 要写成「每天」「每周四」「每周一三五」「工作日」「每隔一天」「每月1号」这样');
        const rule = cleanRule({ ...read.ruleRaw, ...(validDate(a.start) ? { start: a.start } : {}), ...(validDate(a.until) ? { until: a.until } : {}) }, todayISO());
        if (!rule) throw new Error('重复规则不完整');
        return { type: 'add_repeat', title, minutes: cleanMinutes(a.minutes, 30), spaceId: pickSpace(state, a), tags: cleanTags(a.tags), rule, ...(validTime(a.time) ? { time: a.time } : {}) };
      }
      case 'add_habit': {
        const title = cleanText(a.title, 80);
        if (!title) throw new Error('习惯缺少名称');
        const perWeek = Math.round(Number(a.perWeek));
        return { type: 'add_habit', title, perWeek: perWeek >= 1 && perWeek <= 7 ? perWeek : 7, spaceId: pickSpace(state, a) };
      }
      case 'add_goal': {
        const title = cleanText(a.title, 150);
        if (!title) throw new Error('目标缺少名称');
        const spaceId = pickSpace(state, a);
        let budget = 40;
        const milestones = (Array.isArray(a.milestones) ? a.milestones : []).slice(0, 12).map((m) => {
          const name = cleanText(isObject(m) ? m.title : '', 120);
          if (!name) throw new Error('目标的阶段缺少名称');
          const tasks = (Array.isArray(m.tasks) ? m.tasks : []).slice(0, Math.max(0, budget)).map((t) => {
            const fields = taskFields(state, t, '阶段任务');
            if (spaceId || !fields.spaceId) fields.spaceId = spaceId; // tasks of a goal live in the goal's space
            return fields;
          });
          budget -= tasks.length;
          return { title: name, due: validDate(m.due) ? m.due : null, tasks };
        });
        if (!milestones.length) throw new Error('目标至少需要一个阶段');
        return { type: 'add_goal', title, deadline: validDate(a.deadline) ? a.deadline : null, spaceId, milestones };
      }
      case 'log_metric': {
        const name = cleanText(a.name, 30);
        const value = Number(a.value);
        if (!name) throw new Error('记录缺少名称');
        if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error('记录的数值无效');
        return { type: 'log_metric', name, value: Math.round(value * 100) / 100, unit: cleanText(a.unit, 10), date: validDate(a.date) ? a.date : null, spaceId: pickSpace(state, a) };
      }
      case 'add_reflection': {
        // Line breaks are kept: a reflection is the user's own writing, often transcribed from a photo.
        const text = typeof a.text === 'string' ? a.text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000) : '';
        if (!text) throw new Error('反思内容为空');
        return { type: 'add_reflection', text, date: validDate(a.date) ? a.date : null };
      }
      case 'remember': {
        const text = cleanText(a.text, 300);
        if (!text) throw new Error('记忆内容为空');
        return { type: 'remember', text };
      }
      case 'log_time': {
        const minutes = Math.round(Number(a.minutes));
        if (!(minutes >= 1 && minutes <= 1440)) throw new Error('补记的时间需要是 1–1440 分钟');
        const task = a.taskId ? existing(a.taskId) : null;
        const title = cleanText(a.title, 150) || (task ? task.title : '');
        if (!title) throw new Error('补记缺少内容');
        return { type: 'log_time', title, minutes, date: validDate(a.date) ? a.date : null, taskId: task ? task.id : null, spaceId: task ? task.spaceId : pickSpace(state, a) };
      }
      case 'log_money': {
        const f = moneyFields({ ...a, date: validDate(a.date) ? a.date : todayISO() });
        return { type: 'log_money', kind: f.kind, amount: f.amount, category: f.category, note: f.note, date: validDate(a.date) ? a.date : null };
      }
      case 'add_date': {
        const title = cleanText(a.title, 80);
        if (!title) throw new Error('重要日期缺少名称');
        if (!validDate(a.date)) throw new Error('重要日期缺少有效的日期');
        const out = { type: 'add_date', title, date: a.date, place: cleanText(a.place, 40), spaceId: pickSpace(state, a) };
        if (validTime(a.time)) out.time = a.time;
        return out;
      }
      case 'add_cards': {
        const cards = (Array.isArray(a.cards) ? a.cards : []).slice(0, MAX_CARDS_PER_ACTION).map((c) => ({ front: cardText(c && c.front, 300), back: cardText(c && c.back, 800) })).filter((c) => c.front && c.back);
        if (!cards.length) throw new Error('复习卡片需要同时有问题和答案');
        return { type: 'add_cards', cards, spaceId: pickSpace(state, a) };
      }
      default:
        throw new Error('不支持的操作类型');
    }
  }

  function newTask(fields, now, origin, extra) {
    const task = { id: uid('t'), title: fields.title, date: fields.date, minutes: fields.minutes, spaceId: fields.spaceId, done: false, doneAt: null, createdAt: now, origin, ...extra };
    if (fields.time) task.time = fields.time;
    if (fields.tags && fields.tags.length) task.tags = cleanTags(fields.tags);
    if (fields.steps) task.steps = fields.steps.map((x) => ({ title: x.title, minutes: x.minutes, done: false }));
    return task;
  }

  function applyAction(s, a, now, origin, created) {
    if (a.type === 'add_task') {
      const task = newTask(a, now, origin);
      s.tasks.push(task);
      created.push(task.id);
    } else if (a.type === 'update_task') {
      const t = s.tasks.find((x) => x.id === a.taskId);
      for (const key of ['title', 'date', 'minutes', 'time']) if (a[key] !== undefined) t[key] = a[key];
      if (!t.date || !t.time) delete t.time;
      if (a.tags !== undefined) { if (a.tags.length) t.tags = a.tags; else delete t.tags; }
    } else if (a.type === 'complete_task') {
      const t = s.tasks.find((x) => x.id === a.taskId);
      if (!t.done) { t.done = true; t.doneAt = now; }
    } else if (a.type === 'delete_task') {
      s.tasks = s.tasks.filter((x) => x.id !== a.taskId);
      if (s.timer && s.timer.taskId === a.taskId) s.timer = null;
    } else if (a.type === 'add_repeat') {
      s.repeats.push({ id: uid('r'), title: a.title, minutes: a.minutes, spaceId: a.spaceId, tags: a.tags, rule: a.rule, madeUntil: null, createdAt: now, ...(a.time ? { time: a.time } : {}) });
      const made = materializeRepeats(s, todayISO(new Date(now)), now).state;
      s.tasks = made.tasks; s.repeats = made.repeats;
    } else if (a.type === 'add_habit') {
      s.habits.push({ id: uid('h'), title: a.title, perWeek: a.perWeek, spaceId: a.spaceId, log: {}, createdAt: now });
    } else if (a.type === 'add_goal') {
      const goal = { id: uid('g'), title: a.title, deadline: a.deadline, spaceId: a.spaceId, createdAt: now, origin, milestones: a.milestones.map((m) => ({ title: m.title, due: m.due })) };
      s.goals.push(goal);
      a.milestones.forEach((m, index) => m.tasks.forEach((fields) => {
        const task = newTask(fields, now, origin, { goalId: goal.id, milestone: index });
        s.tasks.push(task);
        created.push(task.id);
      }));
    } else if (a.type === 'log_metric') {
      logMetric(s, a, now);
    } else if (a.type === 'add_reflection') {
      s.reflections.push({ id: uid('r'), date: a.date || todayISO(new Date(now)), text: a.text, at: now, source: origin });
    } else if (a.type === 'remember') {
      addMemory(s, a.text, now, origin);
    } else if (a.type === 'log_time') {
      s.sessions.push(manualSession(s, { title: a.title, minutes: a.minutes, date: a.date || todayISO(new Date(now)), taskId: a.taskId, spaceId: a.spaceId }, now));
    } else if (a.type === 'log_money') {
      s.money.entries.push(moneyEntry({ ...a, date: a.date || todayISO(new Date(now)) }, now));
    } else if (a.type === 'add_date') {
      s.dates.push({ id: uid('d'), title: a.title, date: a.date, ...(a.time ? { time: a.time } : {}), place: a.place || '', spaceId: a.spaceId, createdAt: now });
    } else if (a.type === 'add_cards') {
      for (const c of a.cards) s.cards.push(newCard(c, a.spaceId, now, origin));
    }
  }

  /* ---------- time records entered or corrected by hand ----------
     A timer session is an observation; a hand-entered one is the user's report. Both count as time
     spent, but only timer sessions say anything about pace against a plan, so manual ones are marked. */
  function sessionFields(s, f) {
    const minutes = Math.round(Number(f.minutes));
    if (!(minutes >= 1 && minutes <= 1440)) throw new Error('时间请填 1–1440 分钟');
    if (!validDate(f.date)) throw new Error('请选择日期');
    const task = f.taskId ? s.tasks.find((t) => t.id === f.taskId) : null;
    const title = cleanText(f.title, 150) || (task ? task.title : '');
    if (!title) throw new Error('请填写做了什么');
    return { title, minutes, date: f.date, taskId: task ? task.id : null, spaceId: task ? task.spaceId || null : s.spaces.some((x) => x.id === f.spaceId) ? f.spaceId : null,
      hour: validTime(f.startTime) ? Number(f.startTime.slice(0, 2)) : null, startTime: validTime(f.startTime) ? f.startTime : null, note: cardText(f.note, 600) };
  }
  function manualSession(s, f, now) {
    const v = sessionFields(s, f);
    return { id: uid('s'), taskId: v.taskId, title: v.title, step: v.title, spaceId: v.spaceId, planned: v.minutes, actual: v.minutes, date: v.date, hour: v.hour, ...(v.startTime ? { startTime: v.startTime } : {}), endedAt: now, partial: false, manual: true, ...(v.note ? { note: v.note } : {}) };
  }
  function addSession(state, f, now) {
    const s = clone(state);
    s.sessions.push(manualSession(s, f, now));
    return s;
  }
  /* Corrects a saved record. A timer session keeps its planned length; it is marked as edited. */
  function updateSession(state, id, f) {
    const s = clone(state);
    const x = s.sessions.find((y) => y.id === id);
    if (!x) throw new Error('这条记录已不存在');
    const v = sessionFields(s, f);
    Object.assign(x, { title: v.title, actual: v.minutes, date: v.date, taskId: v.taskId, spaceId: v.spaceId });
    if (x.manual) { x.planned = v.minutes; x.step = v.title; }
    else x.edited = true;
    if (v.startTime) { x.startTime = v.startTime; x.hour = v.hour; } else if (x.manual) { delete x.startTime; x.hour = null; }
    if (v.note) x.note = v.note; else delete x.note;
    return s;
  }
  /* What the user writes down when a sitting ends: what was done and where it got stuck go on the
     record of that sitting; where to pick up goes on the task, and is shown when it is next started. */
  function wrapUp(state, f) {
    const s = clone(state);
    const session = f.sessionId ? s.sessions.find((x) => x.id === f.sessionId) : null;
    const task = f.taskId ? s.tasks.find((x) => x.id === f.taskId) : null;
    const did = cardText(f.did, 600), stuck = cardText(f.stuck, 600), next = cleanText(f.next, 300);
    if (session) {
      if (did) session.note = did; else delete session.note;
      if (stuck) session.stuck = stuck; else delete session.stuck;
    }
    if (task) { if (next) task.next = next; else delete task.next; }
    return s;
  }

  /* ---------- the week: where each task sits, what the week is for, how much fits ---------- */
  /* Puts a task on a day, or into a week without a day. Its records and steps are left alone. */
  function moveTask(state, taskId, target) {
    const s = clone(state);
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('任务已不存在');
    if (validDate(target.date)) { task.date = target.date; delete task.week; }
    else if (validDate(target.week)) { task.date = null; task.week = weekStart(target.week); delete task.time; }
    else { task.date = null; delete task.week; delete task.time; }
    return s;
  }
  function setWeekPlan(state, monday, values) {
    const s = clone(state);
    const plan = { ...(s.weekPlans[monday] || {}) };
    if (values.focus !== undefined) plan.focus = cardText(values.focus, 400);
    if (values.capacity !== undefined) {
      const n = values.capacity === null || values.capacity === '' ? null : Math.round(Number(values.capacity));
      if (n !== null && !(n >= 0 && n <= 10080)) throw new Error('本周可投入请填 0–10080 分钟');
      plan.capacity = n;
    }
    s.weekPlans[monday] = plan;
    return s;
  }
  /* Planned minutes include finished tasks; recorded minutes come only from time records. They are
     different facts, so neither is subtracted from the other. */
  function weekSummary(state, monday) {
    const end = addDays(monday, 6);
    const plan = state.weekPlans[monday] || {};
    const dated = state.tasks.filter((t) => t.date && t.date >= monday && t.date <= end);
    const loose = state.tasks.filter((t) => !t.date && t.week === monday);
    const daily = state.settings.prefs.dailyMinutes;
    const capacity = plan.capacity != null ? plan.capacity : daily ? daily * 7 : null;
    const planned = sum(dated, (t) => t.minutes) + sum(loose, (t) => t.minutes);
    return {
      focus: plan.focus || '', capacity, capacityIsDefault: plan.capacity == null,
      scheduled: sum(dated, (t) => t.minutes), unscheduled: sum(loose, (t) => t.minutes), planned,
      recorded: sum(state.sessions.filter((x) => x.date >= monday && x.date <= end), (x) => x.actual),
      over: capacity != null && planned > capacity ? planned - capacity : 0,
    };
  }

  /* ---------- money: income, spending and the piggy bank ----------
     Three kinds of entry. 'in' adds to the balance and 'out' takes from it. 'saved' is money the
     user decided not to spend: it never touches the balance and is counted on its own.
     Amounts are kept to the cent. Nothing here moves real money; it is a record. */
  const MONEY_KINDS = ['in', 'out', 'saved'];
  const MONEY_CATEGORIES = { in: ['生活费', '兼职', '奖学金', '红包', '退款', '其他'], out: ['餐饮', '交通', '学习', '购物', '娱乐', '住宿', '其他'], saved: ['餐饮', '购物', '娱乐', '交通', '其他'] };
  const cents = (value) => Math.round(Number(value) * 100) / 100;
  function moneyFields(f) {
    if (!MONEY_KINDS.includes(f.kind)) throw new Error('请选择是收入、支出还是忍住没花');
    const amount = cents(f.amount);
    if (!(amount > 0 && amount <= 1e8)) throw new Error('金额请填大于 0 的数字');
    if (!validDate(f.date)) throw new Error('请选择日期');
    const category = cleanText(f.category, 12) || '其他';
    return { kind: f.kind, amount, date: f.date, category, note: cleanText(f.note, 120), ...(validTime(f.time) ? { time: f.time } : {}) };
  }
  const moneyEntry = (f, now) => ({ id: uid('y'), ...moneyFields(f), createdAt: now });
  function addMoney(state, f, now) { const s = clone(state); s.money.entries.push(moneyEntry(f, now)); return s; }
  function updateMoney(state, id, f) {
    const s = clone(state);
    const i = s.money.entries.findIndex((e) => e.id === id);
    if (i < 0) throw new Error('这笔记录已不存在');
    s.money.entries[i] = { id, createdAt: s.money.entries[i].createdAt, ...moneyFields(f) };
    return s;
  }
  function setMoneySettings(state, f) {
    const s = clone(state);
    if (f.opening !== undefined) { const n = Number(f.opening === '' ? 0 : f.opening); if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error('初始资金请填数字'); s.money.opening = cents(n); }
    if (f.openingDate !== undefined) s.money.openingDate = validDate(f.openingDate) ? f.openingDate : null;
    if (f.monthly !== undefined) { const n = f.monthly === '' || f.monthly == null ? null : Number(f.monthly); if (n !== null && !(n > 0 && n <= 1e8)) throw new Error('每月生活费请填大于 0 的数字，或者留空'); s.money.monthly = n === null ? null : cents(n); }
    if (f.symbol !== undefined) s.money.symbol = cleanText(f.symbol, 3) || '¥';
    if (f.share !== undefined) s.money.share = f.share === true;
    return s;
  }
  /* Entries in the order they happened: by day, then by the time given, then by when they were written down. */
  const moneyOrder = (a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || (a.createdAt || 0) - (b.createdAt || 0);
  const signed = (e) => (e.kind === 'in' ? e.amount : e.kind === 'out' ? -e.amount : 0);
  /* Entries dated before the opening date are history: they are listed but do not change the balance. */
  const counts = (money, e) => !money.openingDate || e.date >= money.openingDate;
  function moneySummary(state, today) {
    const m = state.money;
    const month = today.slice(0, 7);
    const live = m.entries.filter((e) => counts(m, e) && e.date <= today);
    const inMonth = m.entries.filter((e) => e.date.slice(0, 7) === month && e.date <= today);
    const total = (list, kind) => cents(sum(list.filter((e) => e.kind === kind), (e) => e.amount));
    const lastDay = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
    const daysLeft = lastDay - Number(today.slice(8)) + 1; // counting today
    const spent = total(inMonth, 'out');
    const left = m.monthly == null ? null : cents(m.monthly - spent);
    return {
      balance: cents(m.opening + sum(live, signed)),
      today: { in: total(live.filter((e) => e.date === today), 'in'), out: total(live.filter((e) => e.date === today), 'out') },
      month: { in: total(inMonth, 'in'), out: spent, net: cents(total(inMonth, 'in') - spent), saved: total(inMonth, 'saved'), savedCount: inMonth.filter((e) => e.kind === 'saved').length },
      budget: m.monthly == null ? null : { monthly: m.monthly, spent, left, daysLeft, perDay: left > 0 ? cents(left / daysLeft) : 0, over: left < 0 ? cents(-left) : 0 },
      piggy: { total: total(m.entries, 'saved'), count: m.entries.filter((e) => e.kind === 'saved').length },
    };
  }
  /* The balance as candles: where it stood when the period opened and closed, and the highest and
     lowest it reached on the way, following the entries in order. `unit` is 'day' or 'week'. */
  function moneyCandles(state, today, unit, count) {
    const m = state.money;
    const span = unit === 'week' ? 7 : 1;
    const lastStart = unit === 'week' ? weekStart(today) : today;
    const firstStart = addDays(lastStart, -(count - 1) * span);
    const live = m.entries.filter((e) => counts(m, e) && e.kind !== 'saved' && e.date <= today).sort(moneyOrder);
    let balance = cents(m.opening + sum(live.filter((e) => e.date < firstStart), signed));
    const out = [];
    for (let i = 0; i < count; i++) {
      const start = addDays(firstStart, i * span);
      const end = addDays(start, span - 1);
      const open = balance;
      let high = open, low = open, flowIn = 0, flowOut = 0;
      for (const e of live) {
        if (e.date < start || e.date > end) continue;
        balance = cents(balance + signed(e));
        if (e.kind === 'in') flowIn = cents(flowIn + e.amount); else flowOut = cents(flowOut + e.amount);
        high = Math.max(high, balance); low = Math.min(low, balance);
      }
      out.push({ start, end: end > today ? today : end, open, close: balance, high, low, in: flowIn, out: flowOut, entries: live.filter((e) => e.date >= start && e.date <= end).length });
    }
    return out;
  }
  /* Where the money came from and went, by category, between two dates. Largest first. */
  function moneyFlow(state, from, to) {
    const group = (kind) => {
      const map = {};
      for (const e of state.money.entries) if (e.kind === kind && e.date >= from && e.date <= to) map[e.category] = cents((map[e.category] || 0) + e.amount);
      const total = cents(sum(Object.values(map), (n) => n));
      return { total, items: Object.entries(map).map(([category, amount]) => ({ category, amount, share: total ? amount / total : 0 })).sort((a, b) => b.amount - a.amount) };
    };
    return { in: group('in'), out: group('out'), saved: group('saved') };
  }
  /* A line such as "花了15买奶茶", "收入 500 兼职" or "忍住没买奶茶 15块", for use without a model. */
  function parseMoney(line, today) {
    const text = String(line).trim();
    const kind = /忍住|没买|没花|省下|省了/.test(text) ? 'saved' : /收入|赚了?|进账|收到|工资|到账/.test(text) ? 'in' : /花了?|支出|买了?|付了?|消费/.test(text) ? 'out' : null;
    if (!kind) return null;
    // "买3本书" is a task, not a purchase of 3: a weak cue needs a money word or a unit beside the number.
    const strong = /花了|支出|消费|收入|赚了|进账|到账|忍住|省了|省下|没买|没花/.test(text);
    if (!strong && !/\d\s*(?:元|块)|[¥$]\s*\d|生活费|工资|奖学金|红包|钱/.test(text)) return null;
    const when = readWhen(text, today);
    const amount = when.rest.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块钱?|rmb|¥|\$)?/i);
    if (!amount || !(Number(amount[1]) > 0)) return null;
    const note = cleanText(when.rest.replace(amount[0], ' ').replace(/忍住了?|没买|没花|省下了?|省了|收入|赚了|进账|收到|到账|花了|花|支出|买了|买|付了|消费|今天|了$/g, ' '), 120);
    const guess = (words) => (Object.entries(words).find(([, re]) => re.test(text)) || ['其他'])[0];
    const category = kind === 'in' ? guess({ 生活费: /生活费/, 兼职: /兼职|工资|家教/, 奖学金: /奖学金|助学金/, 红包: /红包|压岁/, 退款: /退款|退了/ })
      : guess({ 餐饮: /奶茶|咖啡|饭|餐|外卖|零食|水果|食堂|早餐|午餐|晚餐|夜宵|喝|吃/, 交通: /地铁|公交|打车|车费|机票|火车|高铁|加油/, 学习: /书|教材|课|打印|文具|资料/, 购物: /衣|鞋|淘宝|京东|网购|日用/, 娱乐: /电影|游戏|会员|演出|KTV/i, 住宿: /房租|宿舍|水电|住宿/ });
    return { type: 'log_money', kind, amount: cents(amount[1]), category, note, date: when.date && when.date <= today ? when.date : null };
  }

  /* ---------- the longer view: recorded time by day, by week and by space ----------
     Facts only, read from the time records. `heat` is 20 weeks of days ending with this week,
     `weeks` the last 12 weekly totals, and `balance` compares where time went in the last four
     weeks with the four before, one axis per space. */
  function trajectory(state, today) {
    const monday = weekStart(today);
    const perDay = {};
    for (const x of state.sessions) perDay[x.date] = (perDay[x.date] || 0) + x.actual;
    const heatStart = addDays(monday, -19 * 7);
    const heat = Array.from({ length: 140 }, (_, i) => { const date = addDays(heatStart, i); return { date, minutes: date > today ? null : perDay[date] || 0 }; });
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const start = addDays(monday, (i - 11) * 7);
      const days = Array.from({ length: 7 }, (_, d) => perDay[addDays(start, d)] || 0);
      return { monday: start, minutes: sum(days, (n) => n), activeDays: days.filter((n) => n > 0).length };
    });
    const bySpace = (from, to) => {
      const out = {};
      for (const x of state.sessions) if (x.date >= from && x.date <= to) { const key = state.spaces.some((sp) => sp.id === x.spaceId) ? x.spaceId : ''; out[key] = (out[key] || 0) + x.actual; }
      return out;
    };
    const recent = bySpace(addDays(today, -27), today);
    const previous = bySpace(addDays(today, -55), addDays(today, -28));
    const total = (key) => (recent[key] || 0) + (previous[key] || 0);
    let keys = [...state.spaces.map((sp) => sp.id), ''].filter((key) => total(key) > 0).sort((a, b) => total(b) - total(a));
    let other = null;
    if (keys.length > 7) { other = keys.slice(6); keys = keys.slice(0, 6); } // a radar stays readable up to about seven axes
    for (const sp of state.spaces) if (keys.length + (other ? 1 : 0) < 3 && !keys.includes(sp.id) && !(other || []).includes(sp.id)) keys.push(sp.id);
    const name = (key) => (key ? state.spaces.find((sp) => sp.id === key).name : '未分区');
    const axes = keys.map((key) => ({ id: key || null, name: name(key), recent: recent[key] || 0, previous: previous[key] || 0 }));
    if (other) axes.push({ id: 'other', name: '其他 ' + other.length + ' 个分区', recent: sum(other, (key) => recent[key] || 0), previous: sum(other, (key) => previous[key] || 0) });
    // The same comparison by tag, read from each record's task. A record counts toward every tag of its
    // task, so tags overlap and their shares can add up to more than the whole.
    let tags = null;
    if (state.tasks.some((t) => t.tags && t.tags.length)) {
      const taskTags = new Map(state.tasks.map((t) => [t.id, t.tags || []]));
      const tagsOf = (x) => taskTags.get(x.taskId) || [];
      const within = (from, to) => state.sessions.filter((x) => x.date >= from && x.date <= to);
      const rs = within(addDays(today, -27), today), ps = within(addDays(today, -55), addDays(today, -28));
      const count = (list) => {
        const out = {};
        for (const x of list) { const own = tagsOf(x); if (!own.length) out[''] = (out[''] || 0) + x.actual; for (const tag of own) out[tag] = (out[tag] || 0) + x.actual; }
        return out;
      };
      const rc = count(rs), pc = count(ps);
      const both = (k) => (rc[k] || 0) + (pc[k] || 0);
      let named = [...new Set([...Object.keys(rc), ...Object.keys(pc)])].filter((k) => k && both(k) > 0).sort((a, b) => both(b) - both(a) || a.localeCompare(b));
      let rest = [];
      if (named.length > 6) { rest = named.slice(5); named = named.slice(0, 5); }
      const restSet = new Set(rest);
      const once = (list) => sum(list.filter((x) => tagsOf(x).some((tag) => restSet.has(tag))), (x) => x.actual); // each record once, however many of these tags it has
      const tagAxes = named.map((tag) => ({ id: tag, tag, name: '#' + tag, recent: rc[tag] || 0, previous: pc[tag] || 0 }));
      if (rest.length) tagAxes.push({ id: 'other', name: '其他 ' + rest.length + ' 个标签', recent: once(rs), previous: once(ps) });
      if (both('')) tagAxes.push({ id: 'none', name: '没有标签', recent: rc[''] || 0, previous: pc[''] || 0 });
      if (tagAxes.length) tags = { axes: tagAxes, recentTotal: sum(rs, (x) => x.actual), previousTotal: sum(ps, (x) => x.actual), overlap: [...rs, ...ps].some((x) => tagsOf(x).length > 1) };
    }
    return { heat, weeks, tags, balance: axes.length >= 3 ? { axes, recentTotal: sum(axes, (a) => a.recent), previousTotal: sum(axes, (a) => a.previous) } : null,
      recordedDays: Object.keys(perDay).filter((d) => d >= heatStart && d <= today && perDay[d] > 0).length };
  }

  /* ---------- the recap of one period: totals, the busiest weekday and hour, where the time went ----------
     Facts only. `series` is one entry per day, or per week when `bucket` is 'week'. `previous` is the
     recorded time of the equally long period just before, for comparison. */
  function reviewSummary(state, from, to, { bucket = 'day' } = {}) {
    const inRange = (d) => d >= from && d <= to;
    const sessions = state.sessions.filter((x) => inRange(x.date));
    const length = daysBetween(from, to) + 1;
    const days = Array.from({ length }, (_, i) => addDays(from, i));
    const perDay = {}, donePerDay = {};
    for (const x of sessions) perDay[x.date] = (perDay[x.date] || 0) + x.actual;
    const done = state.tasks.filter((t) => t.done && t.doneAt && inRange(todayISO(new Date(t.doneAt))));
    for (const t of done) { const d = todayISO(new Date(t.doneAt)); donePerDay[d] = (donePerDay[d] || 0) + 1; }
    const step = bucket === 'week' ? 7 : 1;
    const series = [];
    for (let i = 0; i < days.length; i += step) {
      const part = days.slice(i, i + step);
      series.push({ from: part[0], to: part[part.length - 1], minutes: sum(part, (d) => perDay[d] || 0), done: sum(part, (d) => donePerDay[d] || 0) });
    }
    const byWeekday = Array(7).fill(0); // Monday first
    for (const d of days) byWeekday[isoWeekday(d) - 1] += perDay[d] || 0;
    const byHour = {};
    for (const x of sessions) if (Number.isInteger(x.hour)) byHour[x.hour] = (byHour[x.hour] || 0) + x.actual;
    const peak = Object.entries(byHour).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const total = sum(sessions, (x) => x.actual);
    const taskOf = new Map(state.tasks.map((t) => [t.id, t]));
    const rank = new Map();
    for (const x of sessions) {
      const task = taskOf.get(x.taskId);
      const key = task ? task.id : 'title:' + (x.title || '');
      const row = rank.get(key) || { taskId: task ? task.id : null, title: task ? task.title : x.title || '没有标题的记录', spaceId: state.spaces.some((sp) => sp.id === x.spaceId) ? x.spaceId : null, minutes: 0, sessions: 0 };
      row.minutes += x.actual; row.sessions++;
      rank.set(key, row);
    }
    const tasks = [...rank.values()].sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title));
    const areas = [...state.spaces.map((sp) => ({ id: sp.id, name: sp.name, color: sp.color })), { id: null, name: '未分区', color: null }]
      .map((a) => { const mine = tasks.filter((t) => t.spaceId === a.id); return { ...a, minutes: sum(mine, (t) => t.minutes), tasks: mine.slice(0, 3).map((t) => t.title) }; })
      .filter((a) => a.minutes > 0).sort((a, b) => b.minutes - a.minutes);
    const best = days.reduce((b, d) => ((perDay[d] || 0) > b.minutes ? { date: d, minutes: perDay[d] } : b), { date: null, minutes: 0 });
    const top = Math.max(...byWeekday);
    return {
      from, to, length, total, sessions: sessions.length, activeDays: days.filter((d) => perDay[d] > 0).length, done: done.length,
      previous: sum(state.sessions.filter((x) => x.date >= addDays(from, -length) && x.date < from), (x) => x.actual),
      series, byWeekday, bestWeekday: top > 0 ? byWeekday.indexOf(top) : null, bestDay: best.date ? best : null,
      peakHour: peak ? { hour: Number(peak[0]), minutes: peak[1] } : null, areas, tasks: tasks.slice(0, 8),
    };
  }

  /* ---------- reading a T计划 v3 export ----------
     v3 kept tasks, time records and notes in other shapes. This maps what has a home in v4 and
     reports what does not, so nothing is dropped silently. */
  const isV3Export = (o) => isObject(o) && o.app === 'tplan' && o.version === undefined && Array.isArray(o.tasks) && (Array.isArray(o.notes) || Array.isArray(o.trees) || o.planningVersion !== undefined);
  function convertV3(o) {
    const s = emptyState();
    const report = { tasks: 0, sessions: 0, reflections: 0, spaces: 0, weekPlans: 0, skippedTrees: Array.isArray(o.trees) ? o.trees.length : 0, skippedSessions: 0, skippedProposals: Array.isArray(o.proposals) ? o.proposals.length : 0 };
    const sections = isObject(o.settings) && Array.isArray(o.settings.taskSections) ? o.settings.taskSections.filter((x) => isObject(x) && typeof x.id === 'string' && typeof x.name === 'string' && x.name.trim()) : [];
    const spaceOf = {};
    for (const sec of sections) {
      let name = cleanText(sec.name, 20);
      for (let n = 2; s.spaces.some((x) => x.name === name); n++) name = cleanText(sec.name, 17) + ' ' + n;
      const sp = { id: uid('space'), name, color: SPACE_COLORS[s.spaces.length % SPACE_COLORS.length], type: 'study' };
      s.spaces.push(sp); spaceOf[sec.id] = sp.id; report.spaces++;
    }
    const taskSpace = {};
    for (const t of o.tasks) {
      if (!isObject(t) || !cleanText(t.title, 150)) continue;
      const task = { id: typeof t.id === 'string' && t.id ? 'v3_' + t.id : uid('t'), title: cleanText(t.title, 150), date: validDate(t.date) ? t.date : null, minutes: cleanMinutes(t.est, 30), spaceId: spaceOf[t.sectionId] || null,
        done: !!t.done, doneAt: t.done ? Number(t.doneAt) || null : null, createdAt: Number(t.createdAt) || Date.now(), origin: 'v3' };
      if (!task.date && validDate(t.week)) task.week = weekStart(t.week);
      if (typeof t.next === 'string' && t.next.trim()) task.next = cleanText(t.next, 300);
      taskSpace[t.id] = task;
      s.tasks.push(task); report.tasks++;
    }
    for (const x of Array.isArray(o.sessions) ? o.sessions : []) {
      const minutes = Math.round(Number(x && x.minutes));
      if (!isObject(x) || !validDate(x.date) || !(minutes >= 1 && minutes <= 1440)) { report.skippedSessions++; continue; }
      const task = taskSpace[x.taskId] || null;
      const startMs = Number(x.start);
      const started = Number.isFinite(startMs) && startMs > 1e11 ? new Date(startMs) : null;
      const title = cleanText(x.title, 150) || (task ? task.title : '未命名记录');
      const note = cardText(x.note, 600);
      // v3 did not keep a planned length per record, so these say nothing about pace: they are kept as reports of time spent.
      s.sessions.push({ id: uid('s'), taskId: task ? task.id : null, title, step: title, spaceId: task ? task.spaceId : null, planned: minutes, actual: minutes, date: x.date,
        hour: started ? started.getHours() : null, ...(started ? { startTime: pad(started.getHours()) + ':' + pad(started.getMinutes()) } : {}), endedAt: Number(x.end) || startMs || Date.now(), partial: false, manual: true, origin: 'v3', ...(note ? { note } : {}) });
      report.sessions++;
    }
    const addReflection = (date, text, at) => { const clean = cardText(text, 4000); if (validDate(date) && clean) { s.reflections.push({ id: uid('r'), date, text: clean, at: Number(at) || Date.now(), source: 'user' }); report.reflections++; } };
    for (const n of Array.isArray(o.notes) ? o.notes : []) if (isObject(n)) addReflection(n.date, n.text, n.at);
    for (const [key, entry] of Object.entries(isObject(o.reviewEntries) ? o.reviewEntries : {})) {
      const date = (String(key).match(/\d{4}-\d{2}-\d{2}/) || [])[0];
      if (isObject(entry)) addReflection(date, [entry.reflection, entry.next ? '下次从哪里继续：' + entry.next : ''].filter((x) => typeof x === 'string' && x.trim()).join('\n\n'), entry.updatedAt);
    }
    s.reflections.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
    for (const [week, plan] of Object.entries(isObject(o.weekPlans) ? o.weekPlans : {})) {
      if (!validDate(week) || !isObject(plan)) continue;
      const focus = cardText(Array.isArray(plan.focus) ? plan.focus.join('\n') : plan.focus, 400);
      const capacity = Number.isInteger(plan.capacityMin) && plan.capacityMin >= 0 && plan.capacityMin <= 10080 ? plan.capacityMin : null;
      if (focus || capacity !== null) { s.weekPlans[weekStart(week)] = { focus, capacity }; report.weekPlans++; }
    }
    const cap = Math.round(Number(isObject(o.settings) && o.settings.cap));
    if (cap >= 1 && cap <= 960) s.settings.prefs.dailyMinutes = cap;
    s.settings.prefs.onboarded = true;
    return { state: normalize(s), report };
  }

  /* ---------- key dates: exams and deadlines, counted down ---------- */
  const dayNumber = (date) => Math.round(new Date(date + 'T12:00:00').getTime() / 86400000);
  const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
  /* Exams, deadlines and goal deadlines from today on, nearest first. `spaceId` undefined means everything. */
  function upcomingDates(state, today, spaceId) {
    const mine = (x) => spaceId === undefined || (x.spaceId || null) === spaceId;
    return [
      ...state.dates.filter((d) => d.date >= today && mine(d)).map((d) => ({ id: d.id, kind: 'date', title: d.title, date: d.date, time: d.time || null, place: d.place || '', spaceId: d.spaceId || null })),
      ...state.goals.filter((g) => g.deadline && g.deadline >= today && mine(g)).map((g) => ({ id: g.id, kind: 'goal', title: g.title, date: g.deadline, time: null, place: '', spaceId: g.spaceId || null })),
    ].map((x) => ({ ...x, daysLeft: daysBetween(today, x.date) })).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  }

  /* ---------- review cards ----------
     One question, one answer. A remembered card comes back after 1, 2, 4, 7, 15, then 30 days; a
     forgotten one starts over tomorrow. Every answer is kept as a dated observation, so "has this
     been learned" rests on what the user actually recalled, not on time spent. */
  const CARD_INTERVALS = [1, 2, 4, 7, 15, 30];
  const MAX_CARDS_PER_ACTION = 30;
  const MAX_REVIEWS_KEPT = 40;
  const cardText = (value, max) => (typeof value === 'string' ? value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
  function newCard(fields, spaceId, now, origin) {
    return { id: uid('c'), front: cardText(fields.front, 300), back: cardText(fields.back, 800), spaceId: spaceId || null, createdAt: now, origin, stage: 0, due: todayISO(new Date(now)), reviews: [] };
  }
  function dueCards(state, today, spaceId) {
    return state.cards.filter((c) => c.due <= today && (spaceId === undefined || spaceId === null || c.spaceId === spaceId)).sort((a, b) => a.due.localeCompare(b.due) || a.createdAt - b.createdAt);
  }
  /* Records one answer and schedules the next showing. Returns a new state. */
  function reviewCard(state, cardId, remembered, now) {
    const s = clone(state);
    const card = s.cards.find((c) => c.id === cardId);
    if (!card) throw new Error('这张卡片已不存在');
    const today = todayISO(new Date(now));
    card.reviews.push({ at: now, date: today, ok: !!remembered, stage: card.stage });
    if (card.reviews.length > MAX_REVIEWS_KEPT) card.reviews = card.reviews.slice(-MAX_REVIEWS_KEPT);
    if (remembered) {
      card.due = addDays(today, CARD_INTERVALS[Math.min(card.stage, CARD_INTERVALS.length - 1)]);
      card.stage = Math.min(card.stage + 1, CARD_INTERVALS.length);
    } else {
      card.stage = 0;
      card.due = addDays(today, 1);
    }
    return s;
  }
  /* Facts about the cards, for the list header and the assistant. Recall is counted over the last 14 days. */
  function cardStats(state, today, spaceId) {
    const cards = state.cards.filter((c) => spaceId === undefined || spaceId === null || c.spaceId === spaceId);
    const since = addDays(today, -13);
    const recent = cards.flatMap((c) => c.reviews).filter((r) => r.date >= since);
    return {
      total: cards.length, dueToday: cards.filter((c) => c.due <= today).length, neverReviewed: cards.filter((c) => !c.reviews.length).length,
      steady: cards.filter((c) => c.stage >= 4).length, // remembered four times running: now a week or more apart
      recentAnswers: recent.length, recentRemembered: recent.filter((r) => r.ok).length,
    };
  }

  /* One number per day for a named measurement (weight, sleep hours...). A second value on the same day replaces the first. */
  function logMetric(s, a, now) {
    let metric = s.metrics.find((m) => m.name === a.name && (m.spaceId || null) === (a.spaceId || null)) || s.metrics.find((m) => m.name === a.name);
    if (!metric) {
      metric = { id: uid('k'), name: a.name, unit: a.unit || '', spaceId: a.spaceId || null, entries: [] };
      s.metrics.push(metric);
    }
    if (a.unit && !metric.unit) metric.unit = a.unit;
    const date = a.date || todayISO(new Date(now));
    metric.entries = metric.entries.filter((e) => e.date !== date).concat({ date, value: a.value }).sort((x, y) => x.date.localeCompare(y.date));
    return metric;
  }

  function addMemory(s, text, now, source) {
    const clean = cleanText(text, 300);
    if (!clean || s.memory.some((m) => m.text === clean)) return false;
    s.memory.push({ id: uid('m'), text: clean, at: now, source });
    if (s.memory.length > 80) s.memory = s.memory.slice(-80);
    return true;
  }

  /* Applies a pending proposal attached to a message. Returns a new state; the input is untouched.
     Actions are re-validated against current data, so a proposal that went stale fails as a whole. */
  function resolveProposal(state, messageId, accept, now = Date.now()) {
    const s = clone(state);
    const message = s.messages.find((m) => m.id === messageId);
    if (!message || !message.proposal) throw new Error('找不到这份提议');
    const p = message.proposal;
    if (p.status !== 'pending') return s;
    if (!accept) { p.status = 'dismissed'; p.resolvedAt = now; return s; }
    const checked = validateActions(s, p.actions);
    if (checked.rejected.length) throw new Error('提议里的任务已经变化：' + checked.rejected[0] + '。请让助手重新提议。');
    const created = [];
    for (const action of checked.actions) applyAction(s, action, now, p.source, created);
    p.status = 'accepted';
    p.resolvedAt = now;
    p.created = created;
    return s;
  }

  /* Lets the user adjust the steps of a proposed task before confirming it. Returns a new state. */
  function editProposal(state, messageId, actionIndex, op) {
    const s = clone(state);
    const message = s.messages.find((m) => m.id === messageId);
    if (!message || !message.proposal || message.proposal.status !== 'pending') throw new Error('这份提议已经处理过了');
    const a = message.proposal.actions[actionIndex];
    if (a && a.type === 'add_reflection' && op.kind === 'text') {
      const text = String(op.text || '').trim().slice(0, 4000);
      if (!text) throw new Error('反思内容不能为空');
      a.text = text;
      message.proposal.edited = true;
      return s;
    }
    if (!a || a.type !== 'add_task') throw new Error('这一项不能修改');
    if (!a.steps) a.steps = [{ title: a.title, minutes: Math.min(180, a.minutes) }];
    editSteps(a.steps, op, s.settings.prefs.segment);
    a.minutes = sum(a.steps, (x) => x.minutes);
    message.proposal.edited = true;
    return s;
  }
  /* The step operations shared by a pending proposal and a task that is already on the list. */
  function editSteps(steps, op, segment) {
    const step = steps[op.step];
    if (op.kind !== 'add' && !step) throw new Error('这一步已经不存在');
    if (op.kind === 'minutes') step.minutes = Math.min(180, Math.max(5, step.minutes + op.delta));
    else if (op.kind === 'title') {
      const title = cleanText(op.title, 100);
      if (!title) throw new Error('步骤内容不能为空');
      step.title = title;
    } else if (op.kind === 'remove') {
      if (steps.length <= 1) throw new Error('至少保留一步');
      steps.splice(op.step, 1);
    } else if (op.kind === 'move') {
      const to = op.step + op.dir;
      if (to >= 0 && to < steps.length) steps.splice(to, 0, steps.splice(op.step, 1)[0]);
    } else if (op.kind === 'add') {
      if (steps.length >= MAX_STEPS) throw new Error('最多 ' + MAX_STEPS + ' 步');
      steps.push({ title: cleanText(op.title, 100) || '新的一步', minutes: segment || 25 });
    } else throw new Error('不支持的修改');
  }
  /* Adjusts the steps of a task after it was confirmed. Finished steps keep their place and length,
     and the step being timed cannot be removed or moved, so recorded sessions stay true. */
  function editTaskSteps(state, taskId, op) {
    const s = clone(state);
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('任务已不存在');
    if (task.done) throw new Error('任务已完成，不能再改分段');
    if (!task.steps) task.steps = [{ title: task.title, minutes: Math.min(180, task.minutes), done: false }];
    const target = task.steps[op.step];
    const structural = op.kind === 'remove' || op.kind === 'move';
    if (target && target.done && op.kind !== 'title') throw new Error('已完成的分段不能再改');
    if (op.kind === 'move' && task.steps[op.step + op.dir] && task.steps[op.step + op.dir].done) throw new Error('不能移到已完成的分段前面');
    if (structural && s.timer && s.timer.taskId === taskId) throw new Error('计时进行中，先结束计时再调整顺序或删除');
    editSteps(task.steps, op, s.settings.prefs.segment);
    for (const x of task.steps) x.done = !!x.done;
    task.minutes = sum(task.steps, (x) => x.minutes);
    return s;
  }

  /* Ticks a task done or not done. If its timer is running, the time worked so far is recorded
     first, so finishing by the checkbox leaves the same evidence as finishing by the timer. */
  function toggleTask(state, taskId, now) {
    const s = clone(state);
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('任务已不存在');
    let session = null;
    const timed = !!(s.timer && s.timer.taskId === taskId);
    task.done = !task.done;
    task.doneAt = task.done ? now : null;
    if (task.done && timed) {
      if (timerElapsed(s.timer, now) >= 60000) session = recordSession(s, now, false);
      s.timer = null;
    }
    return { state: s, session, wasTiming: task.done && timed };
  }

  /* ---------- habits ---------- */
  function habitWeekCount(habit, anyDateInWeek) {
    const start = weekStart(anyDateInWeek);
    let count = 0;
    for (let i = 0; i < 7; i++) if (habit.log[addDays(start, i)]) count++;
    return count;
  }

  /* ---------- segmented timer ----------
     The timer walks through a task's steps one at a time. Time is derived from timestamps, so a
     reload or a sleeping tab never loses or invents minutes. Every finished step becomes a session:
     the factual record that the profile below is computed from. */
  function timerElapsed(timer, now) {
    return timer.acc + (timer.phase === 'running' ? Math.max(0, now - timer.lastAt) : 0);
  }
  function timerView(state, now) {
    const timer = state.timer;
    if (!timer) return null;
    const task = state.tasks.find((t) => t.id === timer.taskId);
    const step = task.steps[timer.step];
    const elapsedMs = timerElapsed(timer, now);
    const remainingMs = step.minutes * 60000 - elapsedMs;
    return { task, step, index: timer.step, total: task.steps.length, elapsedMs, remainingMs, due: remainingMs <= 0, running: timer.phase === 'running' };
  }
  function startTimer(state, taskId, now) {
    if (state.timer) throw new Error('已经有一个计时在进行，请先结束它');
    const s = clone(state);
    const task = s.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error('任务已不存在');
    if (task.done) throw new Error('这个任务已经完成了');
    if (!task.date) task.date = todayISO(new Date(now)); // work started today belongs on today's list
    if (!task.steps) task.steps = [{ title: task.title, minutes: Math.min(180, task.minutes), done: false }];
    let index = task.steps.findIndex((x) => !x.done);
    if (index < 0) { task.steps.forEach((x) => { x.done = false; }); index = 0; }
    s.timer = { taskId, step: index, phase: 'running', acc: 0, lastAt: now, startedAt: now };
    return s;
  }
  function pauseTimer(state, now) {
    const s = clone(state);
    if (s.timer && s.timer.phase === 'running') { s.timer.acc = timerElapsed(s.timer, now); s.timer.phase = 'paused'; }
    return s;
  }
  function resumeTimer(state, now) {
    const s = clone(state);
    if (s.timer && s.timer.phase === 'paused') { s.timer.lastAt = now; s.timer.phase = 'running'; }
    return s;
  }
  function extendTimer(state, minutes = 5) {
    const s = clone(state);
    if (!s.timer) return s;
    const task = s.tasks.find((t) => t.id === s.timer.taskId);
    const step = task.steps[s.timer.step];
    if (!task.estimate) task.estimate = task.minutes; // what was planned before any time was added, kept for comparing with what it really took
    step.minutes = Math.min(180, step.minutes + minutes);
    task.minutes = sum(task.steps, (x) => x.minutes);
    return s;
  }
  function recordSession(s, now, partial) {
    const view = timerView(s, now);
    const actual = Math.max(1, Math.round(view.elapsedMs / 60000));
    const session = {
      id: uid('s'), taskId: view.task.id, title: view.task.title, step: view.step.title, spaceId: view.task.spaceId,
      planned: view.step.minutes, actual, date: todayISO(new Date(now)), hour: new Date(now - view.elapsedMs).getHours(), endedAt: now, partial: !!partial,
    };
    s.sessions.push(session);
    return session;
  }
  /* Ends the current step and moves to the next one. The last step completes the task. */
  function finishStep(state, now) {
    if (!state.timer) throw new Error('没有正在进行的计时');
    const s = clone(state);
    // Under a minute means the step was skipped, not worked on: it is no evidence about the user's pace.
    const session = timerElapsed(s.timer, now) >= 60000 ? recordSession(s, now, false) : null;
    const task = s.tasks.find((t) => t.id === s.timer.taskId);
    task.steps[s.timer.step].done = true;
    const next = task.steps.findIndex((x) => !x.done);
    if (next >= 0) {
      s.timer = { ...s.timer, step: next, phase: 'running', acc: 0, lastAt: now };
      return { state: s, session, finishedTask: null };
    }
    task.done = true;
    task.doneAt = now;
    s.timer = null;
    return { state: s, session, finishedTask: task.id };
  }
  /* Stops without finishing the step. A minute or more of work is still recorded, marked partial. */
  function stopTimer(state, now) {
    const s = clone(state);
    if (!s.timer) return s;
    if (timerElapsed(s.timer, now) >= 60000) recordSession(s, now, true);
    s.timer = null;
    return s;
  }

  /* ---------- learner profile ----------
     Computed from recorded facts only (sessions, task dates, one-click feedback). A figure is left
     out until there is enough evidence for it, so the assistant never plans from one data point. */
  const DAY_BLOCKS = [['早上', 6, 12], ['下午', 12, 18], ['晚上', 18, 23]];
  const blockOf = (hour) => (DAY_BLOCKS.find(([, from, to]) => hour >= from && hour < to) || ['深夜'])[0];
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  function buildProfile(state, today) {
    const sessions = state.sessions;
    const full = sessions.filter((x) => !x.partial && !x.manual && !x.edited); // only untouched timer sessions compare actual with planned
    const profile = { sessionsRecorded: sessions.length };
    const ratio = (list) => Math.round((sum(list, (x) => x.actual) / sum(list, (x) => x.planned)) * 100) / 100;
    if (full.length >= 3) {
      profile.actualVsPlanned = ratio(full);
      const bySpace = {};
      for (const sp of state.spaces) {
        const list = full.filter((x) => x.spaceId === sp.id);
        if (list.length >= 3) bySpace[sp.name] = ratio(list);
      }
      if (Object.keys(bySpace).length) profile.actualVsPlannedBySpace = bySpace;
      profile.typicalFocusMinutes = median(full.map((x) => x.actual));
    }
    if (sessions.length >= 5) {
      const blocks = {};
      for (const x of sessions) if (Number.isInteger(x.hour)) blocks[blockOf(x.hour)] = (blocks[blockOf(x.hour)] || 0) + x.actual;
      if (Object.keys(blocks).length) profile.focusMinutesByTimeOfDay = blocks; // manual records without a start time have no hour
    }
    const days = new Set(sessions.map((x) => x.date));
    if (days.size >= 3) profile.focusMinutesPerActiveDay = Math.round(sum(sessions, (x) => x.actual) / days.size);
    const from = addDays(today, -14);
    const dated = state.tasks.filter((t) => t.date && t.date >= from && t.date < today);
    if (dated.length >= 5) profile.last14Days = { planned: dated.length, done: dated.filter((t) => t.done).length };
    const feels = { easy: 0, ok: 0, hard: 0 };
    for (const t of state.tasks) if (feels[t.feel] !== undefined) feels[t.feel]++;
    if (feels.easy + feels.ok + feels.hard) profile.difficultyFeedback = feels;
    profile.overdueOpenTasks = state.tasks.filter((t) => !t.done && t.date && t.date < today).length;
    return profile;
  }

  /* ---------- assistant context ---------- */
  /* Everything the model is allowed to see. Facts only; the model is told not to invent the rest. */
  /* `thread` limits the conversation history to one space's chat (null is the general chat). */
  function buildContext(state, today, text, thread) {
    const spaceName = (id) => (state.spaces.find((x) => x.id === id) || {}).name || null;
    const toDay = (ms) => todayISO(new Date(ms));
    const recentCutoff = addDays(today, -14);
    return {
      today,
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(today + 'T12:00:00').getDay()],
      preferences: (({ railCompact, railFolded, listWidth, timerCompact, homeHidden, homeOrder, ...rest }) => rest)(state.settings.prefs), // layout choices mean nothing to the model
      scheduledCourses: Timetable.events(state.schedule, today, addDays(today, 13)).map(e => ({ title: e.title, date: e.date, startTime: e.startTime, endTime: e.endTime, room: e.room })),
      profile: buildProfile(state, today),
      memory: state.memory.map((m) => m.text),
      spaces: state.spaces.map((x) => x.name),
      metrics: state.metrics.filter((m) => m.entries.length).map((m) => ({
        name: m.name, unit: m.unit, space: spaceName(m.spaceId), count: m.entries.length,
        first: m.entries[0], latest: m.entries[m.entries.length - 1],
      })),
      goals: state.goals.map((g) => {
        const tasks = state.tasks.filter((t) => t.goalId === g.id);
        return { title: g.title, deadline: g.deadline, milestones: g.milestones.map((m) => m.title), tasksDone: tasks.filter((t) => t.done).length, tasksTotal: tasks.length };
      }),
      openTasks: state.tasks.filter((t) => !t.done).slice(0, 200).map((t) => ({
        taskId: t.id, title: t.title, date: t.date, ...(t.time ? { time: t.time } : {}), ...(t.week ? { undatedInWeekOf: t.week } : {}), ...(t.next ? { continueFrom: t.next } : {}), minutes: t.minutes, space: spaceName(t.spaceId), ...(t.tags ? { tags: t.tags } : {}), ...(t.repeatId ? { fromRepeat: true } : {}), ...(t.note ? { note: t.note.slice(0, 200) } : {}),
        ...(t.steps ? { stepsDone: t.steps.filter((x) => x.done).length, stepsTotal: t.steps.length } : {}),
      })),
      recentlyDone: state.tasks.filter((t) => t.done && t.doneAt && toDay(t.doneAt) >= recentCutoff).slice(-60).map((t) => ({
        title: t.title, doneOn: toDay(t.doneAt), minutes: t.minutes, space: spaceName(t.spaceId), feel: t.feel || null,
      })),
      repeatingTasks: state.repeats.map((r) => ({ title: r.title, repeat: repeatLabel(r.rule), ...(r.time ? { time: r.time } : {}), minutes: r.minutes, space: spaceName(r.spaceId), ...(r.tags.length ? { tags: r.tags } : {}) })),
      tagsInUse: [...new Set(state.tasks.flatMap((t) => t.tags || []))].slice(0, 40),
      habits: state.habits.map((h) => ({ title: h.title, targetPerWeek: h.perWeek, doneThisWeek: habitWeekCount(h, today), doneToday: !!h.log[today] })),
      recentReflections: state.reflections.slice(-5).map((r) => ({ date: r.date, text: r.text.slice(0, 600) })),
      keyDates: upcomingDates(state, today).slice(0, 12).map((d) => ({ title: d.title, date: d.date, ...(d.time ? { time: d.time } : {}), daysLeft: d.daysLeft, kind: d.kind === 'goal' ? 'goalDeadline' : 'examOrDeadline', space: spaceName(d.spaceId) })),
      ...(state.cards.length ? { reviewCards: { ...cardStats(state, today), bySpace: state.spaces.map((x) => ({ space: x.name, ...cardStats(state, today, x.id) })).filter((x) => x.total).map((x) => ({ space: x.space, total: x.total, dueToday: x.dueToday })) } } : {}),
      ...(state.money.share ? { money: (() => { const m = moneySummary(state, today); return { currency: state.money.symbol, balance: m.balance, thisMonthIn: m.month.in, thisMonthOut: m.month.out, monthlyAllowance: state.money.monthly, allowanceLeft: m.budget ? m.budget.left : null, notSpentAfterAllThisMonth: m.month.saved }; })() } : {}),
      thisWeek: (() => { const w = weekSummary(state, weekStart(today)); return { focus: w.focus || null, capacityMinutes: w.capacity, plannedMinutes: w.planned, undatedMinutes: w.unscheduled, recordedMinutes: w.recorded }; })(),
      timerRunning: !!state.timer,
      history: state.messages.filter((m) => thread === undefined || (m.spaceId || null) === thread).slice(-12).map((m) => ({ role: m.role, text: m.text.slice(0, 1500) })),
      message: text,
    };
  }

  /* Detailed records for the get_history tool. */
  function history(state, today, days) {
    const from = addDays(today, -Math.min(90, Math.max(1, Math.round(Number(days)) || 14)));
    return {
      from, to: today,
      sessions: state.sessions.filter((x) => x.date >= from).slice(-200).map((x) => ({ date: x.date, startHour: x.hour, task: x.title, step: x.step, planned: x.planned, actual: x.actual, partial: x.partial, ...(x.manual ? { enteredByHand: true } : {}), ...(x.note ? { did: x.note } : {}), ...(x.stuck ? { stuck: x.stuck } : {}) })),
      tasks: state.tasks.filter((t) => t.date && t.date >= from && t.date <= today).slice(-200).map((t) => ({ title: t.title, date: t.date, minutes: t.minutes, done: t.done, feel: t.feel || null })),
    };
  }

  /* ---------- offline fallback ---------- */
  const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  /* Reads a date, a start time and a length out of a line the way people write them
     ("明天下午3点半 40分钟", "下周一", "11/20 19:00", "三天后", "今晚八点"). Only what is written is
     returned; nothing is guessed. `rest` is the line with those parts taken out. */
  const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function cnNumber(text) {
    if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
    if (text === '半') return 0.5;
    const m = text.match(/^([一二两三四五六七八九])?(十)?([一二两三四五六七八九])?$/);
    if (!m || !text) return NaN;
    return m[2] ? (m[1] ? CN_DIGITS[m[1]] : 1) * 10 + (m[3] ? CN_DIGITS[m[3]] : 0) : m[1] && !m[3] ? CN_DIGITS[m[1]] : NaN;
  }
  const NUM = '(\\d+(?:\\.\\d+)?|[一二两三四五六七八九十]{1,3})';
  function readWhen(line, today) {
    let rest = String(line);
    let date = null;
    let time = null;
    let minutes = null;
    let evening = false; // 今晚 / 明晚 say "evening" without a clock time
    let morning = false;
    const take = (re, fn) => {
      const m = rest.match(re);
      if (!m || fn(m) === false) return false;
      rest = rest.replace(m[0], ' ');
      return true;
    };
    const year = Number(today.slice(0, 4));
    const monthDay = (month, day) => {
      let d = year + '-' + pad(+month) + '-' + pad(+day);
      if (!validDate(d)) return false;
      if (d < today) d = year + 1 + d.slice(4);
      if (!validDate(d)) return false;
      date = d;
    };
    take(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/, (m) => { const d = m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]); if (!validDate(d)) return false; date = d; });
    if (!date) take(/(\d{1,2})月(\d{1,2})[日号]?/, (m) => monthDay(m[1], m[2]));
    if (!date) take(/(?<![\d.:：])(\d{1,2})\/(\d{1,2})(?![\d/])/, (m) => monthDay(m[1], m[2]));
    if (!date) take(/(下下|下个?|本|这个?)?(?:周|星期|礼拜)([一二三四五六日天末])/, (m) => {
      const index = m[2] === '末' ? 5 : (WEEKDAYS[m[2]] + 6) % 7;
      const weeks = /下下/.test(m[1] || '') ? 2 : /下/.test(m[1] || '') ? 1 : 0;
      let d = addDays(weekStart(today), index + weeks * 7);
      if (!m[1] && d < today) d = addDays(d, 7);
      date = d;
    });
    if (!date) take(/大后天|后天|明天|明早|明晚|今天|今早|今晚|昨天|昨晚|前天/, (m) => {
      date = addDays(today, { 大后天: 3, 后天: 2, 明天: 1, 明早: 1, 明晚: 1, 今天: 0, 今早: 0, 今晚: 0, 昨天: -1, 昨晚: -1, 前天: -2 }[m[0]]);
      evening = /晚/.test(m[0]); morning = /早/.test(m[0]);
    });
    if (!date) take(new RegExp(NUM + '\\s*(天|周|个?星期|个?礼拜|个月)\\s*(?:之)?后'), (m) => {
      const n = cnNumber(m[1]);
      if (!Number.isInteger(n) || n < 1 || n > 366) return false;
      if (m[2] === '个月') { const d = new Date(today + 'T12:00:00'); d.setMonth(d.getMonth() + n); date = iso(d); } else date = addDays(today, m[2] === '天' ? n : n * 7);
    });
    if (!date) take(/下个?(?:周|星期|礼拜)/, () => { date = addDays(weekStart(today), 7); });
    // A clock time needs 点 or a colon, so "2小时" and "30分钟" below are never read as one.
    take(new RegExp('(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\\s*(?:(\\d{1,2})[:：]([0-5]\\d)|' + NUM + '\\s*点(半|一刻|三刻|[0-5]?\\d分?)?)'), (m) => {
      const period = m[1] || (evening ? '晚上' : morning ? '早上' : '');
      let hour = m[2] !== undefined ? +m[2] : cnNumber(m[4]);
      if (!Number.isInteger(hour) || hour > 24) return false;
      const minute = m[3] !== undefined ? +m[3] : m[5] === '半' ? 30 : m[5] === '一刻' ? 15 : m[5] === '三刻' ? 45 : m[5] ? parseInt(m[5], 10) : 0;
      if (/下午|傍晚|晚上|夜里/.test(period) && hour < 12) hour += 12;
      else if (period === '中午' && hour < 11) hour += 12;
      else if (!period && m[2] === undefined && hour >= 1 && hour <= 6) hour += 12; // a bare "3点" in a plan means the afternoon; "3:00" is taken as written
      const midnight = /晚上|夜里/.test(period) && hour === 12; // "晚上12点" is the start of the next day
      const value = pad(midnight ? 0 : hour % 24) + ':' + pad(minute);
      if (!validTime(value)) return false;
      time = value;
      if (midnight) date = addDays(date || today, 1);
    });
    const fit = (n) => (Number.isFinite(n) && Math.round(n) >= 1 && Math.round(n) <= 1440 ? Math.round(n) : null);
    take(new RegExp(NUM + '\\s*个半\\s*(?:小时|钟头)'), (m) => { minutes = fit((cnNumber(m[1]) + 0.5) * 60); return minutes !== null; })
      || take(new RegExp(NUM + '\\s*(?:个)?\\s*(?:小时|钟头|h\\b|hr\\b|hrs\\b)\\s*(?:' + NUM + '\\s*(?:分钟|分|min\\b|m\\b))?', 'i'), (m) => { minutes = fit(cnNumber(m[1]) * 60 + (m[2] ? cnNumber(m[2]) : 0)); return minutes !== null; })
      || take(/半\s*(?:个)?\s*(?:小时|钟头)/, () => { minutes = 30; })
      || take(new RegExp(NUM + '\\s*(?:分钟|min\\b|mins\\b|m\\b)', 'i'), (m) => { minutes = fit(cnNumber(m[1])); return minutes !== null; });
    return { date, time, minutes, rest };
  }
  /* For a date-and-time box: the date and time written in `text`, or nulls. A time without a date means today. */
  function parseWhen(text, today) {
    const r = readWhen(text, today);
    return { date: r.date || (r.time ? today : null), time: r.time, minutes: r.minutes, understood: !!(r.date || r.time || r.minutes) };
  }
  function parseLine(line, today) {
    const tagged = takeTags(line);
    const r = readWhen(tagged.rest, today);
    const title = cleanText(r.rest.replace(/^[\s\-•·\d.、)]+/, '').replace(/[，,。；;]+$/, ''), 150);
    if (!title) return null;
    const minutes = r.minutes || 30;
    const task = r.time ? { type: 'add_task', title, date: r.date || today, time: r.time, minutes, space: null } : { type: 'add_task', title, date: r.date, minutes, space: null };
    if (tagged.tags.length) task.tags = tagged.tags;
    return task;
  }
  /* One typed line in the quick-add box: "明天下午3点 复习单片机 40分钟 @学习 #考试".
     "@名字" picks a space by name; "#词" adds a tag; the rest is read like a chat line.
     A line that starts with a repeat phrase ("每周四 交实验报告") becomes a repeat rule instead. */
  function parseTaskLine(state, line, today, fallbackSpaceId = null) {
    let spaceId = fallbackSpaceId, spaceName = '', unknownSpace = '';
    const text = String(line || '').replace(/[@＠]\s*([^\s@＠#＃]{1,20})/, (_, name) => {
      const sp = state.spaces.find((x) => x.name === name) || state.spaces.find((x) => x.name.startsWith(name)) || state.spaces.find((x) => name.startsWith(x.name));
      if (sp) { spaceId = sp.id; spaceName = sp.name; } else unknownSpace = name;
      return ' ';
    });
    if (!state.spaces.some((x) => x.id === spaceId)) spaceId = null;
    const minutesGiven = new RegExp(NUM + '\\s*(?:分钟|min|小时|钟头|h\\b|个小时)', 'i').test(text) || /半\s*(?:个)?\s*小时/.test(text);
    const repeat = takeRepeat(text, today);
    if (repeat && repeat.error) return { error: repeat.error };
    if (repeat) {
      const tagged = takeTags(repeat.rest);
      const r = readWhen(tagged.rest, today);
      const title = cleanText(r.rest.replace(/^[\s\-•·\d.、)]+/, '').replace(/[，,。；;]+$/, ''), 150);
      if (!title) return { error: '没有读到要做的事，例如「每周四 交实验报告」' };
      const rule = repeat.ruleRaw;
      if (r.date && !repeat.startGiven) rule.start = r.date; // a date written beside the rule is where it starts
      const clean = cleanRule(rule, today);
      if (!clean) return { error: '重复规则不完整，例如「每周四」「每天」「每隔一天」' };
      return { repeat: { title, minutes: r.minutes || 30, spaceId, tags: tagged.tags, rule: clean, ...(r.time ? { time: r.time } : {}) }, minutesGiven, spaceName, unknownSpace };
    }
    const parsed = parseLine(text, today);
    if (!parsed) return { error: '没有读到要做的事，例如「明天 复习单片机 40分钟」' };
    const task = { title: parsed.title, date: parsed.date, minutes: parsed.minutes, spaceId, tags: parsed.tags || [] };
    if (parsed.time) task.time = parsed.time;
    return { task, minutesGiven, spaceName, unknownSpace };
  }

  /* ---------- repeating tasks ----------
     A rule ("每周四", "每天", "每隔一天", "每月1号") makes ordinary tasks for the coming week, one per
     occurrence, so the timer, the lists and the week page treat them like any other task. Each
     instance carries `repeatId` and the `repeatDate` it was made for. A rule only ever makes dates
     after the last one it made, so a deleted instance does not come back. An instance that was never
     started gives way when the next occurrence arrives, so a missed daily task does not pile up. */
  const REPEAT_KINDS = ['daily', 'weekly', 'interval', 'monthly'];
  const REPEAT_AHEAD = 6; // today and the six days after it
  const CN_WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const isoWeekday = (date) => ((new Date(date + 'T12:00:00').getDay() + 6) % 7) + 1;
  const monthLength = (date) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();
  function cleanRule(raw, today) {
    if (!isObject(raw) || !REPEAT_KINDS.includes(raw.kind)) return null;
    const rule = { kind: raw.kind, start: validDate(raw.start) ? raw.start : today };
    if (raw.kind === 'weekly') {
      const days = [...new Set((Array.isArray(raw.days) ? raw.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b);
      if (!days.length) return null;
      rule.days = days;
      rule.every = Number(raw.every) === 2 ? 2 : 1;
    } else if (raw.kind === 'interval') {
      const every = Math.round(Number(raw.every));
      if (!(every >= 2 && every <= 365)) return null;
      rule.every = every;
    } else if (raw.kind === 'monthly') {
      const day = Math.round(Number(raw.day));
      if (!(day >= 1 && day <= 31)) return null;
      rule.day = day;
    }
    if (validDate(raw.until) && raw.until >= rule.start) rule.until = raw.until;
    return rule;
  }
  function occursOn(rule, date) {
    if (date < rule.start || (rule.until && date > rule.until)) return false;
    if (rule.kind === 'daily') return true;
    if (rule.kind === 'interval') return daysBetween(rule.start, date) % rule.every === 0;
    if (rule.kind === 'monthly') return Number(date.slice(8)) === Math.min(rule.day, monthLength(date));
    if (!rule.days.includes(isoWeekday(date))) return false;
    return rule.every === 1 || (Math.round(daysBetween(weekStart(rule.start), weekStart(date)) / 7) % 2 === 0);
  }
  function nextOccurrences(rule, from, count = 3) {
    const out = [];
    let d = from < rule.start ? rule.start : from;
    for (let i = 0; i < 800 && out.length < count; i++, d = addDays(d, 1)) {
      if (rule.until && d > rule.until) break;
      if (occursOn(rule, d)) out.push(d);
    }
    return out;
  }
  function repeatLabel(rule) {
    if (!rule) return '';
    const names = '一二三四五六日';
    const days = rule.days ? rule.days.join() : '';
    const text = rule.kind === 'daily' ? '每天'
      : rule.kind === 'interval' ? '每 ' + rule.every + ' 天一次'
        : rule.kind === 'monthly' ? '每月 ' + rule.day + ' 号' + (rule.day > 28 ? '（没有这一天的月份取最后一天）' : '')
          : rule.every === 1 && days === '1,2,3,4,5' ? '工作日'
            : rule.every === 1 && days === '6,7' ? '每个周末'
              : rule.every === 1 && rule.days.length === 7 ? '每天'
                : (rule.every === 2 ? '每两周的' : '每') + '周' + rule.days.map((d) => names[d - 1]).join('、');
    return text + (rule.until ? '，到 ' + Number(rule.until.slice(5, 7)) + '月' + Number(rule.until.slice(8)) + '日' : '');
  }
  /* Reads a repeat phrase out of a line: null when there is none, { error } when there is one that
     cannot be used, otherwise the rule and what is left. "每隔N天" is read literally, N days in between,
     so "每隔一天" is every second day; the quick-add card shows the next dates so this can be checked. */
  function takeRepeat(text, today) {
    let rest = String(text || '');
    const cut = (re, fn, keep = ' ') => {
      const m = rest.match(re);
      if (!m || fn(m) === false) return false;
      rest = rest.replace(m[0], typeof keep === 'function' ? keep(m) : keep);
      return true;
    };
    let start = null, until = null, rule = null;
    cut(/从\s*([^\s，,。]{1,12}?)\s*(?:开始|起)/, (m) => { const w = readWhen(m[1], today); if (!w.date) return false; start = w.date; });
    cut(/(?:一直)?(?:直到|到|截止到?)\s*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}[日号]?|\d{1,2}月\d{1,2}[日号]?|\d{1,2}\/\d{1,2})\s*(?:为止|结束)?/, (m) => { const w = readWhen(m[1], today); if (!w.date) return false; until = w.date; });
    const days = (s) => [...s].map((ch) => CN_WEEKDAY[ch]).filter(Boolean);
    const found = cut(new RegExp('每隔\\s*' + NUM + '\\s*天'), (m) => { const k = cnNumber(m[1]); if (!Number.isInteger(k) || k < 1 || k > 364) return false; rule = { kind: 'interval', every: k + 1 }; })
      || cut(new RegExp('每\\s*' + NUM + '\\s*天'), (m) => { const k = cnNumber(m[1]); if (!Number.isInteger(k) || k < 1 || k > 365) return false; rule = k === 1 ? { kind: 'daily' } : { kind: 'interval', every: k }; })
      || cut(/每(?:天)?(晚上?|早上?)/, () => { rule = { kind: 'daily' }; }, (m) => ' ' + (m[1][0] === '晚' ? '晚上' : '早上'))
      || cut(/每(?:一)?天|每日|天天/, () => { rule = { kind: 'daily' }; })
      || cut(/每个?月\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[号日]/, (m) => { const d = cnNumber(m[1]); if (!Number.isInteger(d) || d < 1 || d > 31) return false; rule = { kind: 'monthly', day: d }; })
      || cut(/每个?周末/, () => { rule = { kind: 'weekly', days: [6, 7], every: 1 }; })
      || cut(/(?:每个?)?工作日(?!志)(?:每天)?/, () => { rule = { kind: 'weekly', days: [1, 2, 3, 4, 5], every: 1 }; })
      || cut(/(?:每(两|二|2)?个?|(隔))(?:周|星期|礼拜)的?\s*([一二三四五六日])\s*(?:到|至|-|—|~)\s*(?:周|星期|礼拜)?([一二三四五六日])/, (m) => {
        const a = CN_WEEKDAY[m[3]], b = CN_WEEKDAY[m[4]];
        if (!(a < b)) return false;
        rule = { kind: 'weekly', days: Array.from({ length: b - a + 1 }, (_, i) => a + i), every: m[1] || m[2] ? 2 : 1 };
      })
      || cut(/(?:每(两|二|2)?个?|(隔))(?:周|星期|礼拜)的?\s*((?:(?:周|星期|礼拜)?[一二三四五六日天](?:\s*[、,，和及与跟]\s*)?)+)(?!\s*[次回遍])/, (m) => { // "每周三次" is a count, not Wednesday
        const list = days(m[3].replace(/星期|礼拜/g, '').replace(/周/g, ''));
        if (!list.length) return false;
        rule = { kind: 'weekly', days: list, every: m[1] || m[2] ? 2 : 1 };
      });
    if (!found) {
      if (/每(?:两|二|2)?个?(?:周|星期|礼拜)/.test(rest)) return { error: '每周哪几天？例如「每周一三五」「每周四」。按次数打卡（每周 3 次）请用习惯。' };
      if (/每个?月/.test(rest)) return { error: '每月几号？例如「每月1号」。' };
      return null;
    }
    return { ruleRaw: { ...rule, start: start || today, ...(until ? { until } : {}) }, startGiven: !!start, rest: rest.replace(/\s+/g, ' ').trim() };
  }
  function repeatFields(state, f, today) {
    const title = cleanText(f.title, 150);
    if (!title) throw new Error('重复任务缺少内容');
    const rule = cleanRule(f.rule, today);
    if (!rule) throw new Error('重复规则不完整，例如「每周四」「每天」「每隔一天」');
    const out = { title, minutes: cleanMinutes(f.minutes, 30), spaceId: state.spaces.some((x) => x.id === f.spaceId) ? f.spaceId : null, tags: cleanTags(f.tags), rule };
    if (validTime(f.time)) out.time = f.time;
    return out;
  }
  const untouchedInstance = (s, t) => !t.done && t.date === t.repeatDate && !t.next && !(t.steps && t.steps.some((x) => x.done))
    && !s.sessions.some((x) => x.taskId === t.id) && !(s.timer && s.timer.taskId === t.id);
  function materializeRepeats(state, today, now = Date.now()) {
    const s = clone(state);
    const end = addDays(today, REPEAT_AHEAD);
    let added = 0, removed = 0, changed = false;
    for (const r of s.repeats) {
      const have = new Set(s.tasks.filter((t) => t.repeatId === r.id).map((t) => t.repeatDate));
      let d = [today, r.rule.start, r.madeUntil ? addDays(r.madeUntil, 1) : today].sort().pop();
      for (; d <= end && (!r.rule.until || d <= r.rule.until); d = addDays(d, 1)) {
        if (!occursOn(r.rule, d) || have.has(d)) continue;
        s.tasks.push({ id: uid('t'), title: r.title, date: d, minutes: r.minutes, spaceId: r.spaceId, done: false, doneAt: null, createdAt: now, origin: 'repeat', repeatId: r.id, repeatDate: d,
          ...(r.time ? { time: r.time } : {}), ...(r.tags.length ? { tags: [...r.tags] } : {}) });
        added++;
      }
      if (!r.madeUntil || r.madeUntil < end) { r.madeUntil = end; changed = true; }
      const arrived = s.tasks.filter((t) => t.repeatId === r.id && t.repeatDate <= today).map((t) => t.repeatDate).sort().pop();
      if (arrived) {
        const before = s.tasks.length;
        s.tasks = s.tasks.filter((t) => !(t.repeatId === r.id && t.repeatDate < arrived && untouchedInstance(s, t)));
        removed += before - s.tasks.length;
      }
    }
    return { state: s, added, removed, changed: changed || added > 0 || removed > 0 };
  }
  function addRepeat(state, f, today, now = Date.now()) {
    const s = clone(state);
    s.repeats.push({ id: uid('r'), ...repeatFields(s, f, today), madeUntil: null, createdAt: now });
    return materializeRepeats(s, today, now).state;
  }
  /* A changed rule replaces its instances from today on that were never started; started or finished ones stay. */
  function updateRepeat(state, id, f, today, now = Date.now()) {
    const s = clone(state);
    const r = s.repeats.find((x) => x.id === id);
    if (!r) throw new Error('这个重复任务已经不存在');
    const fields = repeatFields(s, f, today);
    delete r.time;
    Object.assign(r, fields, { madeUntil: addDays(today, -1) });
    s.tasks = s.tasks.filter((t) => !(t.repeatId === id && t.repeatDate >= today && untouchedInstance(s, t)));
    return materializeRepeats(s, today, now).state;
  }
  /* Stopping removes the instances from today on that were never started; the rest become plain tasks. */
  function stopRepeat(state, id, today) {
    const s = clone(state);
    s.tasks = s.tasks.filter((t) => !(t.repeatId === id && t.repeatDate >= today && untouchedInstance(s, t)));
    s.repeats = s.repeats.filter((r) => r.id !== id);
    for (const t of s.tasks) if (t.repeatId === id) { delete t.repeatId; delete t.repeatDate; }
    return s;
  }

  /* ---------- tags across all tasks ----------
     Renaming to a name that is already in use merges the two. Both reach the repeat rules as well. */
  function renameTag(state, from, to) {
    const next = cleanTags([to])[0];
    if (!next) throw new Error('新的标签名不能为空');
    const s = clone(state);
    const swap = (tags) => cleanTags(tags.map((tag) => (tag === from ? next : tag)));
    for (const t of s.tasks) if (t.tags && t.tags.includes(from)) t.tags = swap(t.tags);
    for (const r of s.repeats) if (r.tags.includes(from)) r.tags = swap(r.tags);
    return s;
  }
  function deleteTag(state, tag) {
    const s = clone(state);
    for (const t of s.tasks) if (t.tags && t.tags.includes(tag)) { t.tags = t.tags.filter((x) => x !== tag); if (!t.tags.length) delete t.tags; }
    for (const r of s.repeats) r.tags = r.tags.filter((x) => x !== tag);
    return s;
  }

  /* ---------- how long things really take ----------
     For finished tasks that were timed: recorded time over the time first planned. The middle value
     of those ratios is used, so one runaway task does not decide it. A space answers for itself once
     it has five such tasks; otherwise all spaces together; with fewer than five in all, nothing. */
  const ESTIMATE_MIN_TASKS = 5;
  function estimateFactor(state, spaceId = null) {
    const timed = {};
    for (const x of state.sessions) if (x.taskId && !x.manual) timed[x.taskId] = (timed[x.taskId] || 0) + x.actual;
    const rows = state.tasks.filter((t) => t.done && timed[t.id]).map((t) => ({ spaceId: t.spaceId || null, ratio: timed[t.id] / (t.estimate || t.minutes) })).filter((x) => x.ratio > 0.1 && x.ratio < 10);
    const own = spaceId ? rows.filter((x) => x.spaceId === spaceId) : [];
    const used = own.length >= ESTIMATE_MIN_TASKS ? own : rows;
    if (used.length < ESTIMATE_MIN_TASKS) return null;
    return { factor: Math.round(median(used.map((x) => x.ratio)) * 100) / 100, tasks: used.length, scope: used === own ? 'space' : 'all' };
  }
  /* The suggested length for a planned one, or null when the records agree with the plan closely enough. */
  function suggestMinutes(state, minutes, spaceId = null) {
    const e = estimateFactor(state, spaceId);
    if (!e || (e.factor > 0.8 && e.factor < 1.2)) return null;
    const suggested = Math.min(1440, Math.max(5, Math.round((minutes * e.factor) / 5) * 5));
    return Math.abs(suggested - minutes) >= 5 ? { ...e, minutes: suggested } : null;
  }

  /* ---------- quick add: exam and deadline dates, and money ----------
     "操作系统期末考试 12月20日 9:00 @二东402": "@" is the place. A course or space named in the title
     files the date under that space. */
  function parseDateLine(state, line, today, fallbackSpaceId = null) {
    let place = '';
    const text = String(line || '').replace(/[@＠]\s*([^\s@＠]{1,40})/, (_, p) => { place = p; return ' '; });
    const r = readWhen(text, today);
    const title = cleanText(r.rest.replace(/^[\s,，;；]+|[\s,，;；。]+$/g, ''), 80);
    if (!title) return { error: '没有读到是什么事，例如「操作系统期末考试 12月20日」' };
    if (!r.date) return { error: '没有读到日期，例如「12月20日」「下周五」「明天」', title };
    if (r.date < today) return { error: '这个日期已经过去了', title };
    const sp = state.spaces.find((x) => x.course && title.includes(x.course)) || state.spaces.find((x) => x.name.length >= 2 && title.includes(x.name));
    const spaceId = sp ? sp.id : state.spaces.some((x) => x.id === fallbackSpaceId) ? fallbackSpaceId : null;
    return { item: { title, date: r.date, place: cleanText(place, 40), spaceId, ...(r.time ? { time: r.time } : {}) }, spaceFromTitle: !!sp, daysLeft: daysBetween(today, r.date) };
  }
  /* In the money box a bare "奶茶 15" is spending; "+", 收到, 生活费 and similar words make it income,
     and 忍住没买 puts it in the piggy bank. */
  function parseMoneyLine(line, today) {
    const text = String(line || '').trim();
    let r = parseMoney(text, today);
    if (!r) {
      const income = /^[+＋]/.test(text) || /生活费|工资|奖学金|助学金|红包|退款|兼职|家教|收到|到账/.test(text);
      r = parseMoney((income ? '收入 ' : '花了 ') + text.replace(/^[+＋\-－]\s*/, ''), today);
    }
    if (!r) return { error: '没有读到金额，例如「奶茶 15」「收到生活费 1500」' };
    return { entry: { kind: r.kind, amount: r.amount, category: r.category, note: r.note, date: r.date || today } };
  }

  /* ---------- free time in a day, and spreading late tasks over the coming days ---------- */
  const clockMinutes = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const clockText = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  /* Classes and unfinished tasks with a start time are busy; the gaps between them inside the window
     (8:00–22:00 unless given) are free. With `now`, only the part of the day still ahead counts. */
  function freeSlots(state, date, { now = null, from = '08:00', to = '22:00', min = 20 } = {}) {
    const windowStart = clockMinutes(from), windowEnd = clockMinutes(to);
    const start = now === null ? windowStart : Math.max(windowStart, Math.ceil(now / 5) * 5);
    const busy = [
      ...Timetable.events(state.schedule, date, date).map((e) => ({ kind: 'class', title: e.title, start: clockMinutes(e.startTime), end: clockMinutes(e.endTime) })),
      ...state.tasks.filter((t) => t.date === date && t.time && !t.done).map((t) => ({ kind: 'task', id: t.id, title: t.title, start: clockMinutes(t.time), end: Math.min(1440, clockMinutes(t.time) + t.minutes) })),
    ].filter((b) => b.end > b.start).sort((a, b) => a.start - b.start || a.end - b.end);
    const gaps = [];
    let cursor = start;
    for (const b of busy) {
      if (cursor >= windowEnd) break;
      if (b.end <= cursor) continue;
      if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, windowEnd) });
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });
    const slots = gaps.filter((g) => g.end - g.start >= min).map((g) => ({ start: clockText(g.start), end: clockText(g.end), minutes: g.end - g.start }));
    return { from, to, windowStart, windowEnd, start, busy, slots, free: sum(slots, (x) => x.minutes) };
  }
  /* Puts the given tasks on the earliest days that still have room, over the next `horizon` days.
     Room is the daily amount the user can arrange minus what is already planned that day; today is
     also limited by the free time left in it. Tasks of a space with a close exam or deadline go first,
     then the ones that have waited longest. A task that fits nowhere goes to the day with most room
     and is marked `over`; a task whose space has an exam or deadline coming is kept to the days before
     it. Nothing is written; this returns a plan to show first. */
  function spreadTasks(state, ids, today, { daily = 120, todayFree = null, horizon = 14 } = {}) {
    const moving = new Set(ids);
    const tasks = state.tasks.filter((t) => moving.has(t.id) && !t.done);
    const days = Array.from({ length: horizon }, (_, i) => addDays(today, i));
    const planned = days.map((d) => sum(state.tasks.filter((t) => t.date === d && !t.done && !moving.has(t.id)), (t) => t.minutes));
    const room = planned.map((p) => Math.max(0, daily - p));
    if (todayFree !== null) {
      const untimed = sum(state.tasks.filter((t) => t.date === today && !t.done && !t.time && !moving.has(t.id)), (t) => t.minutes);
      room[0] = Math.min(room[0], Math.max(0, todayFree - untimed));
    }
    const soon = (t) => { const d = t.spaceId ? upcomingDates(state, today, t.spaceId)[0] : null; return d ? d.daysLeft : 9999; }; // only a date in the task's own space counts
    const order = [...tasks].sort((a, b) => soon(a) - soon(b) || (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
    const added = days.map(() => 0);
    const moves = order.map((t) => {
      // Work for an upcoming exam or deadline belongs before it: only the days up to the day before count,
      // even when that overfills one of them.
      const due = soon(t);
      const last = due >= 1 && due < horizon ? due - 1 : due === 0 ? 0 : horizon - 1;
      const window = room.slice(0, last + 1);
      let i = window.findIndex((r) => r >= t.minutes);
      const over = i < 0;
      if (over) i = window.indexOf(Math.max(...window));
      room[i] -= t.minutes;
      added[i] += t.minutes;
      return { taskId: t.id, title: t.title, minutes: t.minutes, from: t.date, to: days[i], over, deadlineIn: soon(t) === 9999 ? null : soon(t) };
    });
    return { moves, days: days.map((d, i) => ({ date: d, planned: planned[i], added: added[i], daily })).filter((x) => x.added) };
  }
  /* Moves tasks to the planned days. A start time is dropped, since the old one may clash on the new day. */
  function applySpread(state, moves) {
    const s = clone(state);
    for (const m of moves) {
      const t = s.tasks.find((x) => x.id === m.taskId);
      if (!t || t.done) continue;
      t.date = m.to;
      delete t.time;
      delete t.week;
    }
    return s;
  }

  /* Evenly sized segments for one sitting, used when no model is connected. */
  function splitIntoSteps(totalMinutes, segment, label) {
    const count = Math.min(MAX_STEPS, Math.max(1, Math.round(totalMinutes / segment)));
    const each = Math.round(totalMinutes / count);
    return Array.from({ length: count }, (_, i) => ({ title: i === count - 1 && count > 1 ? '回顾并记下卡住的地方' : label ? label + '（' + (i + 1) + '/' + count + '）' : '第 ' + (i + 1) + ' 段', minutes: each }));
  }

  function localReply(text, today, prefs = {}) {
    const lines = String(text).split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const actions = [];
    for (const line of lines.slice(0, MAX_ACTIONS)) {
      const memo = line.match(/^(?:记住|请记住)[：:，,\s]*(.+)$/);
      if (memo) { actions.push({ type: 'remember', text: memo[1] }); continue; }
      const money = parseMoney(line, today);
      if (money) { actions.push(money); continue; }
      const task = parseLine(line, today);
      if (!task) continue;
      if (task.minutes >= 45) {
        task.steps = splitIntoSteps(task.minutes, prefs.segment || 25, task.title.slice(0, 80));
        if (!task.date) task.date = today;
      }
      actions.push(task);
    }
    const planned = actions.find((a) => a.steps);
    return {
      reply: !actions.length
        ? '现在是本地模式，我只能把你写的每一行变成任务。连接 AI 模型后，我才能读课件、回答问题和帮你做计划。'
        : planned
          ? '现在是本地模式（没有连接 AI 模型），我按你习惯的 ' + (prefs.segment || 25) + ' 分钟把它等分成了几段，每段要做什么请点文字自己写。连接模型后我可以根据课件内容来分。'
          : '现在是本地模式（没有连接 AI 模型），我把每一行当作一件事。请检查下面的提议。',
      actions,
      options: [],
      questions: [],
      memory: [],
      startTimer: !!planned && lines.length === 1,
    };
  }

  return {
    VERSION, SPACE_COLORS, SPACE_TYPES, logMetric,
    clone, uid, todayISO, validDate, validTime, MONEY_CATEGORIES, addMoney, updateMoney, setMoneySettings, moneySummary, moneyCandles, moneyFlow, parseMoney, trajectory, addSession, updateSession, wrapUp, moveTask, setWeekPlan, weekSummary, isV3Export, convertV3, CARD_INTERVALS, newCard, dueCards, reviewCard, cardStats, upcomingDates, daysBetween, editTaskSteps, toggleTask, addDays, weekStart,
    emptyState, normalize, validateActions, resolveProposal, editProposal, addMemory,
    habitWeekCount, timerElapsed, timerView, startTimer, pauseTimer, resumeTimer, extendTimer, finishStep, stopTimer,
    buildProfile, buildContext, history, parseLine, parseTaskLine, cleanTags, takeTags, parseWhen,
    REPEAT_AHEAD, takeRepeat, cleanRule, occursOn, nextOccurrences, repeatLabel, materializeRepeats, addRepeat, updateRepeat, stopRepeat,
    parseDateLine, parseMoneyLine, freeSlots, spreadTasks, applySpread, reviewSummary, renameTag, deleteTag, estimateFactor, suggestMinutes, splitIntoSteps, localReply,
  };
});
