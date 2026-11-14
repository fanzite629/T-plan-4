/* Turns dropped files into plain text the assistant can read. Everything is parsed on this
   computer; only the extracted text is ever sent to the model, and only when a message is sent.
   Supported: PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), and text or source-code files. */
(function () {
  'use strict';

  const MAX_BYTES = 30 * 1024 * 1024;
  const MAX_CHARS = 400000;
  const TEXT_EXTENSIONS = /\.(txt|md|csv|tsv|json|xml|ya?ml|ini|log|c|h|cpp|hpp|cc|ino|asm|s|a51|py|js|ts|jsx|tsx|java|cs|go|rs|rb|php|swift|kt|m|sql|sh|bat|ps1|html|css|v|sv|vhd|tex|ipynb)$/i;

  /* ---------- minimal ZIP reader (Office files are ZIP archives of XML) ---------- */
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buffer) {
    const view = new DataView(buffer);
    let end = buffer.byteLength - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < 0) throw new Error('文件不是有效的 Office 文档');
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder();
    let expanded = 0;
    if (count > 10000) throw new Error('Office 文件内容过多');
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      const method = view.getUint16(offset + 10, true);
      const size = view.getUint32(offset + 20, true);
      const unpacked = view.getUint32(offset + 24, true);
      expanded += unpacked;
      if (unpacked > 32 * 1024 * 1024 || expanded > 80 * 1024 * 1024) throw new Error('Office 文件解压后过大，请只保留课表所在页面');
      if (method !== 0 && method !== 8) throw new Error('Office 文件使用了不支持的压缩格式');
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
      entries.set(name, { method, size, local });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    async function bytes(name) {
      const entry = entries.get(name);
      if (!entry) return new Uint8Array();
      const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
      const raw = new Uint8Array(buffer, start, entry.size);
      const output = entry.method === 0 ? raw : await inflate(raw);
      if (output.length > 32 * 1024 * 1024) throw new Error('文档内容过大');
      return output;
    }
    return {
      names: [...entries.keys()],
      bytes,
      async text(name) { return decoder.decode(await bytes(name)); },
    };
  }
  const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
  const byNumber = (pattern) => (a, b) => Number(a.match(pattern)[1]) - Number(b.match(pattern)[1]);
  const tagText = (node, tag) => [...node.getElementsByTagName(tag)].map((x) => x.textContent).join('');

  async function readDocx(buffer) {
    const zip = await unzip(buffer);
    const doc = xml(await zip.text('word/document.xml'));
    return [...doc.getElementsByTagName('w:p')].map((p) => tagText(p, 'w:t')).filter(Boolean).join('\n');
  }
  async function readPptx(buffer) {
    const zip = await unzip(buffer);
    const pattern = /^ppt\/slides\/slide(\d+)\.xml$/;
    const slides = zip.names.filter((n) => pattern.test(n)).sort(byNumber(pattern));
    const parts = [];
    for (let i = 0; i < slides.length; i++) {
      const doc = xml(await zip.text(slides[i]));
      const lines = [...doc.getElementsByTagName('a:p')].map((p) => tagText(p, 'a:t')).filter(Boolean);
      parts.push('[第 ' + (i + 1) + ' 页]\n' + lines.join('\n'));
    }
    return { text: parts.join('\n\n'), units: slides.length + ' 页' };
  }
  async function readXlsx(buffer) {
    const zip = await unzip(buffer);
    const shared = [...xml(await zip.text('xl/sharedStrings.xml')).getElementsByTagName('si')].map((si) => tagText(si, 't'));
    const pattern = /^xl\/worksheets\/sheet(\d+)\.xml$/;
    const sheets = zip.names.filter((n) => pattern.test(n)).sort(byNumber(pattern));
    const parts = [];
    for (let i = 0; i < sheets.length; i++) {
      const rows = [...xml(await zip.text(sheets[i])).getElementsByTagName('row')].slice(0, 500).map((row) =>
        [...row.getElementsByTagName('c')].map((cell) => {
          const value = tagText(cell, 'v');
          if (cell.getAttribute('t') === 's') return shared[Number(value)] || '';
          return cell.getAttribute('t') === 'inlineStr' ? tagText(cell, 't') : value;
        }).join('\t'));
      parts.push('[工作表 ' + (i + 1) + ']\n' + rows.join('\n'));
    }
    return { text: parts.join('\n\n'), units: sheets.length + ' 个工作表' };
  }

  /* ---------- PDF (pdf.js, loaded only when the first PDF arrives) ---------- */
  let pdfReady;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('无法加载 PDF 组件'));
      document.head.append(el);
    });
  }
  async function readPdf(buffer) {
    // Loading the worker script on the page lets pdf.js run without a separate worker file request.
    pdfReady = pdfReady || loadScript('vendor/pdfjs/pdf.min.js').then(() => loadScript('vendor/pdfjs/pdf.worker.min.js'));
    await pdfReady;
    const pdf = await window.pdfjsLib.getDocument({ data: buffer, isEvalSupported: false }).promise;
    const parts = [];
    let total = 0;
    for (let n = 1; n <= pdf.numPages && total < MAX_CHARS; n++) {
      const content = await (await pdf.getPage(n)).getTextContent();
      let line = '';
      for (const item of content.items) line += item.str + (item.hasEOL ? '\n' : '');
      total += line.length;
      parts.push('[第 ' + n + ' 页]\n' + line.trim());
    }
    return { text: parts.join('\n\n'), units: pdf.numPages + ' 页' };
  }

  /* ---------- images ----------
     Large photos are scaled down before sending: it keeps requests small and is enough for reading handwriting. */
  const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|bmp)$/;
  const MAX_SIDE = 1568;
  function draw(bitmap, maxSide, quality) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height };
  }
  async function readImage(file) {
    let bitmap;
    try { bitmap = await createImageBitmap(file); } catch { throw new Error('这张图片打不开'); }
    const full = draw(bitmap, MAX_SIDE, 0.86);
    const thumb = draw(bitmap, 160, 0.7);
    return {
      name: file.name || '图片.jpg', kind: '图片', units: full.width + '×' + full.height, text: '',
      image: { mediaType: 'image/jpeg', data: full.url.split(',')[1] }, thumb: thumb.url,
    };
  }

  /* Returns { name, kind, text, units } (plus image and thumb for pictures). Throws a readable message for unsupported files. */
  async function parseFile(file) {
    if (file.size > MAX_BYTES) throw new Error('文件超过 30 MB');
    if (IMAGE_TYPES.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) return readImage(file);
    const name = file.name;
    const ext = (name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
    let result;
    if (ext === 'pdf') result = { kind: 'PDF', ...(await readPdf(await file.arrayBuffer())) };
    else if (ext === 'docx') result = { kind: 'Word', text: await readDocx(await file.arrayBuffer()) };
    else if (ext === 'pptx') result = { kind: 'PPT', ...(await readPptx(await file.arrayBuffer())) };
    else if (ext === 'xlsx') result = { kind: 'Excel', ...(await readXlsx(await file.arrayBuffer())) };
    else if (['doc', 'ppt', 'xls'].includes(ext)) throw new Error('旧格式 .' + ext + ' 读不了，请在 Office 或 WPS 里另存为 .' + ext + 'x');
    else if (TEXT_EXTENSIONS.test(name) || file.type.startsWith('text/')) result = { kind: '文本', text: await file.text() };
    else throw new Error('不支持这种文件（支持图片、PDF、Word、PPT、Excel、文本和代码）');
    const text = result.text.replace(/\u0000/g, '').slice(0, MAX_CHARS);
    if (!text.trim()) throw new Error('没有读到文字（可能是扫描件或图片）');
    return { name, kind: result.kind, units: result.units || text.length + ' 字', text };
  }

  /* Timetables need cell positions and merged-cell origins, not flattened paragraphs. */
  function colIndex(ref) { let n = 0; for (const c of (ref.match(/^[A-Z]+/i) || ['A'])[0].toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; }
  async function scheduleXlsx(buffer) {
    const zip = await unzip(buffer);
    const shared = [...xml(await zip.text('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si => tagText(si, 't'));
    const workbook = xml(await zip.text('xl/workbook.xml'));
    const date1904 = ['1', 'true'].includes(workbook.getElementsByTagName('workbookPr')[0]?.getAttribute('date1904'));
    const styles = xml(await zip.text('xl/styles.xml'));
    const customFormats = new Map([...styles.getElementsByTagName('numFmt')].map(x => [+x.getAttribute('numFmtId'), x.getAttribute('formatCode')]));
    const formats = [...(styles.getElementsByTagName('cellXfs')[0]?.children || [])].map(x => +x.getAttribute('numFmtId'));
    const rels = new Map([...xml(await zip.text('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')].map(x => [x.getAttribute('Id'), x.getAttribute('Target')]));
    const sheetNames = new Map([...workbook.getElementsByTagName('sheet')].map(x => {
      const target = rels.get(x.getAttribute('r:id')) || '';
      return [(target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')), x.getAttribute('name')];
    }));
    const tables = [];
    for (const name of zip.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber(/sheet(\d+)/))) {
      const doc = xml(await zip.text(name)), rows = [], origins = [];
      const sheetRows = [...doc.getElementsByTagName('row')];
      if (sheetRows.length > 500) throw new Error('课表工作表超过 500 行，请只保留课表区域');
      for (const r of sheetRows) {
        const ri = +r.getAttribute('r') - 1;
        if (ri < 0 || ri >= 500) throw new Error('课表区域超出前 500 行，请移到新工作表后导入');
        rows[ri] = []; origins[ri] = [];
        for (const cell of r.getElementsByTagName('c')) {
          const ci = colIndex(cell.getAttribute('r') || 'A'); if (ci >= 80) continue;
          let value = tagText(cell, 'v');
          if (cell.getAttribute('t') === 's') value = shared[+value] || '';
          else if (cell.getAttribute('t') === 'inlineStr') value = tagText(cell, 't');
          else if (value && cell.hasAttribute('s')) {
            const fmt = formats[+cell.getAttribute('s')], code = (customFormats.get(fmt) || '').replace(/"[^"]*"|\[[^\]]*\]/g, '').toLowerCase(), n = Number(value);
            if (Number.isFinite(n) && ([18, 19, 20, 21, 45, 46, 47].includes(fmt) || /h.*m/.test(code) && !/[yd]/.test(code))) {
              const mins = Math.round((n % 1) * 1440) % 1440; value = String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
            } else if (Number.isFinite(n) && ([14, 15, 16, 17, 22].includes(fmt) || /[yd]/.test(code))) {
              const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, n < 60 ? 31 : 30);
              value = new Date(epoch + Math.floor(n) * 86400000).toISOString().slice(0, 10);
            }
          }
          rows[ri][ci] = value; origins[ri][ci] = ri + ':' + ci;
        }
      }
      for (const merge of doc.getElementsByTagName('mergeCell')) {
        const [a, b] = (merge.getAttribute('ref') || '').split(':'); if (!b) continue;
        const r0 = +(a.match(/\d+/) || [0])[0] - 1, r1 = +(b.match(/\d+/) || [0])[0] - 1, c0 = colIndex(a), c1 = colIndex(b);
        if (r0 < 0 || r1 >= 500 || c1 >= 80) continue;
        const value = rows[r0]?.[c0] || '';
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { (rows[r] ||= [])[c] = value; (origins[r] ||= [])[c] = r0 + ':' + c0; }
      }
      tables.push({ name: sheetNames.get(name) || name, rows: Array.from({ length: rows.length }, (_, i) => Array.from({ length: Math.max(1, rows[i]?.length || 0) }, (_, c) => rows[i]?.[c] || '')), origins });
    }
    return { tables, text: tables.map(t => '[' + t.name + ']\n' + t.rows.map(r => r.join('\t')).join('\n')).join('\n\n'), images: [] };
  }
  async function scheduleDocx(buffer) {
    const zip = await unzip(buffer), doc = xml(await zip.text('word/document.xml')), tables = [];
    for (const tbl of doc.getElementsByTagName('w:tbl')) {
      const rows = [], origins = [], vertical = new Map();
      const tr = [...tbl.children].filter(x => x.localName === 'tr');
      for (let r = 0; r < tr.length; r++) {
        rows[r] = []; origins[r] = []; let c = +(tr[r].getElementsByTagName('w:gridBefore')[0]?.getAttribute('w:val') || 0);
        for (const cell of [...tr[r].children].filter(x => x.localName === 'tc')) {
          const count = Math.min(80, +(cell.getElementsByTagName('w:gridSpan')[0]?.getAttribute('w:val') || 1));
          const merge = cell.getElementsByTagName('w:vMerge')[0], continuing = merge && merge.getAttribute('w:val') !== 'restart';
          const value = continuing && vertical.has(c) ? vertical.get(c).value : [...cell.getElementsByTagName('w:p')].map(p => tagText(p, 'w:t')).join('\n');
          const origin = continuing && vertical.has(c) ? vertical.get(c).origin : r + ':' + c;
          for (let n = 0; n < count; n++, c++) { rows[r][c] = value; origins[r][c] = origin; if (merge) vertical.set(c, { value, origin }); else vertical.delete(c); }
        }
      }
      tables.push({ name: 'Word 表格 ' + (tables.length + 1), rows, origins });
    }
    const images = [];
    const media = zip.names.filter(n => /^word\/media\/.+\.(png|jpe?g|webp)$/i.test(n));
    if (media.length > 8) throw new Error('Word 图片超过 8 张，请只保留课表图片后再导入');
    for (const name of media) images.push((await readImage(new File([await zip.bytes(name)], name))).image);
    return { tables, text: [...doc.getElementsByTagName('w:p')].map(p => tagText(p, 'w:t')).filter(Boolean).join('\n'), images };
  }
  function delimited(text) {
    const delimiter = text.includes('\t') ? '\t' : ',', rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && (c === delimiter || c === '\n')) { row.push(value.replace(/\r$/, '')); value = ''; if (c === '\n') { rows.push(row); row = []; } }
      else value += c;
    }
    row.push(value.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  async function schedulePdf(buffer) {
    pdfReady = pdfReady || loadScript('vendor/pdfjs/pdf.min.js').then(() => loadScript('vendor/pdfjs/pdf.worker.min.js'));
    await pdfReady;
    const pdf = await window.pdfjsLib.getDocument({ data: buffer, isEvalSupported: false }).promise;
    const images = [], parts = [];
    try {
      if (pdf.numPages > 8) throw new Error('课表 PDF 最多支持 8 页，请先拆出课表页面');
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n), content = await page.getTextContent();
        const items = content.items.filter(x => x.str.trim()).sort((a, b) => Math.abs(a.transform[5] - b.transform[5]) > 3 ? b.transform[5] - a.transform[5] : a.transform[4] - b.transform[4]);
        const lines = []; let y = null;
        for (const item of items) {
          if (y === null || Math.abs(item.transform[5] - y) > 3) { lines.push([]); y = item.transform[5]; }
          lines.at(-1).push(item.str);
        }
        parts.push('[第 ' + n + ' 页]\n' + lines.map(x => x.join('  ')).join('\n'));
        const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(2.5, 2200 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        images.push({ mediaType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1] });
        canvas.width = canvas.height = 1; page.cleanup();
      }
      return { text: parts.join('\n\n'), images, tables: [], units: pdf.numPages + ' 页' };
    } finally { await pdf.destroy(); }
  }
  async function parseScheduleFile(file) {
    if (file.size > MAX_BYTES) throw new Error('课表文件超过 30 MB');
    const ext = (file.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
    let result;
    if (IMAGE_TYPES.test(file.type) || /^(png|jpe?g|webp|gif|bmp)$/.test(ext)) { const image = await readImage(file); result = { text: '', images: [image.image], tables: [], units: image.units }; }
    else if (ext === 'xlsx') result = await scheduleXlsx(await file.arrayBuffer());
    else if (ext === 'docx') result = await scheduleDocx(await file.arrayBuffer());
    else if (ext === 'pdf') result = await schedulePdf(await file.arrayBuffer());
    else if (['csv', 'tsv', 'txt'].includes(ext)) { const content = await file.text(); result = { text: content, tables: [{ name: file.name, rows: delimited(content) }], images: [] }; }
    else if (['doc', 'xls'].includes(ext)) throw new Error('请先在 Word/WPS/Excel 中把 .' + ext + ' 另存为 .' + ext + 'x');
    else throw new Error('课表支持 PDF、图片、.docx、.xlsx、CSV 和文本');
    if (result.text.length > MAX_CHARS) throw new Error('课表文字超过 40 万字，请只保留课表内容');
    return { ...result, name: file.name, kind: ext.toUpperCase(), units: result.units || (result.tables.length ? result.tables.length + ' 个表格' : result.text.length + ' 字') };
  }
  window.TPlanFiles = { parseFile, parseScheduleFile };
})();
