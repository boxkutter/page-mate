// A throwaway local RFC 3161 time-stamp authority built with openssl, for tests.
const fs = require('fs'), path = require('path'), http = require('http'), { spawnSync } = require('child_process');
module.exports = async function startTsa(dir) {
  const sh = (args, opts = {}) => spawnSync('openssl', args, { cwd: dir, encoding: 'utf8', ...opts });
  const w = (n, s) => fs.writeFileSync(path.join(dir, n), s);
  sh(['ts', '-query', '-digest', '00'.repeat(32), '-sha256', '-cert', '-no_nonce', '-out', 'other.tsq']);
  const refQuery = () => fs.readFileSync(path.join(dir, 'other.tsq'));
  let mode = 'good';
  sh(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', '/CN=Test CA', '-days', '2']);
  w('tsa.ext', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=critical,timeStamping\n');
  sh(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'tsa.key', '-out', 'tsa.csr', '-subj', '/CN=Test TSA']);
  sh(['x509', '-req', '-in', 'tsa.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'tsa.crt', '-days', '2', '-extfile', 'tsa.ext']);
  w('tsaserial', '01\n');
  w('tsa.cnf', `[ tsa ]\ndefault_tsa = t\n[ t ]\ndir = ${dir}\nserial = ${dir}/tsaserial\ncrypto_device = builtin\nsigner_cert = ${dir}/tsa.crt\ncerts = ${dir}/tsa.crt\nsigner_key = ${dir}/tsa.key\nsigner_digest = sha256\ndefault_policy = 1.2.3.4.1\nother_policies = 1.2.3.4.5.6\ndigests = sha256\naccuracy = secs:1\nordering = yes\ntsa_name = yes\ness_cert_id_chain = no\ness_cert_id_alg = sha256\n`);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (mode === 'down') { res.statusCode = 503; res.end('no'); return; }
      if (mode === 'junk') { res.end('hello'); return; }
      fs.writeFileSync(path.join(dir, 'req.tsq'), mode === 'other' ? refQuery() : body);
      const r = sh(['ts', '-reply', '-config', 'tsa.cnf', '-queryfile', 'req.tsq', '-out', 'resp.tsr']);
      if (r.status !== 0) { res.statusCode = 500; res.end(r.stderr); return; }
      res.setHeader('Content-Type', 'application/timestamp-reply');
      res.end(fs.readFileSync(path.join(dir, 'resp.tsr')));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/tsr';

  return { url, caFile: path.join(dir, 'ca.crt'), setMode: m => { mode = m; }, close: () => server.close() };
};
