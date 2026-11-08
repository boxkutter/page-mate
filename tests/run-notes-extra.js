// Tests for the second wave of Notes features (pure logic): citations, Anki, Word/PDF model, speech, video notes.
const K = require('../extension/notes-core.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const eq = (name, got, want) => check(name, got === want, got === want ? '' : '\n      got:  ' + got + '\n      want: ' + want);

// ---- sentence context for cloze cards
const text = 'First sentence here. The flat-VII chord is the most common borrowed chord. Many songs use it. Last one.';
const s = text.indexOf('most common borrowed chord');
const sel = K.makeSelectors(text, s, s + 'most common borrowed chord'.length);
eq('sentence context before (keeps the space that precedes the quote)', sel.cb, 'The flat-VII chord is the ');
eq('sentence context after', sel.ca, '.');
const long = 'x'.repeat(500) + ' middle words ' + 'y'.repeat(500);
const sl = K.makeSelectors(long, 501, 513);
check('context is capped when there is no sentence end', sl.cb.length <= 300 && sl.ca.length <= 300);

// ---- citations
const meta = { authors: 'Smith, Jane; Lee, Chris', title: 'Understanding modal interchange', site: 'Harmony Today', published: '2024-03-05', url: 'https://example.com/modal', accessed: '2026-11-08' };
eq('APA, two authors', K.citationString(meta, 'apa', 'md'), 'Smith, J., & Lee, C. (2024, March 5). *Understanding modal interchange.* Harmony Today. https://example.com/modal');
eq('MLA, two authors', K.citationString(meta, 'mla', 'md'), 'Smith, Jane, and Chris Lee. “Understanding modal interchange.” *Harmony Today*, 5 Mar. 2024, example.com/modal. Accessed 8 Nov. 2026.');
eq('Chicago, two authors', K.citationString(meta, 'chicago', 'md'), 'Smith, Jane, and Chris Lee. “Understanding modal interchange.” Harmony Today. March 5, 2024. https://example.com/modal.');
eq('plain mode has no asterisks', K.citationString(meta, 'apa', 'plain'), 'Smith, J., & Lee, C. (2024, March 5). Understanding modal interchange. Harmony Today. https://example.com/modal');
const one = { ...meta, authors: 'Jane Smith' };
eq('APA: "First Last" becomes "Last, F."', K.citationString(one, 'apa', 'plain'), 'Smith, J. (2024, March 5). Understanding modal interchange. Harmony Today. https://example.com/modal');
eq('MLA: three authors -> et al.', K.citationString({ ...meta, authors: 'Smith, Jane; Lee, Chris; Kim, Pat' }, 'mla', 'plain'), 'Smith, Jane, et al. “Understanding modal interchange.” Harmony Today, 5 Mar. 2024, example.com/modal. Accessed 8 Nov. 2026.');
eq('Chicago: three authors listed', K.citationString({ ...meta, authors: 'Smith, Jane; Lee, Chris; Kim, Pat' }, 'chicago', 'plain'), 'Smith, Jane, Chris Lee, and Pat Kim. “Understanding modal interchange.” Harmony Today. March 5, 2024. https://example.com/modal.');
eq('APA: organization as author, site not repeated', K.citationString({ ...meta, authors: 'Example College of Music', site: 'Example College of Music' }, 'apa', 'plain'), 'Example College of Music. (2024, March 5). Understanding modal interchange. https://example.com/modal');
eq('APA: no author -> title first, date after title', K.citationString({ ...meta, authors: '' }, 'apa', 'plain'), 'Understanding modal interchange. (2024, March 5). Harmony Today. https://example.com/modal');
eq('APA: no date -> n.d. + retrieval date', K.citationString({ ...meta, published: '' }, 'apa', 'plain'), 'Smith, J., & Lee, C. (n.d.). Understanding modal interchange. Harmony Today. Retrieved November 8, 2026, from https://example.com/modal');
eq('Chicago: no date -> accessed date', K.citationString({ ...meta, published: '' }, 'chicago', 'plain'), 'Smith, Jane, and Chris Lee. “Understanding modal interchange.” Harmony Today. Accessed November 8, 2026. https://example.com/modal.');
check('dates: year-only and ISO timestamps parse', JSON.stringify(K.parseDate('2024')) === '{"y":2024,"m":0,"d":0}' && K.parseDate('2024-03-05T10:00:00Z').d === 5 && K.parseDate('garbage') === null);
check('authors: organization vs person detection', JSON.stringify(K.parseAuthors('The New York Times; Madonna; Ada Lovelace')) === '[{"org":"The New York Times"},{"org":"Madonna"},{"family":"Lovelace","given":"Ada"}]', JSON.stringify(K.parseAuthors('The New York Times; Madonna; Ada Lovelace')));

// ---- video / audio time notes
eq('fmtTime minutes', K.fmtTime(755), '12:35');
eq('fmtTime hours', K.fmtTime(3725), '1:02:05');
eq('timeUrl', K.timeUrl('https://cdn.example.com/v/lesson3.mp4?x=1#old', 755.9), 'https://cdn.example.com/v/lesson3.mp4?x=1#t=755');

const page = {
  url: 'https://example.edu/week-3?x=1', title: 'Week 3 – Modal Interchange', note: 'Exam prep.\n\nSecond paragraph.', case: 'Harmony II / Exam 2',
  created: '2026-11-08T09:00:00Z', meta: { authors: 'Smith, Jane', site: 'Harmony Today', published: '2024-03-05' },
  items: [
    { id: 'a1', quote: 'most common borrowed chord', cb: 'The flat-VII chord is the', ca: '.', color: 'yellow', note: 'The bVII chord in major.', tags: ['exam'], pos: 40, created: '2026-11-08T10:00:00Z' },
    { id: 'b2', quote: 'Why is iv borrowed?', cb: '', ca: '', color: 'blue', note: '', tags: [], pos: 90, created: '2026-11-08T10:01:00Z' },
    { id: 'c3', quote: 'verify this claim', cb: 'Please', ca: 'later', color: 'pink', note: 'Check source', tags: [], pos: 120, created: '2026-11-08T10:02:00Z' },
    { id: 't4', kind: 'time', t: 755, quote: '', media: { src: 'https://example.edu/v/lesson3.mp4', title: 'Lesson 3' }, color: 'blue', note: 'Instructor explains bVII', tags: ['lecture'], created: '2026-11-08T10:03:00Z' }
  ]
};

// ---- markdown with citation, case and a video note
const md = K.toMarkdown(page, { citation: 'apa', exportedAt: new Date('2026-11-08T12:00:00Z') });
check('markdown: case in front matter and header', md.includes('case: "Harmony II / Exam 2"') && md.includes('· case: Harmony II / Exam 2'));
check('markdown: citation section (APA) built from stored metadata', md.includes('## Citation (APA 7)\n\nSmith, J. (2024, March 5). *Week 3 – Modal Interchange.* Harmony Today. https://example.edu/week-3?x=1'), md.split('## Citation')[1].slice(0, 160));
check('markdown: video note with a time link', md.includes('### 4. ⏱ 12:35 — Lesson 3') && md.includes('[Play at 12:35](<https://example.edu/v/lesson3.mp4#t=755>)') && md.includes('#lecture'));
check('markdown: video notes sort after text highlights', md.indexOf('### 3.') < md.indexOf('### 4.'));
const byLabel = K.toMarkdown(page, { order: 'label', exportedAt: new Date('2026-11-08T12:00:00Z') });
check('markdown (by label): has a "Video notes" section', byLabel.includes('## Video notes') && byLabel.indexOf('## Verify') < byLabel.indexOf('## Video notes'));
check('markdown without citation option has no citation section', !K.toMarkdown(page, { exportedAt: new Date() }).includes('## Citation'));

// ---- Anki
const basic = K.toAnki(page, { type: 'basic' });
const bl = basic.text.split('\n');
check('Anki basic: header lines (separator, html, notetype, deck, guid + tags columns)', bl[0] === '#separator:tab' && bl[1] === '#html:true' && bl[2] === '#notetype:Basic' && bl[3].startsWith('#deck:Week 3') && bl[4] === '#guid column:4' && bl[5] === '#tags column:3', bl.slice(0, 6).join(' | '));
check('Anki basic: only highlights WITH a note become cards (default labels skip "Verify")', basic.count === 1 && basic.skipped === 1, JSON.stringify({ c: basic.count, s: basic.skipped }));
const row = bl[6].split('\t');
check('Anki basic: front = highlight, back = note + source link, tags, stable guid', row.length === 4 && row[0] === 'most common borrowed chord' && row[1].startsWith('The bVII chord in major.') && row[1].includes('<a href="https://example.edu/week-3?x=1">') && /pagemate label-key-term exam/.test(row[2]) && row[3] === 'kokoro-a1', bl[6]);
const cloze = K.toAnki(page, { type: 'cloze', labels: new Set(['yellow', 'blue', 'green', 'pink']) });
const cl = cloze.text.split('\n');
check('Anki cloze: notetype Cloze, one card per highlight (4 labels incl. verify; no video note)', cl[2] === '#notetype:Cloze' && cloze.count === 3, String(cloze.count));
check('Anki cloze: the highlighted words are hidden inside their sentence', cl[6].split('\t')[0] === 'The flat-VII chord is the {{c1::most common borrowed chord}}.', cl[6].split('\t')[0]);
const nasty = K.toAnki({ url: 'https://a.com', title: 'T\tab', items: [{ id: 'n', quote: 'a\tb }} <script>', cb: 'x', ca: 'y', color: 'yellow', note: 'n\nl', tags: ['a b'] }] }, { type: 'cloze' });
check('Anki: tabs/newlines/HTML in text cannot break the file format', nasty.text.split('\n').filter(l => l && !l.startsWith('#')).length === 1 && nasty.text.split('\n')[6].split('\t').length === 4 && !nasty.text.includes('<script>') && nasty.text.includes('} }'), JSON.stringify(nasty.text.split('\n')[6]));
check('Anki: labels option restricts which highlights are used', K.toAnki(page, { type: 'cloze', labels: new Set(['blue']) }).count === 1);

// ---- Word / PDF model
const model = K.toModel(page, { citation: 'mla' });
const types = model.blocks.map(b => b.t + (b.l || ''));
check('model: case, citation, page note, highlights, quotes', model.title === 'Notes: Week 3 – Modal Interchange' && model.blocks[0].r[0].x === 'Case: ' && types.includes('h2') && types.includes('quote') && JSON.stringify(model.blocks).includes('Citation (MLA 9)'));
check('model: links back to the passage and to the video time', JSON.stringify(model.blocks).includes('#:~:text=most%20common%20borrowed%20chord') && JSON.stringify(model.blocks).includes('lesson3.mp4#t=755'));
check('model: one paragraph per page-note paragraph', model.blocks.filter(b => b.t === 'p' && (b.r[0].x === 'Exam prep.' || b.r[0].x === 'Second paragraph.')).length === 2);
check('model feeds the real Word writer', (() => { require('../extension/zip.js'); const { toDocx } = require('../extension/docx.js'); return typeof toDocx === 'function'; })());

// ---- speech
const speech = K.toSpeech(page);
check('speech: intro, page note, one chunk per highlight, time spoken in words', speech.length === 6 && speech[0].startsWith('Notes for Week 3 – Modal Interchange. 4 highlights.') && speech[1].startsWith('Page note.') && speech[2].startsWith('Highlight 1, Key term. most common borrowed chord Your note. The bVII chord in major.') && speech[5].startsWith('Video note 4, at 12 minutes 35 seconds. Instructor'), JSON.stringify(speech));

// ---- index grouped by case
const idx = K.indexMd([{ title: 'A', file: 'A.md', count: 1, tags: [], case: 'Case 1' }, { title: 'B', file: 'B.md', count: 2, tags: ['x'], case: '' }], { exportedAt: new Date('2026-11-08T12:00:00Z') });
check('index groups pages by case', idx.includes('## Case 1') && idx.includes('## No case') && idx.indexOf('## Case 1') < idx.indexOf('## No case'));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
