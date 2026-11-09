// What the tools are: names, icons, letters and shortcut slots. Shared by the floating toolbox (dock.js, injected into
// pages) and the fallback toolbox window (popup.js), so both always agree.
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  // Icons as shapes on a 24x24 grid: ['p', pathData] | ['c', cx, cy, r] | ['s', cx, cy, r] (solid dot).
  const ICONS = {
    read: [['p', 'M11 5 6 9H3v6h3l5 4z'], ['p', 'M15.5 8.5a5 5 0 0 1 0 7'], ['p', 'M18.5 5.5a9 9 0 0 1 0 13']],
    stop: [['p', 'M6 6h12v12H6z']],
    notes: [['p', 'M4 20h4L19 9l-4-4L4 16z'], ['p', 'M13 7l4 4']],
    page: [['p', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'], ['p', 'M14 3v5h5'], ['p', 'M12 11v6'], ['p', 'M9.5 14.5 12 17l2.5-2.5']],
    video: [['p', 'M3 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3z'], ['p', 'M17 10.5 21 8v8l-4-2.5']],
    audio: [['p', 'M4 15v-3a8 8 0 0 1 16 0v3'], ['p', 'M4 14h3v6H4z'], ['p', 'M17 14h3v6h-3z']],
    images: [['p', 'M4 5h16v14H4z'], ['p', 'M4 16l5-5 4 4 3-3 4 4'], ['s', 9, 9.5, 1.3]],
    shot: [['p', 'M4 8V5a1 1 0 0 1 1-1h3'], ['p', 'M16 4h3a1 1 0 0 1 1 1v3'], ['p', 'M20 16v3a1 1 0 0 1-1 1h-3'], ['p', 'M8 20H5a1 1 0 0 1-1-1v-3'], ['c', 12, 12, 3]],
    region: [['p', 'M5 9V6a1 1 0 0 1 1-1h3'], ['p', 'M15 5h3a1 1 0 0 1 1 1v3'], ['p', 'M19 15v3a1 1 0 0 1-1 1h-3'], ['p', 'M9 19H6a1 1 0 0 1-1-1v-3']],
    visible: [['p', 'M3 5h18v14H3z'], ['p', 'M3 9h18']],
    full: [['p', 'M7 3h10v18H7z'], ['p', 'M10 8h4M10 12h4M10 16h4']],
    record: [['c', 12, 12, 9], ['s', 12, 12, 4.2]],
    investigate: [['c', 11, 11, 6.5], ['p', 'M16 16l5 5']],
    lookup: [['p', 'M4 6h16M4 11h7M4 16h7'], ['c', 16.5, 15.5, 3], ['p', 'M18.7 17.7 21 20']],
    archive: [['p', 'M3 4h18v4H3z'], ['p', 'M5 8v11h14V8'], ['p', 'M10 12h4']],
    share: [['c', 18, 5.5, 2.7], ['c', 6, 12, 2.7], ['c', 18, 18.5, 2.7], ['p', 'M8.4 10.7l7.2-3.9M8.4 13.3l7.2 3.9']]
  };
  function icon(name, doc = document) {
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const [kind, ...a] of ICONS[name] || []) {
      let el;
      if (kind === 'p') { el = doc.createElementNS(NS, 'path'); el.setAttribute('d', a[0]); }
      else { el = doc.createElementNS(NS, 'circle'); el.setAttribute('cx', a[0]); el.setAttribute('cy', a[1]); el.setAttribute('r', a[2]); if (kind === 's') el.setAttribute('class', 'solid'); }
      svg.append(el);
    }
    return svg;
  }

  // page: the tool works on the page you are looking at, so it needs an ordinary web page.
  // key: the letter that starts it while the toolbox is open. command: its browser-wide shortcut slot (manifest "commands").
  const TILES = {
    read: { label: 'Read aloud', tip: 'Read this page aloud, or just your selection if you have selected text', icon: 'read', tool: 'read', page: true, key: 'r', command: 'read-page' },
    notes: { label: 'Notes', tip: 'Highlight and keep notes on this page', icon: 'notes', tool: 'notes', page: true, key: 'n', command: 'toggle-notes' },
    savePage: { label: 'Save page', tip: 'Save this page as PDF, Word or Markdown', icon: 'page', tool: 'save-page', page: true, key: 's', command: 'save-page' },
    saveVideo: { label: 'Video', tip: 'Download a video from this page', icon: 'video', tool: 'save-video', page: true, key: 'v', command: 'save-video' },
    saveAudio: { label: 'Audio', tip: 'Download audio from this page', icon: 'audio', tool: 'save-audio', page: true, key: 'u', command: 'save-audio' },
    saveImages: { label: 'Images', tip: 'Download images from this page', icon: 'images', tool: 'save-images', page: true, key: 'm', command: 'save-images' },
    shot: { label: 'Screenshot', tip: 'Take a screenshot: an area, what you see, or the whole page', icon: 'shot', submenu: 'shot', page: true, key: 'c' },
    record: { label: 'Record screen', tip: 'Record the screen, a window or a tab', icon: 'record', tool: 'record', cls: 'rec', key: 'e', command: 'record-screen' },
    investigate: { label: 'Investigate', tip: 'Everything on this page: names, addresses, images, site details', icon: 'investigate', tool: 'investigate', page: true, key: 'i', command: 'investigate' },
    lookup: { label: 'Look up', tip: 'Look up an address, domain, email, name or number in many services', icon: 'lookup', tool: 'lookup', key: 'l', command: 'lookup' },
    archive: { label: 'Archive', tip: 'Find or make saved copies of this page', icon: 'archive', tool: 'archive', page: true, key: 'a', command: 'archive' },
    share: { label: 'Share', tip: 'Share this page, with tracking codes removed', icon: 'share', tool: 'share', page: true, key: 'h', command: 'share' }
  };
  const GROUPS = [
    ['Listen and notes', ['read', 'notes']],
    ['Save', ['savePage', 'saveVideo', 'saveAudio', 'saveImages']],
    ['Capture', ['shot', 'record']],
    ['Investigate', ['investigate', 'lookup', 'archive', 'share']]
  ];
  const SHOTS = [
    { label: 'Selected area', hint: 'Drag a box over the part you want', icon: 'region', tool: 'shot-region', key: 'a', command: 'screenshot-region' },
    { label: 'Visible part', hint: 'What you can see right now', icon: 'visible', tool: 'shot-visible', key: 'v', command: 'screenshot-visible' },
    { label: 'Whole page', hint: 'Scrolls down the page and stitches it together', icon: 'full', tool: 'shot-full', key: 'w', command: 'screenshot-full' }
  ];
  // The Shortcuts panel: [what it does, toolbox letter(s), browser-wide command]
  const KEYROWS = [
    ['Open this toolbox', '', '_execute_action'],
    ['Read aloud (start / stop)', 'R', 'read-page'],
    ['Pause / resume reading', '', 'toggle-pause'],
    ['Notes sidebar', 'N', 'toggle-notes'],
    ['Highlight the selection', '', 'highlight-selection'],
    ['Save page as PDF / Word / Markdown', 'S', 'save-page'],
    ['Download a video', 'V', 'save-video'],
    ['Download audio', 'U', 'save-audio'],
    ['Download images', 'M', 'save-images'],
    ['Screenshot: selected area', 'C, then A', 'screenshot-region'],
    ['Screenshot: visible part', 'C, then V', 'screenshot-visible'],
    ['Screenshot: whole page', 'C, then W', 'screenshot-full'],
    ['Record screen', 'E', 'record-screen'],
    ['Investigate this page', 'I', 'investigate'],
    ['Look up', 'L', 'lookup'],
    ['Archive this page', 'A', 'archive'],
    ['Share this page', 'H', 'share'],
    ['All my notes', 'O', 'all-notes']
  ];


  // chrome of the toolbox itself
  ICONS.gear = [['c', 12, 12, 3], ['p', 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1']];
  ICONS.close = [['p', 'M6 6l12 12M18 6 6 18']];
  ICONS.keys = [['p', 'M3 7h18v10H3z'], ['p', 'M7 11h.01M11 11h.01M15 11h.01M7 14h10']];
  ICONS.back = [['p', 'M15 5l-7 7 7 7']];
  ICONS.copy = [['p', 'M9 9h11v11H9z'], ['p', 'M5 15V4h11']];
  ICONS.edit = [['p', 'M4 20h4L19 9l-4-4L4 16z']];

  const ORDER = ['read', 'notes', 'savePage', 'saveVideo', 'saveAudio', 'saveImages', 'shot', 'record', 'investigate', 'lookup', 'archive', 'share'];

  root.KOTools = { ICONS, icon, TILES, GROUPS, ORDER, SHOTS, KEYROWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.KOTools;
})(typeof self !== 'undefined' ? self : globalThis);
