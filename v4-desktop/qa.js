(async () => {
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const P = window.TPlanPlatform;
  const C = window.TPlanCore;
  const read = () => JSON.parse(P.loadState());
  const post = (value) => window.chrome.webview.postMessage(value);
  const clickTimer = (text) => {
    const el = [...document.querySelectorAll('#dock button')].find(x => x.textContent.trim() === text || x.getAttribute('aria-label') === text);
    if (!el) throw new Error('找不到按钮：' + text);
    el.click();
  };
  try {
    assert(P.name === 'desktop', '桌面桥接初始化');
    assert(document.querySelector('#main').children.length > 0, '主界面完成渲染');
    assert(getComputedStyle(document.querySelector('#shell')).display !== 'block', '样式资源加载');
    if (!await window.runOnboardingQa(assert)) {
      sessionStorage.setItem('qa-welcome-checks', JSON.stringify(checks));
      location.reload(); return;
    }
    if (sessionStorage.getItem('qa-timetable-complete')) {
      checks.unshift(...JSON.parse(sessionStorage.getItem('qa-timetable-complete')));
      assert(read().schedule.courses.length === 3 && read().schedule.settings.periods.length === 4, '课表与学校时间重新加载后保留');
      assert(document.querySelector('.tt-day-card')?.textContent.includes('当天测试课'), '重新加载后当天课程正常显示');
      post({ kind: 'qa-result', ok: true, checks });
      return;
    }
    if (!sessionStorage.getItem('qa-reload')) {
      P.saveKey('deepseek', 'qa-fake-key-a');
      P.saveKey('openai', 'qa-fake-key-b');
      assert(P.loadKey('deepseek') === 'qa-fake-key-a' && P.loadKey('openai') === 'qa-fake-key-b', '服务商密钥独立保存');
      const initial = C.emptyState();
      initial.settings.prefs.onboarded = true;
      initial.settings.prefs.name = '独立测试用户';
      initial.tasks.push({ id: 'qa-task', title: '桌面验收任务', date: C.todayISO(new Date()), minutes: 10, spaceId: 'space_1', done: false, steps: [{ title: '第一段', minutes: 5, done: false }, { title: '第二段', minutes: 5, done: false }] });
      P.saveState(JSON.stringify(C.startTimer(initial, 'qa-task', Date.now())));
      sessionStorage.setItem('qa-reload', JSON.stringify(checks));
      location.reload();
      return;
    }
    checks.unshift(...JSON.parse(sessionStorage.getItem('qa-reload')));
    assert(read().settings.prefs.name === '独立测试用户' && read().tasks[0].title === '桌面验收任务', '重新加载后任务与个人设置保留');
    assert(!document.querySelector('#onboarding').open && document.querySelector('.welcome-banner'), '旧用户保留计时进入工作台，仅显示偏好设置入口');
    assert(P.loadKey('deepseek') === 'qa-fake-key-a', '重新加载后加密密钥可读取');
    P.openFloating();
    await delay(500);
    post({ kind: 'qa-check-mini' });
    await delay(500);
    assert(read().timer.phase === 'paused', '原生小窗暂停命令同步到主界面');
    clickTimer('继续');
    clickTimer('暂停');
    assert(read().timer.phase === 'paused', '暂停计时并持久化');
    clickTimer('继续');
    assert(read().timer.phase === 'running', '恢复计时并持久化');
    clickTimer('+5 分');
    assert(read().tasks[0].steps[0].minutes === 10, '分段加时保存');
    clickTimer('下一段');
    assert(read().timer.step === 1, '下一段同步');
    const now = Date.now;
    try {
      Date.now = () => now() + 61000;
      clickTimer('完成');
    } finally { Date.now = now; }
    assert(read().timer === null && read().tasks[0].done, '完成任务并结束计时');
    const recap = [...document.querySelectorAll('dialog[open]')].find(d => d.textContent.includes('这一轮记一笔'));
    assert(recap, '完成计时后打开回顾');
    [...recap.querySelectorAll('button')].find(b => b.textContent.trim() === '跳过').click();
    document.querySelector('button[aria-label="收起导航"]').click();
    assert(read().settings.prefs.railCompact && document.querySelector('#shell').classList.contains('rail-compact'), '新版侧栏收起并保存');
    document.querySelector('button[aria-label="展开导航"]').click();
    document.querySelector('#rail .rail-group[aria-label="视图"] .rail-group-head').click();
    assert(read().settings.prefs.railFolded.views && document.querySelector('#rail .rail-stack'), '新版视图分组折叠');
    document.querySelector('#rail .rail-group[aria-label="视图"] .rail-stack').click();
    assert(!read().settings.prefs.railFolded.views, '新版视图分组展开');
    document.querySelector('button[aria-label="工作台"]').click();
    [...document.querySelectorAll('#main button')].find(b => b.textContent.trim() === '新建任务').click();
    const quick = document.querySelector('dialog[aria-label="快速添加"]');
    const expected = C.addDays(C.todayISO(new Date()), 1);
    const beforeQuick = read().tasks.length;
    assert(quick?.open && quick.querySelector('.composer-input'), '新建任务打开统一输入框');
    const quickInput = quick.querySelector('.composer-input');
    quickInput.value = '明天下午3点 合成验收任务 40分钟 @学习 #验收';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    assert(quick.querySelector('.composer-live').textContent.includes('15:00'), '统一输入框实时预览开始时间');
    quickInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(quick.querySelector('.cp-card')?.textContent.includes('#验收') && read().tasks.length === beforeQuick, '任务与标签先预览，确认前不写入');
    [...quick.querySelectorAll('.cp-actions button')].find(b => b.textContent.trim() === '添加').click();
    const addedTask = read().tasks.find(t => t.title === '合成验收任务');
    assert(read().tasks.length === beforeQuick + 1 && addedTask?.date === expected && addedTask.time === '15:00' && addedTask.minutes === 40 && addedTask.tags.includes('验收'), '统一输入框确认后保存任务、日期、时间与标签');
    [...quick.querySelectorAll('header button')].find(b => b.textContent.trim() === '用表单').click();
    const taskDialog = document.querySelector('#dialog');
    const form = taskDialog.querySelector('form');
    [...taskDialog.querySelectorAll('button')].find(b => b.textContent.trim() === '明天').click();
    assert(form.elements.date.value === expected, '新建任务的明天快捷按钮');
    const when = taskDialog.querySelector('.when-quick');
    when.value = '明天下午3点 40分钟';
    when.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(form.elements.date.value === expected && form.elements.time.value === '15:00' && form.elements.minutes.value === '40', '任务文字输入填写日期、时间和时长');
    taskDialog.close();
    document.querySelector('button[aria-label="回看"]').click();
    assert(document.querySelector('#main .review-scroll')?.textContent.includes('成长轨迹'), '回看页渲染成长轨迹');
    document.querySelector('button[aria-label="收支"]').click();
    [...document.querySelectorAll('#main header button')].find(b => b.textContent.trim() === '记一笔').click();
    taskDialog.querySelector('input[name="amount"]').value = '12.5';
    taskDialog.querySelector('input[name="note"]').value = '合成验收支出';
    [...taskDialog.querySelectorAll('button')].find(b => b.textContent.trim() === '保存').click();
    assert(read().money.entries.some(e => e.kind === 'out' && e.amount === 12.5 && e.note === '合成验收支出') && document.querySelector('#main').textContent.includes('合成验收支出'), '收支页保存并显示测试记录');
    document.querySelector('#openSettings').click();
    assert(document.querySelector('#panel').open, '设置面板打开');
    P.saveKey('deepseek', ''); P.saveKey('openai', '');
    assert(P.loadKey('deepseek') === '' && P.loadKey('openai') === '', '删除测试密钥');
    await window.runTimetableQa(assert);
    sessionStorage.setItem('qa-timetable-complete', JSON.stringify(checks));
    location.reload();
  } catch (error) { post({ kind: 'qa-result', ok: false, checks, error: error.stack || error.message }); }
})();
