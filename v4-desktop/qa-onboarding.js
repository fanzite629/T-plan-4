/* Runs only in --self-test's newly created isolated SQLite profile. */
window.runOnboardingQa = async function (assert) {
  const P = window.TPlanPlatform, C = window.TPlanCore, bridge = window.chrome.webview;
  const read = () => JSON.parse(P.loadState());
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const dialog = () => document.querySelector('#onboarding');
  const button = (root, name) => [...root.querySelectorAll('button')].find(b => b.textContent.replace(/→/g, '').trim() === name);
  const fill = (selector, value) => { const input = dialog().querySelector(selector); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const choose = (group, text) => button(dialog().querySelector('[aria-label="' + group + '"]'), text).click();
  const open = () => {
    document.querySelector('#openSettings').click();
    button(document.querySelector('#panel'), '我的节奏').click();
    button(document.querySelector('#panel'), '称呼与偏好设置').click();
  };
  const request = (kind, data = {}) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { bridge.removeEventListener('message', onMessage); reject(new Error('Native QA request timed out: ' + kind)); }, 5000);
    const onMessage = event => { if (event.data.kind === kind) { clearTimeout(timeout); bridge.removeEventListener('message', onMessage); resolve(event.data); } };
    bridge.addEventListener('message', onMessage); bridge.postMessage({ kind, ...data });
  });
  const stage = sessionStorage.getItem('qa-welcome-stage');
  if (stage === 'done') return true;
  for (const label of JSON.parse(sessionStorage.getItem('qa-welcome-checks') || '[]')) assert(true, label);
  const remember = next => { sessionStorage.setItem('qa-welcome-stage', next); };
  if (!stage) {
    assert(dialog().open && dialog().textContent.includes('设置您的偏好'), '全新数据自动打开完整欢迎页');
    assert(!P.loadState(), '打开欢迎页不提前写入数据');
    assert(dialog().scrollWidth <= dialog().clientWidth + 1, '桌面欢迎页无横向溢出');
    const actionBox = dialog().querySelector('.welcome-submit').getBoundingClientRect();
    assert(actionBox.top >= 0 && actionBox.bottom < innerHeight, '高缩放小窗口中保存按钮始终可见');
    await request('qa-capture', { name: 'onboarding-first-use' });
    await request('qa-resize', { width: 1920, height: 1280 }); await wait(200);
    await request('qa-capture', { name: 'onboarding-desktop' });
    fill('[name="nickname"]', '不应保存的草稿');
    choose('一次专注多久比较舒服', '自定义'); fill('[name="customMinutes"]', '0');
    const originalSave = P.saveState;
    P.saveState = () => { throw new Error('模拟存储空间不足'); };
    try {
      button(dialog(), '暂时跳过，稍后设置').click();
      assert(dialog().open && !P.loadState() && !dialog().querySelector('.welcome-error').hidden, '保存失败保留欢迎页与草稿，不把未保存偏好标为完成');
    } finally { P.saveState = originalSave; }
    button(dialog(), '暂时跳过，稍后设置').click();
    assert(!dialog().open && read().settings.prefs.name === '' && read().settings.prefs.segment === 25 && read().settings.prefs.welcomeVersion === 1, '跳过忽略未确认草稿并持久化完成标记');
    remember('skipped'); return false;
  }
  if (stage === 'skipped') {
    assert(!dialog().open, '跳过后重新启动不重复弹出欢迎页');
    open(); fill('[name="nickname"]', '验收昵称');
    choose('使用用途', '项目推进'); choose('使用用途', '习惯养成');
    choose('一次专注多久比较舒服', '自定义'); fill('[name="customMinutes"]', '37');
    choose('安排节奏', '多留空白'); choose('提醒方式', '保持安静');
    dialog().querySelector('details').open = true; fill('[name="dailyMinutes"]', '120');
    assert(dialog().querySelector('.welcome-summary').textContent.includes('78 分钟'), '节奏预览实际按 35% 留白计算每日专注上限');
    assert(read().settings.prefs.name === '', '偏好点选是草稿，保存前不写入');
    fill('[name="customMinutes"]', '0'); button(dialog(), '保存偏好').click();
    assert(dialog().open && read().settings.prefs.segment === 25, '自定义时长越界被阻止');
    fill('[name="customMinutes"]', '37'); button(dialog(), '保存偏好').click();
    const p = read().settings.prefs;
    assert(p.segment === 37 && p.pace === 'spacious' && p.reminderMode === 'quiet' && p.purposes.join(',') === 'project,habit' && p.name === '验收昵称', '偏好保存到独立桌面数据库');
    assert(document.querySelector('.home-head').textContent.includes('验收昵称') && document.querySelector('.starters').textContent.includes('项目拆成几个阶段'), '称呼和用途立即改变问候与推荐入口');
    const quick = document.querySelector('.home-today .quick-add');
    quick.value = '偏好默认时长任务'; quick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(read().tasks.find(t => t.title === '偏好默认时长任务')?.minutes === 37, '工作台实际新建任务采用自定义专注时长');
    open(); fill('[name="nickname"]', '取消的修改'); button(dialog(), '取消，保留原设置').click();
    assert(read().settings.prefs.name === '验收昵称', '设置入口取消保留原偏好');
    const initial = C.normalize(read());
    initial.tasks.push({ id: 'qa-pref-timer', title: '偏好计时验收', date: C.todayISO(), spaceId: null, goalId: null, minutes: 2, done: false, steps: [{ title: '第一步', minutes: 1, done: false }, { title: '第二步', minutes: 1, done: false }] });
    const timed = C.pauseTimer(C.startTimer(initial, 'qa-pref-timer', Date.now()), Date.now());
    P.saveState(JSON.stringify(timed));
    remember('saved'); return false;
  }
  assert(!dialog().open && read().settings.prefs.segment === 37, '重启后自定义偏好保留且不重复欢迎页');
  const before = read();
  open(); choose('安排节奏', '均衡安排'); button(dialog(), '保存偏好').click();
  assert(JSON.stringify(read().timer) === JSON.stringify(before.timer) && JSON.stringify(read().tasks) === JSON.stringify(before.tasks) && JSON.stringify(read().schedule) === JSON.stringify(before.schedule), '修改偏好完整保留现有任务、课表及暂停计时字段');
  const count = async () => (await request('qa-notification-count')).count;
  const clickDock = name => { const b = button(document.querySelector('#dock'), name) || document.querySelector('#dock button[aria-label="' + name + '"]'); if (!b) throw new Error('Missing dock button ' + name); b.click(); };
  const initialCount = await count(), now = Date.now;
  try {
    clickDock('继续'); Date.now = () => now() + 61000;
    await wait(650);
    assert(await count() === initialCount, '保持安静时到时不发原生通知也不响铃');
  } finally { Date.now = now; }
  clickDock('暂停');
  open(); choose('提醒方式', '仅结束提醒'); button(dialog(), '保存偏好').click();
  clickDock('+5 分'); clickDock('继续');
  try {
    Date.now = () => now() + 400000;
    await wait(650);
    assert(await count() === initialCount + 1, '仅结束提醒在到时通过原生通知桥接发送');
    await wait(650);
    assert(await count() === initialCount + 1, '到时提醒只发送一次，不重复打扰');
  } finally { Date.now = now; }
  clickDock('暂停');
  open(); choose('提醒方式', '开始与结束'); button(dialog(), '保存偏好').click();
  clickDock('结束');
  button(document.querySelector('.home-hero'), '开始计时').click();
  await wait(200);
  assert(await count() === initialCount + 2, '开始与结束模式在真正开始任务时发送原生提醒');
  remember('done');
  return true;
};
