const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Providers = require('../v4/js/providers.js');
const source = fs.readFileSync(path.join(__dirname, '../v4/js/platform.js'), 'utf8');
function harness() {
  const storage = new Map(), sent = [], listeners = [], timers = new Map();
  let secret = '', timerId = 0;
  const db = { Read: k => storage.get(k) || '', Write: (k, v) => storage.set(k, v), ReadSecret: () => secret, WriteSecret: v => { secret = v; } };
  const webview = { hostObjects: { sync: { database: db } }, postMessage: m => sent.push(m), addEventListener: (kind, fn) => listeners.push(fn) };
  const window = { TPlanProviders: Providers, chrome: { webview } };
  vm.runInNewContext(source, { window, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
  return { p: window.TPlanPlatform, storage, sent, timers, reply: data => listeners.forEach(fn => fn({ data })) };
}
test('v4 uses its own data key; provider switching preserves separate keys', () => {
  const h = harness();
  h.p.saveState('{"version":4}');
  assert.equal(h.storage.get('tplan.v4'), '{"version":4}');
  assert.equal(h.storage.has('tplan.v3'), false);
  h.p.saveKey('openai', 'test-a'); h.p.saveKey('deepseek', 'test-b');
  assert.equal(h.p.loadKey('openai'), 'test-a');
  assert.equal(h.p.loadKey('deepseek'), 'test-b');
  h.p.saveKey('openai', '');
  assert.equal(h.p.loadKey('deepseek'), 'test-b');
  assert.equal(h.p.loadKey('openai'), '');
});
test('unsaved settings and images reach native transport; concurrent responses are paired by id', async () => {
  const h = harness(), agent = { provider: 'openai', baseUrl: 'https://example.com/v1', modelId: 'test-model' };
  h.p.saveKey('openai', 'saved-key');
  const chat = h.p.chat(agent, 'system', 'user', [{ mediaType: 'image/png', data: 'aGVsbG8=' }], 'draft-key');
  const models = h.p.listModels(agent, 'models-key');
  assert.equal(h.sent[0].headers.authorization, 'Bearer draft-key');
  assert.equal(JSON.parse(h.sent[0].body).messages[1].content[1].type, 'image_url');
  h.reply({ kind: 'http-response', id: h.sent[1].id, status: 200, text: '{"data":[{"id":"test-model"}]}' });
  h.reply({ kind: 'http-response', id: h.sent[0].id, status: 200, text: '{"choices":[{"message":{"content":"connected"}}]}' });
  assert.deepEqual(await models, ['test-model']);
  assert.equal(await chat, 'connected');
  assert.equal(h.timers.size, 0);
});
test('native HTTP errors are not accepted as model content; timeout cancels native request', async () => {
  const h = harness(), a = { provider: 'deepseek', baseUrl: 'https://example.com', modelId: 'm' };
  const failed = h.p.chat(a, '', '', [], 'k');
  h.reply({ kind: 'http-response', id: h.sent[0].id, status: 401, text: '{"error":{"message":"bad key"}}' });
  await assert.rejects(failed, /401/);
  const timed = h.p.listModels(a, 'k');
  [...h.timers.values()][0]();
  await assert.rejects(timed, /超时/);
  assert.equal(h.sent.at(-1).kind, 'http-cancel');
  assert.equal(h.sent.at(-1).id, h.sent[1].id);
});
test('native timer commands route to UI and arbitrary file reads fail immediately', async () => {
  const h = harness(); let command;
  h.p.onTimerCommand(c => { command = c; });
  h.reply({ kind: 'timer-command', command: 'pause' });
  assert.equal(command, 'pause');
  await assert.rejects(h.p.readPath('C:\\test.txt'), /附件/);
  assert.equal(h.sent.length, 0);
});
