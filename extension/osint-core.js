// Investigation helpers: pure logic, no browser APIs, so it can be unit tested in Node.
//
//   detect / refang / defang       what is this string, and make links safe to paste
//   extract                         pull emails, domains, IPs, hashes ... out of text
//   pivots / reverseImage / archive build the URLs for "look this up elsewhere" (we only OPEN them; nothing is sent by us)
//   dork                            search-operator query builder
//   share                           social share links, tracking-parameter cleaner, "is this safe to share?" warnings
//   tech / headers                  a small technology + security-header profile of a page
//
// Everything that touches page content is treated as untrusted text.
(function (root) {
  // ---------- defang / refang ----------

  function refang(s) {
    return String(s == null ? '' : s)
      .replace(/\bhxxp(s?)\b/gi, 'http$1')
      .replace(/\bh\*\*p(s?)\b/gi, 'http$1')
      .replace(/\bfxp\b/gi, 'ftp')
      .replace(/\[:\]|\(:\)/g, ':')
      .replace(/\[\s*\/\/\s*\]/g, '//')
      .replace(/\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}/gi, '.')
      .replace(/\[\s*(?:@|at)\s*\]|\(\s*(?:@|at)\s*\)/gi, '@');
  }

  // Makes an indicator harmless to click: hxxps://evil[.]example[.]com/a
  function defang(s) {
    let out = String(s == null ? '' : s);
    out = out.replace(/\bhttp(s?):\/\//gi, 'hxxp$1://').replace(/\bftp:\/\//gi, 'fxp://');
    // dots inside hosts only (leave the path and query alone)
    out = out.replace(/((?:hxxps?|fxp):\/\/)([^\s/?#]+)/gi, (_, scheme, host) => scheme + host.replace(/\./g, '[.]'));
    out = out.replace(/([A-Za-z0-9._%+'-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g, (_, local, host) => local + '[@]' + host.replace(/\./g, '[.]'));
    out = out.replace(/(^|[\s(<"'])((?:[a-z0-9-]+\.)+[a-z]{2,})(?=$|[\s)>"'/?#,;:])/gi, (m, pre, host) => /\[\.\]/.test(host) ? m : pre + host.replace(/\./g, '[.]'));
    out = out.replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, '$1[.]$2[.]$3[.]$4');
    return out;
  }

  // ---------- recognising things ----------

  const RE = {
    email: /^[A-Za-z0-9._%+'-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
    md5: /^[a-f0-9]{32}$/i,
    sha1: /^[a-f0-9]{40}$/i,
    sha256: /^[a-f0-9]{64}$/i,
    cve: /^CVE-\d{4}-\d{4,7}$/i,
    btc: /^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[ac-hj-np-z02-9]{11,71})$/,
    eth: /^0x[a-fA-F0-9]{40}$/,
    asn: /^AS\d{1,10}$/i,
    mac: /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i,
    latlon: /^\s*([-+]?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*([-+]?\d{1,3}(?:\.\d+)?)\s*$/,
    handle: /^@[A-Za-z0-9_.]{2,30}$/,
    analyticsId: /^(?:UA-\d{4,10}-\d{1,4}|G-[A-Z0-9]{8,12}|GTM-[A-Z0-9]{4,8}|ca-pub-\d{10,16}|AW-\d{6,12})$/
  };

  const GENERIC_TLDS = new Set(('com net org edu gov mil int info biz name pro mobi asia tel xxx app dev io ai co me tv cc ly ws to fm gg sh tech online site store shop blog cloud xyz top club live news media network agency digital email link click world today space life group solutions systems services support expert design studio works zone center social video ' +
    'ru cn jp de uk fr it es nl br in au ca ch se no fi dk pl cz at be ie pt gr hu ro bg sk si hr rs ua by kz tr il ir sa ae eg za ng ke mx ar cl pe co ve kr tw hk sg my th vn id ph pk bd lk np nz is lu lt lv ee cy mt mk ba al md ge am az uz kg ps iq sy lb jo ye om qa kw bh tn dz ma ly sd et tz ug gh sn ci cm cd ao mz zm zw bw na mu ' +
    'onion eu su').split(/\s+/));
  // Lookalikes of file extensions: fine when the user explicitly selects them, too noisy when scanning text.
  const NOISY_TLDS = new Set(['js', 'py', 'rs', 'sh', 'md', 'pl', 'so', 'ts', 'cs', 'rb', 'gz', 'ps', 'ai', 'cc', 'cd', 'is', 'in', 'it', 'me', 'to', 'no', 'at', 'be', 'by', 'am', 'id', 'my', 'do', 'hu', 'la', 'lv']);
  const DOMAIN_LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i;

  function ipv4Ok(s) { return RE.ipv4.test(s); }
  // Real validation by the URL parser (it knows every IPv6 shorthand); rejects MAC addresses and clock times.
  function ipv6Ok(s) {
    if (!/^[0-9a-f:.]+$/i.test(s) || (s.match(/:/g) || []).length < 2 || !/[0-9a-f]/i.test(s)) return false;
    try { return new URL('http://[' + s + ']/').hostname.startsWith('['); } catch (_) { return false; }
  }
  const FILE_EXT = new Set('txt pdf doc docx xls xlsx ppt pptx odt jpg jpeg png gif svg webp bmp ico heic mp3 mp4 m4a wav avi mkv mov css json xml csv tsv log tar gz tgz bz2 exe dll bat cmd html htm php asp aspx jsp py rb js mjs ts tsx jsx md ini cfg conf yml yaml toml lock bak tmp sql db sh java class jar c cpp h go rs'.split(' '));
  function isPrivateIp(ip) {
    if (!ipv4Ok(ip)) return /^(?:::1|fe80:|fc|fd)/i.test(ip);
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }

  function isDomain(s, { strict = false } = {}) {
    if (!s || s.length > 253 || !s.includes('.') || /\s/.test(s)) return false;
    const labels = s.toLowerCase().split('.');
    if (!labels.every(l => DOMAIN_LABEL.test(l))) return false;
    const tld = labels[labels.length - 1];
    if (/^\d+$/.test(tld)) return false;
    if (strict) return GENERIC_TLDS.has(tld) && !(NOISY_TLDS.has(tld) && labels.length === 2 && /^(?:index|main|app|test|readme|setup|config|script|utils?|common|types?|server|client|style|styles|package|file|data|run|build|make|lib|src|home)$/.test(labels[0]));
    return /^(?:[a-z]{2,24}|xn--[a-z0-9-]+)$/.test(tld);
  }

  function digitsOf(s) { return String(s).replace(/\D/g, ''); }

  function parseLatLon(s) {
    const m = RE.latlon.exec(s);
    if (!m) return null;
    const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
    if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
    // Two small whole numbers are far more likely a pair of counts than a place.
    if (!/\./.test(m[1]) && !/\./.test(m[2])) return null;
    return { lat, lon };
  }

  // What is this string? -> { type, value } with the cleaned value. `text` is the fallback.
  function detect(input) {
    let v = refang(String(input == null ? '' : input)).trim().replace(/^[<("'`]+|[>"'`.,;]+$/g, '').replace(/^tel:/i, '');
    if (/\)$/.test(v) && !/\(/.test(v)) v = v.slice(0, -1);
    if (!v) return { type: 'text', value: '' };
    const phoneLike = /^\+?[\d()\-.\s]{7,22}$/.test(v) && !RE.latlon.test(v) && !/^\d{4}-\d{2}-\d{2}/.test(v) && !/^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(v);
    if (phoneLike) {
      const n = digitsOf(v).length;
      if (n >= 8 && n <= 15 && (/^\+/.test(v) || (n >= 9 && /[\s().-]/.test(v)))) return { type: 'phone', value: v };
    }
    if (/\s/.test(v) && !RE.latlon.test(v)) return { type: 'text', value: String(input).trim() };
    if (/^https?:\/\//i.test(v)) { try { const u = new URL(v); if (u.hostname) return { type: 'url', value: u.href }; } catch (_) {} }
    if (/^mailto:/i.test(v)) v = v.slice(7).split('?')[0];
    if (RE.email.test(v)) return { type: 'email', value: v.toLowerCase() };
    if (ipv4Ok(v)) return { type: 'ipv4', value: v };
    if (RE.mac.test(v)) return { type: 'mac', value: v.toLowerCase() };
    if (ipv6Ok(v)) return { type: 'ipv6', value: v.toLowerCase() };
    if (RE.sha256.test(v)) return { type: 'sha256', value: v.toLowerCase() };
    if (RE.sha1.test(v)) return { type: 'sha1', value: v.toLowerCase() };
    if (RE.md5.test(v)) return { type: 'md5', value: v.toLowerCase() };
    if (RE.cve.test(v)) return { type: 'cve', value: v.toUpperCase() };
    if (RE.eth.test(v)) return { type: 'eth', value: v };
    if (RE.btc.test(v)) return { type: 'btc', value: v };
    if (RE.asn.test(v)) return { type: 'asn', value: v.toUpperCase() };
    if (RE.analyticsId.test(v)) return { type: 'analyticsId', value: v };
    const ll = parseLatLon(v);
    if (ll) return { type: 'latlon', value: ll.lat + ',' + ll.lon, lat: ll.lat, lon: ll.lon };
    if (RE.handle.test(v)) return { type: 'handle', value: v };
    // bare domain or host/path
    const hostPath = /^((?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+)(?:[/:?#].*)?$/.exec(v);
    if (hostPath && isDomain(hostPath[1]) && !(FILE_EXT.has(hostPath[1].split('.').pop().toLowerCase()) && !/[/?#:]/.test(v))) {
      if (/[/?#]/.test(v)) { try { const u = new URL('http://' + v); return { type: 'url', value: u.href }; } catch (_) {} }
      return { type: 'domain', value: hostPath[1].toLowerCase() };
    }
    if (/^[A-Za-z0-9_.]{3,30}$/.test(v) && !/^\d+$/.test(v)) return { type: 'username', value: v };
    return { type: 'text', value: String(input).trim() };
  }

  // ---------- extracting from text ----------

  const TYPE_LABEL = {
    url: 'Links', email: 'Email addresses', domain: 'Domains', ipv4: 'IPv4 addresses', ipv6: 'IPv6 addresses', phone: 'Phone numbers',
    handle: 'Handles (@name)', btc: 'Bitcoin addresses', eth: 'Ethereum addresses', md5: 'MD5 hashes', sha1: 'SHA-1 hashes', sha256: 'SHA-256 hashes',
    cve: 'CVE ids', asn: 'AS numbers', latlon: 'Coordinates', analyticsId: 'Analytics / ad ids', hashtag: 'Hashtags'
  };
  const TYPE_ORDER = ['email', 'phone', 'handle', 'url', 'domain', 'ipv4', 'ipv6', 'btc', 'eth', 'sha256', 'sha1', 'md5', 'cve', 'asn', 'latlon', 'analyticsId', 'hashtag'];

  function hasHexMix(s) { return /[a-f]/i.test(s) && /\d/.test(s); }

  // text: string. opts.links: [{href, text}], opts.max: cap per type.
  // -> { type: [{ value, count, sources: ['text'|'link'|'mailto'|'tel'] }] }
  function extract(text, opts = {}) {
    const max = opts.max || 2000;
    const found = {};
    const add = (type, value, source) => {
      if (!value) return;
      const bag = (found[type] = found[type] || new Map());
      const key = type === 'url' ? value : value;
      const e = bag.get(key);
      if (e) { e.count++; if (!e.sources.includes(source)) e.sources.push(source); }
      else if (bag.size < max) bag.set(key, { value, count: 1, sources: [source] });
    };

    let t = refang(String(text || '')).slice(0, 4_000_000);

    for (const l of opts.links || []) {
      const href = String(l.href || '').trim();
      if (!href) continue;
      if (/^mailto:/i.test(href)) { const a = href.slice(7).split('?')[0]; for (const part of decodeURIComponentSafe(a).split(',')) { const e = part.trim(); if (RE.email.test(e)) add('email', e.toLowerCase(), 'mailto'); } continue; }
      if (/^tel:/i.test(href)) { const p = decodeURIComponentSafe(href.slice(4)).trim(); if (digitsOf(p).length >= 6) add('phone', p, 'tel'); continue; }
      if (/^https?:\/\//i.test(href)) {
        try { const u = new URL(href); add('url', u.href, 'link'); if (isDomain(u.hostname) && !ipv4Ok(u.hostname)) add('domain', u.hostname.toLowerCase(), 'link'); else if (ipv4Ok(u.hostname)) add('ipv4', u.hostname, 'link'); } catch (_) {}
      }
    }

    // URLs first, then blank them out so their pieces aren't reported twice as emails/domains.
    t = t.replace(/\b(?:https?|ftp):\/\/[^\s<>"'`\\^{}|]+/gi, m => {
      const clean = m.replace(/[)\].,;:!?'"]+$/, '');
      try { const u = new URL(clean); add('url', u.href, 'text'); if (ipv4Ok(u.hostname)) add('ipv4', u.hostname, 'text'); else if (isDomain(u.hostname)) add('domain', u.hostname.toLowerCase(), 'text'); } catch (_) {}
      return ' ';
    });
    t = t.replace(/[A-Za-z0-9._%+'-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}/g, m => {
      m = m.replace(/^[.'-]+/, '');
      if (RE.email.test(m)) { add('email', m.toLowerCase(), 'text'); const host = m.split('@')[1].toLowerCase(); if (isDomain(host, { strict: true })) add('domain', host, 'text'); }
      return ' ';
    });
    for (const m of t.matchAll(/(?<![\w.:])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.]*\d)/g)) add('ipv4', m[0], 'text');
    for (const m of t.matchAll(/(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi)) if (ipv6Ok(m[0]) && !/^[\d:]+$/.test(m[0].replace(/^::/, '1::'))) add('ipv6', m[0].toLowerCase(), 'text');
    for (const m of t.matchAll(/\b[a-f0-9]{64}\b/gi)) if (hasHexMix(m[0])) add('sha256', m[0].toLowerCase(), 'text');
    for (const m of t.matchAll(/\b[a-f0-9]{40}\b/gi)) if (hasHexMix(m[0])) add('sha1', m[0].toLowerCase(), 'text');
    for (const m of t.matchAll(/\b[a-f0-9]{32}\b/gi)) if (hasHexMix(m[0])) add('md5', m[0].toLowerCase(), 'text');
    for (const m of t.matchAll(/\bCVE-\d{4}-\d{4,7}\b/gi)) add('cve', m[0].toUpperCase(), 'text');
    for (const m of t.matchAll(/\b0x[a-fA-F0-9]{40}\b/g)) add('eth', m[0], 'text');
    for (const m of t.matchAll(/(?<![\w])(?:bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})(?![\w])/g)) if (RE.btc.test(m[0]) && /\d/.test(m[0]) && /[a-zA-Z]/.test(m[0])) add('btc', m[0], 'text');
    for (const m of t.matchAll(/\b(?:UA-\d{4,10}-\d{1,4}|GTM-[A-Z0-9]{4,8}|ca-pub-\d{10,16})\b/g)) add('analyticsId', m[0], 'text');
    for (const m of t.matchAll(/\bG-[A-Z0-9]{10}\b/g)) if (/\d/.test(m[0])) add('analyticsId', m[0], 'text');
    for (const m of t.matchAll(/\bAS\d{2,10}\b/g)) add('asn', m[0], 'text');
    // phones: international (+...) anywhere, or national with separators
    for (const m of t.matchAll(/(?<![\w.+-])(\+\d[\d\s().-]{6,18}\d|\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{1,4})?)(?![\w-])/g)) {
      const raw = m[1].trim(), n = digitsOf(raw).length;
      if (n < 8 || n > 15) continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(raw) || /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(raw)) continue; // dates
      if (ipv4Ok(raw)) continue;
      add('phone', raw.replace(/\s+/g, ' '), 'text');
    }
    for (const m of t.matchAll(/(?<![\w@./-])(-?\d{1,2}\.\d{3,8})\s*,\s*(-?\d{1,3}\.\d{3,8})(?!\w|\.\d)/g)) { const ll = parseLatLon(m[1] + ',' + m[2]); if (ll) add('latlon', ll.lat + ',' + ll.lon, 'text'); }
    for (const m of t.matchAll(/(?<![\w@/])@([A-Za-z0-9_]{2,30})\b/g)) add('handle', '@' + m[1], 'text');
    for (const m of t.matchAll(/(?<![\w&#])#([A-Za-z][A-Za-z0-9_]{2,40})\b/g)) add('hashtag', '#' + m[1], 'text');
    // bare domains, last, so the URL/email text has already been blanked out
    for (const m of t.matchAll(/(?<![\w@.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?![\w@-])/gi)) {
      const d = m[1].toLowerCase().replace(/\.$/, '');
      if (!ipv4Ok(d) && isDomain(d, { strict: true })) add('domain', d, 'text');
    }

    const out = {};
    for (const type of TYPE_ORDER) {
      if (!found[type]) continue;
      out[type] = [...found[type].values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    }
    return out;
  }

  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (_) { return s; } }

  function entityRows(entities) {
    const rows = [];
    for (const type of TYPE_ORDER) for (const e of entities[type] || []) rows.push({ type, value: e.value, count: e.count, sources: e.sources.join('+') });
    return rows;
  }
  const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  function entitiesCsv(entities, page) {
    const head = ['type', 'value', 'count', 'found_in', 'page_url', 'page_title'];
    const p = page || {};
    return head.join(',') + '\n' + entityRows(entities).map(r => [r.type, r.value, r.count, r.sources, p.url || '', p.title || ''].map(csvCell).join(',')).join('\n') + '\n';
  }
  function entitiesMarkdown(entities, page) {
    const p = page || {};
    const L = ['# Entities found on a page', ''];
    if (p.url) L.push('- **Page:** ' + (p.title ? p.title + ' — ' : '') + p.url);
    if (p.at) L.push('- **Extracted (UTC):** ' + p.at);
    L.push('');
    for (const type of TYPE_ORDER) {
      const list = entities[type];
      if (!list || !list.length) continue;
      L.push('## ' + TYPE_LABEL[type] + ' (' + list.length + ')', '');
      for (const e of list) L.push('- `' + e.value.replace(/`/g, "'") + '`' + (e.count > 1 ? ' ×' + e.count : ''));
      L.push('');
    }
    return L.join('\n');
  }

  // ---------- lookups ("pivots") ----------

  const enc = encodeURIComponent;

  // types: which detected types this service understands. '*' = anything.
  const SERVICES = [
    // general search (always offered)
    { id: 'google', name: 'Google', cat: 'Search', types: ['*'], url: 'https://www.google.com/search?q={q}' },
    { id: 'google-exact', name: 'Google (exact phrase)', cat: 'Search', types: ['email', 'phone', 'handle', 'username', 'text', 'btc', 'eth', 'analyticsId', 'md5', 'sha1', 'sha256'], url: 'https://www.google.com/search?q=%22{q}%22' },
    { id: 'bing', name: 'Bing', cat: 'Search', types: ['*'], url: 'https://www.bing.com/search?q={q}' },
    { id: 'ddg', name: 'DuckDuckGo', cat: 'Search', types: ['*'], url: 'https://duckduckgo.com/?q={q}' },
    { id: 'yandex', name: 'Yandex', cat: 'Search', types: ['email', 'phone', 'handle', 'username', 'text', 'domain'], url: 'https://yandex.com/search/?text={q}' },
    { id: 'scholar', name: 'Google Scholar', cat: 'Search', types: ['text'], url: 'https://scholar.google.com/scholar?q={q}' },
    { id: 'github-code', name: 'GitHub code search', cat: 'Search', types: ['email', 'domain', 'username', 'text', 'ipv4', 'analyticsId'], url: 'https://github.com/search?q=%22{q}%22&type=code' },
    // domains
    { id: 'vt-domain', name: 'VirusTotal', cat: 'Reputation', types: ['domain'], url: 'https://www.virustotal.com/gui/domain/{q}' },
    { id: 'urlscan-domain', name: 'urlscan.io', cat: 'Reputation', types: ['domain'], url: 'https://urlscan.io/search/#domain:{q}' },
    { id: 'crtsh', name: 'crt.sh (certificates)', cat: 'Infrastructure', types: ['domain'], url: 'https://crt.sh/?q={q}' },
    { id: 'rdap-domain', name: 'RDAP / WHOIS', cat: 'Registration', types: ['domain'], url: 'https://rdap.org/domain/{q}' },
    { id: 'whois-domain', name: 'who.is', cat: 'Registration', types: ['domain'], url: 'https://who.is/whois/{q}' },
    { id: 'securitytrails', name: 'SecurityTrails (DNS history)', cat: 'Infrastructure', types: ['domain'], url: 'https://securitytrails.com/domain/{q}/dns' },
    { id: 'shodan-host', name: 'Shodan (hostname)', cat: 'Infrastructure', types: ['domain'], url: 'https://www.shodan.io/search?query=hostname%3A{q}' },
    { id: 'censys-host', name: 'Censys', cat: 'Infrastructure', types: ['domain'], url: 'https://search.censys.io/search?resource=hosts&q={q}' },
    { id: 'builtwith', name: 'BuiltWith', cat: 'Technology', types: ['domain'], url: 'https://builtwith.com/{q}' },
    { id: 'wayback-domain', name: 'Wayback Machine', cat: 'Archive', types: ['domain'], url: 'https://web.archive.org/web/*/{q}' },
    { id: 'talos-domain', name: 'Cisco Talos reputation', cat: 'Reputation', types: ['domain', 'ipv4'], url: 'https://talosintelligence.com/reputation_center/lookup?search={q}' },
    // ips
    { id: 'vt-ip', name: 'VirusTotal', cat: 'Reputation', types: ['ipv4', 'ipv6'], url: 'https://www.virustotal.com/gui/ip-address/{q}' },
    { id: 'shodan-ip', name: 'Shodan', cat: 'Infrastructure', types: ['ipv4', 'ipv6'], url: 'https://www.shodan.io/host/{q}' },
    { id: 'censys-ip', name: 'Censys', cat: 'Infrastructure', types: ['ipv4', 'ipv6'], url: 'https://search.censys.io/hosts/{q}' },
    { id: 'abuseipdb', name: 'AbuseIPDB', cat: 'Reputation', types: ['ipv4', 'ipv6'], url: 'https://www.abuseipdb.com/check/{q}' },
    { id: 'greynoise', name: 'GreyNoise', cat: 'Reputation', types: ['ipv4', 'ipv6'], url: 'https://viz.greynoise.io/ip/{q}' },
    { id: 'bgphe-ip', name: 'bgp.he.net', cat: 'Infrastructure', types: ['ipv4', 'ipv6'], url: 'https://bgp.he.net/ip/{q}' },
    { id: 'rdap-ip', name: 'RDAP / WHOIS', cat: 'Registration', types: ['ipv4', 'ipv6'], url: 'https://rdap.org/ip/{q}' },
    { id: 'ipinfo', name: 'ipinfo.io', cat: 'Infrastructure', types: ['ipv4', 'ipv6'], url: 'https://ipinfo.io/{q}' },
    { id: 'urlscan-ip', name: 'urlscan.io', cat: 'Reputation', types: ['ipv4', 'ipv6'], url: 'https://urlscan.io/search/#ip:{q}' },
    // urls
    { id: 'vt-url', name: 'VirusTotal', cat: 'Reputation', types: ['url'], url: 'https://www.virustotal.com/gui/search/{q}' },
    { id: 'urlscan-url', name: 'urlscan.io', cat: 'Reputation', types: ['url'], url: 'https://urlscan.io/search/#{q}' },
    { id: 'wayback-url', name: 'Wayback Machine', cat: 'Archive', types: ['url'], url: 'https://web.archive.org/web/*/{raw}' },
    { id: 'archiveph-url', name: 'archive.today', cat: 'Archive', types: ['url'], url: 'https://archive.ph/newest/{raw}' },
    { id: 'gsb', name: 'Google Safe Browsing status', cat: 'Reputation', types: ['url'], url: 'https://transparencyreport.google.com/safe-browsing/search?url={q}' },
    // emails
    { id: 'epieos', name: 'Epieos', cat: 'Accounts', types: ['email'], url: 'https://epieos.com/?q={q}&t=email' },
    { id: 'email-domain-whois', name: 'Email’s domain: RDAP', cat: 'Registration', types: ['email'], url: 'https://rdap.org/domain/{domain}' },
    // hashes
    { id: 'vt-file', name: 'VirusTotal', cat: 'Reputation', types: ['md5', 'sha1', 'sha256'], url: 'https://www.virustotal.com/gui/file/{q}' },
    { id: 'malwarebazaar', name: 'MalwareBazaar', cat: 'Reputation', types: ['md5', 'sha1', 'sha256'], url: 'https://bazaar.abuse.ch/browse.php?search={q}' },
    { id: 'hybrid', name: 'Hybrid Analysis', cat: 'Reputation', types: ['md5', 'sha1', 'sha256'], url: 'https://www.hybrid-analysis.com/search?query={q}' },
    // cve
    { id: 'nvd', name: 'NVD', cat: 'Vulnerability', types: ['cve'], url: 'https://nvd.nist.gov/vuln/detail/{q}' },
    { id: 'cveorg', name: 'CVE.org', cat: 'Vulnerability', types: ['cve'], url: 'https://www.cve.org/CVERecord?id={q}' },
    { id: 'exploitdb', name: 'Exploit-DB', cat: 'Vulnerability', types: ['cve'], url: 'https://www.exploit-db.com/search?cve={q}' },
    { id: 'ghadv', name: 'GitHub advisories', cat: 'Vulnerability', types: ['cve'], url: 'https://github.com/advisories?query={q}' },
    // crypto
    { id: 'blockchair-btc', name: 'Blockchair', cat: 'Blockchain', types: ['btc'], url: 'https://blockchair.com/bitcoin/address/{q}' },
    { id: 'blockstream', name: 'Blockstream explorer', cat: 'Blockchain', types: ['btc'], url: 'https://blockstream.info/address/{q}' },
    { id: 'etherscan', name: 'Etherscan', cat: 'Blockchain', types: ['eth'], url: 'https://etherscan.io/address/{q}' },
    { id: 'blockchair-eth', name: 'Blockchair', cat: 'Blockchain', types: ['eth'], url: 'https://blockchair.com/ethereum/address/{q}' },
    // asn / mac
    { id: 'bgphe-asn', name: 'bgp.he.net', cat: 'Infrastructure', types: ['asn'], url: 'https://bgp.he.net/{q}' },
    { id: 'peeringdb', name: 'PeeringDB', cat: 'Infrastructure', types: ['asn'], url: 'https://www.peeringdb.com/asn/{num}' },
    { id: 'maclookup', name: 'MAC vendor lookup', cat: 'Infrastructure', types: ['mac'], url: 'https://maclookup.app/search/result?mac={q}' },
    // analytics ids: sites sharing an id are often run by the same people
    { id: 'publicwww', name: 'PublicWWW (sites using this id)', cat: 'Linked sites', types: ['analyticsId'], url: 'https://publicwww.com/websites/%22{q}%22/' },
    { id: 'urlscan-id', name: 'urlscan.io', cat: 'Linked sites', types: ['analyticsId'], url: 'https://urlscan.io/search/#%22{q}%22' },
    // places
    { id: 'gmaps', name: 'Google Maps', cat: 'Maps', types: ['latlon'], url: 'https://www.google.com/maps?q={lat},{lon}' },
    { id: 'osm', name: 'OpenStreetMap', cat: 'Maps', types: ['latlon'], url: 'https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=17/{lat}/{lon}' },
    { id: 'gearth', name: 'Google Earth', cat: 'Maps', types: ['latlon'], url: 'https://earth.google.com/web/search/{lat},{lon}' },
    { id: 'sentinel', name: 'Sentinel Hub EO Browser', cat: 'Maps', types: ['latlon'], url: 'https://apps.sentinel-hub.com/eo-browser/?zoom=14&lat={lat}&lng={lon}' },
    { id: 'gmaps-search', name: 'Google Maps search', cat: 'Maps', types: ['text'], url: 'https://www.google.com/maps/search/{q}' },
    // people / handles (opens a profile page or a search; nothing is scraped)
    { id: 'p-github', name: 'GitHub', cat: 'Profiles', types: ['handle', 'username'], url: 'https://github.com/{user}' },
    { id: 'p-x', name: 'X / Twitter', cat: 'Profiles', types: ['handle', 'username'], url: 'https://x.com/{user}' },
    { id: 'p-instagram', name: 'Instagram', cat: 'Profiles', types: ['handle', 'username'], url: 'https://www.instagram.com/{user}/' },
    { id: 'p-reddit', name: 'Reddit', cat: 'Profiles', types: ['handle', 'username'], url: 'https://www.reddit.com/user/{user}' },
    { id: 'p-tiktok', name: 'TikTok', cat: 'Profiles', types: ['handle', 'username'], url: 'https://www.tiktok.com/@{user}' },
    { id: 'p-youtube', name: 'YouTube', cat: 'Profiles', types: ['handle', 'username'], url: 'https://www.youtube.com/@{user}' },
    { id: 'p-telegram', name: 'Telegram', cat: 'Profiles', types: ['handle', 'username'], url: 'https://t.me/{user}' },
    { id: 'p-keybase', name: 'Keybase', cat: 'Profiles', types: ['username', 'handle'], url: 'https://keybase.io/{user}' }
  ];

  function fillTemplate(tpl, d) {
    const v = d.value;
    const vars = {
      q: enc(v), raw: v, user: enc(v.replace(/^@/, '')), lat: d.lat != null ? String(d.lat) : '', lon: d.lon != null ? String(d.lon) : '',
      domain: enc(v.includes('@') ? v.split('@')[1] : hostOf(v)), num: enc(v.replace(/^AS/i, ''))
    };
    return tpl.replace(/\{(q|raw|user|lat|lon|domain|num)\}/g, (_, k) => vars[k]);
  }

  function hostOf(v) {
    try { return new URL(/^[a-z]+:\/\//i.test(v) ? v : 'http://' + v).hostname; } catch (_) { return v; }
  }

  // A URL gives us a domain to look up too: offer both sets.
  function derived(d) {
    const out = [d];
    if (d.type === 'url') {
      const h = hostOf(d.value);
      if (ipv4Ok(h)) out.push({ type: 'ipv4', value: h });
      else if (h) out.push({ type: 'domain', value: h.replace(/^www\./, '') });
    }
    if (d.type === 'email') { const dom = d.value.split('@')[1]; if (dom) out.push({ type: 'domain', value: dom }); out.push({ type: 'username', value: d.value.split('@')[0] }); }
    return out;
  }

  // custom: user-defined [{name, types, url}] (see parseCustomServices)
  function pivots(input, custom = []) {
    const d = typeof input === 'string' ? detect(input) : input;
    if (!d.value) return { detected: d, groups: [] };
    const groups = [];
    for (const target of derived(d)) {
      const items = [];
      for (const s of SERVICES.concat(custom || [])) {
        const generic = s.types.includes('*');
        if (!generic && !s.types.includes(target.type)) continue;
        if (target !== d && generic) continue; // search engines once, for the original string
        items.push({ id: s.id, name: s.name, cat: s.cat || 'Custom', url: fillTemplate(s.url, target), custom: !!s.custom });
      }
      if (items.length) groups.push({ type: target.type, value: target.value, items });
    }
    return { detected: d, groups };
  }

  // Options-page JSON: [{ "name": "...", "types": ["domain"], "url": "https://x.example/?q={q}" }]
  function parseCustomServices(json) {
    const errors = [], out = [];
    let arr;
    try { arr = JSON.parse(json || '[]'); } catch (e) { return { services: [], errors: ['Not valid JSON: ' + e.message] }; }
    if (!Array.isArray(arr)) return { services: [], errors: ['Expected a list: [ {...}, {...} ]'] };
    arr.forEach((s, i) => {
      const n = '#' + (i + 1);
      if (!s || typeof s.name !== 'string' || !s.name.trim()) { errors.push(n + ': missing "name"'); return; }
      if (typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) { errors.push(n + ': "url" must start with http:// or https://'); return; }
      if (!/\{(q|raw|user|lat|lon|domain|num)\}/.test(s.url)) { errors.push(n + ': "url" needs a {q} placeholder'); return; }
      const types = (Array.isArray(s.types) && s.types.length ? s.types : ['*']).map(String);
      out.push({ id: 'custom-' + i, name: s.name.trim().slice(0, 60), cat: 'Custom', types, url: s.url, custom: true });
    });
    return { services: out, errors };
  }

  // ---------- reverse image search ----------

  const REVERSE_IMAGE = [
    { id: 'lens', name: 'Google Lens', url: 'https://lens.google.com/uploadbyurl?url={q}' },
    { id: 'bing', name: 'Bing Visual Search', url: 'https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{q}' },
    { id: 'yandex', name: 'Yandex Images', url: 'https://yandex.com/images/search?rpt=imageview&url={q}' },
    { id: 'tineye', name: 'TinEye', url: 'https://tineye.com/search?url={q}' },
    { id: 'baidu', name: 'Baidu Images', url: 'https://graph.baidu.com/details?isfromtusoupc=1&tn=pc&image={q}' }
  ];
  // Engines that need the picture itself (for files and video frames): open their upload page after copying the image.
  const REVERSE_IMAGE_UPLOAD = [
    { id: 'lens', name: 'Google Lens', url: 'https://lens.google.com/' },
    { id: 'bing', name: 'Bing Visual Search', url: 'https://www.bing.com/visualsearch' },
    { id: 'yandex', name: 'Yandex Images', url: 'https://yandex.com/images/' },
    { id: 'tineye', name: 'TinEye', url: 'https://tineye.com/' }
  ];
  function reverseImageUrl(engineId, imageUrl) {
    const e = REVERSE_IMAGE.find(x => x.id === engineId);
    if (!e || !/^https?:\/\//i.test(imageUrl || '')) return null;
    return e.url.replace('{q}', enc(imageUrl));
  }

  // ---------- archives ----------

  const stripFrag = u => String(u).split('#')[0];
  function archiveLinks(pageUrl) {
    const u = stripFrag(pageUrl);
    return {
      waybackAll: 'https://web.archive.org/web/*/' + u,
      waybackNewest: 'https://web.archive.org/web/' + u,
      waybackSave: 'https://web.archive.org/save/' + u,
      archiveTodayNewest: 'https://archive.ph/newest/' + u,
      archiveTodaySave: 'https://archive.ph/?run=1&url=' + enc(u),
      ghostarchive: 'https://ghostarchive.org/search?term=' + enc(u),
      cdxApi: cdxUrl(u),
      availabilityApi: 'https://archive.org/wayback/available?url=' + enc(u)
    };
  }
  function cdxUrl(pageUrl, { limit = 200 } = {}) {
    return 'https://web.archive.org/cdx/search/cdx?url=' + enc(stripFrag(pageUrl)) + '&output=json&fl=timestamp,original,statuscode,mimetype,digest,length&collapse=digest&limit=' + limit;
  }
  function wbDate(ts) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(ts || '');
    return m ? m[1] + '-' + m[2] + '-' + m[3] + (m[4] ? 'T' + m[4] + ':' + (m[5] || '00') + ':' + (m[6] || '00') + 'Z' : '') : '';
  }
  // CDX json -> newest first. Rows after the header: [timestamp, original, statuscode, mimetype, digest, length]
  function parseCdx(json) {
    if (!Array.isArray(json) || json.length < 2) return [];
    const head = json[0];
    const idx = n => head.indexOf(n);
    const rows = json.slice(1).map(r => ({
      timestamp: r[idx('timestamp')], original: r[idx('original')], status: r[idx('statuscode')], mime: r[idx('mimetype')], digest: r[idx('digest')], length: Number(r[idx('length')]) || 0
    })).filter(r => /^\d{8,14}$/.test(r.timestamp || ''));
    rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return rows.map(r => ({ ...r, date: wbDate(r.timestamp), url: 'https://web.archive.org/web/' + r.timestamp + '/' + r.original }));
  }
  function parseAvailability(json) {
    const c = json && json.archived_snapshots && json.archived_snapshots.closest;
    if (!c || !c.available || !/^https?:\/\//.test(c.url || '')) return null;
    return { url: c.url.replace(/^http:\/\//, 'https://'), timestamp: c.timestamp, date: wbDate(c.timestamp), status: c.status };
  }

  // ---------- search-operator builder ("dorks") ----------

  function quoteIf(s) { s = String(s).trim(); return /\s/.test(s) && !/^".*"$/.test(s) ? '"' + s + '"' : s; }
  // f: { all, exact, any: [], none: [], site, filetype, inurl, intitle, intext, before, after }
  function dork(f) {
    const parts = [];
    if (f.all) parts.push(String(f.all).trim());
    if (f.exact) parts.push('"' + String(f.exact).replace(/"/g, '').trim() + '"');
    const any = (f.any || []).map(s => String(s).trim()).filter(Boolean);
    if (any.length) parts.push(any.length > 1 ? '(' + any.map(quoteIf).join(' OR ') + ')' : quoteIf(any[0]));
    for (const w of (f.none || []).map(s => String(s).trim()).filter(Boolean)) parts.push('-' + quoteIf(w));
    if (f.site) parts.push('site:' + String(f.site).trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
    if (f.filetype) parts.push('filetype:' + String(f.filetype).trim().replace(/^\./, ''));
    if (f.inurl) parts.push('inurl:' + quoteIf(f.inurl));
    if (f.intitle) parts.push('intitle:' + quoteIf(f.intitle));
    if (f.intext) parts.push('intext:' + quoteIf(f.intext));
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.after || '')) parts.push('after:' + f.after);
    if (/^\d{4}-\d{2}-\d{2}$/.test(f.before || '')) parts.push('before:' + f.before);
    return parts.join(' ').trim();
  }
  const SEARCH_ENGINES = [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q={q}' },
    { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q={q}' },
    { id: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={q}' },
    { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text={q}' },
    { id: 'brave', name: 'Brave Search', url: 'https://search.brave.com/search?q={q}' }
  ];
  const DORK_PRESETS = [
    { name: 'Documents published on a site', needs: 'site', build: s => dork({ site: s, any: ['filetype:pdf', 'filetype:doc', 'filetype:docx', 'filetype:xls', 'filetype:xlsx', 'filetype:ppt', 'filetype:pptx'] }) },
    { name: 'Subdomains search engines know about', needs: 'site', build: s => 'site:*.' + s.replace(/^www\./, '') + ' -site:www.' + s.replace(/^www\./, '') },
    { name: 'Mentions of a site elsewhere', needs: 'site', build: s => '"' + s.replace(/^www\./, '') + '" -site:' + s.replace(/^www\./, '') },
    { name: 'Pages from a site that mention a word', needs: 'site+word', build: (s, w) => dork({ site: s, exact: w }) },
    { name: 'Person on professional networks', needs: 'word', build: w => '(site:linkedin.com/in OR site:xing.com/profile) "' + w.replace(/"/g, '') + '"' },
    { name: 'Name or phrase in news (last year)', needs: 'word', build: w => '"' + w.replace(/"/g, '') + '" (site:news.google.com OR inurl:news)' },
    { name: 'Spreadsheets and PDFs mentioning an exact phrase', needs: 'word', build: w => '"' + w.replace(/"/g, '') + '" (filetype:pdf OR filetype:xlsx OR filetype:csv)' }
  ];
  function searchUrl(engineId, query) {
    const e = SEARCH_ENGINES.find(x => x.id === engineId);
    return e ? e.url.replace('{q}', enc(query)) : null;
  }

  // ---------- sharing ----------

  const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|igshid|igsh|ref_src|ref_url|s_cid|_ga|_gl|yclid|twclid|ttclid|vero_id|oly_enc_id|oly_anon_id|spm|share_id|si|feature|pp)$/i;
  const SECRET_PARAMS = /^(token|access_token|id_token|refresh_token|auth|authorization|key|api_key|apikey|secret|sig|signature|session|sessionid|sid|password|passwd|pwd|code|otp|x-amz-[a-z-]+|x-goog-[a-z-]+|expires|policy|jwt|bearer)$/i;

  function cleanUrl(u) {
    try {
      const url = new URL(u);
      const drop = [];
      for (const k of url.searchParams.keys()) if (TRACKING_PARAMS.test(k)) drop.push(k);
      for (const k of drop) url.searchParams.delete(k);
      return url.href.replace(/\?$/, '');
    } catch (_) { return u; }
  }

  // Reasons NOT to post this address publicly. Empty list = nothing noticed (not a guarantee).
  function shareWarnings(u) {
    const w = [];
    let url;
    try { url = new URL(u); } catch (_) { return ['This isn’t a normal web address.']; }
    if (!/^https?:$/.test(url.protocol)) w.push('Only web pages (http/https) can be shared by link.');
    const h = url.hostname;
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || isPrivateIp(h)) w.push('This is a private or local address; nobody else can open it.');
    if (url.username || url.password) w.push('The address contains a username or password.');
    const secrets = [...url.searchParams.keys()].filter(k => SECRET_PARAMS.test(k));
    if (secrets.length) w.push('The address carries what looks like a private token or signature (' + secrets.join(', ') + '). Anyone with it may get into your account or file.');
    if (/\/(account|settings|billing|checkout|login|signin|inbox|messages|admin)(\/|$)/i.test(url.pathname)) w.push('This looks like a signed-in or account page.');
    return w;
  }

  const SHARE_CHANNELS = [
    { id: 'x', name: 'X', limit: 280, urlWeight: 23, build: (p) => 'https://x.com/intent/post?text=' + enc(p.text) + '&url=' + enc(p.url) },
    { id: 'bluesky', name: 'Bluesky', limit: 300, build: (p) => 'https://bsky.app/intent/compose?text=' + enc(p.text + ' ' + p.url) },
    { id: 'mastodon', name: 'Mastodon', limit: 500, needsInstance: true, build: (p) => 'https://' + p.instance + '/share?text=' + enc(p.text + ' ' + p.url) },
    { id: 'threads', name: 'Threads', limit: 500, build: (p) => 'https://www.threads.net/intent/post?text=' + enc(p.text + ' ' + p.url) },
    { id: 'reddit', name: 'Reddit', limit: 300, build: (p) => 'https://www.reddit.com/submit?url=' + enc(p.url) + '&title=' + enc(p.title || p.text) },
    { id: 'linkedin', name: 'LinkedIn', build: (p) => 'https://www.linkedin.com/sharing/share-offsite/?url=' + enc(p.url) },
    { id: 'facebook', name: 'Facebook', build: (p) => 'https://www.facebook.com/sharer/sharer.php?u=' + enc(p.url) + '&quote=' + enc(p.text) },
    { id: 'telegram', name: 'Telegram', build: (p) => 'https://t.me/share/url?url=' + enc(p.url) + '&text=' + enc(p.text) },
    { id: 'whatsapp', name: 'WhatsApp', build: (p) => 'https://wa.me/?text=' + enc(p.text + ' ' + p.url) },
    { id: 'hn', name: 'Hacker News', build: (p) => 'https://news.ycombinator.com/submitlink?u=' + enc(p.url) + '&t=' + enc(p.title || p.text) },
    { id: 'email', name: 'Email', build: (p) => 'mailto:?subject=' + enc(p.title || p.text) + '&body=' + enc(p.text + '\n\n' + p.url) }
  ];

  function mastodonInstance(s) {
    const h = String(s || '').trim().replace(/^https?:\/\//i, '').replace(/^@?[^@\s/]*@/, '').replace(/\/.*$/, '').toLowerCase();
    return isDomain(h) ? h : '';
  }

  function truncate(s, max) {
    s = String(s || '');
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, m => m.length > 20 ? '' : m).trimEnd() + '…';
  }

  // Builds the text that goes with the link, within the channel's length limit (the link is counted too).
  // p: { title, quote, note, hashtags: [], via }
  function composeText(p, channel) {
    const parts = [];
    if (p.note) parts.push(p.note.trim());
    if (p.quote) parts.push('“' + p.quote.trim().replace(/\s+/g, ' ') + '”');
    else if (p.title && !p.note) parts.push(p.title.trim());
    const tags = (p.hashtags || []).map(t => '#' + String(t).replace(/^#/, '').replace(/[^\w]/g, '')).filter(t => t.length > 1).join(' ');
    let text = parts.join(' — ');
    if (!channel || !channel.limit) return [text, tags].filter(Boolean).join('\n');
    const linkLen = (channel.urlWeight || (p.url || '').length) + 1;
    const room = channel.limit - linkLen - (tags ? tags.length + 1 : 0);
    text = truncate(text, Math.max(0, room));
    return [text, tags].filter(Boolean).join(' ');
  }

  // p: { url, title, quote, note, hashtags, instance, clean: bool }
  function shareLinks(p, channelIds) {
    const url = p.clean === false ? p.url : cleanUrl(p.url);
    const out = [];
    for (const c of SHARE_CHANNELS) {
      if (channelIds && !channelIds.includes(c.id)) continue;
      if (c.needsInstance && !p.instance) { out.push({ id: c.id, name: c.name, href: '', needs: 'instance' }); continue; }
      const text = composeText(p, c);
      out.push({ id: c.id, name: c.name, href: c.build({ ...p, url, text }), text, over: c.limit ? text.length + (c.urlWeight || url.length) + 1 > c.limit : false });
    }
    return out;
  }

  // ---------- a page's technical profile ----------

  const TECH = [
    { name: 'WordPress', cat: 'CMS', any: [{ meta: 'generator', re: /wordpress/i }, { src: /\/wp-(content|includes)\// }, { header: 'x-powered-by', re: /wordpress/i }] },
    { name: 'Drupal', cat: 'CMS', any: [{ meta: 'generator', re: /drupal/i }, { header: 'x-generator', re: /drupal/i }, { src: /\/sites\/(default|all)\/(files|modules)\// }] },
    { name: 'Joomla', cat: 'CMS', any: [{ meta: 'generator', re: /joomla/i }] },
    { name: 'Ghost', cat: 'CMS', any: [{ meta: 'generator', re: /^ghost/i }] },
    { name: 'Hugo', cat: 'Static site', any: [{ meta: 'generator', re: /^hugo/i }] },
    { name: 'Jekyll', cat: 'Static site', any: [{ meta: 'generator', re: /jekyll/i }] },
    { name: 'Wix', cat: 'Hosted builder', any: [{ meta: 'generator', re: /wix\.com/i }, { src: /static\.parastorage\.com|wixstatic\.com/ }] },
    { name: 'Squarespace', cat: 'Hosted builder', any: [{ meta: 'generator', re: /squarespace/i }, { src: /static1\.squarespace\.com/ }] },
    { name: 'Shopify', cat: 'E-commerce', any: [{ src: /cdn\.shopify\.com/ }, { header: 'x-shopify-stage', re: /./ }] },
    { name: 'Webflow', cat: 'Hosted builder', any: [{ meta: 'generator', re: /webflow/i }] },
    { name: 'Next.js', cat: 'Framework', any: [{ src: /\/_next\/static\// }, { header: 'x-powered-by', re: /next\.js/i }] },
    { name: 'Nuxt', cat: 'Framework', any: [{ src: /\/_nuxt\// }] },
    { name: 'React', cat: 'Library', any: [{ src: /react(\.production|-dom)?(\.min)?\.js/i }] },
    { name: 'jQuery', cat: 'Library', any: [{ src: /jquery[-.\d]*(\.min)?\.js/i }] },
    { name: 'Bootstrap', cat: 'Library', any: [{ href: /bootstrap[-.\d]*(\.min)?\.css/i }, { src: /bootstrap[-.\d]*(\.bundle)?(\.min)?\.js/i }] },
    { name: 'nginx', cat: 'Server', any: [{ header: 'server', re: /nginx/i }] },
    { name: 'Apache', cat: 'Server', any: [{ header: 'server', re: /apache/i }] },
    { name: 'Microsoft IIS', cat: 'Server', any: [{ header: 'server', re: /iis/i }] },
    { name: 'LiteSpeed', cat: 'Server', any: [{ header: 'server', re: /litespeed/i }] },
    { name: 'Cloudflare', cat: 'CDN / host', any: [{ header: 'server', re: /cloudflare/i }, { header: 'cf-ray', re: /./ }] },
    { name: 'Amazon CloudFront', cat: 'CDN / host', any: [{ header: 'x-amz-cf-id', re: /./ }, { header: 'via', re: /cloudfront/i }] },
    { name: 'Fastly', cat: 'CDN / host', any: [{ header: 'x-served-by', re: /cache-/i }, { header: 'via', re: /varnish/i }] },
    { name: 'Akamai', cat: 'CDN / host', any: [{ header: 'server', re: /akamai/i }, { header: 'x-akamai-transformed', re: /./ }] },
    { name: 'Vercel', cat: 'CDN / host', any: [{ header: 'server', re: /vercel/i }, { header: 'x-vercel-id', re: /./ }] },
    { name: 'Netlify', cat: 'CDN / host', any: [{ header: 'server', re: /netlify/i }, { header: 'x-nf-request-id', re: /./ }] },
    { name: 'GitHub Pages', cat: 'CDN / host', any: [{ header: 'server', re: /github\.com/i }] },
    { name: 'PHP', cat: 'Language', any: [{ header: 'x-powered-by', re: /php/i }] },
    { name: 'ASP.NET', cat: 'Language', any: [{ header: 'x-powered-by', re: /asp\.net/i }, { header: 'x-aspnet-version', re: /./ }] },
    { name: 'Express', cat: 'Framework', any: [{ header: 'x-powered-by', re: /express/i }] },
    { name: 'Google Analytics', cat: 'Analytics', any: [{ src: /google-analytics\.com\/(ga|analytics)\.js|googletagmanager\.com\/gtag\/js/ }] },
    { name: 'Google Tag Manager', cat: 'Tag manager', any: [{ src: /googletagmanager\.com\/gtm\.js/ }] },
    { name: 'Facebook Pixel', cat: 'Advertising', any: [{ src: /connect\.facebook\.net\/.*\/(fbevents|sdk)\.js/ }] },
    { name: 'Hotjar', cat: 'Analytics', any: [{ src: /static\.hotjar\.com/ }] },
    { name: 'Matomo', cat: 'Analytics', any: [{ src: /matomo\.js|piwik\.js/ }] },
    { name: 'Plausible', cat: 'Analytics', any: [{ src: /plausible\.io\/js/ }] },
    { name: 'Cloudflare Web Analytics', cat: 'Analytics', any: [{ src: /static\.cloudflareinsights\.com/ }] },
    { name: 'reCAPTCHA', cat: 'Security', any: [{ src: /google\.com\/recaptcha|gstatic\.com\/recaptcha/ }] },
    { name: 'hCaptcha', cat: 'Security', any: [{ src: /hcaptcha\.com/ }] },
    { name: 'Stripe', cat: 'Payments', any: [{ src: /js\.stripe\.com/ }] },
    { name: 'PayPal', cat: 'Payments', any: [{ src: /paypal(objects)?\.com/ }] }
  ];

  const TRACKER_DOMAINS = ['google-analytics.com', 'googletagmanager.com', 'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'connect.facebook.net', 'facebook.net', 'hotjar.com', 'segment.com', 'segment.io', 'mixpanel.com', 'amplitude.com', 'scorecardresearch.com', 'adnxs.com', 'criteo.com', 'taboola.com', 'outbrain.com', 'analytics.tiktok.com', 'ads-twitter.com', 'snap.licdn.com', 'px.ads.linkedin.com', 'clarity.ms', 'fullstory.com', 'mouseflow.com', 'quantserve.com', 'chartbeat.com', 'newrelic.com', 'nr-data.net', 'sentry.io', 'bat.bing.com', 'static.ads-twitter.com', 'hs-scripts.com', 'hs-analytics.net', 'hubspot.com', 'pardot.com', 'optimizely.com', 'adsrvr.org', 'amazon-adsystem.com'];

  const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.cn', 'com.hk', 'com.tw', 'com.sg', 'com.mx', 'co.za', 'co.in', 'com.tr', 'com.ar', 'co.kr']);
  function registrable(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!host || ipv4Ok(host)) return host;
    const p = host.split('.');
    if (p.length <= 2) return host;
    return SECOND_LEVEL.has(p.slice(-2).join('.')) ? p.slice(-3).join('.') : p.slice(-2).join('.');
  }
  const isTracker = host => { host = String(host || '').toLowerCase(); return TRACKER_DOMAINS.some(t => host === t || host.endsWith('.' + t)); };

  // facts: { headers: {name: value} (lowercase names), metas: {name: content}, scripts: [src], links: [href] }
  function detectTech(facts) {
    const headers = facts.headers || {}, metas = facts.metas || {};
    const lowMetas = {};
    for (const k of Object.keys(metas)) lowMetas[k.toLowerCase()] = metas[k];
    const out = [];
    for (const t of TECH) {
      const why = [];
      for (const rule of t.any) {
        if (rule.header) { const v = headers[rule.header]; if (v != null && rule.re.test(v)) why.push('header ' + rule.header + (v.length < 60 ? ': ' + v : '')); }
        else if (rule.meta) { const v = lowMetas[rule.meta]; if (v != null && rule.re.test(v)) why.push('meta ' + rule.meta + ': ' + v); }
        else if (rule.src) { const s = (facts.scripts || []).find(x => rule.src.test(x)); if (s) why.push('script ' + shortUrl(s)); }
        else if (rule.href) { const s = (facts.links || []).find(x => rule.href.test(x)); if (s) why.push('stylesheet ' + shortUrl(s)); }
      }
      if (why.length) out.push({ name: t.name, cat: t.cat, evidence: why[0] });
    }
    return out;
  }
  const shortUrl = s => (s.length > 70 ? s.slice(0, 67) + '…' : s);

  const SEC_HEADERS = [
    { h: 'strict-transport-security', name: 'HSTS', why: 'Forces HTTPS on later visits.' },
    { h: 'content-security-policy', name: 'Content-Security-Policy', why: 'Limits which scripts and resources the page may load.' },
    { h: 'x-frame-options', name: 'X-Frame-Options', why: 'Stops other sites framing this page (clickjacking).', alt: 'content-security-policy' },
    { h: 'x-content-type-options', name: 'X-Content-Type-Options', why: 'Stops the browser guessing file types.' },
    { h: 'referrer-policy', name: 'Referrer-Policy', why: 'Controls how much of the address is sent to other sites.' },
    { h: 'permissions-policy', name: 'Permissions-Policy', why: 'Restricts camera, microphone, location and similar features.' }
  ];
  function securityHeaders(headers) {
    return SEC_HEADERS.map(s => {
      const v = headers[s.h];
      const viaAlt = v == null && s.alt && /frame-ancestors/i.test(headers[s.alt] || '');
      return { name: s.name, present: v != null || !!viaAlt, value: v != null ? v : (viaAlt ? '(via CSP frame-ancestors)' : ''), why: s.why };
    });
  }

  // Summarises where a page pulls things from. urls: every script/img/link/iframe address.
  function externalHosts(pageUrl, urls) {
    const own = registrable(hostOf(pageUrl));
    const map = new Map();
    for (const u of urls || []) {
      let h;
      try { h = new URL(u, pageUrl).hostname.toLowerCase(); } catch (_) { continue; }
      if (!h) continue;
      const reg = registrable(h);
      if (reg === own) continue;
      const e = map.get(reg) || { domain: reg, count: 0, hosts: new Set(), tracker: false };
      e.count++; e.hosts.add(h); e.tracker = e.tracker || isTracker(h);
      map.set(reg, e);
    }
    return [...map.values()].map(e => ({ domain: e.domain, count: e.count, hosts: [...e.hosts].sort(), tracker: e.tracker })).sort((a, b) => Number(b.tracker) - Number(a.tracker) || b.count - a.count || a.domain.localeCompare(b.domain));
  }

  const api = {
    refang, defang, detect, isDomain, isPrivateIp, parseLatLon, extract, entityRows, entitiesCsv, entitiesMarkdown, TYPE_LABEL, TYPE_ORDER,
    SERVICES, pivots, parseCustomServices, REVERSE_IMAGE, REVERSE_IMAGE_UPLOAD, reverseImageUrl,
    archiveLinks, cdxUrl, parseCdx, parseAvailability, wbDate,
    dork, DORK_PRESETS, SEARCH_ENGINES, searchUrl,
    cleanUrl, shareWarnings, SHARE_CHANNELS, composeText, shareLinks, mastodonInstance,
    detectTech, securityHeaders, externalHosts, registrable, isTracker, hostOf
  };
  root.KOsint = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
