// Unit tests for the investigation core: detection, extraction, lookups, archives, dorks, sharing, tech profile.
const K = require('../extension/osint-core.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- defang / refang
check('refang handles hxxp, [.] , (dot), [at]', K.refang('hxxps://evil[.]example(dot)com/a and bob[at]example[.]org') === 'https://evil.example.com/a and bob@example.org');
check('defang makes URLs, bare domains, IPs and emails inert', K.defang('see https://evil.example.com/a.b?x=1.2 and 10.1.2.3 or bob@example.org') === 'see hxxps://evil[.]example[.]com/a.b?x=1.2 and 10[.]1[.]2[.]3 or bob[@]example[.]org', K.defang('see https://evil.example.com/a.b?x=1.2 and 10.1.2.3 or bob@example.org'));
check('refang(defang(x)) round-trips a URL', K.refang(K.defang('http://a.example.com/p')) === 'http://a.example.com/p');

// ---- detect
const t = s => K.detect(s).type;
check('detect: url / email / ip / domain', t('https://example.com/x') === 'url' && t('Bob@Example.com') === 'email' && t('8.8.8.8') === 'ipv4' && t('example.co.uk') === 'domain');
check('detect: defanged input is understood', t('hxxp://bad[.]example[.]net/x') === 'url' && t('1[.]2[.]3[.]4') === 'ipv4' && t('x[at]y[.]com') === 'email');
check('detect: hashes by length', t('d41d8cd98f00b204e9800998ecf8427e') === 'md5' && t('da39a3ee5e6b4b0d3255bfef95601890afd80709') === 'sha1' && t('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') === 'sha256');
check('detect: cve, eth, btc, asn, mac', t('cve-2024-3094') === 'cve' && t('0x52908400098527886E0F7030069857D2E4169EE7') === 'eth' && t('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2') === 'btc' && t('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq') === 'btc' && t('AS13335') === 'asn' && t('00:1A:2b:3c:4d:5e') === 'mac');
check('detect: ipv6', t('2001:db8::1') === 'ipv6' && t('fe80::1ff:fe23:4567:890a') === 'ipv6');
check('detect: coordinates, but not two small counts', t('48.8584, 2.2945') === 'latlon' && t('12, 40') === 'text' && K.detect('48.8584,2.2945').lat === 48.8584 && t('95.1, 20.2') !== 'latlon');
check('detect: phone needs + or separators', t('+44 20 7946 0958') === 'phone' && t('(415) 555-2671') === 'phone' && t('20230101') !== 'phone');
check('detect: handle, username, text', t('@some_user') === 'handle' && t('some_user') === 'username' && t('two words here') === 'text');
check('detect: analytics ids', t('UA-12345678-1') === 'analyticsId' && t('GTM-ABC1234') === 'analyticsId' && t('ca-pub-1234567890123456') === 'analyticsId');
check('detect: trailing punctuation and wrapping are trimmed', K.detect('"example.com".').value === 'example.com' && t('<https://a.example/x>') === 'url');
check('detect: host/path becomes a url', K.detect('example.com/path?q=1').type === 'url');
check('detect: file name is not a domain', t('notes.txt') !== 'domain');

// ---- extract
const sample = `Contact Jane at jane.doe@example.org or +1 (415) 555-2671 / +44 20 7946 0958. Follow @janedoe and #OSINT.
Site: https://www.example.com/page?utm_source=x. Mirror hxxp://bad[.]example[.]net/login. Server 203.0.113.7 and 2001:db8::7334.
Hash: 5d41402abc4b2a76b9719d911017c592 and e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. See CVE-2021-44228 (CVE-2021-44228 again).
Wallets: 1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2, 0x52908400098527886E0F7030069857D2E4169EE7. Tracking UA-1234567-1 AS64500.
Location 48.8584, 2.2945. Date 2024-05-06 and 3.14159 and v1.2.3 should not match. The file index.js and readme.md are not domains. Visit news.bbc.co.uk today.`;
const ent = K.extract(sample, { links: [{ href: 'mailto:press@corp.example.com?subject=hi' }, { href: 'tel:+4930123456' }, { href: 'https://github.com/x/y' }] });
const vals = type => (ent[type] || []).map(e => e.value);
check('extract: emails (text + mailto, lower-cased)', eq(vals('email').sort(), ['jane.doe@example.org', 'press@corp.example.com']), JSON.stringify(vals('email')));
check('extract: phones, not dates or decimals', vals('phone').some(p => p.includes('415')) && vals('phone').some(p => p.includes('7946')) && vals('phone').includes('+4930123456') && !vals('phone').some(p => /2024|3\.14/.test(p)), JSON.stringify(vals('phone')));
check('extract: handles and hashtags, not email parts', vals('handle').includes('@janedoe') && !vals('handle').some(h => h.includes('example')) && vals('hashtag').includes('#OSINT'), JSON.stringify(vals('handle')));
check('extract: urls (refanged) and no trailing dot', vals('url').includes('https://www.example.com/page?utm_source=x') && vals('url').includes('http://bad.example.net/login') && vals('url').includes('https://github.com/x/y'), JSON.stringify(vals('url')));
check('extract: domains from urls and bare text, but not file names', vals('domain').includes('www.example.com') && vals('domain').includes('bad.example.net') && vals('domain').includes('news.bbc.co.uk') && vals('domain').includes('example.org') && !vals('domain').some(d => /^(index\.js|readme\.md)$/.test(d)), JSON.stringify(vals('domain')));
check('extract: ips', eq(vals('ipv4'), ['203.0.113.7']) && vals('ipv6').includes('2001:db8::7334'));
check('extract: hashes, cve counted twice, wallets, ids, asn, coordinates', vals('md5').length === 1 && vals('sha256').length === 1 && ent.cve[0].count === 2 && vals('btc').length === 1 && vals('eth').length === 1 && vals('analyticsId').includes('UA-1234567-1') && vals('asn').includes('AS64500') && vals('latlon').includes('48.8584,2.2945'), JSON.stringify([vals('btc'), vals('asn'), vals('latlon')]));
check('extract: CSV and Markdown exports', /^type,value,count,found_in,page_url,page_title\n/.test(K.entitiesCsv(ent, { url: 'https://p.example/', title: 'T "q"' })) && K.entitiesMarkdown(ent, { url: 'https://p.example/' }).includes('## Email addresses (2)'));
check('extract: huge input stays bounded', Object.values(K.extract('a@b.co '.repeat(5000) + 'x'.repeat(10), { max: 50 })).every(l => l.length <= 50));

// ---- pivots
const pv = K.pivots('hxxps://evil[.]example[.]com/a');
check('pivots: a url also offers its domain, and search engines only once', pv.detected.type === 'url' && pv.groups.length === 2 && pv.groups[1].type === 'domain' && pv.groups[1].value === 'evil.example.com' && !pv.groups[1].items.some(i => i.id === 'google'));
check('pivots: url template encodes the value', pv.groups[0].items.find(i => i.id === 'vt-url').url === 'https://www.virustotal.com/gui/search/' + encodeURIComponent('https://evil.example.com/a'));
const pe = K.pivots('Jane@Example.org');
check('pivots: email offers email, domain and username lookups', pe.groups.map(g => g.type).join() === 'email,domain,username' && pe.groups[1].value === 'example.org');
check('pivots: coordinates fill lat/lon', K.pivots('48.8584,2.2945').groups[0].items.find(i => i.id === 'osm').url.includes('mlat=48.8584&mlon=2.2945'));
check('pivots: handle profile has no @', K.pivots('@jane').groups[0].items.find(i => i.id === 'p-github').url === 'https://github.com/jane');
check('pivots: every service url is http(s) and has a placeholder', K.SERVICES.every(s => /^https:\/\//.test(s.url) && /\{(q|raw|user|lat|lon|domain|num)\}/.test(s.url) && s.types.length));
const cs = K.parseCustomServices('[{"name":"Mine","types":["domain"],"url":"https://x.example/?d={q}"},{"name":"Bad","url":"javascript:alert(1)"},{"url":"https://a/{q}"},{"name":"NoQ","url":"https://a.example/"}]');
check('custom services: valid kept, bad rejected with reasons', cs.services.length === 1 && cs.errors.length === 3 && cs.services[0].custom, JSON.stringify(cs.errors));
check('custom services appear in pivots', K.pivots('example.com', cs.services).groups[0].items.some(i => i.custom && i.url === 'https://x.example/?d=example.com'));
check('custom services: bad JSON is reported, not thrown', K.parseCustomServices('{nope').errors.length === 1);

// ---- reverse image, archive
check('reverse image urls', K.reverseImageUrl('tineye', 'https://i.example/a b.jpg') === 'https://tineye.com/search?url=' + encodeURIComponent('https://i.example/a b.jpg') && K.reverseImageUrl('lens', 'data:image/png;base64,AAAA') === null && K.reverseImageUrl('nope', 'https://a/b.png') === null);
const al = K.archiveLinks('https://example.com/a?b=1#frag');
check('archive links drop the fragment', al.waybackAll === 'https://web.archive.org/web/*/https://example.com/a?b=1' && al.waybackSave.endsWith('/save/https://example.com/a?b=1') && al.archiveTodaySave.includes(encodeURIComponent('https://example.com/a?b=1')));
const cdx = K.parseCdx([['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length'], ['20200101120000', 'https://example.com/', '200', 'text/html', 'AAA', '1000'], ['20240305101112', 'https://example.com/', '200', 'text/html', 'BBB', '2000'], ['bad', 'x', '200', '', '', '0']]);
check('cdx: newest first, dates and links', cdx.length === 2 && cdx[0].date === '2024-03-05T10:11:12Z' && cdx[0].url === 'https://web.archive.org/web/20240305101112/https://example.com/' && K.parseCdx([]).length === 0 && K.parseCdx(null).length === 0);
check('availability api parse', K.parseAvailability({ archived_snapshots: { closest: { available: true, url: 'http://web.archive.org/web/2020/https://a/', timestamp: '20200102030405', status: '200' } } }).url.startsWith('https://') && K.parseAvailability({ archived_snapshots: {} }) === null);

// ---- dorks
check('dork builder', K.dork({ exact: 'john smith', any: ['pdf report', 'xlsx'], none: ['jobs'], site: 'https://www.example.com/x', filetype: '.pdf', after: '2024-01-01' }) === '"john smith" ("pdf report" OR xlsx) -jobs site:www.example.com filetype:pdf after:2024-01-01');
check('dork: bad dates ignored', K.dork({ all: 'x', before: 'yesterday' }) === 'x');
check('dork presets', K.DORK_PRESETS[1].build('www.example.com') === 'site:*.example.com -site:www.example.com' && K.DORK_PRESETS.every(p => typeof p.build === 'function'));
check('search url', K.searchUrl('google', 'a b') === 'https://www.google.com/search?q=a%20b' && K.searchUrl('x', 'a') === null);

// ---- sharing
check('cleanUrl strips tracking, keeps real params', K.cleanUrl('https://a.example/p?id=7&utm_source=x&fbclid=abc&gclid=1') === 'https://a.example/p?id=7' && K.cleanUrl('https://a.example/p?utm_medium=x') === 'https://a.example/p');
check('shareWarnings: tokens, local, account pages, none for a normal page', K.shareWarnings('https://a.example/f?X-Amz-Signature=abc&token=z').length === 1 && K.shareWarnings('http://192.168.1.5/x').length === 1 && K.shareWarnings('https://user:pw@a.example/').length === 1 && K.shareWarnings('https://a.example/account/billing').length === 1 && K.shareWarnings('https://a.example/news/story').length === 0 && K.shareWarnings('file:///etc/passwd').length >= 1);
const links = K.shareLinks({ url: 'https://a.example/post?utm_source=x', title: 'A title', quote: 'x'.repeat(400), note: 'Look', hashtags: ['OSINT', '#verify'], instance: 'mastodon.social' });
const x = links.find(l => l.id === 'x');
check('share: x text fits 280 incl. link (23) and carries hashtags', x.href.startsWith('https://x.com/intent/post?text=') && x.href.includes(encodeURIComponent('https://a.example/post')) && !x.href.includes('utm_source') && x.text.length + 24 <= 280 && x.text.includes('#OSINT #verify'), String(x.text.length));
check('share: bluesky limit and mastodon instance', links.find(l => l.id === 'bluesky').text.length + 'https://a.example/post'.length + 1 <= 300 && links.find(l => l.id === 'mastodon').href.startsWith('https://mastodon.social/share?text='));
check('share: mastodon without instance asks for one', K.shareLinks({ url: 'https://a/b', title: 't' }, ['mastodon'])[0].needs === 'instance' && K.mastodonInstance('@me@Fosstodon.org') === 'fosstodon.org' && K.mastodonInstance('https://mas.to/x') === 'mas.to' && K.mastodonInstance('not a host') === '');
check('share: email and clean:false', K.shareLinks({ url: 'https://a.example/?utm_x=1', title: 'T', clean: false }, ['email'])[0].href.includes(encodeURIComponent('https://a.example/?utm_x=1')));

// ---- tech profile
const facts = { headers: { server: 'cloudflare', 'cf-ray': 'abc', 'x-powered-by': 'PHP/8.2' }, metas: { Generator: 'WordPress 6.5' }, scripts: ['https://www.googletagmanager.com/gtag/js?id=G-ABCDE12345', 'https://example.com/wp-content/a.js', 'https://cdn.example/jquery-3.7.1.min.js'], links: ['https://x/bootstrap.min.css'] };
const tech = K.detectTech(facts).map(t => t.name);
check('tech: servers, cms, libraries, analytics', ['Cloudflare', 'PHP', 'WordPress', 'Google Analytics', 'jQuery', 'Bootstrap'].every(n => tech.includes(n)) && !tech.includes('nginx'), tech.join());
const sec = K.securityHeaders({ 'strict-transport-security': 'max-age=1', 'content-security-policy': "frame-ancestors 'none'" });
check('security headers: present/missing and CSP frame-ancestors counts for X-Frame-Options', sec.find(s => s.name === 'HSTS').present && !sec.find(s => s.name === 'Referrer-Policy').present && sec.find(s => s.name === 'X-Frame-Options').present);
const ext = K.externalHosts('https://www.example.co.uk/', ['https://cdn.example.co.uk/a.js', 'https://www.google-analytics.com/a.js', 'https://fonts.gstatic.com/x', '/local.js', 'https://stats.hotjar.com/x', 'https://fonts.gstatic.com/y']);
check('external hosts: own site excluded (co.uk aware), trackers first, counted', ext.length === 3 && ext[0].tracker && ext.find(e => e.domain === 'gstatic.com').count === 2 && !ext.some(e => e.domain.includes('example.co.uk')), JSON.stringify(ext.map(e => e.domain)));
check('registrable()', K.registrable('a.b.example.com') === 'example.com' && K.registrable('a.b.example.co.uk') === 'example.co.uk' && K.registrable('1.2.3.4') === '1.2.3.4');

const hm = K.headerMap([{ name: 'Set-Cookie', value: 'sid=SECRET123; Path=/; HttpOnly' }, { name: 'Set-Cookie', value: 'a=1; Secure' }, { name: 'Server', value: 'nginx' }, { name: 'Authorization', value: 'Bearer abc' }, { name: 'Link', value: '<a>' }, { name: 'Link', value: '<b>' }]);
check('headerMap: lower-cased, cookie values and credentials redacted, duplicates joined', hm.server === 'nginx' && hm['set-cookie'] === 'sid=[redacted]; Path=/; HttpOnly\na=[redacted]; Secure' && !JSON.stringify(hm).includes('SECRET123') && hm.authorization === '[redacted]' && hm.link === '<a>, <b>');

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll osint-core tests passed');
process.exit(failed ? 1 : 0);
