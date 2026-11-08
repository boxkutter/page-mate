// Unit tests for the notes core: anchoring, links, Markdown.
const K = require('../extension/notes-core.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

const page = 'Modal interchange means borrowing chords from the parallel minor key. ' +
  'The flat-VII chord is the most common borrowed chord. Many songs use the iv chord too. ' +
  'In the bridge, the flat-VII chord returns, and the iv chord follows it. ' +
  'Practice: write a progression that uses the flat-VII chord twice.';

// ---- selectors + exact anchoring
const s = page.indexOf('parallel minor key');
const rec = K.makeSelectors(page, s, s + 'parallel minor key'.length);
check('selectors capture quote, context and position', rec.quote === 'parallel minor key' && rec.prefix.endsWith('borrowing chords from the ') && rec.suffix.startsWith('. The flat-VII') && rec.pos === s);
let r = K.locate(page, rec);
check('exact quote is found where it was', r && r.start === s && r.end === s + rec.quote.length && r.how === 'exact');

// ---- same phrase three times: context picks the right one
const q = 'the flat-VII chord';
const third = page.indexOf(q, page.indexOf('In the bridge'));
const rec3 = K.makeSelectors(page, third, third + q.length);
r = K.locate(page, rec3);
check('repeated phrase: the right occurrence is chosen (context)', r && r.start === third, `want ${third}, got ${r && r.start}`);
// content inserted before shifts every position; context must still win
const shifted = 'NEW INTRO PARAGRAPH THAT WAS ADDED LATER. '.repeat(5) + page;
r = K.locate(shifted, rec3);
check('repeated phrase still right after text is inserted above it', r && shifted.slice(r.start, r.end) === q && shifted.slice(r.start - 20, r.start).includes('In the bridge, '), r && shifted.slice(r.start - 20, r.end + 10));

// ---- case / small edits
r = K.locate(page.replace('parallel minor key', 'Parallel Minor Key'), rec);
check('case change still anchors', r && r.how === 'exact');

const longQuote = 'The flat-VII chord is the most common borrowed chord. Many songs use the iv chord too.';
const a = page.indexOf(longQuote);
const recL = K.makeSelectors(page, a, a + longQuote.length);
const edited = page.replace('is the most common borrowed chord', 'is by far the most common borrowed chord');
r = K.locate(edited, recL);
check('lightly edited passage is found approximately', r && r.how === 'approx' && edited.slice(r.start, r.end).startsWith('The flat-VII chord') && edited.slice(r.start, r.end).endsWith('iv chord too.'), r && r.how);
r = K.locate('Completely different page about cooking pasta and nothing else of note at all here.', recL);
check('passage that is gone is reported as not found (orphan)', r === null);
r = K.locate(page.replace(longQuote, 'Something unrelated now sits here instead of the old passage, entirely rewritten.'), recL);
check('rewritten passage is not falsely matched', r === null);

// ---- similarity helper
check('dice: identical = 1, unrelated < 0.3', K.dice('abcdef', 'abcdef') === 1 && K.dice('modal interchange', 'cooking spaghetti') < 0.3);

// ---- addresses
check('normalizeUrl drops #fragment and tracking params, keeps real params',
  K.normalizeUrl('https://Example.com/p?a=1&utm_source=x&fbclid=y#sec') === 'https://example.com/p?a=1');
check('normalizeUrl rejects non-web pages', K.normalizeUrl('chrome://settings') === '' && K.normalizeUrl('file:///x') === '');
check('same page with different #fragment shares a key', K.pageKey('https://a.com/x#1') === K.pageKey('https://a.com/x#2'));

// ---- text fragment links
let f = K.textFragment('borrowing chords from the parallel minor key', false);
check('short quote becomes a #:~:text= link', f === '#:~:text=borrowing%20chords%20from%20the%20parallel%20minor%20key', f);
f = K.textFragment('flat-VII, iv & more (see 100%)', false);
check('"-" "," "&" "(" "%" are encoded so the link is valid', !/[-,&()]/.test(f.slice('#:~:text='.length)) && f.includes('%2D') && f.includes('%26') && f.includes('%25'), f);
const longQ = 'one two three four five six seven eight nine ten eleven twelve';
f = K.textFragment(longQ, true);
check('quote spanning blocks uses start,end form', f === '#:~:text=one%20two%20three%20four%20five,eight%20nine%20ten%20eleven%20twelve', f);
check('passageUrl replaces an old #fragment', K.passageUrl('https://a.com/x#old', { quote: 'hello world' }) === 'https://a.com/x#:~:text=hello%20world');

// ---- tags
check('cleanTag', K.cleanTag('#Modal Interchange!') === 'modal-interchange' && K.cleanTag('  ') === '' && K.cleanTag('a'.repeat(50)).length === 30);

// ---- markdown
const notesPage = {
  url: 'https://example.edu/courses/12/week-3?x=1', title: 'Week 3: *Modal* Interchange', note: 'Overview for the exam.\n\n- know bVII',
  items: [
    { id: 'b', quote: 'The flat-VII chord is the most common borrowed chord.', color: 'green', note: 'Compare with **iv**.', tags: ['exam', 'harmony'], pos: 80, created: '2026-11-08T10:00:00Z' },
    { id: 'a', quote: 'borrowing chords\nfrom the parallel minor key', color: 'yellow', note: '', tags: [], pos: 20, created: '2026-11-08T10:01:00Z', multi: true },
    { id: 'c', quote: '# Not a heading', color: 'blue', note: 'Why?', tags: [], pos: 300, created: '2026-11-08T10:02:00Z', orphan: true }
  ]
};
const md = K.toMarkdown(notesPage, { exportedAt: new Date('2026-11-08T12:00:00Z') });
console.log('----\n' + md + '----');
check('frontmatter: title, source, tags, count', md.startsWith('---\ntitle: "Week 3: *Modal* Interchange"\nsource: "https://example.edu/courses/12/week-3?x=1"\nexported: 2026-11-08T12:00:00.000Z\nhighlights: 3\ntags: ["exam", "harmony"]\n---'));
check('page note kept', md.includes('## Page note\n\nOverview for the exam.\n\n- know bVII'));
check('highlights are in page order', md.indexOf('borrowing chords') < md.indexOf('most common borrowed chord') && md.indexOf('most common borrowed chord') < md.indexOf('Not a heading'));
check('label shown, tags written as #tags, note kept verbatim', md.includes('### 2. Evidence') && md.includes('#exam #harmony') && md.includes('Compare with **iv**.'));
check('each live passage has a link back; orphan says so instead', (md.match(/\[Open this passage\]/g) || []).length === 2 && md.includes('could no longer be found'));
check('multi-line quote stays one blockquote', md.includes('> borrowing chords\n>\n> from the parallel minor key'));
check('markdown in a quote is escaped (no accidental heading)', md.includes('> \\# Not a heading') || md.includes('> # Not a heading') === false);
check('the title is escaped in the heading', md.includes('# Week 3: \\*Modal\\* Interchange'));
const byLabel = K.toMarkdown(notesPage, { order: 'label', exportedAt: new Date('2026-11-08T12:00:00Z') });
check('grouped by label: sections in Key term > Evidence > Question order', byLabel.indexOf('## Key term') < byLabel.indexOf('## Evidence') && byLabel.indexOf('## Evidence') < byLabel.indexOf('## Question'));
const empty = K.toMarkdown({ url: 'https://a.com', title: 'T', items: [] }, { exportedAt: new Date('2026-11-08T12:00:00Z') });
check('page with no highlights still exports cleanly', empty.includes('highlights: 0') && !empty.includes('## Highlights'));
const idx = K.indexMd([{ title: 'Week 3', file: 'Week 3.md', count: 3, tags: ['exam'] }], { exportedAt: new Date('2026-11-08T12:00:00Z') });
check('index lists files with counts and tags', idx.includes('[Week 3](<Week 3.md>) — 3 highlights · #exam'));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
