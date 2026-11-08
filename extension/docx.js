// Document model -> editable Word (.docx).
//
// toDocx(model, opts) -> Promise<Blob>
//   opts.images   Map(src -> { bytes, mime, w, h })  fetched images (png / jpeg / gif only;
//                 the caller converts everything else to PNG first)
//   opts.videos   'links' | 'none'
//   opts.meta     show the source line
//   opts.paper    'letter' | 'a4'
//   opts.savedAt  Date
(function (root) {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  const PAPER = {
    letter: { w: 12240, h: 15840 },
    a4: { w: 11906, h: 16838 }
  };
  const MARGIN = 1440; // 1 inch
  const EMU_PER_TWIP = 635;
  const EMU_PER_PX = 9525;
  const HEADING_SIZES = [0, 36, 30, 26, 24, 22, 22]; // half-points (index = level)

  // XML 1.0 forbids most control characters.
  const xmlSafe = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const esc = s => xmlSafe(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function toDocx(model, opts = {}) {
    const images = opts.images || new Map();
    const paper = PAPER[opts.paper] || PAPER.letter;
    const textWidthTwips = paper.w - 2 * MARGIN;
    const includeVideos = opts.videos !== 'none';

    const rels = [];           // { id, type, target, external }
    const mediaFiles = [];     // { name, data }
    const linkIds = new Map(); // url -> rId
    const imageIds = new Map(); // src -> { rId, ... }
    let relSeq = 10;
    let drawingSeq = 0;
    const nums = [];           // extra <w:num> definitions for ordered lists
    let numSeq = 1;            // numId 1 is the bullet list

    function linkId(url) {
      if (!linkIds.has(url)) {
        const id = 'rId' + (++relSeq);
        linkIds.set(url, id);
        rels.push({ id, type: 'hyperlink', target: url, external: true });
      }
      return linkIds.get(url);
    }

    // ----- runs -----

    function runProps(r, extra = {}) {
      let p = '';
      if (r.a) p += '<w:rStyle w:val="Hyperlink"/>';
      if (r.c || extra.mono) p += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas" w:eastAsia="Consolas"/>';
      if (r.b || extra.b) p += '<w:b/><w:bCs/>';
      if (r.i || extra.i) p += '<w:i/><w:iCs/>';
      if (r.s) p += '<w:strike/>';
      if (extra.color) p += '<w:color w:val="' + extra.color + '"/>';
      if (r.c && !extra.mono) p += '<w:sz w:val="20"/>';
      if (r.u && !r.a) p += '<w:u w:val="single"/>';
      if (r.c && !extra.noShade) p += '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/>';
      if (r.sup) p += '<w:vertAlign w:val="superscript"/>';
      else if (r.sub) p += '<w:vertAlign w:val="subscript"/>';
      return p ? '<w:rPr>' + p + '</w:rPr>' : '';
    }

    function textXml(text) {
      // Tabs and newlines inside a text run need their own elements.
      return xmlSafe(text).split(/(\t|\n)/).map(piece => {
        if (piece === '\t') return '<w:tab/>';
        if (piece === '\n') return '<w:br/>';
        return piece ? '<w:t xml:space="preserve">' + esc(piece) + '</w:t>' : '';
      }).join('');
    }

    function runsXml(runs, extra) {
      let out = '';
      let i = 0;
      while (i < runs.length) {
        const r = runs[i];
        if (r.br) { out += '<w:r><w:br/></w:r>'; i++; continue; }
        if (r.a) {
          // Group consecutive runs of the same link into one hyperlink element.
          let j = i;
          let inner = '';
          while (j < runs.length && runs[j].a === r.a) {
            inner += '<w:r>' + runProps(runs[j], extra) + textXml(runs[j].x) + '</w:r>';
            j++;
          }
          out += '<w:hyperlink r:id="' + linkId(r.a) + '" w:history="1">' + inner + '</w:hyperlink>';
          i = j;
          continue;
        }
        out += '<w:r>' + runProps(r, extra) + textXml(r.x) + '</w:r>';
        i++;
      }
      return out;
    }

    // ----- paragraphs -----

    function para(content, o = {}) {
      let pPr = '';
      if (o.style) pPr += '<w:pStyle w:val="' + o.style + '"/>';
      if (o.keepNext) pPr += '<w:keepNext/>';
      if (o.numId != null) pPr += '<w:numPr><w:ilvl w:val="' + o.ilvl + '"/><w:numId w:val="' + o.numId + '"/></w:numPr>';
      if (o.spacing) pPr += o.spacing;
      if (o.indent) pPr += '<w:ind w:left="' + o.indent + '"' + (o.hanging ? ' w:hanging="' + o.hanging + '"' : '') + '/>';
      if (o.jc) pPr += '<w:jc w:val="' + o.jc + '"/>';
      return '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + content + '</w:p>';
    }

    // ----- images -----

    function imageXml(src, alt, maxTwips) {
      const img = images.get(src);
      if (!img) return null;
      if (!imageIds.has(src)) {
        const ext = img.mime === 'image/jpeg' ? 'jpg' : img.mime === 'image/gif' ? 'gif' : 'png';
        const name = 'image' + (imageIds.size + 1) + '.' + ext;
        const rId = 'rId' + (++relSeq);
        mediaFiles.push({ name: 'word/media/' + name, data: img.bytes });
        rels.push({ id: rId, type: 'image', target: 'media/' + name });
        imageIds.set(src, { rId, name });
      }
      const { rId, name } = imageIds.get(src);
      let cx = (img.w || 600) * EMU_PER_PX;
      let cy = (img.h || 400) * EMU_PER_PX;
      const maxW = Math.min(maxTwips, textWidthTwips) * EMU_PER_TWIP;
      const maxH = 8.5 * 914400;
      const scale = Math.min(1, maxW / cx, maxH / cy);
      cx = Math.max(9525, Math.round(cx * scale));
      cy = Math.max(9525, Math.round(cy * scale));
      const id = ++drawingSeq;
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
        '<wp:docPr id="' + id + '" name="Picture ' + id + '" descr="' + esc(alt || '') + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="' + esc(name) + '" descr="' + esc(alt || '') + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
        '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }

    // ----- blocks -----

    // ctx: { indent: twips, list: { depth } }
    function blocksXml(blocks, ctx) {
      return blocks.map(b => blockXml(b, ctx)).join('');
    }

    function blockXml(b, ctx) {
      const indent = ctx.indent || 0;
      switch (b.t) {
        case 'h': {
          const level = Math.min(6, Math.max(1, b.l));
          return para(runsXml(b.r), { style: 'Heading' + level, keepNext: true, indent: indent || undefined });
        }
        case 'p':
          return para(runsXml(b.r, b.cap ? { i: true, color: '595959' } : undefined),
            { style: b.cap ? 'Caption' : undefined, indent: indent || undefined, jc: b.cap ? 'center' : undefined });
        case 'quote':
          return blocksXml(b.b, { ...ctx, indent: indent + 720, quote: true });
        case 'code': {
          const lines = b.text.split('\n');
          return lines.map((line, i) => para(
            line ? '<w:r>' + '<w:t xml:space="preserve">' + esc(line.replace(/\t/g, '    ')) + '</w:t></w:r>' : '',
            { style: 'Code', indent: indent || undefined, keepNext: i < lines.length - 1 && lines.length < 12 })).join('');
        }
        case 'hr':
          return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>';
        case 'img': {
          const drawing = imageXml(b.src, b.alt, textWidthTwips - indent);
          if (!drawing) {
            const label = b.alt ? '[Image: ' + b.alt + ']' : '[Image not available]';
            return para(runsXml([{ x: label, i: 1 }, { x: ' ' }, { x: b.src.startsWith('data:') ? '' : b.src, a: b.src.startsWith('data:') ? undefined : b.src }].filter(r => r.x)),
              { indent: indent || undefined });
          }
          return para(drawing, { jc: 'center', keepNext: false, indent: indent || undefined });
        }
        case 'video': {
          if (!includeVideos) return '';
          let out = '';
          if (b.poster) {
            const d = imageXml(b.poster, b.title, textWidthTwips - indent);
            if (d) out += para(d, { jc: 'center', keepNext: true, indent: indent || undefined });
          }
          const label = b.audio ? '🔊 Audio: ' : '▶ Video: ';
          const title = b.title || (b.audio ? 'Audio' : 'Video');
          const runs = b.src
            ? [{ x: label, b: 1 }, { x: title, a: b.src }]
            : [{ x: label, b: 1 }, { x: title }, { x: ' (streamed — no direct link)', i: 1 }];
          out += para(runsXml(runs), { indent: indent || undefined });
          return out;
        }
        case 'list': return listXml(b, ctx);
        case 'table': return tableXml(b, ctx);
      }
      return '';
    }

    function listXml(list, ctx) {
      const depth = Math.min(8, (ctx.depth || 0));
      let numId = 1;
      if (list.ordered) {
        numId = ++numSeq;
        nums.push({ numId, start: list.start || 1, ilvl: depth });
      }
      let out = '';
      for (const item of list.items) {
        let first = true;
        for (const blk of item) {
          if (blk.t === 'list') {
            out += listXml(blk, { ...ctx, depth: depth + 1 });
          } else if ((blk.t === 'p' || blk.t === 'h') && first) {
            out += para(runsXml(blk.r), { style: 'ListParagraph', numId, ilvl: depth });
            first = false;
          } else {
            out += blockXml(blk, { ...ctx, indent: (ctx.indent || 0) + 720 * (depth + 1), depth: depth + 1 });
            first = false;
          }
        }
      }
      return out;
    }

    function tableXml(t, ctx) {
      const cols = Math.max(...t.rows.map(r => r.reduce((n, c) => n + c.cs, 0)));
      const avail = textWidthTwips - (ctx.indent || 0);
      const colW = Math.floor(avail / cols);
      const headerRow = t.rows[0].every(c => c.h);
      const border = (side) => '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>';
      let x = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="' + avail + '" w:type="dxa"/>' +
        (ctx.indent ? '<w:tblInd w:w="' + ctx.indent + '" w:type="dxa"/>' : '') +
        '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders>' +
        '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>' +
        '<w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>' +
        Array.from({ length: cols }, () => '<w:gridCol w:w="' + colW + '"/>').join('') + '</w:tblGrid>';
      t.rows.forEach((row, ri) => {
        x += '<w:tr>' + (ri === 0 && headerRow ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>');
        let used = 0;
        for (const c of row) {
          const span = Math.min(c.cs, cols - used);
          used += span;
          const shade = c.h ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '';
          x += '<w:tc><w:tcPr><w:tcW w:w="' + colW * span + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + shade + '</w:tcPr>' +
            para(runsXml(c.r, c.h ? { b: true } : undefined), { style: 'TableText' }) + '</w:tc>';
        }
        while (used < cols) {
          x += '<w:tc><w:tcPr><w:tcW w:w="' + colW + '" w:type="dxa"/></w:tcPr>' + para('', { style: 'TableText' }) + '</w:tc>';
          used++;
        }
        x += '</w:tr>';
      });
      // Word requires a paragraph after a table, and it gives breathing room.
      return x + '</w:tbl>' + '<w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p>';
    }

    // ----- assemble -----

    let body = '';
    body += para(runsXml([{ x: model.title || 'Untitled' }]), { style: 'Title' });
    if (opts.meta !== false) {
      const when = (opts.savedAt || new Date()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const metaRuns = [{ x: 'Source: ' }];
      if (model.url) metaRuns.push({ x: model.url, a: model.url });
      metaRuns.push({ x: ' · Saved ' + when });
      body += para(runsXml(metaRuns), { style: 'Meta' });
    }
    body += blocksXml(model.blocks, {});
    body += '<w:sectPr><w:pgSz w:w="' + paper.w + '" w:h="' + paper.h + '"/>' +
      '<w:pgMar w:top="' + MARGIN + '" w:right="' + MARGIN + '" w:bottom="' + MARGIN + '" w:left="' + MARGIN + '" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + '</w:body></w:document>';

    // relationships
    const REL_TYPES = {
      styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
      numbering: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
      image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
      hyperlink: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
    };
    const relXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + REL_TYPES.styles + '" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="' + REL_TYPES.numbering + '" Target="numbering.xml"/>' +
      rels.map(r => '<Relationship Id="' + r.id + '" Type="' + REL_TYPES[r.type] + '" Target="' + esc(r.target) + '"' + (r.external ? ' TargetMode="External"' : '') + '/>').join('') +
      '</Relationships>';

    const hasExt = new Set(mediaFiles.map(f => f.name.split('.').pop()));
    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      (hasExt.has('png') ? '<Default Extension="png" ContentType="image/png"/>' : '') +
      (hasExt.has('jpg') ? '<Default Extension="jpg" ContentType="image/jpeg"/>' : '') +
      (hasExt.has('gif') ? '<Default Extension="gif" ContentType="image/gif"/>' : '') +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const iso = (opts.savedAt || new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc(model.title || '') + '</dc:title><dc:creator>PageMate</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified></cp:coreProperties>';
    const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PageMate</Application></Properties>';

    return root.KRZip.createZip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rootRels },
      { name: 'word/document.xml', data: documentXml },
      { name: 'word/_rels/document.xml.rels', data: relXml },
      { name: 'word/styles.xml', data: stylesXml() },
      { name: 'word/numbering.xml', data: numberingXml(nums) },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app },
      ...mediaFiles
    ], { date: opts.savedAt || new Date() }).then(blob => new Blob([blob], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }));
  }

  function style(id, name, { based = 'Normal', next, rPr = '', pPr = '', type = 'paragraph', q = true } = {}) {
    return '<w:style w:type="' + type + '" w:styleId="' + id + '"><w:name w:val="' + name + '"/>' +
      (id !== 'Normal' && type === 'paragraph' ? '<w:basedOn w:val="' + based + '"/>' : '') +
      (next ? '<w:next w:val="' + next + '"/>' : '') + (q ? '<w:qFormat/>' : '') +
      (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '') + '</w:style>';
  }

  function stylesXml() {
    const head = (lvl, sz, before, after, color) => style('Heading' + lvl, 'heading ' + lvl, {
      next: 'Normal',
      pPr: '<w:keepNext/><w:keepLines/><w:spacing w:before="' + before + '" w:after="' + after + '"/><w:outlineLvl w:val="' + (lvl - 1) + '"/>',
      rPr: '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light" w:cs="Calibri Light"/><w:b/><w:color w:val="' + color + '"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>'
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
      '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
      style('Title', 'Title', { next: 'Normal', pPr: '<w:spacing w:before="0" w:after="80"/><w:contextualSpacing/>', rPr: '<w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light" w:cs="Calibri Light"/><w:b/><w:color w:val="1F2A29"/><w:sz w:val="52"/><w:szCs w:val="52"/>' }) +
      style('Meta', 'Source line', { pPr: '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="BFBFBF"/></w:pBdr><w:spacing w:after="280"/>', rPr: '<w:color w:val="595959"/><w:sz w:val="18"/><w:szCs w:val="18"/>' }) +
      head(1, 36, 360, 120, '1F2A29') + head(2, 30, 320, 100, '1F2A29') + head(3, 26, 280, 80, '1D5C58') +
      head(4, 24, 240, 60, '1D5C58') + head(5, 22, 200, 40, '404040') + head(6, 22, 200, 40, '595959') +
      style('ListParagraph', 'List Paragraph', { pPr: '<w:spacing w:after="60"/><w:contextualSpacing/>' }) +
      style('Caption', 'caption', { pPr: '<w:spacing w:after="200"/>', rPr: '<w:i/><w:color w:val="595959"/><w:sz w:val="19"/>' }) +
      style('Code', 'Code', { pPr: '<w:keepLines/><w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/><w:spacing w:before="0" w:after="0" w:line="252" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/>', rPr: '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas" w:eastAsia="Consolas"/><w:sz w:val="19"/><w:szCs w:val="19"/>' }) +
      style('TableText', 'Table Text', { pPr: '<w:spacing w:before="0" w:after="0" w:line="252" w:lineRule="auto"/>', rPr: '<w:sz w:val="20"/><w:szCs w:val="20"/>' }) +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>').join('') +
      '</w:tblBorders></w:tblPr></w:style>' +
      '</w:styles>';
  }

  function numberingXml(extra) {
    const bullets = ['•', '◦', '▪'];
    const abstract0 = Array.from({ length: 9 }, (_, i) =>
      '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + bullets[i % 3] + '"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:hint="default"/></w:rPr></w:lvl>').join('');
    // Nested ordered lists stay decimal, as browsers render them.
    const abstract1 = Array.from({ length: 9 }, (_, i) =>
      '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%' + (i + 1) + '."/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="' + (720 * (i + 1)) + '" w:hanging="360"/></w:pPr></w:lvl>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + abstract0 + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + abstract1 + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      extra.map(n => '<w:num w:numId="' + n.numId + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="' + n.ilvl + '"><w:startOverride w:val="' + n.start + '"/></w:lvlOverride></w:num>').join('') +
      '</w:numbering>';
  }

  const api = { toDocx };
  root.KRDocx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
