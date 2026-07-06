// Client-side HTML deck -> editable PPTX reconstruction.
// Browser adaptation of the huashu-design html2pptx approach: each slide is a
// self-contained 1280x720 HTML document; we render it in a hidden same-origin
// iframe, walk the live DOM with getComputedStyle/getBoundingClientRect, and
// translate elements into positioned pptxgenjs objects (real editable
// textboxes and shapes, not screenshots).

export interface HtmlDeckSlide {
  title: string;
  html: string;
  narration?: string;
}

const SLIDE_W_PX = 1280;
const SLIDE_H_PX = 720;
const PX_PER_IN = 96;
const PT_PER_PX = 0.75;

const pxToIn = (px: number) => px / PX_PER_IN;

interface RGBA { hex: string; alpha: number }

function parseCssColor(value: string | null | undefined): RGBA | null {
  if (!value) return null;
  const m = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  if (alpha === 0) return null;
  const hex = [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, alpha };
}

function firstGradientColor(backgroundImage: string): RGBA | null {
  const m = backgroundImage.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
  if (!m) return null;
  if (m[1].startsWith('#')) {
    let hex = m[1].slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    return { hex: hex.slice(0, 6).toUpperCase(), alpha: 1 };
  }
  return parseCssColor(m[1]);
}

function mapFontFace(fontFamily: string): string {
  const lower = fontFamily.toLowerCase();
  if (/mono|consolas|courier|menlo|cascadia/.test(lower)) return 'Courier New';
  if (/serif|georgia|times|songti|simsun|garamond|playfair|fraunces|newsreader|lora/.test(lower) && !/sans-serif/.test(lower.split(',')[0])) {
    return 'Georgia';
  }
  return 'Arial';
}

function isElementVisible(el: Element, style: CSSStyleDeclaration, rect: DOMRect): boolean {
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;
  if (rect.width < 1 || rect.height < 1) return false;
  if (rect.right < 0 || rect.bottom < 0 || rect.left > SLIDE_W_PX || rect.top > SLIDE_H_PX) return false;
  return true;
}

const INLINE_TAGS = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'SUP', 'SUB', 'CODE', 'SMALL', 'MARK', 'A', 'BR']);

function hasOnlyInlineContent(el: Element): boolean {
  for (const child of Array.from(el.children)) {
    if (!INLINE_TAGS.has(child.tagName)) return false;
    if (!hasOnlyInlineContent(child)) return false;
  }
  return true;
}

function directTextContent(el: Element): string {
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

interface TextRun {
  text: string;
  options: Record<string, unknown>;
}

function collectRuns(el: Element, win: Window, inherited: CSSStyleDeclaration): TextRun[] {
  const runs: TextRun[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').replace(/\s+/g, ' ');
      if (text.trim()) {
        runs.push({ text, options: runOptionsFromStyle(inherited) });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.tagName === 'BR') {
        runs.push({ text: '', options: { breakLine: true } });
        continue;
      }
      const childStyle = win.getComputedStyle(child);
      if (childStyle.display === 'none') continue;
      runs.push(...collectRuns(child, win, childStyle));
    }
  }
  return runs;
}

function runOptionsFromStyle(style: CSSStyleDeclaration): Record<string, unknown> {
  const color = parseCssColor(style.color);
  const fontSizePt = Math.max(6, Math.round(parseFloat(style.fontSize) * PT_PER_PX * 10) / 10);
  return {
    fontSize: fontSizePt,
    color: color?.hex || '000000',
    bold: Number(style.fontWeight) >= 600,
    italic: style.fontStyle === 'italic',
    fontFace: mapFontFace(style.fontFamily),
    ...(parseFloat(style.letterSpacing) > 0 ? { charSpacing: Math.round(parseFloat(style.letterSpacing) * PT_PER_PX * 100) / 100 } : {}),
  };
}

type PptxSlide = {
  background: { color: string };
  addText: (runs: unknown, opts: Record<string, unknown>) => void;
  addShape: (type: string, opts: Record<string, unknown>) => void;
  addImage: (opts: Record<string, unknown>) => void;
  addNotes: (notes: string) => void;
};

async function svgToPngDataUrl(svg: SVGElement, rect: DOMRect): Promise<string | null> {
  try {
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(Math.max(1, Math.round(rect.width))));
    clone.setAttribute('height', String(Math.max(1, Math.round(rect.height))));
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(clone);
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    const img = new Image();
    const loaded = new Promise<boolean>(resolve => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    });
    img.src = svgUrl;
    if (!(await loaded)) return null;
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function shapeOptionsFromStyle(style: CSSStyleDeclaration, rect: DOMRect): Record<string, unknown> | null {
  const bg = parseCssColor(style.backgroundColor);
  const gradientBg = style.backgroundImage && style.backgroundImage !== 'none'
    ? firstGradientColor(style.backgroundImage)
    : null;
  const fill = bg || gradientBg;
  const borderWidth = parseFloat(style.borderTopWidth) || 0;
  const borderColor = borderWidth > 0 ? parseCssColor(style.borderTopColor) : null;
  if (!fill && !borderColor) return null;

  const radius = parseFloat(style.borderTopLeftRadius) || 0;
  const opts: Record<string, unknown> = {
    x: pxToIn(rect.left),
    y: pxToIn(rect.top),
    w: pxToIn(rect.width),
    h: pxToIn(rect.height),
  };
  if (fill) {
    opts.fill = { color: fill.hex, ...(fill.alpha < 1 ? { transparency: Math.round((1 - fill.alpha) * 100) } : {}) };
  } else {
    opts.fill = { color: 'FFFFFF', transparency: 100 };
  }
  if (borderColor) {
    opts.line = { color: borderColor.hex, width: Math.max(0.25, borderWidth * PT_PER_PX) };
  }
  opts.rectRadius = radius > 0 ? Math.min(pxToIn(radius), pxToIn(Math.min(rect.width, rect.height)) / 2) : 0;
  return opts;
}

async function walkElement(
  el: Element,
  win: Window,
  slide: PptxSlide,
  pptx: { ShapeType: Record<string, string> },
  depth: number,
): Promise<void> {
  const style = win.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  if (!isElementVisible(el, style, rect)) return;

  if (el instanceof win.window.SVGSVGElement || el.tagName.toLowerCase() === 'svg') {
    const dataUrl = await svgToPngDataUrl(el as SVGElement, rect);
    if (dataUrl) {
      slide.addImage({ data: dataUrl, x: pxToIn(rect.left), y: pxToIn(rect.top), w: pxToIn(rect.width), h: pxToIn(rect.height) });
    }
    return;
  }

  const text = directTextContent(el);
  const isTextBlock = text.length > 0 && hasOnlyInlineContent(el);

  // Draw the box (background/border) before its content so paint order holds.
  const shapeOpts = depth > 0 ? shapeOptionsFromStyle(style, rect) : null;
  if (shapeOpts) {
    slide.addShape((shapeOpts.rectRadius as number) > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, shapeOpts);
  }

  if (isTextBlock) {
    const runs = collectRuns(el, win, style);
    if (runs.length > 0) {
      const lineHeightPx = parseFloat(style.lineHeight);
      const align = ({ left: 'left', right: 'right', center: 'center', justify: 'justify' } as Record<string, string>)[style.textAlign] || 'left';
      const padL = parseFloat(style.paddingLeft) || 0;
      const padT = parseFloat(style.paddingTop) || 0;
      const padR = parseFloat(style.paddingRight) || 0;
      const padB = parseFloat(style.paddingBottom) || 0;
      slide.addText(runs, {
        x: pxToIn(rect.left + padL),
        y: pxToIn(rect.top + padT),
        w: Math.max(0.1, pxToIn(rect.width - padL - padR)),
        h: Math.max(0.1, pxToIn(rect.height - padT - padB)),
        align,
        valign: 'top',
        margin: 0,
        ...(Number.isFinite(lineHeightPx) ? { lineSpacing: Math.round(lineHeightPx * PT_PER_PX * 10) / 10 } : {}),
      });
    }
    return;
  }

  for (const child of Array.from(el.children)) {
    await walkElement(child, win, slide, pptx, depth + 1);
  }
}

function renderSlideInIframe(html: string): Promise<HTMLIFrameElement> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;left:-99999px;top:0;width:${SLIDE_W_PX}px;height:${SLIDE_H_PX}px;border:0;visibility:hidden;pointer-events:none;`;
    iframe.setAttribute('aria-hidden', 'true');
    const timeout = window.setTimeout(() => reject(new Error('幻灯片渲染超时')), 15_000);
    iframe.onload = () => {
      window.clearTimeout(timeout);
      // Give layout one frame to settle before measuring.
      requestAnimationFrame(() => resolve(iframe));
    };
    document.body.appendChild(iframe);
    iframe.srcdoc = html;
  });
}

export interface SlideOverflowReport {
  overflowX: number; // px beyond 1280
  overflowY: number; // px beyond 720
}

// Quality-loop measurement: render the slide off-screen and check whether the
// content spills out of the 1280x720 canvas (visual-deck-builder style audit).
export async function measureSlideOverflow(html: string): Promise<SlideOverflowReport> {
  const iframe = await renderSlideInIframe(html);
  try {
    const doc = iframe.contentDocument;
    if (!doc?.body) return { overflowX: 0, overflowY: 0 };
    const body = doc.body;
    let maxRight = body.scrollWidth;
    let maxBottom = body.scrollHeight;
    // scrollWidth misses absolutely-positioned overflow under overflow:hidden,
    // so also scan element bounding boxes.
    for (const el of Array.from(body.querySelectorAll('*')).slice(0, 800)) {
      const rect = (el as Element).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      maxRight = Math.max(maxRight, rect.right);
      maxBottom = Math.max(maxBottom, rect.bottom);
    }
    return {
      overflowX: Math.max(0, Math.round(maxRight - SLIDE_W_PX)),
      overflowY: Math.max(0, Math.round(maxBottom - SLIDE_H_PX)),
    };
  } finally {
    iframe.remove();
  }
}

export async function exportHtmlDeckToPptx(slides: HtmlDeckSlide[], fileName: string): Promise<void> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33in x 7.5in = 1280x720 @96dpi
  pptx.title = fileName;

  for (const deckSlide of slides) {
    const iframe = await renderSlideInIframe(deckSlide.html);
    try {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win || !doc.body) throw new Error('无法读取幻灯片文档');

      const slide = pptx.addSlide() as unknown as PptxSlide;
      const bodyStyle = win.getComputedStyle(doc.body);
      const bodyBg = parseCssColor(bodyStyle.backgroundColor)
        || (bodyStyle.backgroundImage !== 'none' ? firstGradientColor(bodyStyle.backgroundImage) : null);
      slide.background = { color: bodyBg?.hex || 'FFFFFF' };

      for (const child of Array.from(doc.body.children)) {
        await walkElement(child, win as unknown as Window, slide, pptx as unknown as { ShapeType: Record<string, string> }, 1);
      }

      if (deckSlide.narration?.trim()) {
        slide.addNotes(deckSlide.narration.trim());
      }
    } finally {
      iframe.remove();
    }
  }

  await pptx.writeFile({ fileName: `${fileName.replace(/[\\/:*?"<>|]/g, '_')}.pptx` });
}

export function buildStandaloneDeckHtml(slides: HtmlDeckSlide[], deckTitle: string): string {
  const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const frames = slides
    .map((s, i) => `<iframe class="slide" data-idx="${i}" srcdoc="${escapeAttr(s.html)}" sandbox=""></iframe>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${deckTitle.replace(/</g, '&lt;')}</title>
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
  .stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}
  .frame-box{position:relative;width:min(100vw,calc(100vh*16/9));height:min(100vh,calc(100vw*9/16))}
  .slide{position:absolute;inset:0;width:1280px;height:720px;border:0;background:#fff;transform-origin:top left;display:none}
  .slide.active{display:block}
  .hud{position:fixed;bottom:16px;right:20px;color:#fff;background:rgba(0,0,0,.55);padding:6px 14px;border-radius:999px;font-size:13px;user-select:none;z-index:9}
</style>
</head>
<body>
<div class="stage"><div class="frame-box" id="box">
${frames}
</div></div>
<div class="hud" id="hud"></div>
<script>
  var slides=[].slice.call(document.querySelectorAll('.slide')),cur=0;
  function fit(){var box=document.getElementById('box'),s=Math.min(box.clientWidth/1280,box.clientHeight/720);slides.forEach(function(f){f.style.transform='scale('+s+')'})}
  function show(i){cur=Math.max(0,Math.min(slides.length-1,i));slides.forEach(function(f,j){f.classList.toggle('active',j===cur)});document.getElementById('hud').textContent=(cur+1)+' / '+slides.length}
  window.addEventListener('resize',fit);
  window.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown')show(cur+1);
    if(e.key==='ArrowLeft'||e.key==='PageUp')show(cur-1);
    if(e.key==='f'&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen();
  });
  window.addEventListener('click',function(){show(cur+1)});
  fit();show(0);
</script>
</body>
</html>`;
}
