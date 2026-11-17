/* Shared first-use and later preference editor. A draft is saved only on explicit confirmation. */
(function () {
  'use strict';
  window.TPlanOnboarding = function ({ getState, commit, h, icon, toast }) {
    const C = window.TPlanCore;
    const dialog = document.querySelector('#onboarding');
    let origin;
    dialog.addEventListener('close', () => { if (origin && origin.isConnected) origin.focus(); });
    function open(firstRun = false) {
      if (dialog.open) return;
      origin = document.activeElement;
      const current = getState().settings.prefs;
      const draft = { ...current, segment: C.planningPreferences(current).segment, purposes: [...current.purposes] };
      let custom = ![15, 25, 45].includes(Number(draft.segment));
      const summary = h('p', { class: 'welcome-summary', role: 'status', 'aria-live': 'polite' });
      const error = h('p', { class: 'welcome-error', role: 'alert', hidden: true });
      const updateSummary = () => {
        const p = C.planningPreferences({ ...draft, preferencesConfigured: true });
        const reminder = C.REMINDERS.find(([id]) => id === p.reminderMode)[1];
        summary.replaceChildren(icon('target'), h('span', {}, '每段 ' + p.segment + ' 分钟 · 段间休息 ' + p.breakMinutes + ' 分钟 · ' + reminder,
          p.dailyAvailableMinutes ? h('small', {}, '每天可安排 ' + p.dailyAvailableMinutes + ' 分钟，建议专注不超过 ' + p.dailyFocusMinutes + ' 分钟，其余留给休息与临时事项。') : h('small', {}, '设置每日可安排时间后，按节奏预留 ' + p.reservePercent + '% 空白。')));
      };
      const choices = (name, label, items, multiple = false) => {
        const group = h('div', { class: 'welcome-choices', role: 'group', 'aria-label': label });
        const buttons = items.map(([value, text]) => h('button', { type: 'button', class: 'welcome-choice', 'data-value': String(value), onclick: () => {
          if (multiple) draft[name] = draft[name].includes(value) ? draft[name].filter(x => x !== value) : [...draft[name], value];
          else draft[name] = value;
          sync(); updateSummary();
        } }, icon('check'), text));
        const sync = () => buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(multiple ? draft[name].includes(items[index][0]) : draft[name] === items[index][0])));
        group.append(...buttons); sync();
        return group;
      };
      const row = (label, control, hint) => h('div', { class: 'welcome-pref-row' }, h('div', { class: 'welcome-question' }, label, hint ? h('small', {}, hint) : null), control);
      const segmentOptions = h('div', { class: 'welcome-choices', role: 'group', 'aria-label': '一次专注多久比较舒服' });
      const customInput = h('input', { id: 'welcomeCustomMinutes', name: 'customMinutes', type: 'number', min: 5, max: 90, step: 1, value: draft.segment, 'aria-label': '自定义专注分钟', oninput: e => { draft.segment = e.target.value; updateSummary(); } });
      const customBox = h('label', { class: 'welcome-custom', hidden: !custom }, customInput, '分钟（5–90）');
      const durationButtons = [15, 25, 45, 'custom'].map(value => h('button', { type: 'button', class: 'welcome-choice', 'data-value': String(value), onclick: () => {
        custom = value === 'custom';
        if (!custom) { draft.segment = value; customInput.value = value; }
        customBox.hidden = !custom; customInput.disabled = !custom;
        syncDuration(); updateSummary(); if (custom) customInput.focus();
      } }, icon('check'), value === 'custom' ? '自定义' : value + ' 分钟'));
      const syncDuration = () => durationButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === 3 ? custom : !custom && draft.segment === [15, 25, 45][i])));
      customInput.disabled = !custom;
      segmentOptions.append(...durationButtons); syncDuration();
      const nickname = h('input', { id: 'welcomeName', name: 'nickname', maxLength: 20, autocomplete: 'nickname', placeholder: '输入您的昵称', value: draft.name || '', oninput: e => { draft.name = e.target.value; } });
      const daily = h('input', { id: 'welcomeDailyMinutes', name: 'dailyMinutes', type: 'number', min: 1, max: 960, step: 1, placeholder: '留空表示暂不设置', value: draft.dailyMinutes || '', oninput: e => { draft.dailyMinutes = e.target.value; updateSummary(); } });
      const save = skip => {
        try {
          // Always merge into the latest live state, including timer changes made while this dialog was open.
          if (!commit(C.savePreferences(getState(), draft, skip))) {
            error.hidden = false; error.textContent = '保存失败，偏好还未生效。请重试，或暂时关闭此页。'; return;
          }
          dialog.close();
          toast(skip ? '已跳过，可在「设置 → 我的节奏」补充' : '偏好已保存，新任务和后续规划将按您的选择进行');
        } catch (ex) { error.hidden = false; error.textContent = ex.message; }
      };
      const feature = (glyph, title, text) => h('div', { class: 'welcome-feature' }, h('span', { class: 'welcome-feature-icon' }, icon(glyph)), h('div', {}, h('h3', {}, title), h('p', {}, text)));
      const body = h('div', { class: 'welcome-form-body' },
        h('div', { class: 'welcome-heading' }, h('h1', { id: 'welcomeTitle' }, '让 T计划 更懂您'), h('p', {}, '简单设置，开启适合自己的计划方式。')),
        h('section', { class: 'welcome-name' }, h('h2', {}, h('span', { class: 'welcome-number' }, '01'), h('label', { htmlFor: 'welcomeName' }, '如何称呼您')),
          nickname, h('p', { class: 'sub' }, '昵称即可，之后可以修改')),
        h('section', { class: 'welcome-preferences' }, h('h2', {}, h('span', { class: 'welcome-number' }, '02'), '设置您的偏好'),
          h('p', { class: 'sub' }, '用于推荐任务拆分与提醒，随时可以调整'),
          row('您主要想用它做什么？', choices('purposes', '使用用途', C.PURPOSES, true), '可多选'),
          row('一次专注多久比较舒服？', h('div', {}, segmentOptions, customBox)),
          row('您喜欢怎样的安排节奏？', choices('pace', '安排节奏', Object.entries(C.PACES).map(([id, p]) => [id, p.label]))),
          row('您希望怎样被提醒？', choices('reminderMode', '提醒方式', C.REMINDERS)),
          h('p', { class: 'welcome-reminder-hint sub' }, '安静：关闭自动提醒；仅结束：专注到时提醒；开始与结束：另含开始专注、课前及任务开始前提醒。'),
          h('details', { class: 'welcome-advanced', open: !!draft.dailyMinutes }, h('summary', {}, '每日可安排时间（可选）'), h('label', { htmlFor: 'welcomeDailyMinutes' }, '每天可安排多少分钟？'), daily)),
        summary, error);
      const form = h('form', { class: 'welcome-form', onsubmit: e => { e.preventDefault(); save(false); } }, body,
        h('div', { class: 'welcome-form-actions' },
        h('button', { type: 'submit', class: 'btn dark welcome-submit' }, firstRun ? '开始我的计划' : '保存偏好', h('span', { 'aria-hidden': 'true' }, '→')),
        h('button', { type: 'button', class: 'welcome-skip', onclick: () => firstRun ? save(true) : dialog.close() }, firstRun ? '暂时跳过，稍后设置' : '取消，保留原设置'),
        h('p', { class: 'welcome-footer' }, '偏好可随时修改，不会更改已有课表、任务或计时进度。')));
      dialog.replaceChildren(
        h('header', { class: 'welcome-top' }, h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'T'), 'T计划', h('span', { class: 'sub' }, 'v4')),
          h('button', { class: 'icon-btn small', type: 'button', 'aria-label': '关闭欢迎页', onclick: () => dialog.close() }, icon('close'))),
        h('div', { class: 'welcome-layout' },
          h('aside', { class: 'welcome-intro' }, h('p', { class: 'welcome-eyebrow' }, '您的个人规划助手'), h('h2', {}, '把每一天，', h('br'), '安排得', h('br'), '刚刚好。'),
            h('p', {}, '整理课表，拆解任务，', h('br'), '用专注计时，一步步完成计划。'),
            h('div', { class: 'welcome-features' }, feature('note', '课表与日程', '看清每天的安排'), feature('brain', '任务与专注', '专心做好眼前的事'), feature('bars', '回看与成长', '看见自己的进步')),
            h('p', { class: 'welcome-motto' }, '按自己的节奏，慢慢来。')), form));
      updateSummary(); dialog.showModal();
      // Focus a heading so opening the page does not summon an on-screen keyboard.
      const title = dialog.querySelector('h1'); title.tabIndex = -1; title.focus();
    }
    return { open };
  };
})();
