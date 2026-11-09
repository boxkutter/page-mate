const S = require('../extension/shot-core.js');
let failed = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };

// Property: tiles cover [0, height) exactly once, and each tile's source window lies inside the capture.
function covers(plan, viewHeight, dpr) {
  let at = 0;
  for (const t of plan.tiles) {
    if (t.destY !== at) return 'gap/overlap at ' + at + ' vs ' + t.destY;
    if (t.srcY < 0 || t.srcY + t.h > Math.round(viewHeight * dpr) + 1) return 'source window outside capture ' + JSON.stringify(t);
    at += t.h;
  }
  return at === plan.height ? '' : 'covers ' + at + ' of ' + plan.height;
}
for (const [ph, vh, dpr] of [[3000, 800, 1], [3000, 800, 2], [801, 800, 1], [800, 800, 1], [500, 800, 1], [12345, 777, 1.25], [100000, 900, 1]]) {
  const p = S.planFullPage({ pageHeight: ph, viewHeight: vh, viewWidth: 1200, dpr });
  const bad = covers(p, vh, dpr);
  check(`plan ${ph}px page / ${vh}px view @${dpr}x: exact cover` + (p.truncated ? ' (truncated)' : ''), !bad, bad);
}
const p1 = S.planFullPage({ pageHeight: 1000, viewHeight: 800, viewWidth: 1000, dpr: 1 });
check('last tile is scrolled only as far as the page allows and draws from below the overlap', p1.tiles.length === 2 && p1.tiles[1].scrollY === 200 && p1.tiles[1].srcY === 600 && p1.tiles[1].h === 200 && !p1.truncated);
const p2 = S.planFullPage({ pageHeight: 50000, viewHeight: 900, viewWidth: 1920, dpr: 2 });
check('very tall page is cut at the canvas limit and says so', p2.truncated && p2.height <= S.MAX_SIDE && p2.width * p2.height <= S.MAX_AREA && p2.shownHeight < 50000, `${p2.width}x${p2.height}`);
check('short page = one tile', S.planFullPage({ pageHeight: 300, viewHeight: 800, viewWidth: 500, dpr: 1 }).tiles.length === 1);

check('cropRect scales by dpr and clamps to the image', JSON.stringify(S.cropRect({ x: 10, y: 20, w: 100, h: 50 }, 2, 1000, 1000)) === '{"x":20,"y":40,"w":200,"h":100}' && S.cropRect({ x: 990, y: 0, w: 100, h: 10 }, 1, 1000, 1000).w === 10 && S.cropRect({ x: 2000, y: 0, w: 10, h: 10 }, 1, 1000, 1000) === null && S.cropRect({ x: 0, y: 0, w: 0, h: 10 }, 1, 100, 100) === null);
check('rectFromPoints works in any drag direction and clamps', JSON.stringify(S.rectFromPoints({ x: 50, y: 60 }, { x: 10, y: 20 })) === '{"x":10,"y":20,"w":40,"h":40}' && S.rectFromPoints({ x: -5, y: 0 }, { x: 500, y: 10 }, 100, 100).w === 100);
check('fileBase is safe and stamped', S.fileBase('A/B: "C"?', new Date('2026-11-09T10:11:12.345Z')) === 'Screenshot - A B C - 20261109T101112Z' && S.fileBase('', new Date(0), 'Evidence').startsWith('Evidence - page - 1970'));
console.log(failed ? '\n' + failed + ' FAILED' : '\nAll shot-core tests passed');
process.exit(failed ? 1 : 0);
