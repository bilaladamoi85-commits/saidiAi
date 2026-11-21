const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
let srv; const B = 'http://localhost:3999'; const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
const j = async (p, o = {}) => { const r = await fetch(B + p, o); return { s: r.status, d: await r.json() }; };
before(async () => {
  srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: 3999, SCAN_MODE: 'off', NODE_ENV: 'test' }, cwd: path.join(__dirname, '..') });
  await new Promise(r => setTimeout(r, 1500));
});
after(() => srv.kill());
test('full flow: register, upload, list, play, stop', async () => {
  const email = `t${Date.now()}@x.com`;
  const reg = await j('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  assert.equal(reg.s, 200);
  const h = { Authorization: 'Bearer ' + reg.d.token };
  const fd = new FormData();
  fd.append('title', 'Test'); fd.append('rights', 'true');
  fd.append('file', new Blob([Buffer.from('MZ' + 'x'.repeat(100))]), 'a.exe');
  assert.equal((await j('/api/apps', { method: 'POST', headers: h, body: fd })).s, 200);
  const bad = new FormData(); bad.append('title', 'T'); bad.append('rights', 'true'); bad.append('file', new Blob(['hi']), 'a.txt');
  assert.equal((await j('/api/apps', { method: 'POST', headers: h, body: bad })).s, 400);
  const apps = await j('/api/apps', { headers: h }); assert.equal(apps.d.length, 1);
  const s = await j('/api/sessions', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ appId: apps.d[0].id }) });
  assert.equal(s.s, 200);
  assert.equal((await j('/api/sessions/' + s.d.sessionId, { method: 'DELETE', headers: h })).s, 200);
});
