// Upload security: file-type check + ClamAV (clamd over TCP). Fails closed.
const fs = require('fs');
const net = require('net');
const HOST = process.env.CLAMD_HOST || 'clamav';
const PORT = +(process.env.CLAMD_PORT || 3310);
const OFF = process.env.SCAN_MODE === 'off' && process.env.NODE_ENV !== 'production';

function magicOk(p) {
  const b = Buffer.alloc(4); const fd = fs.openSync(p, 'r'); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd);
  return (b[0] === 0x4d && b[1] === 0x5a) || b.readUInt32BE(0) === 0xd0cf11e0; // MZ (exe) or OLE (msi)
}

function clamScan(p) {
  return new Promise((ok, no) => {
    const s = net.connect(PORT, HOST); let out = '';
    s.setTimeout(120000, () => { s.destroy(); no(new Error('scanner timeout')); });
    s.on('error', no);
    s.on('data', d => (out += d));
    s.on('close', () => ok(out));
    s.write('zINSTREAM\0');
    const rs = fs.createReadStream(p, { highWaterMark: 1 << 20 });
    rs.on('data', c => { const l = Buffer.alloc(4); l.writeUInt32BE(c.length); s.write(l); s.write(c); });
    rs.on('end', () => s.end(Buffer.alloc(4)));
    rs.on('error', no);
  });
}

// returns { clean, reason }. Throws if the scanner is unreachable (caller must reject the upload).
async function scan(p) {
  if (!magicOk(p)) return { clean: false, reason: 'Not a valid Windows executable or installer.' };
  if (OFF) return { clean: true };
  const r = await clamScan(p);
  if (/FOUND/.test(r)) return { clean: false, reason: 'Malware detected.' };
  if (!/OK/.test(r)) throw new Error('scanner error: ' + r);
  return { clean: true };
}
module.exports = { scan };
