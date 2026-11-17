const test = require('node:test');
const assert = require('node:assert');
const C = require('./js/core.js');
const Agent = require('./js/agent.js');
const Providers = require('./js/providers.js');

const TODAY = '2026-11-14'; // a Saturday
const MIN = 60000;

function stateWithTask() {
  const s = C.emptyState();
  s.tasks.push({ id: 't1', title: 'Read chapter 3', date: TODAY, minutes: 40, spaceId: 'space_1', done: false, doneAt: null, createdAt: 1 });
  return s;
}
function withProposal(s, actions) {
  s.messages.push({ id: 'm1', role: 'assistant', text: 'ok', at: 1, proposal: { status: 'pending', source: 'ai', actions: C.validateActions(s, actions).actions } });
  return s;
}

test('dates: week starts on Monday and addDays crosses months', () => {
  assert.equal(C.weekStart(TODAY), '2026-11-09');
  assert.equal(C.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(C.validDate('2026-02-30'), false);
});

test('normalize repairs missing fields and rejects newer data', () => {
  const s = C.normalize({ tasks: [{ id: 'a', title: 'x', date: 'bad', spaceId: 'gone', goalId: 'gone' }], timer: { taskId: 'nope' } });
  assert.equal(s.tasks[0].date, null);
  assert.equal(s.tasks[0].spaceId, null);
  assert.equal(s.tasks[0].goalId, null);
  assert.equal(s.timer, null);
  assert.equal(s.settings.prefs.segment, 25);
  assert.throws(() => C.normalize({ version: 99 }));
});

test('validateActions keeps good actions and reports bad ones', () => {
  const s = stateWithTask();
  const { actions, rejected } = C.validateActions(s, [
    { type: 'add_task', title: '  Write  outline ', date: 'tomorrow', minutes: 'x', space: '学习' },
    { type: 'update_task', taskId: 'missing', date: '2026-11-15' },
    { type: 'format_disk' },
    { type: 'add_habit', title: 'Run', perWeek: 30 },
  ]);
  assert.deepEqual(actions[0], { type: 'add_task', title: 'Write outline', date: null, minutes: 25, spaceId: 'space_1' });
  assert.equal(actions[1].perWeek, 7);
  assert.equal(rejected.length, 2);
});

test('a task with steps takes its length from the steps', () => {
  const { actions } = C.validateActions(C.emptyState(), [{ type: 'add_task', title: 'MCU', minutes: 5, steps: [{ title: 'Read p1-10', minutes: 30 }, { title: 'Timer lab', minutes: 45 }, 'Review'] }]);
  assert.equal(actions[0].minutes, 100);
  assert.deepEqual(actions[0].steps[2], { title: 'Review', minutes: 25 });
});

test('nothing changes until a proposal is accepted, and accepting twice is a no-op', () => {
  const s = withProposal(stateWithTask(), [
    { type: 'add_task', title: 'New', minutes: 20 },
    { type: 'complete_task', taskId: 't1' },
  ]);
  const before = JSON.stringify(s);
  const next = C.resolveProposal(s, 'm1', true, 1000);
  assert.equal(JSON.stringify(s), before, 'input state must not be mutated');
  assert.equal(next.tasks.length, 2);
  assert.equal(next.tasks[0].done, true);
  assert.equal(next.messages[0].proposal.created.length, 1);
  assert.equal(C.resolveProposal(next, 'm1', true, 2000).tasks.length, 2);
});

test('dismissing writes nothing; a stale proposal fails as a whole', () => {
  const s = withProposal(stateWithTask(), [{ type: 'add_task', title: 'New' }, { type: 'delete_task', taskId: 't1' }]);
  assert.equal(C.resolveProposal(s, 'm1', false).tasks.length, 1);
  s.tasks = [];
  assert.throws(() => C.resolveProposal(s, 'm1', true));
});

test('proposed steps can be edited before confirming', () => {
  let s = withProposal(C.emptyState(), [{ type: 'add_task', title: 'MCU', steps: [{ title: 'A', minutes: 30 }, { title: 'B', minutes: 30 }] }]);
  const edit = (op) => { s = C.editProposal(s, 'm1', 0, op); return s.messages[0].proposal.actions[0]; };
  assert.equal(edit({ kind: 'minutes', step: 0, delta: -10 }).minutes, 50);
  assert.equal(edit({ kind: 'minutes', step: 0, delta: -100 }).steps[0].minutes, 5);
  assert.equal(edit({ kind: 'title', step: 1, title: '  Lab  ' }).steps[1].title, 'Lab');
  assert.deepEqual(edit({ kind: 'move', step: 1, dir: -1 }).steps.map((x) => x.title), ['Lab', 'A']);
  assert.equal(edit({ kind: 'add' }).steps.length, 3);
  assert.equal(edit({ kind: 'remove', step: 0 }).minutes, 30);
  assert.throws(() => C.editProposal(s, 'm1', 0, { kind: 'title', step: 0, title: ' ' }));
  const done = C.resolveProposal(s, 'm1', true);
  assert.deepEqual(done.tasks[0].steps.map((x) => [x.title, x.minutes]), [['A', 5], ['新的一步', 25]]);
  assert.throws(() => C.editProposal(done, 'm1', 0, { kind: 'add' }), 'a confirmed proposal is frozen');
});

test('a goal becomes milestones with linked tasks', () => {
  const s = withProposal(C.emptyState(), [{
    type: 'add_goal', title: 'Finish MCU course', deadline: '2026-12-31', space: '学习',
    milestones: [
      { title: 'Week 1: GPIO', due: '2026-11-22', tasks: [{ title: 'Read ch1', date: '2026-11-16', minutes: 60, steps: [{ title: 'p1-20', minutes: 30 }, { title: 'p21-40', minutes: 30 }] }, { title: 'LED lab', date: '2026-11-17', minutes: 45 }] },
      { title: 'Week 2: Timers', tasks: [{ title: 'Read ch2' }] },
    ],
  }]);
  const next = C.resolveProposal(s, 'm1', true);
  assert.equal(next.goals.length, 1);
  assert.deepEqual(next.goals[0].milestones.map((m) => m.title), ['Week 1: GPIO', 'Week 2: Timers']);
  assert.equal(next.tasks.length, 3);
  assert.ok(next.tasks.every((t) => t.goalId === next.goals[0].id && t.spaceId === 'space_1'));
  assert.equal(next.tasks[2].milestone, 1);
  assert.equal(next.tasks[0].steps.length, 2);
});

test('timer walks the steps, records real minutes, and completes the task', () => {
  let s = C.emptyState();
  s.tasks.push({ id: 't', title: 'MCU', date: TODAY, minutes: 50, spaceId: 'space_1', done: false, steps: [{ title: 'A', minutes: 20, done: false }, { title: 'B', minutes: 30, done: false }] });
  const t0 = new Date(TODAY + 'T09:00:00').getTime();
  s = C.startTimer(s, 't', t0);
  assert.throws(() => C.startTimer(s, 't', t0));
  assert.equal(C.timerView(s, t0 + 5 * MIN).remainingMs, 15 * MIN);
  s = C.pauseTimer(s, t0 + 5 * MIN);
  s = C.resumeTimer(s, t0 + 15 * MIN); // a ten-minute pause is not counted
  assert.equal(C.timerView(s, t0 + 20 * MIN).elapsedMs, 10 * MIN);
  assert.equal(C.timerView(s, t0 + 40 * MIN).due, true);
  s = C.extendTimer(s, 5);
  assert.equal(s.tasks[0].minutes, 55);
  let r = C.finishStep(s, t0 + 38 * MIN); // 28 working minutes
  assert.equal(r.session.actual, 28);
  assert.equal(r.session.planned, 25);
  assert.equal(r.session.hour, 9);
  assert.equal(r.finishedTask, null);
  assert.equal(r.state.timer.step, 1);
  r = C.finishStep(r.state, t0 + 68 * MIN);
  assert.equal(r.finishedTask, 't');
  assert.equal(r.state.timer, null);
  assert.equal(r.state.tasks[0].done, true);
  assert.equal(r.state.sessions.length, 2);
  const skipped = C.finishStep(C.startTimer(stateWithTask(), 't1', 0), 20000);
  assert.equal(skipped.session, null, 'a step skipped within a minute leaves no record');
  assert.equal(skipped.state.tasks[0].done, false, 'remaining generated segment is still pending');
  assert.equal(C.finishStep(skipped.state, 40000).state.tasks[0].done, true);
});

test('stopping early records a partial session only after a minute', () => {
  let s = stateWithTask();
  s = C.startTimer(s, 't1', 0);
  assert.equal(s.tasks[0].steps.length, 2, 'a task without steps is split using the focus preference');
  assert.equal(s.tasks[0].steps.reduce((n, step) => n + step.minutes, 0), 40);
  assert.equal(C.stopTimer(s, 30000).sessions.length, 0);
  const stopped = C.stopTimer(s, 12 * MIN);
  assert.equal(stopped.sessions[0].partial, true);
  assert.equal(stopped.sessions[0].actual, 12);
  assert.equal(stopped.tasks[0].done, false);
});

test('profile reports a figure only when there is enough evidence', () => {
  const s = C.emptyState();
  const session = (planned, actual, hour, date) => ({ id: C.uid('s'), taskId: 't', title: 'x', step: 'y', spaceId: 'space_1', planned, actual, date, hour, partial: false });
  s.sessions.push(session(25, 30, 9, '2026-11-10'), session(25, 35, 10, '2026-11-11'));
  let p = C.buildProfile(s, TODAY);
  assert.equal(p.actualVsPlanned, undefined);
  assert.equal(p.sessionsRecorded, 2);
  s.sessions.push(session(30, 39, 9, '2026-11-12'), session(20, 20, 20, '2026-11-12'), session(20, 20, 21, '2026-11-13'));
  s.tasks.push({ id: 'f', title: 'x', date: null, minutes: 1, done: true, feel: 'hard' });
  p = C.buildProfile(s, TODAY);
  assert.equal(p.actualVsPlanned, 1.2);
  assert.equal(p.actualVsPlannedBySpace['学习'], 1.2);
  assert.equal(p.typicalFocusMinutes, 30);
  assert.deepEqual(p.focusMinutesByTimeOfDay, { 早上: 104, 晚上: 40 });
  assert.equal(p.focusMinutesPerActiveDay, 36);
  assert.deepEqual(p.difficultyFeedback, { easy: 0, ok: 0, hard: 1 });
});

test('memory notes are de-duplicated', () => {
  const s = C.emptyState();
  assert.equal(C.addMemory(s, ' Morning  person ', 1, 'ai'), true);
  assert.equal(C.addMemory(s, 'Morning person', 2, 'ai'), false);
  assert.equal(s.memory.length, 1);
});

test('local mode parses dates and splits a long sitting into segments', () => {
  assert.deepEqual(C.parseLine('明天 复习第三章 45分钟', TODAY), { type: 'add_task', title: '复习第三章', date: '2026-11-15', minutes: 45, space: null });
  assert.equal(C.parseLine('周三 写报告 1.5小时', TODAY).date, '2026-11-18');
  assert.equal(C.parseLine('下周一 开会', TODAY).date, '2026-11-16');
  const plan = C.localReply('学习单片机 2小时', TODAY, { segment: 30 });
  assert.equal(plan.actions[0].steps.length, 4);
  assert.equal(plan.actions[0].date, TODAY);
  assert.equal(plan.startTimer, true);
  assert.deepEqual(C.localReply('买菜\n记住：我早上效率高', TODAY).actions.map((a) => a.type), ['add_task', 'remember']);
});

test('context carries facts, preferences and profile', () => {
  const s = stateWithTask();
  s.habits.push({ id: 'h1', title: 'Run', perWeek: 3, spaceId: null, log: { '2026-11-10': true, [TODAY]: true, '2026-11-01': true } });
  s.memory.push({ id: 'm', text: 'Morning person', at: 1, source: 'user' });
  const ctx = C.buildContext(s, TODAY, 'plan my day');
  assert.equal(ctx.openTasks[0].taskId, 't1');
  assert.deepEqual(ctx.habits[0], { title: 'Run', targetPerWeek: 3, doneThisWeek: 2, doneToday: true });
  assert.deepEqual(ctx.memory, ['Morning person']);
  assert.equal(ctx.preferences.segment, 25);
  assert.equal(ctx.profile.sessionsRecorded, 0);
});

test('parseReply reads final answers, tool calls, fenced JSON and plain text', () => {
  const final = Agent.parseReply('{"reply":"hi","actions":[{"type":"remember","text":"a"}],"options":["好","  "],"startTimer":true}');
  assert.equal(final.actions.length, 1);
  assert.deepEqual(final.options, ['好']);
  assert.equal(final.startTimer, true);
  const asked = Agent.parseReply('{"reply":"q","questions":[{"question":"每天多久？","options":["1 小时","2 小时"],"multi":false},{"question":"bad","options":["only one"]},{"question":"哪几天？","options":["周一","周三","周五"],"multi":true}]}');
  assert.deepEqual(asked.questions.map((q) => [q.question, q.options.length, q.multi]), [['每天多久？', 2, false], ['哪几天？', 3, true]]);
  assert.deepEqual(Agent.parseReply('{"tool":{"name":"get_history","args":{"days":7}}}').tool, { name: 'get_history', args: { days: 7 } });
  assert.equal(Agent.parseReply('```json\n{"reply":"hi"}\n```').reply, 'hi');
  assert.equal(Agent.parseReply('Sure, here is my advice.').reply, 'Sure, here is my advice.');
});

test('agent loop runs tools, feeds results back, and stops at the limit', async () => {
  const library = new Map([['slides.pdf', { name: 'slides.pdf', kind: 'PDF', text: 'A'.repeat(7000) + 'TIMER CHAPTER' }]]);
  const seen = [];
  const replies = [
    '{"tool":{"name":"read_attachment","args":{"name":"slides.pdf","offset":6000}}}',
    '{"tool":{"name":"nope","args":{}}}',
    '{"reply":"done","actions":[],"options":[]}',
  ];
  const steps = [];
  const result = await Agent.run({
    context: { message: 'plan' }, attachments: [library.get('slides.pdf')], library,
    chat: async (system, user) => { seen.push(JSON.parse(user)); return replies.shift(); },
    onStep: (name) => steps.push(name),
  });
  assert.equal(result.reply, 'done');
  assert.equal(result.toolCalls, 2);
  assert.deepEqual(steps, ['read_attachment', 'nope']);
  assert.equal(seen[0].attachments[0].excerpt.length, 6000);
  assert.ok(seen[1].toolResults[0].result.text.endsWith('TIMER CHAPTER'));
  assert.ok(seen[2].toolResults[1].result.error);

  let calls = 0;
  const looping = await Agent.run({ context: {}, chat: async () => { calls++; return '{"tool":{"name":"get_history","args":{}}}'; }, tools: { get_history: () => ({}) } });
  assert.equal(calls, Agent.MAX_TOOL_STEPS + 1);
  assert.equal(looping.actions.length, 0);
});

test('a reflection keeps its line breaks, can be corrected, and is saved on confirm', () => {
  let s = withProposal(C.emptyState(), [{ type: 'add_reflection', text: '今天学了定时器。\n\n\n\n卡在初值计算  上。 ', date: 'x' }]);
  assert.equal(s.messages[0].proposal.actions[0].text, '今天学了定时器。\n\n卡在初值计算  上。');
  s = C.editProposal(s, 'm1', 0, { kind: 'text', text: '今天学了定时器。\n卡在初值计算上。' });
  const done = C.resolveProposal(s, 'm1', true, new Date(TODAY + 'T20:00:00').getTime());
  assert.deepEqual([done.reflections[0].date, done.reflections[0].text], [TODAY, '今天学了定时器。\n卡在初值计算上。']);
  assert.equal(C.buildContext(done, TODAY, 'x').recentReflections.length, 1);
});

test('agent passes pictures to the model and lists only documents as attachments', async () => {
  const seen = [];
  await Agent.run({
    context: {}, attachments: [{ name: 'note.jpg', kind: '图片', text: '', image: { mediaType: 'image/jpeg', data: 'AAAA' } }, { name: 'a.txt', kind: '文本', text: 'hello' }],
    chat: async (system, user, images) => { seen.push([JSON.parse(user), images]); return '{"reply":"ok"}'; },
  });
  assert.deepEqual(seen[0][0].images, ['note.jpg']);
  assert.deepEqual(seen[0][0].attachments.map((a) => a.name), ['a.txt']);
  assert.deepEqual(seen[0][1], [{ mediaType: 'image/jpeg', data: 'AAAA' }]);
});

test('providers: presets, old settings, and request shapes', () => {
  assert.deepEqual(Providers.PROVIDERS.map((p) => p.id), ['deepseek', 'openai', 'anthropic', 'doubao', 'kimi', 'custom']);
  assert.equal(Providers.migrate({ provider: 'openai', baseUrl: 'https://api.deepseek.com', modelId: 'm' }).provider, 'deepseek');
  assert.equal(Providers.migrate({ provider: 'openai', baseUrl: 'http://localhost:11434/v1' }).provider, 'custom');
  assert.equal(Providers.migrate({ provider: 'anthropic', baseUrl: '' }).baseUrl, 'https://api.anthropic.com');
  assert.equal(Providers.migrate({ provider: 'kimi', baseUrl: 'https://api.moonshot.ai/v1' }).provider, 'kimi');

  const deepseek = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/', modelId: 'deepseek-chat' };
  assert.deepEqual(Providers.modelsRequest(deepseek, 'k'), { url: 'https://api.deepseek.com/models', headers: { authorization: 'Bearer k' } });
  const plain = Providers.chatRequest(deepseek, 'k', 'sys', 'hi');
  assert.equal(plain.url, 'https://api.deepseek.com/chat/completions');
  assert.deepEqual(plain.body.messages, [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]);
  const image = [{ mediaType: 'image/jpeg', data: 'AAAA' }];
  assert.deepEqual(Providers.chatRequest(deepseek, 'k', 'sys', 'hi', image).body.messages[1].content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });

  const claude = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', modelId: 'claude-opus-5-5' };
  assert.equal(Providers.modelsRequest(claude, 'k').url, 'https://api.anthropic.com/v1/models?limit=100');
  const call = Providers.chatRequest(claude, 'k', 'sys', 'hi', image);
  assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(call.headers['x-api-key'], 'k');
  assert.equal(call.body.system, 'sys');
  assert.deepEqual(call.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.equal(Providers.parseChat(claude, { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'ok' }] }), 'ok');
  assert.equal(Providers.parseChat(deepseek, { choices: [{ message: { content: 'ok' } }] }), 'ok');

  assert.deepEqual(Providers.parseModels({ data: [{ id: 'gpt-x' }, { id: 'text-embedding-3' }, { id: 'a-model' }, { id: 'gpt-x' }] }), ['a-model', 'gpt-x']);
  assert.throws(() => Providers.chatRequest({ provider: 'custom', baseUrl: 'http://example.com', modelId: 'm' }, '', 's', 'u'));
  assert.match(Providers.explain(401, { error: { message: 'bad key' } }), /密钥.*bad key/);
});

test('inside a space the app decides where new items go, including goals and their tasks', () => {
  const s = C.emptyState();
  const { actions } = C.validateActions(s, [
    { type: 'add_goal', title: '减重', space: '不存在的分区', spaceId: 'space_3', milestones: [{ title: '第 1 个月', tasks: [{ title: '快走 45 分钟', space: '学习' }] }] },
    { type: 'add_habit', title: '称体重', perWeek: 1, spaceId: 'space_3' },
    { type: 'add_task', title: '买运动鞋', space: '生活' },
    { type: 'add_task', title: '无分区', space: '乱写' },
  ]);
  assert.equal(actions[0].spaceId, 'space_3');
  assert.equal(actions[0].milestones[0].tasks[0].spaceId, 'space_3');
  assert.equal(actions[0].deadline, null);
  assert.equal(actions[1].spaceId, 'space_3');
  assert.equal(actions[2].spaceId, 'space_4');
  assert.equal(actions[3].spaceId, null);
});

test('each space has its own conversation history', () => {
  const s = C.emptyState();
  s.messages.push({ id: 'a', role: 'user', text: 'general', at: 1 }, { id: 'b', role: 'user', text: 'health', at: 2, spaceId: 'space_3' });
  assert.deepEqual(C.buildContext(s, TODAY, 'x', 'space_3').history.map((m) => m.text), ['health']);
  assert.deepEqual(C.buildContext(s, TODAY, 'x', null).history.map((m) => m.text), ['general']);
  assert.equal(C.buildContext(s, TODAY, 'x').history.length, 2);
});

test('spaces have a type; older data gets sensible types', () => {
  assert.deepEqual(C.emptyState().spaces.map((x) => x.type), ['study', 'project', 'habit', 'life']);
  const old = C.normalize({ spaces: [{ id: 'space_3', name: '习惯与健康', color: '#000' }, { id: 'space_x', name: '微机原理', color: '#000' }, { id: 'space_y', name: 'y', color: '#000', type: 'bogus' }] });
  assert.deepEqual(old.spaces.map((x) => x.type), ['habit', 'study', 'study']);
});

test('a measurement keeps one value per day and reports first and latest to the model', () => {
  let s = withProposal(C.emptyState(), [
    { type: 'log_metric', name: '体重', value: '72.456', unit: 'kg', date: '2026-11-01', spaceId: 'space_3' },
    { type: 'log_metric', name: '体重', value: 71.800, date: '2026-11-14', spaceId: 'space_3' },
    { type: 'log_metric', name: '体重', value: 'abc' },
  ]);
  assert.equal(s.messages[0].proposal.actions.length, 2, 'a non-number is rejected');
  s = C.resolveProposal(s, 'm1', true, new Date(TODAY + 'T08:00:00').getTime());
  assert.equal(s.metrics.length, 1);
  assert.deepEqual(s.metrics[0].entries, [{ date: '2026-11-01', value: 72.46 }, { date: '2026-11-14', value: 71.800 }]);
  C.logMetric(s, { name: '体重', value: 71.500, spaceId: 'space_3', date: '2026-11-14' }, 0);
  assert.equal(s.metrics[0].entries.length, 2, 'same day replaces');
  const ctx = C.buildContext(s, TODAY, 'x');
  assert.deepEqual(ctx.metrics, [{ name: '体重', unit: 'kg', space: '习惯与健康', count: 2, first: { date: '2026-11-01', value: 72.46 }, latest: { date: '2026-11-14', value: 71.500 } }]);
});

test('a start time is parsed in local mode and only kept on a dated task', () => {
  assert.deepEqual(C.parseLine('周五下午3点开会', TODAY), { type: 'add_task', title: '开会', date: '2026-11-20', time: '15:00', minutes: 30, space: null });
  assert.equal(C.parseLine('明天 8:30 交作业 30分钟', TODAY).time, '08:30');
  const evening = C.parseLine('晚上7点半跑步 40分钟', TODAY);
  assert.deepEqual([evening.date, evening.time, evening.minutes], [TODAY, '19:30', 40]);
  assert.equal(C.parseLine('单片机 2小时', TODAY).time, undefined);
  const s = C.emptyState();
  const checked = C.validateActions(s, [
    { type: 'add_task', title: 'A', date: TODAY, time: '19:00', minutes: 30 },
    { type: 'add_task', title: 'B', date: null, time: '19:00', minutes: 30 },
    { type: 'add_task', title: 'C', date: TODAY, time: '25:00', minutes: 30 },
  ]);
  assert.deepEqual(checked.actions.map((a) => a.time), ['19:00', undefined, undefined]);
  const raw = C.emptyState();
  raw.tasks.push({ id: 'a', title: 'x', date: null, time: '09:00', minutes: 10 }, { id: 'b', title: 'y', date: TODAY, time: '09:00', minutes: 10 });
  assert.deepEqual(C.normalize(raw).tasks.map((t) => t.time), [undefined, '09:00']);
  assert.equal(C.buildContext(C.normalize(raw), TODAY, 'hi').openTasks[1].time, '09:00');
});

test('local mode names segments after the task instead of numbering them', () => {
  const steps = C.localReply('学习单片机 2小时', TODAY, { segment: 30 }).actions[0].steps;
  assert.deepEqual(steps.map((x) => x.title), ['学习单片机（1/4）', '学习单片机（2/4）', '学习单片机（3/4）', '回顾并记下卡住的地方']);
});

test('ticking a task done while its timer runs records the time worked', () => {
  let s = C.startTimer(stateWithTask(), 't1', 1000);
  const result = C.toggleTask(s, 't1', 1000 + 12 * MIN);
  assert.equal(result.wasTiming, true);
  assert.equal(result.state.timer, null);
  assert.equal(result.state.tasks[0].done, true);
  assert.deepEqual(result.state.sessions.map((x) => [x.taskId, x.actual, x.partial]), [['t1', 12, false]]);
  // Under a minute is not evidence of work; unticking never records anything.
  s = C.startTimer(stateWithTask(), 't1', 1000);
  assert.equal(C.toggleTask(s, 't1', 1000 + 20000).state.sessions.length, 0);
  const undone = C.toggleTask(result.state, 't1', 5);
  assert.deepEqual([undone.state.tasks[0].done, undone.state.tasks[0].doneAt, undone.wasTiming, undone.state.sessions.length], [false, null, false, 1]);
});

test('steps of a confirmed task can be edited, within what the records allow', () => {
  let s = stateWithTask();
  s = C.editTaskSteps(s, 't1', { kind: 'add', title: '做习题' }); // a plain task becomes two steps
  assert.deepEqual(s.tasks[0].steps.map((x) => [x.title, x.minutes, x.done]), [['Read chapter 3', 40, false], ['做习题', 25, false]]);
  assert.equal(s.tasks[0].minutes, 65);
  s = C.editTaskSteps(s, 't1', { kind: 'minutes', step: 1, delta: 5 });
  s = C.editTaskSteps(s, 't1', { kind: 'title', step: 0, title: '读第三章' });
  assert.deepEqual([s.tasks[0].steps[0].title, s.tasks[0].minutes], ['读第三章', 70]);
  s.tasks[0].steps[0].done = true;
  assert.throws(() => C.editTaskSteps(s, 't1', { kind: 'remove', step: 0 }), /已完成的分段/);
  assert.throws(() => C.editTaskSteps(s, 't1', { kind: 'move', step: 1, dir: -1 }), /已完成的分段前面/);
  const timing = C.startTimer(s, 't1', 1000);
  assert.throws(() => C.editTaskSteps(timing, 't1', { kind: 'remove', step: 1 }), /计时进行中/);
  assert.equal(C.editTaskSteps(timing, 't1', { kind: 'minutes', step: 1, delta: 5 }).tasks[0].steps[1].minutes, 35);
});

test('the agent stops between steps when asked, and offers no path tools', async () => {
  assert.ok(!/read_path|list_dir/.test(Agent.SYSTEM_PROMPT));
  const control = new AbortController();
  let calls = 0;
  const run = Agent.run({ context: {}, signal: control.signal, chat: async () => { calls++; control.abort(); return '{"tool":{"name":"get_history","args":{}}}'; }, tools: { get_history: () => ({}) } });
  await assert.rejects(run, { name: 'AbortError' });
  assert.equal(calls, 1);
});

test('exams, deadlines and goal deadlines are counted down, nearest first', () => {
  const s = C.emptyState();
  const checked = C.validateActions(s, [
    { type: 'add_date', title: '操作系统期末考试', date: '2026-11-19', time: '09:00', place: 'A204', space: '学习' },
    { type: 'add_date', title: '没有日期', date: 'soon' },
    { type: 'add_date', title: '', date: '2026-11-19' },
  ]);
  assert.equal(checked.actions.length, 1);
  assert.equal(checked.rejected.length, 2);
  s.messages.push({ id: 'm', role: 'assistant', text: '', proposal: { status: 'pending', source: 'ai', actions: checked.actions } });
  const next = C.resolveProposal(s, 'm', true, 1);
  assert.deepEqual([next.dates[0].title, next.dates[0].time, next.dates[0].spaceId], ['操作系统期末考试', '09:00', 'space_1']);
  next.dates.push({ id: 'old', title: '已经过去', date: '2026-11-01' }, { id: 'far', title: '六级', date: '2026-12-12' });
  next.goals.push({ id: 'g', title: '学完单片机', deadline: '2026-11-30', milestones: [] });
  assert.deepEqual(C.upcomingDates(next, TODAY).map((d) => [d.title, d.daysLeft, d.kind]), [['操作系统期末考试', 5, 'date'], ['学完单片机', 16, 'goal'], ['六级', 28, 'date']]);
  assert.deepEqual(C.upcomingDates(next, TODAY, 'space_1').map((d) => d.title), ['操作系统期末考试']);
  assert.equal(C.buildContext(next, TODAY, 'hi').keyDates[0].daysLeft, 5);
  // A date without a title or a valid day does not survive loading.
  const raw = C.clone(next); raw.dates.push({ id: 'bad', title: 'x', date: 'nope' });
  assert.equal(C.normalize(raw).dates.length, 3);
});

test('a remembered card moves out along the intervals; a forgotten one starts over tomorrow', () => {
  const at = (date) => new Date(date + 'T10:00:00').getTime();
  let s = C.emptyState();
  s.cards.push(C.newCard({ front: '进程和线程的区别？', back: '资源分配单位 / 调度单位' }, 'space_1', at(TODAY), 'user'));
  const id = s.cards[0].id;
  assert.deepEqual([s.cards[0].due, s.cards[0].stage], [TODAY, 0]);
  assert.equal(C.dueCards(s, TODAY).length, 1);
  const seen = [];
  let day = TODAY;
  for (let i = 0; i < 7; i++) { s = C.reviewCard(s, id, true, at(day)); day = s.cards[0].due; seen.push(C.daysBetween(TODAY, day)); }
  assert.deepEqual(seen, [1, 3, 7, 14, 29, 59, 89]); // gaps of 1, 2, 4, 7, 15, 30, then 30 again
  assert.equal(s.cards[0].stage, C.CARD_INTERVALS.length);
  s = C.reviewCard(s, id, false, at(day));
  assert.deepEqual([s.cards[0].stage, s.cards[0].due], [0, C.addDays(day, 1)]);
  assert.deepEqual(s.cards[0].reviews.map((r) => r.ok), [true, true, true, true, true, true, true, false]);
  assert.equal(C.dueCards(s, day, 'space_1').length, 0);
  assert.equal(C.dueCards(s, C.addDays(day, 1), 'space_2').length, 0);
  assert.equal(C.dueCards(s, C.addDays(day, 1), 'space_1').length, 1);
  const stats = C.cardStats(s, day);
  assert.deepEqual([stats.total, stats.recentAnswers, stats.recentRemembered], [1, 1, 0]); // only the last answer falls in the 14 days before `day`
  assert.throws(() => C.reviewCard(s, 'missing', true, 1), /已不存在/);
});

test('the assistant can propose cards, which need both a question and an answer', () => {
  const s = C.emptyState();
  const checked = C.validateActions(s, [
    { type: 'add_cards', space: '学习', cards: [{ front: 'FCFS 是什么？', back: '先来先服务' }, { front: '只有问题', back: '' }, 'nope'] },
    { type: 'add_cards', cards: [] },
  ]);
  assert.deepEqual(checked.actions, [{ type: 'add_cards', cards: [{ front: 'FCFS 是什么？', back: '先来先服务' }], spaceId: 'space_1' }]);
  assert.equal(checked.rejected.length, 1);
  s.messages.push({ id: 'm', role: 'assistant', text: '', proposal: { status: 'pending', source: 'ai', actions: checked.actions } });
  const next = C.resolveProposal(s, 'm', true, new Date(TODAY + 'T09:00:00').getTime());
  assert.deepEqual([next.cards.length, next.cards[0].due, next.cards[0].origin, next.cards[0].spaceId], [1, TODAY, 'ai', 'space_1']);
  assert.equal(C.buildContext(next, TODAY, 'hi').reviewCards.dueToday, 1);
  assert.equal(C.buildContext(C.emptyState(), TODAY, 'hi').reviewCards, undefined);
});

test('a v3 backup is recognised and converted, and what has no home is reported', () => {
  const v3 = { app: 'tplan', v: 1, planningVersion: 1,
    tasks: [{ id: 'a', title: '复习高数', cat: 'math', date: TODAY, est: 45, done: true, doneAt: 1700000000000, pin: true, createdAt: 1, sectionId: 'sec1', next: '从例 5 开始' }, { id: 'b', title: '写报告', date: null, week: '2026-11-11', est: 60 }, { id: 'c', title: '  ' }],
    sessions: [{ id: 's', date: TODAY, minutes: 30, title: '复习高数', taskId: 'a', start: new Date(TODAY + 'T10:05:00').getTime(), note: '做了例题' }, { id: 'bad', date: 'x', minutes: 5 }],
    notes: [{ id: 'n', date: TODAY, text: '卡在积分', at: 5 }], trees: [{ id: 't' }], proposals: [{}, {}],
    settings: { cap: 180, taskSections: [{ id: 'sec1', name: '高等数学' }] },
    reviewEntries: { 'day:2026-11-13': { reflection: '今天不错', next: '继续' } }, weekPlans: { '2026-11-09': { focus: '期中复习', capacityMin: 900 } } };
  assert.equal(C.isV3Export(v3), true);
  assert.equal(C.isV3Export(C.emptyState()), false);
  assert.equal(C.isV3Export({ tasks: [] }), false);
  const { state: s, report } = C.convertV3(v3);
  assert.deepEqual(report, { tasks: 2, sessions: 1, reflections: 2, spaces: 1, weekPlans: 1, skippedTrees: 1, skippedSessions: 1, skippedProposals: 2 });
  const section = s.spaces.find((x) => x.name === '高等数学');
  assert.deepEqual(s.tasks.map((t) => [t.title, t.date, t.week, t.minutes, t.done, t.spaceId, t.next]), [['复习高数', TODAY, undefined, 45, true, section.id, '从例 5 开始'], ['写报告', null, '2026-11-09', 60, false, null, undefined]]);
  assert.deepEqual([s.sessions[0].taskId, s.sessions[0].actual, s.sessions[0].startTime, s.sessions[0].hour, s.sessions[0].manual, s.sessions[0].note], [s.tasks[0].id, 30, '10:05', 10, true, '做了例题']);
  assert.deepEqual(s.reflections.map((r) => [r.date, r.text]), [['2026-11-13', '今天不错\n\n下次从哪里继续：继续'], [TODAY, '卡在积分']]);
  assert.deepEqual(s.weekPlans, { '2026-11-09': { focus: '期中复习', capacity: 900 } });
  assert.equal(s.settings.prefs.dailyMinutes, 180);
  assert.equal(C.normalize(C.clone(s)).tasks.length, 2); // the result is ordinary v4 data
});

test('time can be entered by hand and corrected, without counting as evidence of pace', () => {
  let s = stateWithTask();
  s = C.addSession(s, { taskId: 't1', date: TODAY, minutes: 40, startTime: '19:30', note: '晚自习' }, 1);
  assert.deepEqual([s.sessions[0].title, s.sessions[0].actual, s.sessions[0].manual, s.sessions[0].hour, s.sessions[0].spaceId, s.sessions[0].note], ['Read chapter 3', 40, true, 19, 'space_1', '晚自习']);
  assert.throws(() => C.addSession(s, { date: TODAY, minutes: 10 }, 1), /做了什么/);
  assert.throws(() => C.addSession(s, { title: 'x', date: TODAY, minutes: 0 }, 1), /1–1440/);
  assert.throws(() => C.addSession(s, { title: 'x', date: 'nope', minutes: 5 }, 1), /日期/);
  // Three timer sessions give a pace; hand-entered and corrected ones are left out of it.
  for (let i = 0; i < 3; i++) s.sessions.push({ id: 'k' + i, taskId: 't1', title: 'Read chapter 3', step: 'x', spaceId: 'space_1', planned: 20, actual: 30, date: TODAY, hour: 9, endedAt: 1, partial: false });
  assert.equal(C.buildProfile(s, TODAY).actualVsPlanned, 1.5);
  s = C.updateSession(s, 'k0', { title: 'Read chapter 3', taskId: 't1', date: TODAY, minutes: 60 });
  assert.deepEqual([s.sessions[1].actual, s.sessions[1].planned, s.sessions[1].edited], [60, 20, true]);
  assert.equal(C.buildProfile(s, TODAY).actualVsPlanned, undefined); // only two untouched timer sessions remain
  assert.throws(() => C.updateSession(s, 'gone', { title: 'x', date: TODAY, minutes: 5 }), /已不存在/);
  // The assistant may log time only with a real number of minutes.
  const checked = C.validateActions(s, [{ type: 'log_time', title: '复习高数', minutes: 40 }, { type: 'log_time', taskId: 't1', minutes: 25, date: '2026-11-13' }, { type: 'log_time', title: 'x', minutes: 'some' }]);
  assert.deepEqual(checked.actions.map((a) => [a.title, a.minutes, a.date, a.taskId]), [['复习高数', 40, null, null], ['Read chapter 3', 25, '2026-11-13', 't1']]);
  assert.equal(checked.rejected.length, 1);
});

test('a sitting can be written up: what was done stays on the record, where to continue on the task', () => {
  const start = new Date(TODAY + 'T10:00:00').getTime();
  let s = C.startTimer(stateWithTask(), 't1', start);
  s = C.stopTimer(s, start + 6 * MIN);
  const id = s.sessions[0].id;
  s = C.wrapUp(s, { taskId: 't1', sessionId: id, did: '看完 3.1 节', stuck: '例 4 没懂', next: '  从例 4 重新看 ' });
  assert.deepEqual([s.sessions[0].note, s.sessions[0].stuck, s.tasks[0].next], ['看完 3.1 节', '例 4 没懂', '从例 4 重新看']);
  assert.equal(C.buildContext(s, TODAY, 'hi').openTasks[0].continueFrom, '从例 4 重新看');
  assert.equal(C.history(s, TODAY, 7).sessions[0].stuck, '例 4 没懂');
  s = C.wrapUp(s, { taskId: 't1', sessionId: id, did: '', stuck: '', next: '' });
  assert.deepEqual([s.sessions[0].note, s.sessions[0].stuck, s.tasks[0].next], [undefined, undefined, undefined]);
});

test('the week: tasks move between days and the undated column, and the totals keep plan and record apart', () => {
  const monday = C.weekStart(TODAY);
  let s = stateWithTask();
  s.tasks[0].time = '09:00';
  s = C.moveTask(s, 't1', { week: TODAY });
  assert.deepEqual([s.tasks[0].date, s.tasks[0].week, s.tasks[0].time], [null, monday, undefined]);
  assert.deepEqual(C.normalize(C.clone(s)).tasks[0].week, monday);
  let w = C.weekSummary(s, monday);
  assert.deepEqual([w.scheduled, w.unscheduled, w.planned, w.capacity], [0, 40, 40, null]);
  s = C.moveTask(s, 't1', { date: '2026-11-12' });
  assert.deepEqual([s.tasks[0].date, s.tasks[0].week], ['2026-11-12', undefined]);
  s.settings.prefs.dailyMinutes = 5;
  s.sessions.push({ id: 's', taskId: 't1', title: 'x', step: 'x', planned: 10, actual: 12, date: '2026-11-12', hour: 9, endedAt: 1, partial: false });
  w = C.weekSummary(s, monday);
  assert.deepEqual([w.scheduled, w.recorded, w.capacity, w.capacityIsDefault, w.over], [40, 12, 35, true, 5]);
  s = C.setWeekPlan(s, monday, { focus: '期中复习\n交报告', capacity: '600' });
  w = C.weekSummary(s, monday);
  assert.deepEqual([w.focus, w.capacity, w.capacityIsDefault, w.over], ['期中复习\n交报告', 600, false, 0]);
  assert.equal(C.setWeekPlan(s, monday, { capacity: null }).weekPlans[monday].capacity, null);
  assert.throws(() => C.setWeekPlan(s, monday, { capacity: -5 }), /0–10080/);
  assert.equal(C.buildContext(s, TODAY, 'hi').thisWeek.focus, '期中复习\n交报告');
  assert.deepEqual([C.moveTask(s, 't1', {}).tasks[0].date, C.moveTask(s, 't1', {}).tasks[0].week], [null, undefined]);
});

test('dates and times are read the way they are written, and nothing is guessed', () => {
  const when = (text) => { const r = C.parseWhen(text, TODAY); return [r.date, r.time, r.minutes]; }; // TODAY is Saturday 2026-11-14
  assert.deepEqual(when('明天下午3点'), ['2026-11-15', '15:00', null]);
  assert.deepEqual(when('下周一'), ['2026-11-16', null, null]);
  assert.deepEqual(when('下下周三 9:15'), ['2026-11-25', '09:15', null]);
  assert.deepEqual(when('11/20 19:00'), ['2026-11-20', '19:00', null]);
  assert.deepEqual(when('三天后'), ['2026-11-17', null, null]);
  assert.deepEqual(when('两周后'), ['2026-11-28', null, null]);
  assert.deepEqual(when('一个月后'), ['2026-12-14', null, null]);
  assert.deepEqual(when('今晚八点'), [TODAY, '20:00', null]);
  assert.deepEqual(when('明早7点'), ['2026-11-15', '07:00', null]);
  assert.deepEqual(when('后天上午10点半 40分钟'), ['2026-11-16', '10:30', 40]);
  assert.deepEqual(when('2026-12-25 下午两点一刻'), ['2026-12-25', '14:15', null]);
  assert.deepEqual(when('周末'), [TODAY, null, null]);
  assert.deepEqual(when('昨天 50分钟'), ['2026-11-13', null, 50]);
  assert.deepEqual(when('一个半小时'), [null, null, 90]);
  assert.deepEqual(when('2小时30分'), [null, null, 150]);
  // A bare "3点" in a plan is the afternoon; a written "3:00" is kept. A time alone means today.
  assert.deepEqual(when('3点'), [TODAY, '15:00', null]);
  assert.deepEqual(when('3:00'), [TODAY, '03:00', null]);
  assert.deepEqual(when('晚上12点'), ['2026-11-15', '00:00', null]);
  // Nothing recognisable gives nothing; a period of the day without a clock time is not turned into one.
  assert.deepEqual([C.parseWhen('看书', TODAY).understood, C.parseWhen('25点', TODAY).understood], [false, false]);
  assert.deepEqual(when('明天上午'), ['2026-11-15', null, null]);
  // Numbers that belong to the title are left in it.
  assert.deepEqual(C.parseLine('做第2题', TODAY), { type: 'add_task', title: '做第2题', date: null, minutes: 30, space: null });
  assert.deepEqual(C.parseLine('复习第3章 明天下午3点 1.5小时', TODAY), { type: 'add_task', title: '复习第3章', date: '2026-11-15', time: '15:00', minutes: 90, space: null });
});

test('the longer view sums recorded time by day, week and space, and never invents any', () => {
  const s = C.emptyState(); // TODAY is Saturday 2026-11-14; its week starts Monday 2026-11-09
  const add = (date, actual, spaceId) => s.sessions.push({ id: 'x' + s.sessions.length, taskId: null, title: 'x', step: 'x', spaceId, planned: actual, actual, date, hour: 9, endedAt: 1, partial: false });
  add(TODAY, 30, 'space_1'); add(TODAY, 20, 'space_2'); add('2026-11-10', 40, 'space_1'); add('2026-11-03', 60, null); // last four weeks
  add('2026-10-10', 90, 'space_2'); add('2026-10-12', 15, 'gone');                                                  // the four weeks before
  add('2026-01-01', 500, 'space_1');                                                                                // too old for any of the views
  const t = C.trajectory(s, TODAY);
  assert.equal(t.heat.length, 140);
  assert.deepEqual([t.heat[0].date, t.heat[139].date], ['2026-06-29', '2026-11-15']);
  assert.deepEqual(t.heat.filter((d) => d.minutes).map((d) => [d.date, d.minutes]), [['2026-10-10', 90], ['2026-10-12', 15], ['2026-11-03', 60], ['2026-11-10', 40], [TODAY, 50]]);
  assert.equal(t.heat[139].minutes, null); // tomorrow has not happened: no value, not zero
  assert.equal(t.recordedDays, 5);
  assert.deepEqual(t.weeks.slice(-2).map((w) => [w.monday, w.minutes, w.activeDays]), [['2026-11-02', 60, 1], ['2026-11-09', 90, 2]]);
  assert.equal(t.weeks.length, 12);
  // One axis per space with time in either period; a record whose space is gone counts as unfiled.
  assert.deepEqual(t.balance.axes.map((a) => [a.name, a.recent, a.previous]), [['项目', 20, 90], ['未分区', 60, 15], ['学习', 70, 0]]);
  assert.deepEqual([t.balance.recentTotal, t.balance.previousTotal], [150, 105]);
  // With nothing recorded the axes are padded to three so the shape can be drawn, all at zero.
  const empty = C.trajectory(C.emptyState(), TODAY);
  assert.deepEqual([empty.balance.axes.length, empty.balance.recentTotal, empty.recordedDays], [3, 0, 0]);
  const two = C.emptyState(); two.spaces = two.spaces.slice(0, 2);
  assert.equal(C.trajectory(two, TODAY).balance, null);
});

test('money: income adds, spending takes away, and what was not spent only fills the piggy bank', () => {
  let s = C.emptyState();
  s = C.setMoneySettings(s, { opening: '1000', monthly: '1500' });
  s = C.addMoney(s, { kind: 'out', amount: 15, date: TODAY, category: '餐饮', note: '奶茶', time: '10:00' }, 1);
  s = C.addMoney(s, { kind: 'in', amount: '200', date: TODAY, category: '兼职', time: '12:00' }, 2);
  s = C.addMoney(s, { kind: 'out', amount: 300.456, date: TODAY, category: '购物', time: '15:00' }, 3);
  s = C.addMoney(s, { kind: 'saved', amount: 15, date: TODAY, category: '餐饮', note: '奶茶' }, 4);
  s = C.addMoney(s, { kind: 'out', amount: 50, date: '2026-11-12', category: '交通' }, 5);
  s = C.addMoney(s, { kind: 'out', amount: 80, date: '2026-10-30', category: '餐饮' }, 6); // last month
  const m = C.moneySummary(s, TODAY);
  assert.equal(m.balance, 754.54); // 1000 − 15 + 200 − 300.46 − 50 − 80; the 15 not spent changes nothing
  assert.deepEqual(m.today, { in: 200, out: 315.46 });
  assert.deepEqual(m.month, { in: 200, out: 365.46, net: -165.46, saved: 15, savedCount: 1 });
  assert.deepEqual(m.budget, { monthly: 1500, spent: 365.46, left: 1134.54, daysLeft: 17, perDay: 66.74, over: 0 });
  assert.deepEqual(m.piggy, { total: 15, count: 1 });
  // Without a monthly allowance there is no budget; overspending is reported, not hidden.
  assert.equal(C.moneySummary(C.setMoneySettings(s, { monthly: '' }), TODAY).budget, null);
  assert.deepEqual([C.moneySummary(C.setMoneySettings(s, { monthly: 300 }), TODAY).budget.over, C.moneySummary(C.setMoneySettings(s, { monthly: 300 }), TODAY).budget.perDay], [65.46, 0]);
  // An opening date leaves earlier entries listed but out of the balance.
  assert.equal(C.moneySummary(C.setMoneySettings(s, { openingDate: '2026-11-01' }), TODAY).balance, 834.54);
  assert.throws(() => C.addMoney(s, { kind: 'out', amount: 0, date: TODAY }, 1), /大于 0/);
  assert.throws(() => C.addMoney(s, { kind: 'gift', amount: 5, date: TODAY }, 1), /收入、支出/);
  assert.throws(() => C.updateMoney(s, 'gone', { kind: 'out', amount: 5, date: TODAY }), /已不存在/);
  const id = s.money.entries[0].id;
  assert.equal(C.moneySummary(C.updateMoney(s, id, { kind: 'out', amount: 25, date: TODAY, category: '餐饮' }), TODAY).balance, 744.54);
  assert.equal(C.normalize(C.clone(s)).money.entries.length, 6);
  // The assistant only sees money when the user allows it.
  assert.equal(C.buildContext(s, TODAY, 'hi').money, undefined);
  assert.equal(C.buildContext(C.setMoneySettings(s, { share: true }), TODAY, 'hi').money.balance, 754.54);
});

test('money: the balance is drawn as candles that follow the entries in order', () => {
  let s = C.setMoneySettings(C.emptyState(), { opening: 1000 });
  s = C.addMoney(s, { kind: 'out', amount: 50, date: '2026-11-12', category: '交通' }, 1);
  s = C.addMoney(s, { kind: 'out', amount: 300, date: TODAY, category: '购物', time: '15:00' }, 2); // written first, happened last
  s = C.addMoney(s, { kind: 'in', amount: 200, date: TODAY, category: '兼职', time: '12:00' }, 3);
  s = C.addMoney(s, { kind: 'out', amount: 15, date: TODAY, category: '餐饮', time: '10:00' }, 4);
  s = C.addMoney(s, { kind: 'saved', amount: 99, date: TODAY, category: '购物' }, 5);
  const days = C.moneyCandles(s, TODAY, 'day', 3);
  assert.deepEqual(days.map((c) => [c.start, c.open, c.close, c.high, c.low, c.in, c.out, c.entries]), [
    ['2026-11-12', 1000, 950, 1000, 950, 0, 50, 1],
    ['2026-11-13', 950, 950, 950, 950, 0, 0, 0],
    [TODAY, 950, 835, 1135, 835, 200, 315, 3], // 950 → 935 → 1135 → 835
  ]);
  const weeks = C.moneyCandles(s, TODAY, 'week', 2);
  assert.deepEqual(weeks.map((c) => [c.start, c.end, c.open, c.close, c.high, c.low]), [['2026-11-02', '2026-11-08', 1000, 1000, 1000, 1000], ['2026-11-09', TODAY, 1000, 835, 1135, 835]]);
  const flow = C.moneyFlow(s, '2026-11-01', TODAY);
  assert.deepEqual(flow.out.items.map((x) => [x.category, x.amount]), [['购物', 300], ['交通', 50], ['餐饮', 15]]);
  assert.deepEqual([flow.out.total, flow.in.total, flow.saved.total], [365, 200, 99]);
});

test('money: a line of chat becomes an entry only when it clearly is one', () => {
  const read = (text) => { const r = C.parseMoney(text, TODAY); return r && [r.kind, r.amount, r.category, r.note, r.date]; };
  assert.deepEqual(read('花了15买奶茶'), ['out', 15, '餐饮', '奶茶', null]);
  assert.deepEqual(read('收到生活费1500'), ['in', 1500, '生活费', '生活费', null]);
  assert.deepEqual(read('忍住没买奶茶 15块'), ['saved', 15, '餐饮', '奶茶', null]);
  assert.deepEqual(read('昨天打车花了23.5'), ['out', 23.5, '交通', '打车', '2026-11-13']);
  assert.deepEqual(read('买书 45元'), ['out', 45, '学习', '书', null]);
  assert.equal(read('买3本书'), null);          // a task, not three yuan
  assert.equal(read('复习高数 2小时'), null);
  assert.equal(read('花了2小时复习'), null);     // time, not money
  assert.deepEqual(C.localReply('花了15买奶茶\n买菜\n复习 30分钟', TODAY).actions.map((a) => a.type), ['log_money', 'add_task', 'add_task']);
  const checked = C.validateActions(C.emptyState(), [{ type: 'log_money', kind: 'out', amount: 15, category: '餐饮', note: '奶茶' }, { type: 'log_money', kind: 'out', amount: 'some' }]);
  assert.deepEqual([checked.actions.length, checked.rejected.length, checked.actions[0].date], [1, 1, null]);
});

test('tags: cleaned, kept through normalize, read from a typed line', () => {
  assert.deepStrictEqual(C.cleanTags('#考试, 作业  考试 ＃复习'), ['考试', '作业', '复习']);
  assert.deepStrictEqual(C.cleanTags(['a', 'b', 'c', 'd', 'e', 'f', 'g']).length, 6);
  const s = C.emptyState();
  s.tasks.push({ id: 't1', title: 'x', date: null, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: 1, tags: ['#考试', '', '考试', 5] });
  s.tasks.push({ id: 't2', title: 'y', date: null, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: 1, tags: [] });
  const n = C.normalize(JSON.parse(JSON.stringify(s)));
  assert.deepStrictEqual(n.tasks[0].tags, ['考试']);
  assert.strictEqual('tags' in n.tasks[1], false);
  const line = C.parseLine('明天 复习单片机 40分钟 #考试 #单片机', TODAY);
  assert.deepStrictEqual(line.tags, ['考试', '单片机']);
  assert.strictEqual(line.title, '复习单片机');
});

test('parseTaskLine picks a space by @name and reports defaults', () => {
  const s = C.emptyState();
  const r = C.parseTaskLine(s, '明天下午3点 复习单片机 40分钟 @学习 #考试', TODAY);
  assert.strictEqual(r.task.spaceId, 'space_1');
  assert.strictEqual(r.task.time, '15:00');
  assert.strictEqual(r.minutesGiven, true);
  const plain = C.parseTaskLine(s, '买洗衣液 @不存在', TODAY, 'space_4');
  assert.strictEqual(plain.task.date, null);
  assert.strictEqual(plain.task.spaceId, 'space_4');
  assert.strictEqual(plain.unknownSpace, '不存在');
  assert.strictEqual(plain.minutesGiven, false);
  assert.ok(C.parseTaskLine(s, '#只有标签', TODAY).error);
});

test('repeat phrases are read into rules', () => {
  const s = C.emptyState();
  const D = '2026-11-16'; // a Monday
  const rule = (line) => C.parseTaskLine(s, line, D).repeat;
  assert.deepStrictEqual(rule('每周四 交实验报告 30分钟 #作业').rule, { kind: 'weekly', start: D, days: [4], every: 1 });
  assert.strictEqual(rule('每周四 交实验报告 30分钟 #作业').title, '交实验报告');
  assert.deepStrictEqual(rule('每周一三五 跑步').rule.days, [1, 3, 5]);
  assert.deepStrictEqual(rule('每周二、四 健身').rule.days, [2, 4]);
  assert.deepStrictEqual(rule('每周一到周五 早读').rule.days, [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(rule('工作日 晨读').rule.days, [1, 2, 3, 4, 5]);
  assert.strictEqual(rule('每两周周四 组会').rule.every, 2);
  assert.strictEqual(rule('每天晚上8点 背单词 20分钟').time, '20:00');
  assert.strictEqual(rule('每晚8点 背单词').time, '20:00');
  assert.deepStrictEqual(rule('每隔一天 复习错题').rule, { kind: 'interval', start: D, every: 2 });
  assert.strictEqual(rule('每3天 整理笔记').rule.every, 3);
  assert.deepStrictEqual(rule('每月1号 交房租').rule, { kind: 'monthly', start: D, day: 1 });
  const ranged = rule('从下周一开始 每天 跑步 到12月31日').rule;
  assert.strictEqual(ranged.start, '2026-11-23');
  assert.strictEqual(ranged.until, '2026-12-31');
  assert.ok(C.parseTaskLine(s, '每周 跑步3次', D).error);
  assert.ok(C.parseTaskLine(s, '每周三次 跑步', D).error); // a count, not Wednesday
  assert.deepStrictEqual(rule('每周三 跑步').rule.days, [3]);
  assert.strictEqual(C.parseTaskLine(s, '明天 复习', D).task.date, '2026-11-17');
  assert.deepStrictEqual(C.nextOccurrences(rule('每两周周四 组会').rule, D, 3), ['2026-11-19', '2026-12-03', '2026-12-17']);
  assert.deepStrictEqual(C.nextOccurrences({ kind: 'monthly', start: '2027-01-01', day: 31 }, '2027-02-01', 2), ['2027-02-28', '2027-03-31']);
  assert.strictEqual(C.repeatLabel(rule('每周一三五 跑步').rule), '每周一、三、五');
});

test('repeat rules make a week of tasks, never remake deleted ones, and clear missed untouched ones', () => {
  const D = '2026-11-16';
  let s = C.addRepeat(C.emptyState(), { title: '背单词', minutes: 20, time: '20:00', tags: ['英语'], rule: { kind: 'daily', start: D } }, D, 1);
  const made = s.tasks.filter((t) => t.repeatId);
  assert.strictEqual(made.length, 7);
  assert.deepStrictEqual(made.map((t) => t.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.strictEqual(made[0].time, '20:00');
  assert.deepStrictEqual(made[0].tags, ['英语']);
  // deleting one: it does not come back on the next run
  s.tasks = s.tasks.filter((t) => t.date !== '2026-11-18');
  s = C.materializeRepeats(s, D, 2).state;
  assert.ok(!s.tasks.some((t) => t.date === '2026-11-18'));
  // two days later: the 16th was never started and is cleared; the 17th was timed and stays
  const timed = s.tasks.find((t) => t.date === '2026-11-17');
  s.sessions.push({ id: 's1', taskId: timed.id, date: '2026-11-17', actual: 10 });
  const later = C.materializeRepeats(s, '2026-11-19', 3);
  assert.ok(!later.state.tasks.some((t) => t.repeatDate === '2026-11-16'));
  assert.ok(later.state.tasks.some((t) => t.repeatDate === '2026-11-17'));
  assert.strictEqual(later.removed, 1);
  assert.strictEqual(later.added, 3); // the 23rd to the 25th: the first run made up to the 22nd
  // editing changes untouched instances from today on; stopping removes them and leaves the rest as plain tasks
  const id = later.state.repeats[0].id;
  const edited = C.updateRepeat(later.state, id, { title: '背单词 Unit 5', minutes: 25, rule: { kind: 'weekly', days: [3], start: D } }, '2026-11-19', 4);
  assert.deepStrictEqual(edited.tasks.filter((t) => t.repeatId && t.repeatDate >= '2026-11-19').map((t) => [t.date, t.title, t.minutes]), [['2026-11-25', '背单词 Unit 5', 25]]);
  assert.ok(edited.tasks.some((t) => t.id === timed.id && t.title === '背单词')); // the started one keeps its old title
  const stopped = C.stopRepeat(edited, id, '2026-11-19');
  assert.strictEqual(stopped.repeats.length, 0);
  assert.ok(stopped.tasks.every((t) => !t.repeatId));
  assert.ok(stopped.tasks.some((t) => t.id === timed.id));
  // normalize keeps a valid rule and drops links to rules that are gone
  const round = C.normalize(JSON.parse(JSON.stringify({ ...later.state, repeats: [...later.state.repeats, { id: 'bad', title: 'x', rule: { kind: 'weekly', days: [] } }] })));
  assert.strictEqual(round.repeats.length, 1);
  const orphan = C.normalize(JSON.parse(JSON.stringify({ ...later.state, repeats: [] })));
  assert.ok(orphan.tasks.every((t) => !t.repeatId && !t.repeatDate));
});

test('quick add reads exam dates and money lines', () => {
  const s = C.emptyState();
  s.spaces.push({ id: 'os', name: '操作系统', color: '#000', type: 'study', course: '操作系统' });
  const d = C.parseDateLine(s, '操作系统期末考试 12月20日 9:00 @二东402', TODAY);
  assert.deepStrictEqual(d.item, { title: '操作系统期末考试', date: '2026-12-20', place: '二东402', spaceId: 'os', time: '09:00' });
  assert.ok(C.parseDateLine(s, '期末考试', TODAY).error);
  assert.deepStrictEqual(C.parseMoneyLine('奶茶 15', TODAY).entry, { kind: 'out', amount: 15, category: '餐饮', note: '奶茶', date: TODAY });
  assert.strictEqual(C.parseMoneyLine('收到生活费 1500', TODAY).entry.kind, 'in');
  assert.strictEqual(C.parseMoneyLine('+200 兼职', TODAY).entry.category, '兼职');
  assert.strictEqual(C.parseMoneyLine('忍住没买奶茶 15', TODAY).entry.kind, 'saved');
  assert.strictEqual(C.parseMoneyLine('昨天 打车 32', TODAY).entry.date, '2026-11-13');
  assert.ok(C.parseMoneyLine('奶茶', TODAY).error);
});

test('free slots sit between classes and timed tasks; late tasks spread over days with room', () => {
  const s = C.emptyState();
  s.schedule.settings = { semesterStart: '2026-09-07', weekCount: 20, periods: [] };
  s.schedule.courses.push({ id: 'c1', title: '电路', weekday: 6, weeks: '1-20', startTime: '10:00', endTime: '11:35', date: '', periods: '', room: '', teacher: '' });
  s.tasks.push({ id: 'timed', title: '组会', date: TODAY, time: '14:00', minutes: 60, spaceId: null, done: false, doneAt: null, createdAt: 1 });
  const all = C.freeSlots(s, TODAY);
  assert.deepStrictEqual(all.slots.map((x) => x.start + '-' + x.end), ['08:00-10:00', '11:35-14:00', '15:00-22:00']);
  const afternoon = C.freeSlots(s, TODAY, { now: 14 * 60 + 30 });
  assert.deepStrictEqual(afternoon.slots.map((x) => x.start + '-' + x.end), ['15:00-22:00']);
  assert.strictEqual(afternoon.free, 420);
  // spreading: today has 30 minutes of room, tomorrow 120
  for (const [id, minutes, date] of [['a', 60, '2026-11-10'], ['b', 30, '2026-11-12'], ['c', 200, '2026-11-11']]) s.tasks.push({ id, title: id, date, minutes, spaceId: null, done: false, doneAt: null, createdAt: 2 });
  s.dates.push({ id: 'exam', title: '期末', date: '2026-11-20', spaceId: 'space_1' });
  s.tasks.find((t) => t.id === 'b').spaceId = 'space_1'; // its space has an exam soon, so it goes first
  const plan = C.spreadTasks(s, ['a', 'b', 'c'], TODAY, { daily: 120, todayFree: 90 });
  assert.deepStrictEqual(plan.moves.map((m) => [m.taskId, m.to, m.over]), [['b', TODAY, false], ['a', '2026-11-15', false], ['c', '2026-11-16', true]]);
  // a task that only fits after its exam is kept before it, even if that overfills the day
  s.dates.push({ id: 'soon', title: '测验', date: '2026-11-15', spaceId: 'space_2' });
  s.tasks.push({ id: 'd', title: 'd', date: '2026-11-10', minutes: 100, spaceId: 'space_2', done: false, doneAt: null, createdAt: 3 });
  const tight = C.spreadTasks(s, ['d'], TODAY, { daily: 120, todayFree: 90 });
  assert.deepStrictEqual(tight.moves.map((m) => [m.to, m.over, m.deadlineIn]), [[TODAY, true, 1]]);
  const moved = C.applySpread(s, plan.moves);
  assert.strictEqual(moved.tasks.find((t) => t.id === 'a').date, '2026-11-15');
});

test('trajectory compares time by tag, counting a record toward each tag of its task', () => {
  const s = C.emptyState();
  s.tasks.push({ id: 'a', title: 'x', tags: ['考试', '单片机'], date: null, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: 1 });
  s.sessions.push({ id: 's1', taskId: 'a', date: TODAY, actual: 40 }, { id: 's2', taskId: null, date: TODAY, actual: 20 });
  const tags = C.trajectory(s, TODAY).tags;
  assert.deepStrictEqual(tags.axes.map((a) => [a.name, a.recent]), [['#单片机', 40], ['#考试', 40], ['没有标签', 20]]);
  assert.strictEqual(tags.recentTotal, 60);
  assert.strictEqual(tags.overlap, true);
  assert.strictEqual(C.trajectory(C.emptyState(), TODAY).tags, null);
});

test('reviewSummary reads a period: totals, busiest weekday and hour, areas, task ranking, the period before', () => {
  const s = C.emptyState();
  s.tasks.push({ id: 'a', title: '复习单片机', date: null, minutes: 30, spaceId: 'space_1', done: true, doneAt: new Date('2026-11-12T10:00:00').getTime(), createdAt: 1 });
  s.sessions.push(
    { id: '1', taskId: 'a', title: '复习单片机', date: '2026-11-11', actual: 50, spaceId: 'space_1', hour: 14 },
    { id: '2', taskId: 'a', title: '复习单片机', date: '2026-11-12', actual: 30, spaceId: 'space_1', hour: 14 },
    { id: '3', taskId: null, title: '看论文', date: '2026-11-12', actual: 20, spaceId: null, hour: null },
    { id: '4', taskId: null, title: '更早', date: '2026-11-05', actual: 45, spaceId: null, hour: 9 });
  const r = C.reviewSummary(s, '2026-11-09', '2026-11-15');
  assert.strictEqual(r.total, 100);
  assert.strictEqual(r.previous, 45);
  assert.strictEqual(r.activeDays, 2);
  assert.strictEqual(r.done, 1);
  assert.strictEqual(r.series.length, 7);
  assert.deepStrictEqual(r.series[3], { from: '2026-11-12', to: '2026-11-12', minutes: 50, done: 1 });
  assert.strictEqual(r.bestWeekday, 2); // Wednesday the 11th: 50 against Thursday's 50 — the earlier one wins a tie
  assert.deepStrictEqual(r.peakHour, { hour: 14, minutes: 80 });
  assert.deepStrictEqual(r.areas.map((a) => [a.name, a.minutes]), [['学习', 80], ['未分区', 20]]);
  assert.deepStrictEqual(r.tasks.map((t) => [t.title, t.minutes, t.sessions]), [['复习单片机', 80, 2], ['看论文', 20, 1]]);
  const weekly = C.reviewSummary(s, '2026-11-02', '2026-11-15', { bucket: 'week' });
  assert.deepStrictEqual(weekly.series.map((x) => x.minutes), [45, 100]);
  assert.strictEqual(C.reviewSummary(C.emptyState(), '2026-11-09', '2026-11-15').bestWeekday, null);
});

test('the assistant can propose a repeating task and tags; context carries both', () => {
  let s = C.emptyState();
  const { actions: accepted, rejected } = C.validateActions(s, [
    { type: 'add_repeat', title: '交实验报告', repeat: '每周四', minutes: 30, space: '学习', tags: ['#作业'] },
    { type: 'add_repeat', title: '跑步', repeat: '每周三次' },
    { type: 'add_task', title: '复习', date: TODAY, minutes: 40, tags: ['考试', '考试'] },
  ]);
  assert.strictEqual(rejected.length, 1);
  assert.deepStrictEqual(accepted[0].rule.days, [4]);
  assert.deepStrictEqual(accepted[0].tags, ['作业']);
  assert.deepStrictEqual(accepted[1].tags, ['考试']);
  s.messages.push({ id: 'm1', role: 'assistant', at: 1, text: '', proposal: { status: 'pending', actions: accepted } });
  s = C.resolveProposal(s, 'm1', true);
  assert.strictEqual(s.repeats.length, 1);
  assert.ok(s.tasks.some((t) => t.repeatId === s.repeats[0].id));
  const ctx = C.buildContext(s, TODAY, { message: 'x' });
  assert.deepStrictEqual(ctx.repeatingTasks.map((r) => r.repeat), ['每周四']);
  assert.ok(ctx.tagsInUse.includes('考试'));
  assert.ok(ctx.openTasks.some((t) => t.fromRepeat) && ctx.openTasks.some((t) => t.tags && t.tags[0] === '考试'));
});

test('tags can be renamed, merged and deleted everywhere', () => {
  const s = C.emptyState();
  const task = (id, tags) => s.tasks.push({ id, title: id, date: null, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: 1, tags });
  task('a', ['考试', '复习']); task('b', ['考式']); task('c', ['考式', '考试']);
  s.repeats.push({ id: 'r', title: 'x', minutes: 30, spaceId: null, tags: ['考式'], rule: { kind: 'daily', start: TODAY }, madeUntil: null, createdAt: 1 });
  const merged = C.renameTag(s, '考式', '考试');
  assert.deepStrictEqual(merged.tasks.map((t) => t.tags), [['考试', '复习'], ['考试'], ['考试']]);
  assert.deepStrictEqual(merged.repeats[0].tags, ['考试']);
  const gone = C.deleteTag(merged, '考试');
  assert.deepStrictEqual(gone.tasks.map((t) => t.tags), [['复习'], undefined, undefined]);
  assert.throws(() => C.renameTag(s, '考试', '  '));
});

test('estimates come from finished, timed tasks: the middle ratio, by space when it has enough', () => {
  const s = C.emptyState();
  const add = (id, planned, actual, spaceId, extra = {}) => { s.tasks.push({ id, title: id, date: null, minutes: planned, spaceId, done: true, doneAt: 1, createdAt: 1, ...extra }); s.sessions.push({ id: 's' + id, taskId: id, date: TODAY, actual, planned, spaceId }); };
  for (let i = 0; i < 4; i++) add('a' + i, 40, 60, 'space_1');
  assert.strictEqual(C.estimateFactor(s, 'space_1'), null); // four are not enough
  add('a4', 40, 300, 'space_1'); // one runaway task does not move the middle
  assert.deepStrictEqual(C.estimateFactor(s, 'space_1'), { factor: 1.5, tasks: 5, scope: 'space' });
  assert.strictEqual(C.estimateFactor(s, 'space_2').scope, 'all');
  assert.deepStrictEqual(C.suggestMinutes(s, 40, 'space_1'), { factor: 1.5, tasks: 5, scope: 'space', minutes: 60 });
  // time added on the timer raises task.minutes; the first estimate is what counts
  const t = C.emptyState(); t.tasks.push({ id: 'x', title: 'x', date: null, minutes: 25, spaceId: null, done: false, doneAt: null, createdAt: 1, steps: [{ title: 'x', minutes: 25, done: false }] });
  const timing = C.extendTimer(C.startTimer(t, 'x', 1000), 5);
  assert.strictEqual(timing.tasks[0].minutes, 30); assert.strictEqual(timing.tasks[0].estimate, 25);
  const close = C.emptyState(); for (let i = 0; i < 5; i++) { close.tasks.push({ id: 'c' + i, title: 'c', date: null, minutes: 40, spaceId: null, done: true, doneAt: 1, createdAt: 1 }); close.sessions.push({ id: 'k' + i, taskId: 'c' + i, date: TODAY, actual: 42 }); }
  assert.strictEqual(C.suggestMinutes(close, 40), null); // close to the plan: say nothing
});

test('a task keeps a note through normalize', () => {
  const s = C.emptyState();
  s.tasks.push({ id: 'a', title: 'a', date: null, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: 1, note: '  要求见 https://example.com/hw3  ' }, { id: 'b', title: 'b', date: null, minutes: 30, spaceId: null, done: false, doneAt: null, createdAt: 1, note: '   ' });
  const n = C.normalize(JSON.parse(JSON.stringify(s)));
  assert.strictEqual(n.tasks[0].note, '要求见 https://example.com/hw3');
  assert.strictEqual('note' in n.tasks[1], false);
});
