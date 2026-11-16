/* Synthetic fixtures only. Never reads personal documents or calls an external model. */
window.runTimetableQa = async function (assert) {
  const T = window.TPlanTimetable, F = window.TPlanFiles, P = window.TPlanPlatform;
  const read = () => JSON.parse(P.loadState());
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(test, label) { for (let i = 0; i < 80; i++) { if (test()) return; await delay(100); } throw new Error('等待超时：' + label); }
  const click = label => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label && !b.disabled); if (!b) throw new Error('找不到可用按钮：' + label); b.click(); };
  const input = (el, value) => { if (!el) throw new Error('测试输入框不存在'); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const xmlEscape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  async function zip(entries) {
    const encoder = new TextEncoder(), local = [], central = []; let offset = 0;
    const crc = bytes => { let c = -1; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ -1) >>> 0; };
    for (const [name, value] of Object.entries(entries)) {
      const n = encoder.encode(name), b = encoder.encode(value), head = new Uint8Array(30 + n.length), v = new DataView(head.buffer);
      const compressed = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, 8, true); v.setUint32(14, crc(b), true); v.setUint32(18, compressed.length, true); v.setUint32(22, b.length, true); v.setUint16(26, n.length, true); head.set(n, 30);
      const dir = new Uint8Array(46 + n.length), d = new DataView(dir.buffer);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(10, 8, true); d.setUint32(16, crc(b), true); d.setUint32(20, compressed.length, true); d.setUint32(24, b.length, true); d.setUint16(28, n.length, true); d.setUint32(42, offset, true); dir.set(n, 46);
      local.push(head, compressed); central.push(dir); offset += head.length + compressed.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, central.reduce((n, b) => n + b.length, 0), true); e.setUint32(16, offset, true);
    return new Blob([...local, ...central, end]);
  }
  const docRows = [['课程名称', '星期', '周次', '节次', '教室'], ['合成Word课程', '周三', '1-4双', '第3-4节', 'W303']];
  const word = await zip({
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>' + docRows.map(r => '<w:tr>' + r.map(c => '<w:tc><w:p><w:r><w:t>' + xmlEscape(c) + '</w:t></w:r></w:p></w:tc>').join('') + '</w:tr>').join('') + '</w:tbl></w:body></w:document>',
  });
  const wordParsed = await F.parseScheduleFile(new File([word], '合成验收.docx'));
  const wordCourses = T.parseRules(wordParsed);
  assert(wordCourses.length === 1 && wordCourses[0].weekday === 3 && wordCourses[0].weeks === '1-4双', 'DOCX真实ZIP/XML表格解析');
  const excel = await zip({
    'xl/workbook.xml': '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="合成课表" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="inlineStr"><is><t>节次</t></is></c><c r="B1" t="inlineStr"><is><t>周一</t></is></c><c r="C1" t="inlineStr"><is><t>周二</t></is></c><c r="D1" t="inlineStr"><is><t>周三</t></is></c></row>' +
      '<row r="2"><c r="A2" t="inlineStr"><is><t>第1节</t></is></c><c r="C2" t="inlineStr"><is><t>合成Excel课\n1-4周</t></is></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>第2节</t></is></c></row></sheetData><mergeCells><mergeCell ref="C2:C3"/></mergeCells></worksheet>',
  });
  const excelParsed = await F.parseScheduleFile(new File([excel], '合成验收.xlsx'));
  const excelCourses = T.parseRules(excelParsed);
  assert(excelCourses.length === 1 && excelCourses[0].weekday === 2 && excelCourses[0].periods === '1,2', 'XLSX空列与合并单元格位置保留');
  function pdf() {
    const content = 'BT /F1 18 Tf 40 140 Td (QA PDF lesson 08:00-09:00) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 220] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'];
    let result = '%PDF-1.4\n', offsets = [0];
    objects.forEach((obj, i) => { offsets.push(result.length); result += (i + 1) + ' 0 obj\n' + obj + '\nendobj\n'; });
    const xref = result.length; result += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return new File([result], '合成验收.pdf', { type: 'application/pdf' });
  }
  const pdfParsed = await F.parseScheduleFile(pdf());
  assert(pdfParsed.text.includes('QA PDF lesson') && pdfParsed.images.length === 1 && pdfParsed.images[0].data.length > 100, 'PDF文字提取与页面图像渲染');
  document.querySelector('#panel').close();
  document.querySelector('button[aria-label="课表"]').click();
  assert(!!document.querySelector('.tt-grid'), '课表周视图渲染');
  click('学期与节次');
  input(document.querySelector('input[aria-label="第1教学周周一"]'), '2026-09-07');
  input(document.querySelector('input[aria-label="学期周数"]'), '20');
  for (const [n, a, b] of [[1, '08:00', '08:45'], [2, '08:55', '09:40'], [3, '10:00', '10:45'], [4, '10:55', '11:40']]) {
    input(document.querySelector('input[aria-label="第' + n + '节开始"]'), a); input(document.querySelector('input[aria-label="第' + n + '节结束"]'), b);
  }
  click('保存学校时间');
  assert(read().schedule.settings.periods.length === 4, '学校节次设置保存');
  const date = window.TPlanCore.todayISO();
  const csv = new File([[
    ['课程名称', '星期', '周次', '节次', '开始时间', '结束时间', '日期', '教室'],
    ['合成数学课', '周一', '1-4', '1-2', '', '', '', 'A101'],
    ['当天测试课', '', '', '', '14:00', '15:00', date, 'B202'],
  ].map(r => r.join(',')).join('\n')], '合成课表.csv', { type: 'text/csv' });
  const drop = file => { const data = new DataTransfer(); data.items.add(file); window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); };
  const previewReady = () => !!document.querySelector('.tt-preview-table');
  const accept = () => [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('确认导入 '));
  drop(csv); document.querySelector('select[aria-label="课表识别方式"]').value = 'rules'; click('开始识别');
  await until(previewReady, 'CSV预览');
  assert(read().schedule.courses.length === 0 && accept().textContent.includes('5 次课') && !accept().disabled, '拖入CSV先预览，确认前不写入');
  const importDialog = document.querySelector('dialog[aria-label="导入课表"]');
  const closed = () => new Promise(resolve => importDialog.addEventListener('close', resolve, { once: true }));
  const firstClose = closed();
  accept().click();
  await firstClose;
  assert(T.events(read().schedule).length === 5 && document.querySelectorAll('.tt-event').length > 0, '确认后按日期和节次填入周视图');
  document.querySelector('button[aria-label="工作台"]').click();
  assert(document.querySelector('.home-today .tt-day-card')?.textContent.includes('当天测试课'), '当天课程进入工作台');
  document.querySelector('button[aria-label="课表"]').click();
  drop(csv); document.querySelector('select[aria-label="课表识别方式"]').value = 'rules'; click('开始识别'); await until(previewReady, '重复预览');
  assert(accept().disabled && read().schedule.courses.length === 2, '重复导入不会重复写课');
  const duplicateClose = closed();
  importDialog.close();
  await duplicateClose;
  // Configure an isolated test model using the actual settings UI; no key or external call.
  document.querySelector('#openSettings').click(); click('AI 模型');
  input(document.querySelector('#panel input[name="modelId"]'), 'qa-timetable-model');
  input(document.querySelector('#panel input[name="baseUrl"]'), 'http://127.0.0.1:1/v1');
  click('保存'); document.querySelector('#panel').close();
  const realChat = P.chat; let imageSent = false;
  try {
    P.chat = async (agent, system, user, images) => {
      imageSent = agent.modelId === 'qa-timetable-model' && images.length === 1 && system.includes('未知字段留空');
      return JSON.stringify({ courses: [{ title: '模型接口合成课', date, startTime: '16:00', endTime: '17:00', room: 'M404', evidence: '仅模拟响应，不代表视觉识别准确率' }], warnings: [] });
    };
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200; const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 400, 200); ctx.fillStyle = 'black'; ctx.font = '24px sans-serif'; ctx.fillText('Synthetic timetable fixture', 10, 70);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    drop(new File([blob], '合成截图.png', { type: 'image/png' }));
    document.querySelector('select[aria-label="课表识别方式"]').value = 'model'; click('开始识别'); await until(previewReady, '图片模型预览');
    assert(imageSent && read().schedule.courses.length === 2, '截图经已配置模型接口生成预览（模拟响应）');
    accept().click();
    assert(read().schedule.courses.some(c => c.title === '模型接口合成课' && c.method === 'model'), '模型识别结果确认后写入并记录来源');
  } finally { P.chat = realChat; }
};
