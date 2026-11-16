/* Timetable workspace and review-before-save import. Uses the configured platform/model. */
(function () {
  'use strict';
  const T = window.TPlanTimetable;
  window.TPlanTimetableUI = function ({ getState, commit, toast, h, openWorkspace, openTask = () => {}, undoable = (label, apply) => apply(), courses: link = null, compose = null }) {
    let currentWeek = T.weekStart(new Date().toLocaleDateString('sv-SE')), activeDraft = null, jobId = 0;
    const dialog = h('dialog', { class: 'tt-dialog', 'aria-label': '导入课表' });
    const schoolDialog = h('dialog', { class: 'tt-dialog tt-school', 'aria-label': '学期与节次设置' });
    document.body.append(dialog, schoolDialog);
    dialog.addEventListener('close', () => { jobId++; });
    const schedule = () => JSON.parse(JSON.stringify(T.normalize(getState().schedule)));
    const today = () => new Date().toLocaleDateString('sv-SE');
    const btn = (label, fn, cls = 'outline') => h('button', { type: 'button', class: 'btn ' + cls, onclick: fn }, label);
    const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
    function save(value) { const next = JSON.parse(JSON.stringify(getState())); next.schedule = value; return commit(next); }
    function openDialog(el) { if (!el.open) el.showModal(); }
    function courseCard(e) {
      return h('button', { class: 'tt-day-card', onclick: () => details(e), 'aria-label': e.startTime + ' ' + e.title },
        h('strong', {}, e.startTime + '–' + e.endTime), h('span', {}, e.title), h('small', {}, [e.room, e.teacher].filter(Boolean).join(' · ') || '课程'));
    }
    function daily(date) {
      const courses = T.events(schedule(), date, date);
      return courses.length ? [h('h3', { class: 'group-title' }, '当天课程'), ...courses.map(courseCard)] : [];
    }
    function settings(onSaved) {
      const original = schedule().settings;
      let slots = Array.from({ length: Math.max(12, ...original.periods.map(p => +p.number)) }, (_, i) => ({ number: i + 1, startTime: '', endTime: '', ...original.periods.find(p => +p.number === i + 1) }));
      const semester = h('input', { type: 'date', value: original.semesterStart, 'aria-label': '第1教学周周一' });
      const count = h('input', { type: 'number', min: 1, max: 60, value: original.weekCount || '', placeholder: '按校历填写', 'aria-label': '学期周数' });
      const list = h('div', { class: 'tt-slots' });
      function renderSlots() { list.replaceChildren(...slots.map(p => h('div', { class: 'tt-slot' },
        h('strong', {}, '第 ' + p.number + ' 节'),
        h('input', { type: 'time', value: p.startTime, 'aria-label': '第' + p.number + '节开始', oninput: e => { p.startTime = e.target.value; } }),
        h('span', {}, '至'), h('input', { type: 'time', value: p.endTime, 'aria-label': '第' + p.number + '节结束', oninput: e => { p.endTime = e.target.value; } })))); }
      renderSlots();
      const error = h('p', { class: 'tt-error', role: 'alert' });
      schoolDialog.replaceChildren(h('div', { class: 'tt-dialog-head' }, h('h2', {}, '学期与学校节次'), btn('关闭', () => schoolDialog.close(), 'ghost')),
        h('div', { class: 'tt-dialog-body' }, h('p', { class: 'sub' }, '只需设置一次，之后按第几节的课程会自动套用。未提供的时间保持空白。'),
          h('div', { class: 'row' }, field('第 1 教学周的周一', semester), field('学期共几周', count)),
          list, btn('增加一节', () => { if (slots.length < 30) { slots.push({ number: slots.length + 1, startTime: '', endTime: '' }); renderSlots(); } }, 'ghost'),
          h('p', { class: 'sub' }, '修改后，按周次或节次导入的现有课程会按新设置重新计算；原表写明的具体日期和钟点保持不变。'), error),
        h('div', { class: 'tt-dialog-foot' }, btn('保存学校时间', () => {
          try {
            const s = schedule(); s.settings = T.validateSettings({ semesterStart: semester.value, weekCount: count.value, periods: slots });
            const invalid = s.courses.filter(c => T.resolve(c, s.settings).errors.length);
            if (invalid.length) throw new Error('这组设置会使 ' + invalid.length + ' 条已有课程无法排入日程，请补齐所需节次或扩大周数');
            if (save(s)) { schoolDialog.close(); if (onSaved) onSaved(); toast('学期与节次时间已保存'); }
          } catch (e) { error.textContent = e.message; }
        }, 'dark')));
      openDialog(schoolDialog);
    }
    function details(event) {
      const course = schedule().courses.find(c => c.id === event.courseId); if (!course) return;
      dialog.replaceChildren(h('div', { class: 'tt-dialog-head' }, h('h2', {}, event.title), btn('关闭', () => dialog.close(), 'ghost')),
        h('div', { class: 'tt-dialog-body' }, h('p', {}, event.date + ' ' + T.weekdayNames[T.weekday(event.date) - 1] + ' · ' + event.startTime + '–' + event.endTime),
          h('p', {}, [event.room, event.teacher].filter(Boolean).join(' · ') || '未填写教室 / 教师'),
          h('p', { class: 'sub' }, '来源：' + (course.source || '手动填写') + (course.weeks ? ' · 第 ' + course.weeks + ' 周' : '')),
          h('details', {}, h('summary', {}, '查看识别依据'), h('pre', {}, course.evidence || '无原文'))),
        h('div', { class: 'tt-dialog-foot' }, ...(link ? courseActions(course.title) : []), btn('编辑这条课程规则', () => { activeDraft = { rows: [{ ...course, selected: true }], reports: [], editId: course.id }; showPreview(); }),
          btn('取消这一天的课', () => { if (!confirm('仅取消 ' + event.date + ' 这一次课程？')) return; const s = schedule(); const c = s.courses.find(x => x.id === course.id); c.excludedDates = [...new Set([...(c.excludedDates || []), event.date])]; if (undoable('已取消 ' + event.date + ' 的这次课', () => save(s))) dialog.close(); }, 'ghost'),
          btn('删除这条课程规则', () => { if (!confirm('删除这条规则及它展开的所有课程日期？')) return; const s = schedule(); s.courses = s.courses.filter(x => x.id !== course.id); if (undoable('课程规则已删除', () => save(s))) dialog.close(); }, 'danger')));
      openDialog(dialog);
    }
    /* What a course leads to: its space, a new task for it, its exam date. */
    function courseActions(title) {
      const sp = link.spaceFor(title);
      return [
        btn('加任务', () => { dialog.close(); link.addTask(title); }),
        btn('加考试日期', () => { dialog.close(); link.addDate(title); }),
        sp ? btn('打开分区「' + sp.name + '」', () => { dialog.close(); link.openSpace(sp.id); }) : btn('为这门课建分区', () => { if (link.createSpaces([title])) dialog.close(); }),
      ];
    }
    function courseTitles() { return [...new Set(schedule().courses.map(c => c.title).filter(Boolean))]; }
    function coursesDialog() {
      const titles = courseTitles(), s = schedule(), missing = titles.filter(t => !link.spaceFor(t));
      dialog.replaceChildren(h('div', { class: 'tt-dialog-head' }, h('h2', {}, '课程与分区'), btn('关闭', () => dialog.close(), 'ghost')),
        h('div', { class: 'tt-dialog-body' },
          h('p', { class: 'sub' }, '给一门课建分区后，它的任务、考试日期、复习卡片和对话都放在一起；在分区里和助手说话，新建的内容自动归到这门课。'),
          titles.length ? h('div', { class: 'tt-course-list' }, ...titles.map(title => {
            const sp = link.spaceFor(title), rules = s.courses.filter(c => c.title === title);
            return h('div', { class: 'tt-course-row' },
              h('div', {}, h('strong', {}, title), h('small', {}, rules.length + ' 条上课规则' + ([...new Set(rules.map(r => r.teacher).filter(Boolean))].length ? ' · ' + [...new Set(rules.map(r => r.teacher).filter(Boolean))].join('、') : ''))),
              h('div', { class: 'tt-actions' }, btn('加任务', () => { dialog.close(); link.addTask(title); }, 'ghost'), btn('加考试日期', () => { dialog.close(); link.addDate(title); }, 'ghost'),
                sp ? btn('打开「' + sp.name + '」', () => { dialog.close(); link.openSpace(sp.id); }) : btn('建分区', () => { if (link.createSpaces([title])) coursesDialog(); })));
          })) : h('p', { class: 'sub' }, '还没有课程。先导入课表或手动添加。')),
        h('div', { class: 'tt-dialog-foot' }, missing.length ? btn('为还没有分区的 ' + missing.length + ' 门课都建分区', () => { if (link.createSpaces(missing)) coursesDialog(); }, 'dark') : h('span', { class: 'sub' }, titles.length ? '每门课都有分区了。' : '')));
      openDialog(dialog);
    }
    /* A click on an empty part of a day starts a new course there, snapped to the school's periods when they are set. */
    function addAt(weekdayNumber, minute) {
      const s = schedule(), slots = s.settings.periods.filter(p => p.startTime && p.endTime), row = { title: '', weekday: weekdayNumber, weeks: s.settings.weekCount ? '1-' + s.settings.weekCount : '', periods: '', selected: true };
      const hit = slots.find(p => T.minutes(p.startTime) <= minute && minute < T.minutes(p.endTime)) || slots.filter(p => T.minutes(p.startTime) > minute)[0];
      if (hit && Math.abs(T.minutes(hit.startTime) - minute) <= 90) {
        const next = slots.find(p => +p.number === +hit.number + 1);
        row.periods = next && +hit.number % 2 === 1 ? hit.number + '-' + next.number : String(hit.number);
      } else {
        const start = Math.floor(minute / 30) * 30, clock = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
        row.startTime = clock(start); row.endTime = clock(Math.min(1439, start + 90));
      }
      if (compose) {
        // The quick-add box gets the day, time and weeks already written; only the course name is left to type.
        const words = [T.weekdayNames[weekdayNumber - 1], row.periods ? row.periods + '节' : row.startTime + '-' + row.endTime, row.weeks ? row.weeks + '周' : ''].filter(Boolean);
        return compose(words.join(' ') + ' ');
      }
      activeDraft = { rows: [row], reports: [], manual: true }; showPreview();
    }
    function render() {
      const keep = document.querySelector('.tt-grid-scroll'), scrollAt = keep ? [keep.scrollTop, keep.scrollLeft] : null;
      const now = new Date(), nowMinute = now.getHours() * 60 + now.getMinutes();
      const s = schedule(), end = T.addDays(currentWeek, 6), courses = T.events(s, currentWeek, end);
      // Tasks that have a start time are drawn beside the courses, so the week shows what is really taken.
      const clockText = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
      const timed = (getState().tasks || []).filter(t => t.date >= currentWeek && t.date <= end && /^\d\d:\d\d$/.test(t.time || '')).map(t => ({ task: t, title: t.title, date: t.date, startTime: t.time, endTime: clockText(Math.min(1439, T.minutes(t.time) + Math.max(15, t.minutes || 30))), room: '' }));
      const ev = [...courses, ...timed].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
      const clash = (a, b) => a !== b && (a.task || b.task ? !(a.task && a.task.done) && !(b.task && b.task.done) && a.startTime < b.endTime && b.startTime < a.endTime : T.overlaps(a, b));
      const main = document.querySelector('#main');
      let weekLabel = currentWeek + ' — ' + end;
      if (T.dateOK(s.settings.semesterStart) && currentWeek >= s.settings.semesterStart) {
        const n = Math.round((new Date(currentWeek + 'T12:00:00') - new Date(s.settings.semesterStart + 'T12:00:00')) / 604800000) + 1;
        if (!s.settings.weekCount || n <= s.settings.weekCount) weekLabel += ' · 第 ' + n + ' 教学周';
      }
      const startMinute = Math.min(7 * 60, ...ev.map(e => Math.floor(T.minutes(e.startTime) / 60) * 60));
      const endMinute = Math.max(22 * 60, ...ev.map(e => Math.ceil(T.minutes(e.endTime) / 60) * 60));
      const scale = 0.9, height = (endMinute - startMinute) * scale;
      const header = h('div', { class: 'tt-grid-head' }, h('div', { class: 'tt-time-heading' }, '时间'));
      const grid = h('div', { class: 'tt-grid-body', style: '--tt-height:' + height + 'px;--tt-hour:' + 60 * scale + 'px' });
      const slots = s.settings.periods.filter(p => p.startTime && p.endTime && T.minutes(p.startTime) >= startMinute && T.minutes(p.endTime) <= endMinute);
      grid.append(h('div', { class: 'tt-time-axis' + (slots.length ? ' has-periods' : '') }, Array.from({ length: (endMinute - startMinute) / 60 + 1 }, (_, i) => h('span', { style: 'top:' + i * 60 * scale + 'px' }, String(startMinute / 60 + i).padStart(2, '0') + ':00')),
        slots.map(p => h('i', { class: 'tt-period', title: '第 ' + p.number + ' 节 ' + p.startTime + '–' + p.endTime, style: 'top:' + (T.minutes(p.startTime) - startMinute) * scale + 'px;height:' + Math.max(14, (T.minutes(p.endTime) - T.minutes(p.startTime)) * scale - 2) + 'px' }, String(p.number)))));
      for (let i = 0; i < 7; i++) {
        const date = T.addDays(currentWeek, i), dayEvents = ev.filter(e => e.date === date);
        header.append(h('div', { class: date === today() ? 'is-today' : '' }, h('strong', {}, T.weekdayNames[i]), h('small', {}, date.slice(5))));
        const lane = h('div', { class: 'tt-lane' + (date === today() ? ' is-today' : ''), 'aria-label': date + '课程', title: '点空白处在这里加一门课',
          onclick: e => { if (e.target === lane) addAt(i + 1, startMinute + Math.max(0, e.offsetY) / scale); } });
        if (date === today() && nowMinute >= startMinute && nowMinute <= endMinute) lane.append(h('div', { class: 'tt-now', style: 'top:' + (nowMinute - startMinute) * scale + 'px', 'aria-hidden': 'true' }));
        const placed = [], groups = []; let group = [], ends = [], until = -1;
        for (const e of dayEvents) {
          const start = T.minutes(e.startTime), end = T.minutes(e.endTime);
          if (start >= until && group.length) { groups.push({ items: group, columns: ends.length }); group = []; ends = []; }
          let col = ends.findIndex(t => t <= start); if (col < 0) col = ends.length;
          ends[col] = end; until = Math.max(group.length ? until : -1, end);
          group.push({ e, col });
        }
        if (group.length) groups.push({ items: group, columns: ends.length });
        for (const g of groups) for (const { e, col } of g.items) {
          const conflict = dayEvents.some(other => clash(e, other));
          const live = !e.task && date === today() && T.minutes(e.startTime) <= nowMinute && nowMinute < T.minutes(e.endTime);
          placed.push(h('button', { class: 'tt-event' + (e.task ? ' task' + (e.task.done ? ' done' : '') : '') + (conflict ? ' conflict' : '') + (live ? ' live' : ''), style: 'top:' + ((T.minutes(e.startTime) - startMinute) * scale) + 'px;height:' + Math.max(25, (T.minutes(e.endTime) - T.minutes(e.startTime)) * scale - 3) + 'px;left:calc(' + col * 100 / g.columns + '% + 3px);width:calc(' + 100 / g.columns + '% - 6px)', onclick: () => e.task ? openTask(e.task.id) : details(e), title: (e.task ? '任务：' : '') + e.title + '\n' + e.startTime + '–' + e.endTime + '\n' + e.room + (conflict ? '\n与其他安排重叠' : '') },
            h('strong', {}, (e.task ? (e.task.done ? '✓ ' : '任务 · ') : '') + e.title), h('small', {}, e.startTime + '–' + e.endTime), e.room ? h('small', {}, e.room) : null, live ? h('small', { class: 'tt-live' }, '正在上课') : null, conflict ? h('small', {}, '时间冲突') : null));
        }
        lane.append(...placed); grid.append(lane);
      }
      const last = s.imports.at(-1);
      main.replaceChildren(...[h('header', { class: 'tt-header' }, h('div', {}, h('h2', {}, '课表'), h('p', { class: 'sub' }, '拖入课表，检查后自动填入每一天')),
        h('div', { class: 'tt-actions' }, btn('学期与节次', () => settings()), link && s.courses.length ? btn('课程与分区', coursesDialog) : null, btn('手动添加', () => { if (compose) return compose(''); activeDraft = { rows: [{ title: '', weekday: '', weeks: '', periods: '', selected: true }], reports: [], manual: true }; showPreview(); }), btn('导入课表', () => openImport(), 'dark'))),
        h('div', { class: 'tt-week-nav' }, btn('‹ 上周', () => { currentWeek = T.addDays(currentWeek, -7); render(); }, 'ghost'), h('strong', {}, weekLabel), btn('下周 ›', () => { currentWeek = T.addDays(currentWeek, 7); render(); }, 'ghost'), btn('本周', () => { currentWeek = T.weekStart(today()); render(); }, 'ghost')),
        !s.courses.length ? h('div', { class: 'tt-empty' }, h('strong', {}, '把课表文件拖到这里'), h('p', {}, 'PDF · 截图 · Word（.docx）· Excel（.xlsx）'), h('p', { class: 'sub' }, '先保存学校节次时间；导入后可修正课程、检查周次与冲突。'), btn('选择课表文件', () => openImport())) : null,
        h('div', { class: 'tt-grid-scroll' }, h('div', { class: 'tt-grid' }, header, grid)),
        h('footer', { class: 'tt-footer' }, h('span', {}, '本周 ' + courses.length + ' 次课' + (timed.length ? ' · ' + timed.length + ' 个定了时间的任务' : '') + ' · 已保存 ' + s.courses.length + ' 条课程规则'), last ? btn('撤销最近导入', () => { if (confirm('撤销「' + last.name + '」导入的课程？')) save(T.undo(schedule(), last.id)); }, 'ghost') : null)].filter(Boolean));
      const grown = document.querySelector('.tt-grid-scroll');
      if (grown && scrollAt) { grown.scrollTop = scrollAt[0]; grown.scrollLeft = scrollAt[1]; }
    }
    // Keeps the "now" line and the class in progress current while the page is simply left open.
    setInterval(() => { if (document.querySelector('.tt-header') && !dialog.open && !schoolDialog.open) render(); }, 60000);
    function openImport(files) {
      jobId++; activeDraft = null;
      const picker = h('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.docx,.xlsx,.csv,.tsv,.txt', multiple: true, hidden: true, onchange: e => { selected = [...e.target.files]; refresh(); } });
      let selected = files ? [...files] : [];
      const list = h('div', { class: 'tt-source-list' });
      const mode = h('select', { 'aria-label': '课表识别方式' }, h('option', { value: 'auto' }, '规则优先，必要时使用模型'), h('option', { value: 'rules' }, '仅本地规则（不发送资料）'), h('option', { value: 'model' }, '使用已配置模型'));
      const agent = getState().settings.agent;
      const modelLabel = agent.modelId ? '当前模型：' + agent.modelId + ' · ' + agent.baseUrl : '尚未配置模型。可先用规则识别文字表格；图片需配置支持识图的模型。';
      const start = btn('开始识别', () => recognize(selected, mode.value), 'dark');
      function refresh() { list.replaceChildren(...selected.map(f => h('div', {}, f.name + ' · ' + (f.size / 1024).toFixed(0) + ' KB'))); start.disabled = !selected.length; }
      const zone = h('button', { type: 'button', class: 'tt-dropzone', onclick: () => picker.click() }, h('strong', {}, '拖入文件，或点击选择'), h('span', {}, 'PDF / 截图 / DOCX / XLSX / CSV，单个不超过 30 MB'));
      dialog.replaceChildren(h('div', { class: 'tt-dialog-head' }, h('h2', {}, '导入课表'), btn('关闭', () => dialog.close(), 'ghost')),
        h('div', { class: 'tt-dialog-body' }, picker, zone, list, field('识别方式', mode), h('p', { class: 'sub' }, modelLabel),
          h('p', { class: 'sub' }, '规则在本机处理。使用模型时，课表文字和必要的图片会发送到上面配置的服务；密钥不会写入课表。扫描 PDF 和截图需要识图模型。'),
          h('p', { class: 'sub' }, '旧版 .doc / .xls 请先另存为 .docx / .xlsx。单个 PDF 最多 8 页，一次最多 6 个文件。')),
        h('div', { class: 'tt-dialog-foot' }, btn('学期与节次', () => settings()), start));
      dialog.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
      dialog.ondrop = e => { e.preventDefault(); e.stopPropagation(); selected = [...e.dataTransfer.files]; refresh(); };
      dialog.onpaste = e => { if (e.clipboardData?.files.length) { e.preventDefault(); selected = [...selected, ...e.clipboardData.files]; refresh(); } };
      refresh(); openDialog(dialog);
    }
    async function recognize(files, mode) {
      if (!files.length || files.length > 6) { toast('一次请选择 1–6 个课表文件'); return; }
      const token = ++jobId, rows = [], reports = [];
      dialog.ondrop = e => { e.preventDefault(); e.stopPropagation(); };
      const status = h('p', { role: 'status' });
      dialog.replaceChildren(h('div', { class: 'tt-dialog-head' }, h('h2', {}, '正在识别课表'), btn('取消', () => dialog.close(), 'ghost')), h('div', { class: 'tt-dialog-body' }, status, h('p', { class: 'sub' }, '完成后会先显示预览，此时还没有写入课程。')));
      for (const file of files) {
        if (token !== jobId) return;
        try {
          status.textContent = '正在读取 ' + file.name + '…';
          const parsed = await window.TPlanFiles.parseScheduleFile(file);
          if (token !== jobId) return;
          let found = T.parseRules(parsed), warnings = [], method = '本地规则';
          const agent = getState().settings.agent;
          const needsHelp = !found.length || found.some(r => r.review || !r.title || !(r.weekday || r.date) || !r.date && !r.weeks || !(r.periods || r.startTime));
          if (mode === 'model' || mode === 'auto' && needsHelp && agent.modelId && agent.baseUrl) {
            if (!agent.modelId || !agent.baseUrl) throw new Error('请先在设置中配置模型');
            const images = agent.vision === false ? [] : parsed.images;
            if (!parsed.text.trim() && !images.length) throw new Error('这个文件需要支持识图的模型，请在模型设置中完成识图连接测试');
            if (parsed.text.length > 120000) throw new Error('文字超过模型导入上限，请拆分课表文件');
            status.textContent = '正在用 ' + agent.modelId + ' 识别 ' + file.name + '…';
            const answer = await window.TPlanPlatform.chat(agent, T.MODEL_PROMPT, '文件名：' + file.name + '\n以下为课表资料，请完整提取，未写明的字段留空：\n' + parsed.text + '\n表格（空白单元格的位置已保留）：\n' + JSON.stringify(parsed.tables), images);
            if (token !== jobId) return;
            const result = T.parseModel(answer, file.name); found = result.rows; warnings = result.warnings; method = '已配置模型';
          }
          if (!found.length) throw new Error(parsed.images.length ? '没有识别出课程。截图或扫描件请使用支持识图的模型；也可手动补录。' : '没有找到明确课表，请使用模型识别或按预览格式手动补录。');
          rows.push(...found); reports.push({ file: file.name, ok: true, message: method + ' · ' + found.length + ' 条规则', warnings });
        } catch (e) { reports.push({ file: file.name, ok: false, message: e.message, warnings: [] }); }
      }
      if (token !== jobId) return;
      activeDraft = { rows, reports }; showPreview();
    }
    function showPreview() {
      if (!activeDraft) return;
      dialog.ondrop = e => { e.preventDefault(); e.stopPropagation(); };
      const d = activeDraft;
      const single = d.rows.length === 1 && !!(d.editId || d.manual); // one course typed by hand gets a plain form, not the review table
      let singleForm = null;
      const noted = (d.reports || []).some(r => !r.ok || r.warnings.length);
      const ackRow = h('label', { class: 'tt-ack' });
      const summary = h('div', { class: 'tt-preview-summary', role: 'status' }), tableBody = h('tbody');
      const issues = [], feedback = h('div', { class: 'tt-error', role: 'alert' });
      const acknowledge = h('input', { type: 'checkbox', 'aria-label': '确认识别提示与时间冲突', onchange: update });
      const accept = btn(d.editId ? '保存课程修改' : '确认导入', finalize, 'dark');
      function baseSchedule() { const s = schedule(); if (d.editId) s.courses = s.courses.filter(c => c.id !== d.editId); return s; }
      function update() {
        const p = T.preview(baseSchedule(), d.rows);
        summary.replaceChildren(h('strong', {}, p.added.length + ' 次课待写入'), h('span', {}, ' · ' + p.duplicates + ' 次重复将跳过 · ' + p.errors + ' 条待修正 · ' + p.conflicts.length + ' 处时间冲突'));
        p.records.forEach((record, i) => {
          if (!issues[i]) return;
          issues[i].textContent = record.errors.length ? record.errors.join('；') : record.occurrences + ' 次课 · ' + record.value.startTime + '–' + record.value.endTime;
          issues[i].className = 'tt-row-status ' + (record.errors.length ? 'tt-error' : '');
        });
        ackRow.hidden = !(p.conflicts.length || noted);
        if (single && !d.editId) summary.replaceChildren(h('strong', {}, p.added.length ? '会排进 ' + p.added.length + ' 次课' : '填好后会显示能排进几次课'), h('span', {}, p.conflicts.length ? ' · ' + p.conflicts.length + ' 处时间冲突' : ''));
        accept.disabled = !!p.errors || !d.rows.some(r => r.selected !== false) || (!p.added.length && !d.editId);
        accept.textContent = d.editId ? '保存课程修改' : single ? '添加课程' : '确认导入 ' + p.added.length + ' 次课';
        const conflicts = p.conflicts.slice(0, 8).map(x => x.a.date + ' ' + x.a.startTime + ' ' + x.a.title + ' ↔ ' + x.b.title);
        feedback.replaceChildren(...conflicts.map(x => h('p', {}, x)), ...(p.conflicts.length > 8 ? [h('p', {}, '另有 ' + (p.conflicts.length - 8) + ' 处冲突')] : []));
      }
      function input(row, key, type = 'text', placeholder = '') { return h('input', { type, value: row[key] || '', placeholder, 'aria-label': key, oninput: e => { row[key] = e.target.value; if (['title', 'weeks', 'periods', 'startTime', 'endTime', 'date'].includes(key)) row.review = ''; }, onchange: update }); }
      d.rows.forEach((row, i) => {
        const error = h('p', { class: 'tt-row-status' }); issues.push(error);
        const choose = h('input', { type: 'checkbox', checked: row.selected !== false, 'aria-label': '导入第' + (i + 1) + '条课程', onchange: e => { row.selected = e.target.checked; update(); } });
        const days = h('select', { 'aria-label': 'weekday', onchange: e => { row.weekday = e.target.value; update(); } }, h('option', { value: '' }, '未明确'), ...T.weekdayNames.map((name, n) => h('option', { value: n + 1, selected: +row.weekday === n + 1 }, name)));
        if (single) {
          singleForm = h('div', { class: 'tt-form' },
            field('课程名称', input(row, 'title', 'text', '例如 自动控制原理')),
            h('div', { class: 'row' }, field('星期', days), field('周次', input(row, 'weeks', 'text', '如 1-16、1-16单、1-8,10-16'))),
            h('div', { class: 'row' }, field('节次（套用学校节次时间）', input(row, 'periods', 'text', '如 1-2')), field('或者直接填开始', input(row, 'startTime', 'time')), field('结束', input(row, 'endTime', 'time'))),
            h('div', { class: 'row' }, field('教室（可以不填）', input(row, 'room', 'text', '')), field('教师（可以不填）', input(row, 'teacher', 'text', ''))),
            h('details', {}, h('summary', {}, '只上一次的课：改填具体日期'), field('具体日期（填了就不看星期和周次）', input(row, 'date', 'date'))),
            row.evidence ? h('details', {}, h('summary', {}, '识别依据'), h('pre', {}, row.evidence)) : null, error);
          return;
        }
        tableBody.append(h('tr', {}, h('td', {}, choose),
          h('td', {}, input(row, 'title', 'text', '课程名称'), h('small', {}, row.source || '手动填写'), row.evidence ? h('details', {}, h('summary', {}, row.method === 'model' ? '模型识别依据' : '规则识别依据'), h('pre', {}, row.evidence)) : null, error),
          h('td', {}, days, input(row, 'date', 'date'), h('small', {}, '有具体日期时按日期排课')),
          h('td', {}, input(row, 'weeks', 'text', '如 1-16单'), h('small', {}, '单双周 / 1-8,10-16')),
          h('td', {}, input(row, 'periods', 'text', '如 1-2'), h('small', {}, '无钟点时套用节次')),
          h('td', {}, input(row, 'startTime', 'time'), input(row, 'endTime', 'time')),
          h('td', {}, input(row, 'room', 'text', '教室'), input(row, 'teacher', 'text', '教师'))));
      });
      const report = h('div', { class: 'tt-reports' }, ...(d.reports || []).map(r => h('div', { class: r.ok ? '' : 'tt-error' }, h('strong', {}, r.file + '：'), r.message, ...r.warnings.map(w => h('p', { class: 'tt-warning' }, w)))));
      dialog.replaceChildren(h('div', { class: 'tt-dialog-head' }, h('h2', {}, d.editId ? '编辑课程规则' : single ? '手动添加一门课' : '检查课表后导入'), btn('关闭', () => dialog.close(), 'ghost')),
        h('div', { class: 'tt-dialog-body' }, report, summary,
          h('div', { class: 'tt-actions' }, btn('学期与节次设置', () => settings(update)), !d.editId && !single ? btn('缺失周次设为整个学期', () => {
            const n = schedule().settings.weekCount; if (!n) return toast('请先设置学期周数');
            if (confirm('把未填写周次且没有具体日期的课程设为第 1–' + n + ' 周，每周上课？')) { for (const row of d.rows) if (!row.weeks && !row.date) row.weeks = '1-' + n; showPreview(); }
          }, 'ghost') : null, !d.editId ? btn(single ? '一次添加多门课' : '增加一行', () => { d.rows.push({ title: '', selected: true }); showPreview(); }, 'ghost') : null),
          single ? singleForm : h('div', { class: 'tt-preview-table' }, h('table', {}, h('thead', {}, h('tr', {}, ...['选中', '课程及核对结果', '星期 / 具体日期', '周次', '节次', '开始 / 结束', '教室 / 教师'].map(x => h('th', {}, x)))), tableBody)),
          single ? null : h('p', { class: 'sub' }, '具体日期优先于周次；原表写明的钟点优先于节次。空白字段不会被猜测。可取消勾选暂不导入的课程。'), feedback,
          ackRow),
        h('div', { class: 'tt-dialog-foot' }, !d.editId && !single ? btn('重新选文件', () => openImport(), 'ghost') : null, accept));
      ackRow.append(acknowledge, noted ? '我已核对识别提示，允许保留时间冲突，或仅导入本次成功识别的文件' : '我知道这门课和已有安排时间重叠，仍然保留');
      function finalize() {
        try {
          const p = T.preview(baseSchedule(), d.rows);
          if ((p.conflicts.length || noted) && !acknowledge.checked) throw new Error(noted ? '请先核对识别提示 / 冲突 / 未识别文件，并勾选下方确认项' : '时间有冲突：请修改，或勾选下方确认项后保留');
          let next;
          if (d.editId) {
            if (p.errors) throw new Error('请先修正课程信息');
            next = schedule(); const i = next.courses.findIndex(c => c.id === d.editId);
            if (i < 0) throw new Error('课程已不存在');
            const old = next.courses[i], raw = d.rows[0], value = T.resolve(raw, next.settings).value;
            if (!T.time(raw.startTime) && !T.time(raw.endTime)) { value.startTime = ''; value.endTime = ''; }
            next.courses[i] = { ...old, ...value };
          } else next = T.applyImport(schedule(), d.rows, [...new Set(d.rows.filter(r => r.selected !== false).map(r => r.source || '手动填写'))].join('、'));
          if (save(next)) {
            const added = p.added[0]; if (added) currentWeek = T.weekStart(added.date);
            dialog.close(); activeDraft = null; openWorkspace();
            const unlinked = link ? courseTitles().filter(t => !link.spaceFor(t)) : [];
            if (!d.editId && unlinked.length) toast('课表已填入。有 ' + unlinked.length + ' 门课还没有分区', { label: '去建分区', run: coursesDialog });
            else toast(d.editId ? '课程已更新' : '课表已填入每天的时间段');
          }
        } catch (e) { toast(e.message); }
      }
      update(); openDialog(dialog);
    }
    return { render, daily, openImport, settings, details };
  };
})();
