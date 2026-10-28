// Minimal SMTP server for tests: accepts every message (AUTH accepted, no TLS) and writes it to <dir>/<n>.eml.
// usage: node smtp-sink.js <port> <dir>
const net = require('net'); const fs = require('fs'); const path = require('path');
const [port, dir] = [Number(process.argv[2] || 2525), process.argv[3] || './mail'];
fs.mkdirSync(dir, { recursive: true });
let n = 0;
net.createServer((sock) => {
  let data = false, buf = '', msg = [];
  const w = (s) => sock.write(s + '\r\n');
  w('220 sink ESMTP');
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; fs.writeFileSync(path.join(dir, `${Date.now()}-${++n}.eml`), msg.join('\n')); msg = []; w('250 OK queued'); }
        else msg.push(line.startsWith('..') ? line.slice(1) : line);
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === 'EHLO') { w('250-sink'); w('250-AUTH PLAIN LOGIN'); w('250 8BITMIME'); }
      else if (cmd === 'HELO') w('250 sink');
      else if (cmd === 'AUTH') { if (/AUTH LOGIN$/i.test(line)) { w('334 VXNlcm5hbWU6'); sock._login = 2; } else w('235 OK'); }
      else if (sock._login) { sock._login--; w(sock._login ? '334 UGFzc3dvcmQ6' : '235 OK'); }
      else if (cmd === 'MAIL' || cmd === 'RCPT' || cmd === 'RSET' || cmd === 'NOOP') w('250 OK');
      else if (cmd === 'DATA') { data = true; w('354 go'); }
      else if (cmd === 'QUIT') { w('221 bye'); sock.end(); }
      else w('250 OK');
    }
  });
  sock.on('error', () => {});
}).listen(port, '127.0.0.1', () => console.log(`smtp sink on ${port} -> ${dir}`));
