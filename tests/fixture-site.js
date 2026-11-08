// A small course-like website for browser tests.
const http = require('http'), fs = require('fs'), path = require('path');
const FIX = path.join(__dirname, 'hls-fixture');
const { pngBytes } = require('./png.js');

const ARTICLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Week 3: Modal Interchange – Harmony II</title><meta property="og:image" content="/img/og.png"><meta name="citation_author" content="Smith, Jane"><meta name="citation_author" content="Lee, Chris"><meta property="article:published_time" content="2024-03-05T10:00:00Z"><meta property="og:site_name" content="Harmony Today"></head><body>
<header class="site-header"><a href="/">Example Online</a> <nav><a href="/m1">Module 1</a><a href="/m2">Module 2</a></nav></header>
<div id="cookie-banner" class="cookie-consent">We use cookies. Accept all cookies to continue.</div>
<div class="layout"><aside class="sidebar"><ul><li><a href="/x">Sidebar link that should not appear</a></li></ul></aside>
<div id="content" class="user_content">
<h1>Week 3: Modal Interchange</h1>
<p>Modal interchange means <strong>borrowing chords</strong> from the parallel minor key, such as the <em>flat-VII</em> and the iv chord. Read <a href="/notes?a=1&b=2">the lesson notes</a> before class, then try the exercises below. This paragraph is deliberately long enough that the page looks like real course content to the extractor.</p>
<span class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Screen reader only text that must be dropped</span>
<div style="display:none">Hidden text that must not be saved</div>
<h2>Chords to know</h2>
<ul><li>bVII (subtonic)</li><li>iv (minor subdominant)<ol start="3"><li>Nested third</li><li>Nested fourth</li></ol></li></ul>
Loose text directly inside a div, followed by a block.
<div><p>Inner paragraph in a div.</p></div>
<blockquote><p>A quoted remark from the instructor.</p></blockquote>
<pre><code class="language-text">Cmaj7 | Fm7 | Bb7 |
  indented line</code></pre>
<figure><img id="main-img" src="/img/chart.png" alt="Chord chart" width="400" height="200"><figcaption>Figure 1: the chord chart</figcaption></figure>
<p><img src="/img/icon.png" alt="" width="16" height="16"> A paragraph with a tiny icon.</p>
<img data-src="/img/lazy.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="Lazy image" width="300" height="150">
<img src="/protected/hotlink.png" alt="Hotlink protected" width="200" height="100">
<table><thead><tr><th>Chord</th><th>Function</th></tr></thead><tbody><tr><td>bVII</td><td>Subtonic<br>second line</td></tr><tr><td colspan="2">Spans both</td></tr></tbody></table>
<img src="/img/chart.png?sr=1" height="1000" width="659" title="" alt="Scroll-revealed picture" data-sr-processed="true" aria-hidden="true" style="visibility:hidden;opacity:0;max-width:200px;height:auto">
<p data-sr-id="7" style="visibility:hidden">Paragraph still waiting to be scrolled into view.</p>
<h2>Listen</h2>
<audio id="a1" controls src="/media/lecture.mp3" aria-label="Lecture audio"></audio>
<p><a href="/media/podcast.m4a">Download the podcast episode</a></p>
<picture><source srcset="/img/big.png 1200w, /img/small.png 400w"><img src="/img/small.png" alt="Responsive picture" width="40" height="20" style="width:300px;height:150px"></picture>
<a href="/img/full-chart.png"><img src="/img/thumb-chart.png" alt="Lightbox thumbnail" width="120" height="60" style="width:200px;height:100px"></a>
<div class="hero" style="background-image:url('/img/bg-hero.png');width:600px;height:200px" aria-label="Hero banner"></div>
<h2>Watch</h2>
<button aria-label="Click to Start Video" kaltura="true" poster="https://cdnsecakmi.kaltura.com/p/2588802/thumbnail/entry_id/1_0lb94emr/width/1000" id="video-asset-area64963803_763" class="video-asset" source="1_0lb94emr"><i aria-hidden="true" class="fas fa-play"></i><img aria-hidden="true" src="https://cdnsecakmi.kaltura.com/p/2588802/thumbnail/entry_id/1_0lb94emr/width/1000" onerror="this.src='/img/poster.png'" width="480" height="270"></button>
<button class="image-asset" aria-label="Enlarge image"><img src="/img/chart.png?lightbox=1" alt="Lightbox chart" width="300" height="150"></button>
<button type="submit">Submit answer</button>
<video id="v1" controls poster="/img/poster.png" src="/protected/lesson3.mp4" width="480" height="270" aria-label="Lesson 3 lecture"></video>
<video id="v2" controls width="480" height="270"></video>
<iframe id="embed" src="/embed.html" width="560" height="315" title="Weekly chat recording"></iframe>
<p>Final paragraph with 日本語 and Ω and a ♯ sign.</p>
</div></div>
<footer>Footer links that should not appear</footer>
<script>
  // Player #2 hides its source behind a blob: URL and loads an HLS playlist like a real player would.
  fetch('/plain/index.m3u8').then(r => r.text());
  fetch('/media/lesson3.mp4').then(r => r.blob()).then(b => { document.getElementById('v2').src = URL.createObjectURL(b); });
</script>
</body></html>`;

function start() {
  return new Promise(resolve => {
    const log = [];
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      log.push({ path: p, referer: req.headers.referer || '', range: req.headers.range || '', origin: req.headers.origin || '' });
      const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
      if (p === '/' || p === '/article') return send(200, 'text/html', ARTICLE);
      if (p === '/embed.html') return send(200, 'text/html', '<!doctype html><title>embed</title><video controls src="/media/lesson3.mp4" width="300" height="150"></video>');
      if (p.startsWith('/img/')) {
        const big = p.includes('full') ? [300, 150] : p.includes('big') || p.includes('bg-') ? [400, 200] : p.includes('chart') ? [80, 40] : [40, 20];
        return send(200, 'image/png', pngBytes(big[0], big[1], p.includes('poster') ? [30, 30, 200] : p.includes('full') ? [20, 140, 90] : [200, 60, 60]));
      }
      if (p === '/media/lecture.mp3' || p === '/media/podcast.m4a') return send(200, p.endsWith('mp3') ? 'audio/mpeg' : 'audio/mp4', fs.readFileSync(path.join(FIX, p.split('/').pop())));
      if (p === '/protected/hotlink.png') {
        if (!(req.headers.referer || '').includes('/article') && !(req.headers.referer || '').endsWith('/')) return send(403, 'text/plain', 'no hotlinking');
        return send(200, 'image/png', pngBytes(30, 15, [60, 200, 60]));
      }
      if (p === '/protected/lesson3.mp4' || p === '/media/lesson3.mp4') {
        if (p.startsWith('/protected') && !(req.headers.referer || '').startsWith('http://127.0.0.1')) return send(403, 'text/plain', 'referer required');
        const file = fs.readFileSync(path.join(FIX, 'src.mp4'));
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
        if (m) { const a = +m[1], b = m[2] ? +m[2] : file.length - 1; return send(206, 'video/mp4', file.subarray(a, b + 1), { 'Content-Range': `bytes ${a}-${b}/${file.length}`, 'Accept-Ranges': 'bytes' }); }
        return send(200, 'video/mp4', file, { 'Accept-Ranges': 'bytes' });
      }
      const f = path.join(FIX, p);
      if (f.startsWith(FIX) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        const type = f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : f.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream';
        return send(200, type, fs.readFileSync(f));
      }
      send(404, 'text/plain', 'not found');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, log, base: 'http://127.0.0.1:' + server.address().port }));
  });
}
module.exports = { start };
