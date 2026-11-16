const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./js/core.js');
const Agent = require('./js/agent.js');
const values = { name: ' 测试昵称 ', purposes: ['project', 'habit'], segment: 37, pace: 'spacious', reminderMode: 'quiet', dailyMinutes: 120 };

test('fresh onboarding is shown, but old records and interview completion are never interrupted', () => {
  assert.equal(C.needsOnboarding(C.emptyState()), true);
  for (const key of ['tasks', 'messages', 'sessions', 'dates', 'memory', 'goals', 'habits', 'reflections', 'cards', 'metrics']) {
    const s = C.emptyState(); s[key].push({ id: 'existing' }); assert.equal(C.needsOnboarding(s), false, key);
  }
  const s = C.emptyState(); s.settings.prefs.onboarded = true; assert.equal(C.needsOnboarding(s), false);
  s.settings.prefs.onboarded = false; s.schedule.courses.push({ id: 'existing-course' }); assert.equal(C.needsOnboarding(s), false);
});
test('preferences are atomic, validate inputs and preserve every personal record including a paused timer', () => {
  const s = C.emptyState();
  s.tasks.push({ id: 'a', title: '已有任务', date: '2026-11-16', minutes: 60, steps: [{ title: '已完成', minutes: 20, done: true }, { title: '进行中', minutes: 40, done: false }] });
  s.timer = { taskId: 'a', step: 1, phase: 'paused', acc: 222222, lastAt: 12, startedAt: 1 };
  s.schedule.courses.push({ id: 'old-course', periods: '5-6', startTime: '13:30', endTime: '15:05' });
  s.settings.prefs.bestTime = '晚上'; s.settings.prefs.railCompact = true;
  const before = structuredClone(s), after = C.savePreferences(s, values);
  assert.deepEqual(s, before);
  for (const key of Object.keys(before).filter(k => k !== 'settings')) assert.deepEqual(after[key], before[key], key);
  assert.deepEqual(after.settings.agent, before.settings.agent);
  assert.equal(after.settings.prefs.bestTime, '晚上'); assert.equal(after.settings.prefs.railCompact, true);
  assert.equal(after.settings.prefs.name, '测试昵称'); assert.equal(after.settings.prefs.welcomeVersion, 1);
  for (const bad of [0, 91, 15.5, '', 'x', Infinity]) assert.throws(() => C.savePreferences(s, { ...values, segment: bad }));
  for (const bad of [0, -1, 961, 1.2, 'x']) assert.throws(() => C.savePreferences(s, { ...values, dailyMinutes: bad }));
  assert.throws(() => C.savePreferences(s, { ...values, pace: 'bad' }));
  assert.throws(() => C.savePreferences(s, { ...values, pace: '__proto__' }));
  assert.throws(() => C.savePreferences(s, { ...values, purposes: ['bad'] }));
  assert.throws(() => C.savePreferences(s, { ...values, reminderMode: 'bad' }));
  const skipped = C.savePreferences(s, { ...values, segment: 0 }, true);
  assert.equal(skipped.settings.prefs.segment, 25); assert.equal(skipped.settings.prefs.name, '');
  assert.equal(skipped.settings.prefs.onboarded, true); assert.equal(C.needsOnboarding(skipped), false);
  const oldBudget = C.emptyState(); oldBudget.settings.prefs.dailyMinutes = 120;
  const skippedOld = C.savePreferences(oldBudget, values, true);
  assert.equal(C.planningPreferences(skippedOld.settings.prefs).dailyFocusMinutes, 120, 'skipping must not activate a new workload policy');
});
test('all task entry defaults respect focus preference, explicit durations and totals survive segmentation', () => {
  const s = C.savePreferences(C.emptyState(), values);
  assert.equal(C.parseTaskLine(s, '写报告', '2026-11-16').task.minutes, 37);
  assert.equal(C.parseTaskLine(s, '写报告 四十分钟', '2026-11-16').task.minutes, 40);
  assert.equal(C.parseTaskLine(s, '写报告 四十分钟', '2026-11-16').minutesGiven, true);
  assert.equal(C.validateActions(s, [{ type: 'add_task', title: '报告' }]).actions[0].minutes, 37);
  const reply = C.localReply('报告 61分钟', '2026-11-16', s.settings.prefs);
  assert.equal(reply.actions[0].steps.reduce((sum, step) => sum + step.minutes, 0), 61);
  assert.ok(reply.actions[0].steps.every(step => step.minutes <= 37));
  assert.match(reply.reply, /休息 10 分钟/);
  assert.equal(C.localReply('报告', '2026-11-16', s.settings.prefs).actions[0].minutes, 37);
  for (let minutes = 1; minutes <= 1440; minutes++) {
    const steps = C.splitIntoSteps(minutes, 25, '内容');
    assert.equal(steps.reduce((n, x) => n + x.minutes, 0), minutes);
    assert.ok(steps.every(x => x.minutes > 0)); assert.ok(steps.length <= 12);
  }
  s.tasks.push({ id: 'a', title: '工作', minutes: 61, done: false });
  const started = C.startTimer(s, 'a', Date.now());
  assert.deepEqual(started.tasks[0].steps.map(x => x.minutes), [31, 30]);
  const changed = C.savePreferences(started, { ...values, segment: 15 });
  assert.deepEqual(changed.timer, started.timer); assert.deepEqual(changed.tasks, started.tasks);
});
test('pace changes usable planning capacity, not existing schedules or explicit weekly capacity', () => {
  const s = C.savePreferences(C.emptyState(), values);
  assert.equal(C.planningPreferences(s.settings.prefs).dailyFocusMinutes, 78);
  assert.equal(C.weekSummary(s, '2026-11-16').capacity, 546);
  const focused = C.savePreferences(s, { ...values, pace: 'focused' });
  assert.equal(C.planningPreferences(focused.settings.prefs).dailyFocusMinutes, 108);
  assert.equal(C.planningPreferences({ ...values, dailyMinutes: null }).dailyFocusMinutes, null);
  assert.equal(C.planningPreferences({ ...values, preferencesConfigured: true, dailyMinutes: 1 }).dailyFocusMinutes, 1);
  const explicit = C.setWeekPlan(s, '2026-11-16', { capacity: 1000 });
  assert.equal(C.weekSummary(explicit, '2026-11-16').capacity, 1000);
  assert.equal(C.planningPreferences({ segment: 25, dailyMinutes: 120 }).dailyFocusMinutes, 120, 'old profile keeps its previous budget');
});
test('reminder modes gate sound, toast and native dispatch consistently', () => {
  const events = ['start', 'end', 'schedule'];
  for (const [mode, expected] of [['quiet', [false, false, false]], ['end', [false, true, false]], ['start-end', [true, true, true]]]) {
    assert.deepEqual(events.map(event => C.shouldNotify({ reminderMode: mode }, event)), expected);
  }
  const old = C.emptyState(); delete old.settings.prefs.reminderMode;
  assert.equal(C.normalize(old).settings.prefs.reminderMode, 'start-end');
  const malformed = C.emptyState(); Object.assign(malformed.settings.prefs, { pace: 'unknown', purposes: null, reminderMode: 'unknown' });
  const repaired = C.normalize(malformed).settings.prefs;
  assert.deepEqual(repaired.purposes, []); assert.equal(repaired.pace, 'balanced'); assert.equal(repaired.reminderMode, 'end');
});
test('actual model request receives selected purposes, pacing and focus limit', async () => {
  const s = C.savePreferences(C.emptyState(), values);
  const context = C.buildContext(s, '2026-11-16', '安排今天', null);
  let sent;
  await Agent.run({ context, attachments: [], library: new Map(), chat: async (system, user) => {
    sent = JSON.parse(user); assert.match(system, /planningPolicy.dailyFocusMinutes/);
    return '{"reply":"建议先推进项目","actions":[]}';
  } });
  assert.equal(sent.planningPolicy.dailyFocusMinutes, 78);
  assert.equal(sent.planningPolicy.segment, 37);
  assert.deepEqual(sent.planningPolicy.purposes, ['项目推进', '习惯养成']);
});
