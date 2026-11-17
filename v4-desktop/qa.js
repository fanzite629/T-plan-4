(async () => {
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const P = window.TPlanPlatform;
  const C = window.TPlanCore;
  const read = () => JSON.parse(P.loadState());
  const post = (value) => window.chrome.webview.postMessage(value);
  const click = (text) => {
    const el = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === text);
    if (!el) throw new Error('找不到按钮：' + text);
    el.click();
  };
  try {
    assert(P.name === 'desktop', '桌面桥接初始化');
    assert(document.querySelector('#main').children.length > 0, '主界面完成渲染');
    assert(getComputedStyle(document.querySelector('#shell')).display !== 'block', '样式资源加载');
    if (sessionStorage.getItem('qa-timetable-complete')) {
      checks.unshift(...JSON.parse(sessionStorage.getItem('qa-timetable-complete')));
      assert(read().schedule.courses.length === 3 && read().schedule.settings.periods.length === 4, '课表与学校时间重新加载后保留');
      assert([...document.querySelectorAll('.tt-day-card, .tt-day-past')].some(el => el.textContent.includes('当天测试课')), '重新加载后当天课程正常显示');
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
    assert(P.loadKey('deepseek') === 'qa-fake-key-a', '重新加载后加密密钥可读取');
    P.openFloating();
    await delay(500);
    post({ kind: 'qa-check-mini' });
    await delay(500);
    assert(read().timer.phase === 'paused', '原生小窗暂停命令同步到主界面');
    click('继续');
    click('暂停');
    assert(read().timer.phase === 'paused', '暂停计时并持久化');
    click('继续');
    assert(read().timer.phase === 'running', '恢复计时并持久化');
    click('+5 分');
    assert(read().tasks[0].steps[0].minutes === 10, '分段加时保存');
    click('下一段');
    assert(read().timer.step === 1, '下一段同步');
    click('完成');
    assert(read().timer === null && read().tasks[0].done, '完成任务并结束计时');
    document.querySelector('#openSettings').click();
    assert(document.querySelector('#panel').open, '设置面板打开');
    P.saveKey('deepseek', ''); P.saveKey('openai', '');
    assert(P.loadKey('deepseek') === '' && P.loadKey('openai') === '', '删除测试密钥');
    await window.runTimetableQa(assert);
    sessionStorage.setItem('qa-timetable-complete', JSON.stringify(checks));
    location.reload();
  } catch (error) { post({ kind: 'qa-result', ok: false, checks, error: error.stack || error.message }); }
})();
