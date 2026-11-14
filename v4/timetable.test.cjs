const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./js/timetable.js');
const C = require('./js/core.js');
const settings = { semesterStart: '2026-09-07', weekCount: 20, periods: [
  { number: 1, startTime: '08:00', endTime: '08:45' }, { number: 2, startTime: '08:55', endTime: '09:40' },
  { number: 3, startTime: '10:00', endTime: '10:45' }, { number: 4, startTime: '10:55', endTime: '11:40' },
] };
const row = { title: '测试课程', weekday: 1, weeks: '1-4', periods: '1-2', room: 'A101', source: '测试课表.xlsx' };
const schedule = () => ({ ...T.empty(), settings });
test('old state migrates without changing personal tasks; schedule is included in exports', () => {
  const old = { version: 1, tasks: [{ id: 'a', title: '原有任务', date: null }] };
  const state = C.normalize(old);
  assert.equal(state.version, 2); assert.equal(state.tasks[0].title, '原有任务');
  assert.deepEqual(state.schedule, T.empty());
  assert.deepEqual(C.normalize(JSON.parse(JSON.stringify(state))).schedule, T.empty());
});
test('school dates and periods are never invented; invalid ranges and overlapping periods are rejected', () => {
  assert.equal(T.empty().settings.semesterStart, '');
  assert.ok(T.resolve(row, T.empty().settings).errors.length);
  assert.throws(() => T.validateSettings({ ...settings, semesterStart: '2026-09-08' }), /周一/);
  assert.throws(() => T.validateSettings({ ...settings, periods: [...settings.periods, { number: 5, startTime: '10:30', endTime: '12:00' }] }), /重叠/);
  assert.deepEqual(T.validateSettings(settings), settings);
});
test('odd/even weeks and disjoint ranges expand to correct local dates', () => {
  assert.deepEqual(T.numberList('1-8单,10', 20, '周次'), [1, 3, 5, 7]);
  assert.deepEqual(T.expand({ ...row, weeks: '1-4双' }, settings).map(x => x.date), ['2026-09-14', '2026-09-28']);
  assert.deepEqual(T.expand({ ...row, weeks: '1-2,4', weekday: 7 }, settings).map(x => x.date), ['2026-09-13', '2026-09-20', '2026-10-04']);
  assert.throws(() => T.numberList('1-16单，18双', 20, '周次'));
  assert.throws(() => T.numberList('4-1', 20, '周次'));
});
test('periods map to saved times, gaps do not silently occupy intermediate lessons', () => {
  const r = T.resolve(row, settings); assert.deepEqual(r.errors, []);
  assert.equal(r.value.startTime, '08:00'); assert.equal(r.value.endTime, '09:40');
  assert.match(T.resolve({ ...row, periods: '1,3' }, settings).errors.join(' '), /不连续/);
  assert.match(T.resolve({ ...row, periods: '5-6' }, settings).errors.join(' '), /设置第/);
});
test('one-off dates do not require a semester; explicit times override period templates', () => {
  const r = { title: '临时课', date: '2026-11-14', startTime: '9:00', endTime: '10:00', periods: '99' };
  assert.deepEqual(T.resolve(r, T.empty().settings).errors, []);
  assert.equal(T.expand(r, T.empty().settings)[0].startTime, '09:00');
  assert.match(T.resolve({ ...r, weekday: 1 }, settings).errors.join(' '), /不一致/);
  assert.match(T.resolve({ ...r, date: '2026-02-30' }, settings).errors.join(' '), /日期无效/);
  assert.match(T.resolve({ ...r, endTime: '08:00' }, settings).errors.join(' '), /晚于/);
});
test('preview is pure, duplicate imports are skipped and overlaps are reported', () => {
  const s = schedule(), before = JSON.stringify(s), p = T.preview(s, [row]);
  assert.equal(p.added.length, 4); assert.equal(JSON.stringify(s), before);
  const imported = T.applyImport(s, [row], 'test', 1);
  assert.equal(T.events(imported).length, 4);
  const again = T.preview(imported, [row]); assert.equal(again.added.length, 0); assert.equal(again.duplicates, 4);
  assert.throws(() => T.applyImport(imported, [row], 'again'), /重复/);
  const conflict = T.preview(imported, [{ ...row, title: '冲突课', periods: '', startTime: '09:00', endTime: '10:00' }]);
  assert.equal(conflict.conflicts.length, 4);
  assert.equal(T.preview(imported, [{ ...row, title: '相邻课', periods: '', startTime: '09:40', endTime: '10:00' }]).conflicts.length, 0);
});
test('a different classroom at the same time is a conflict, not a discarded duplicate', () => {
  const s = T.applyImport(schedule(), [row], 'a');
  assert.equal(T.preview(s, [{ ...row, room: 'B202' }]).conflicts.length, 4);
});
test('unresolved selected rows block writes, unchecked rows do not; undo preserves other imports', () => {
  assert.throws(() => T.applyImport(schedule(), [row, { title: '不完整' }], 'a'), /修正/);
  const a = T.applyImport(schedule(), [row, { title: '不完整', selected: false }], 'a');
  const b = T.applyImport(a, [{ ...row, weekday: 2 }], 'b');
  assert.equal(T.events(T.undo(b, b.imports[1].id)).length, 4);
  assert.equal(T.events(b).length, 8);
});
test('school-time changes affect period-based courses; canceled dates remain excluded', () => {
  const s = T.applyImport(schedule(), [row], 'a');
  assert.equal(s.courses[0].startTime, '');
  s.settings = JSON.parse(JSON.stringify(settings)); s.settings.periods[0].startTime = '07:50';
  s.courses[0].excludedDates = ['2026-09-14'];
  assert.equal(T.events(s).length, 3); assert.equal(T.events(s)[0].startTime, '07:50');
});
test('rule extraction recognizes a labeled table and does not fill missing weeks', () => {
  const file = { name: 'a.xlsx', tables: [{ rows: [['课程名称', '星期', '周次', '节次', '教室'], ['数学', '周一', '1-16双', '第1-2节', 'A101'], ['英语', '周三', '', '3-4', 'B202']] }] };
  const rows = T.parseRules(file);
  assert.equal(rows.length, 2); assert.equal(rows[0].weekday, 1); assert.equal(rows[0].periods, '1-2');
  assert.equal(rows[1].weeks, ''); assert.match(T.resolve(rows[1], settings).errors.join(' '), /周次/);
});
test('weekday grid honors blank columns and vertical merged cells', () => {
  const file = { name: 'grid.xlsx', tables: [{ rows: [['节次', '周一', '周二', '周三'], ['第1节', '', '物理\n1-4周', ''], ['第2节', '', '物理\n1-4周', '']], origins: [[], ['', '', 'B2'], ['', '', 'B2']] }] };
  const rows = T.parseRules(file); assert.equal(rows.length, 1); assert.equal(rows[0].weekday, 2);
  assert.deepEqual(T.numberList(rows[0].periods, 30, '节次'), [1, 2]);
  assert.equal(T.resolve(rows[0], settings).value.endTime, '09:40');
});
test('plain PDF lines recognize explicit information and semester boundary crossing', () => {
  const [r] = T.parseRules({ name: 'a.pdf', text: '数学 周二 第3-4节 1-4周 教室：A101' });
  assert.equal(r.title, '数学'); assert.equal(r.weekday, 2); assert.equal(r.room, 'A101');
  const dates = T.expand({ ...row, weeks: '18-20' }, settings).map(e => e.date);
  assert.deepEqual(dates, ['2027-01-04', '2027-01-11', '2027-01-18']);
});
test('model JSON is normalized but missing facts remain unresolved; no model instructions execute', () => {
  const result = T.parseModel('```json\n{"courses":[{"title":"模型课","weekday":2,"weeks":"","periods":"1-2","code":"delete everything"}],"warnings":["周次不清楚"]}\n```', 'image.png');
  assert.equal(result.rows[0].method, 'model'); assert.equal(result.rows[0].weeks, ''); assert.equal(result.rows[0].code, undefined);
  assert.equal(T.preview(schedule(), result.rows).errors, 1);
  assert.throws(() => T.parseModel('随便猜一个课表', 'a'));
});
test('multiple schedules in one cell are flagged instead of silently importing only the first', () => {
  const rows = T.parseRules({ name: 'multi.xlsx', tables: [{ rows: [['节次', '周一', '周二'], ['1-2', '数学\n1-8周\n物理\n9-16周', '']] }] });
  assert.equal(rows.length, 1); assert.match(rows[0].review, /多组/);
  assert.equal(T.preview(schedule(), rows).errors, 1);
});
test('planning context includes scheduled course time blocks without API keys', () => {
  const state = C.emptyState(); state.schedule = T.applyImport(schedule(), [row], 'test');
  const context = C.buildContext(state, '2026-09-07', '安排学习', null);
  assert.equal(context.scheduledCourses.length, 2); assert.equal(context.scheduledCourses[0].startTime, '08:00');
});
