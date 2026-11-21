const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { provider } = require('./provider');
const { scan } = require('./scanner');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret';
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-only-secret') throw new Error('Set JWT_SECRET in production.');
const MAX_BYTES = 1024 * 1024 * 1024 - 1; // under 1 GB
const MAX_SESSION_MIN = 120;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new Database(path.join(__dirname, 'data', 'cloudplay.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS apps(
  id INTEGER PRIMARY KEY, owner INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
  filename TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_scan', created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY, user INTEGER NOT NULL, app INTEGER NOT NULL, remote TEXT,
  started INTEGER NOT NULL, ended INTEGER);
`);

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- auth ----
const sign = u => jwt.sign({ id: u.id, email: u.email }, JWT_SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Please sign in again.' }); }
}

app.post('/api/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return res.status(400).json({ error: 'Enter a valid email.' });
  if ((password || '').length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const r = db.prepare('INSERT INTO users(email,pass,created) VALUES(?,?,?)')
      .run(email.toLowerCase(), bcrypt.hashSync(password, 12), Date.now());
    res.json({ token: sign({ id: r.lastInsertRowid, email }) });
  } catch { res.status(409).json({ error: 'This email is already registered.' }); }
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get((email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.pass))
    return res.status(401).json({ error: 'Wrong email or password.' });
  res.json({ token: sign(u) });
});

// ---- uploads ----
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_r, _f, cb) => cb(null, crypto.randomUUID() + '.bin')
  }),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_r, f, cb) =>
    /\.(exe|msi)$/i.test(f.originalname) ? cb(null, true) : cb(new Error('Only .exe or .msi files are accepted.'))
});


app.post('/api/apps', auth, (req, res) => {
  upload.single('file')(req, res, async err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File must be under 1 GB.' : err.message });
    const { title, description, rights } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
    const drop = () => fs.unlink(req.file.path, () => {});
    if (!title || !title.trim()) { drop(); return res.status(400).json({ error: 'Add a title.' }); }
    if (rights !== 'true') { drop(); return res.status(400).json({ error: 'Confirm you have the rights to share this app.' }); }
    const hash = crypto.createHash('sha256');
    await new Promise((ok, no) => fs.createReadStream(req.file.path).on('data', d => hash.update(d)).on('end', ok).on('error', no));
    let verdict;
    try { verdict = await scan(req.file.path); }
    catch (e) { drop(); return res.status(503).json({ error: 'Security scan is unavailable. Try again later.' }); }
    if (!verdict.clean) { drop(); return res.status(422).json({ error: verdict.reason }); }
    const r = db.prepare(`INSERT INTO apps(owner,title,description,filename,size,sha256,status,created)
      VALUES(?,?,?,?,?,?,?,?)`).run(req.user.id, title.trim().slice(0, 80), (description || '').slice(0, 500),
      req.file.filename, req.file.size, hash.digest('hex'), 'approved', Date.now());
    res.json({ id: r.lastInsertRowid });
  });
});

app.get('/api/apps', auth, (_req, res) => {
  res.json(db.prepare(`SELECT a.id,a.title,a.description,a.size,a.created,u.email AS owner
    FROM apps a JOIN users u ON u.id=a.owner WHERE a.status='approved' ORDER BY a.created DESC`).all());
});

app.delete('/api/apps/:id', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM apps WHERE id=? AND owner=?').get(req.params.id, req.user.id);
  if (!a) return res.status(404).json({ error: 'App not found.' });
  fs.unlink(path.join(UPLOAD_DIR, a.filename), () => {});
  db.prepare('DELETE FROM apps WHERE id=?').run(a.id);
  res.json({ ok: true });
});

// ---- play sessions ----
app.post('/api/sessions', auth, async (req, res) => {
  const a = db.prepare("SELECT * FROM apps WHERE id=? AND status='approved'").get(req.body.appId);
  if (!a) return res.status(404).json({ error: 'App not found.' });
  const open = db.prepare('SELECT id FROM sessions WHERE user=? AND ended IS NULL').get(req.user.id);
  if (open) return res.status(409).json({ error: 'You already have a running session.', sessionId: open.id });
  try {
    const s = await provider.start(a, req.user);
    const r = db.prepare('INSERT INTO sessions(user,app,remote,started) VALUES(?,?,?,?)')
      .run(req.user.id, a.id, s.remoteId, Date.now());
    res.json({ sessionId: r.lastInsertRowid, streamUrl: s.streamUrl, limitMinutes: MAX_SESSION_MIN, mock: s.note === 'mock' });
  } catch (e) { res.status(503).json({ error: 'No server is available right now. Try again soon.' }); }
});

async function endSession(row) {
  try { await provider.stop(row.remote); } catch {}
  db.prepare('UPDATE sessions SET ended=? WHERE id=?').run(Date.now(), row.id);
}

app.delete('/api/sessions/:id', auth, async (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id=? AND user=? AND ended IS NULL').get(req.params.id, req.user.id);
  if (!s) return res.status(404).json({ error: 'Session not found.' });
  await endSession(s);
  res.json({ ok: true });
});

// Reap sessions that exceeded the time limit.
setInterval(() => {
  const cutoff = Date.now() - MAX_SESSION_MIN * 60000;
  db.prepare('SELECT * FROM sessions WHERE ended IS NULL AND started<?').all(cutoff).forEach(endSession);
}, 60000);

app.listen(PORT, () => console.log(`CloudPlay running on http://localhost:${PORT}`));
