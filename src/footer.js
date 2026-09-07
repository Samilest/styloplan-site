// Footer templates — exactly THREE at launch, one per canvas format
// (handoff UX principle 8). Each template renders: logo, company name,
// tagline/contact line, the listing spec strip (user-confirmed values only),
// and the disclaimer fine-print line (default ON, editable text).

import { drawSpecStrip, measureSpecStrip } from './spec-strip.js';
import { typoScale, minLegiblePx } from './formats.js';

// Says what the process actually did, rather than reaching for the usual
// "dimensions are approximate".
//
// That phrase was contradicting the product. Everything upstream tells the user
// the numbers were transcribed from their own plan and confirmed by a named
// person, and then the footer printed a line implying nobody had checked. Both
// cannot be true, and the weaker one is the one a buyer reads.
//
// This wording is also more defensible than "accuracy is not guaranteed",
// because it is falsifiable: it names where the numbers came from, who approved
// them, and the three things this graphic is not for. Red line 7 is process
// claims, never outcome claims — and a process claim has to describe the
// process.
// Five things have to survive any edit to this line, because each answers a
// question a buyer could otherwise answer wrongly: what the graphic IS
// (illustration), where the numbers CAME FROM (the supplied plan), WHO stood
// behind them (the customer), what was NOT done (independent measurement), and
// what it must not be used for (building, furnishing).
export const DEFAULT_DISCLAIMER =
  'Marketing illustration. Dimensions transcribed from the supplied plan and '
  + 'confirmed by the customer, not independently measured. '
  + 'Not for construction or furniture fit.';

function fontStack(name) {
  return `"${name}", sans-serif`;
}

// THE LOGO FRAME.
//
// Every builder's logo is a different shape, and the footer must not be. Scaled
// on height alone — which is what this did — the width was whatever the file's
// aspect ratio happened to be, so the same footer template produced completely
// different layouts for two customers who changed nothing but their logo. On
// the landscape band a 1:1 mark occupied 103px and a 10:1 wordmark occupied
// 1030px, a tenfold swing that pushed the company name into the spec strip; a
// tall 1:2 mark shrank to 52px and read as a smudge.
//
// So the logo is fitted into a FIXED, invisible frame instead: full height for
// an upright mark, capped width for a wide one, contain-fit so nothing is
// cropped or stretched. The frame's proportions are the only new constant here
// — FRAME_RATIO is the widest a logo may be before height starts giving way —
// and it is deliberately generous enough for a normal horizontal lockup and
// firm enough that a banner cannot take the band.
//
// The reserved width is the FITTED width, not the frame width: reserving the
// whole frame for a small square mark would park the company name a third of
// the way across the canvas with nothing between them.
const FRAME_RATIO = 2.6;

/** @returns {{w:number,h:number}} the box the logo was drawn in — zero when absent. */
export function fitLogo(logo, frameH, ratio = FRAME_RATIO) {
  if (!logo || !logo.width || !logo.height) return { w: 0, h: 0 };
  const frameW = frameH * ratio;
  const scale = Math.min(frameW / logo.width, frameH / logo.height);
  return { w: logo.width * scale, h: logo.height * scale };
}

// Returns the width the logo occupies, whether or not its pixels were painted.
// The width feeds the layout of everything to its right, so a recorder in
// "reserve, do not paint" mode must still get the same number back, or the
// recorded picture and its live text would disagree about where the company
// name sits.
//
// `y` is the frame's TOP and `frameH` its full height, so a logo shorter than
// the frame is centred in it rather than hung from the top — otherwise a wide
// wordmark, which is exactly the shape the frame shrinks, would float above the
// company name it is meant to sit beside.
function drawLogo(ctx, logo, x, y, frameH, align = 'left', rec) {
  if (!logo) return 0;
  const { w, h } = fitLogo(logo, frameH);
  if (!w) return 0;
  const dx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  const dy = y + (frameH - h) / 2;
  if (rec) rec.logo(ctx, logo, dx, dy, w, h);
  else ctx.drawImage(logo, dx, dy, w, h);
  return w;
}

function px(n) { return Math.round(n); }

// An empty string is skipped rather than recorded: `tagline || ''` is drawn
// unconditionally, and an empty <text> in the SVG is an invisible object a
// designer has to hunt for in the layers panel.
function text(ctx, rec, str, x, y) {
  if (!String(str)) return;
  if (rec) rec.text(ctx, str, x, y);
  else ctx.fillText(str, x, y);
}

// THE IDENTITY BLOCK — company name over tagline, and either may be absent.
//
// A builder whose logo already carries their wordmark has a real reason to
// leave the company name empty rather than set the same words twice, and one
// with no strapline leaves the tagline empty. Both used to be filled in for
// them: the brand kit wrote the literal word "Company" and Studio fell back to
// the BUNDLED SAMPLE's name and web address, so an empty field put another
// firm's identity on a customer's marketing image.
//
// Laying the two lines out at fixed offsets from `cy` only balances when both
// are present — with one line, the block hung above or below centre against a
// logo and a spec strip that are both centred on it. So the block is measured
// from what actually exists and centred as a whole.
//
// @param {'left'|'center'} align  where `x` is on the block
// @returns {number} the block's height, 0 when there is nothing to draw
function drawIdentity(ctx, rec, brand, x, cy, nameSize, tagSize, t, font, align) {
  const name = String(brand.companyName || '').trim().toUpperCase();
  const tag = String(brand.tagline || '').trim();

  // AN EMPTY BRAND SHOWS ITS SHAPE ON SCREEN, AND NOTHING ON PAPER.
  //
  // A footer with no name and no strapline draws nothing at all, so a builder
  // who has not filled the brand kit sees a blank band and no reason to think
  // anything belongs there. Saman asked for sample words in that space.
  //
  // They are drawn ONLY when the caller says this canvas is a preview, and the
  // reason is three paragraphs up: this is the exact spot where the brand kit
  // once wrote the word "Company" and Studio fell back to the bundled sample's
  // name and web address, and an empty field put ANOTHER FIRM'S IDENTITY on a
  // customer's marketing image. A placeholder in an export would be the same
  // fault wearing different words. So the export path composes without the
  // flag and gets exactly what it got before: nothing.
  if (!name && !tag) {
    if (!brand.preview) return 0;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    const gap = 4 * t;
    ctx.globalAlpha = 0.38;
    ctx.font = `700 ${nameSize}px ${font}`;
    text(ctx, rec, 'YOUR COMPANY', x, cy - gap);
    ctx.font = `400 ${tagSize}px ${font}`;
    text(ctx, rec, 'www.yourwebsite.com', x, cy + tagSize + gap);
    ctx.globalAlpha = 1;
    return nameSize + tagSize + gap * 2;
  }

  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const gap = 4 * t;

  if (name && tag) {
    // Unchanged from before, so a fully filled footer composes identically.
    ctx.font = `700 ${nameSize}px ${font}`;
    text(ctx, rec, name, x, cy - gap);
    ctx.globalAlpha = 0.75;
    ctx.font = `400 ${tagSize}px ${font}`;
    text(ctx, rec, tag, x, cy + tagSize + gap);
    ctx.globalAlpha = 1;
    return nameSize + tagSize + gap * 2;
  }

  // One line only: sit it on the centre line. 0.36 of the size puts a cap-height
  // string's optical middle on `cy` — a baseline placed AT cy hangs the whole
  // word above it.
  if (name) {
    ctx.font = `700 ${nameSize}px ${font}`;
    text(ctx, rec, name, x, cy + nameSize * 0.36);
    return nameSize;
  }
  ctx.globalAlpha = 0.75;
  ctx.font = `400 ${tagSize}px ${font}`;
  text(ctx, rec, tag, x, cy + tagSize * 0.36);
  ctx.globalAlpha = 1;
  return tagSize;
}

// ---- Template: LANDSCAPE — slim single strip: logo | name+tagline | specs; disclaimer under.
function footerLandscape(ctx, rect, brand, specs, format, rec) {
  const t = typoScale(format);
  const minPx = minLegiblePx(format);
  const padX = rect.w * 0.045;
  const stripCy = rect.y + rect.h * 0.42;
  const font = fontStack(brand.font || 'Inter');
  const ink = brand.footerInk;

  const logoH = rect.h * 0.42;
  const logoW = drawLogo(ctx, brand.logo, padX, stripCy - logoH / 2, logoH, 'left', rec);

  ctx.fillStyle = ink;
  const nameSize = Math.max(minPx, px(34 * t));
  const tagSize = Math.max(minPx, px(19 * t));
  // The gap after the logo is only spent when something follows it.
  const tx = padX + logoW + (logoW ? rect.w * 0.02 : 0);
  drawIdentity(ctx, rec, brand, tx, stripCy, nameSize, tagSize, t, font, 'left');

  const iconH = rect.h * 0.3;
  const stripW = measureSpecStrip(ctx, specs, iconH, font);
  drawSpecStrip(ctx, specs, rect.x + rect.w - padX - stripW, stripCy, iconH, ink, font, rec);

  // Right-aligned to the spec strip's own right edge, below it. The width cap
  // is the right side of the band, so the fine print can never reach back under
  // the logo and company name.
  drawDisclaimer(ctx, rect, brand, format, 'right',
    rect.x + rect.w - padX, rect.y + rect.h * 0.72, rect.w * 0.46, rec);
}

// ---- Template: SQUARE — logo+name left, specs right, hairline divider, disclaimer under.
function footerSquare(ctx, rect, brand, specs, format, rec) {
  const t = typoScale(format);
  const minPx = minLegiblePx(format);
  const padX = rect.w * 0.05;
  const font = fontStack(brand.font || 'Inter');
  const ink = brand.footerInk;

  // hairline divider at the top of the band
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = Math.max(1, 1.5 * t);
  ctx.beginPath();
  ctx.moveTo(rect.x + padX, rect.y + rect.h * 0.08);
  ctx.lineTo(rect.x + rect.w - padX, rect.y + rect.h * 0.08);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const rowCy = rect.y + rect.h * 0.45;
  const logoH = rect.h * 0.34;
  const logoW = drawLogo(ctx, brand.logo, padX, rowCy - logoH / 2, logoH, 'left', rec);

  ctx.fillStyle = ink;
  const nameSize = Math.max(minPx, px(36 * t));
  const tagSize = Math.max(minPx, px(20 * t));
  const tx = padX + logoW + (logoW ? rect.w * 0.022 : 0);
  drawIdentity(ctx, rec, brand, tx, rowCy, nameSize, tagSize, t, font, 'left');

  const iconH = rect.h * 0.26;
  const stripW = measureSpecStrip(ctx, specs, iconH, font);
  drawSpecStrip(ctx, specs, rect.x + rect.w - padX - stripW, rowCy, iconH, ink, font, rec);

  drawDisclaimer(ctx, rect, brand, format, 'right',
    rect.x + rect.w - padX, rect.y + rect.h * 0.72, rect.w * 0.46, rec);
}

// ---- Template: PORTRAIT — centered stack: logo, name, tagline, specs, disclaimer.
function footerPortrait(ctx, rect, brand, specs, format, rec) {
  const t = typoScale(format);
  const minPx = minLegiblePx(format);
  const cx = rect.x + rect.w / 2;
  const font = fontStack(brand.font || 'Inter');
  const ink = brand.footerInk;

  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = Math.max(1, 1.5 * t);
  ctx.beginPath();
  ctx.moveTo(cx - rect.w * 0.06, rect.y + rect.h * 0.05);
  ctx.lineTo(cx + rect.w * 0.06, rect.y + rect.h * 0.05);
  ctx.stroke();
  ctx.globalAlpha = 1;

  let y = rect.y + rect.h * 0.13;
  const logoH = rect.h * 0.24;
  if (brand.logo) {
    drawLogo(ctx, brand.logo, cx, y, logoH, 'center', rec);
    y += logoH + rect.h * 0.05;
  }

  ctx.fillStyle = ink;
  const nameSize = Math.max(minPx, px(38 * t));
  const tagSize = Math.max(minPx, px(20 * t));
  // Centred on the stack rather than hung from a running baseline, so a missing
  // name does not leave its line of empty space behind. `y` then advances by
  // the block's MEASURED height — zero when there is nothing to draw, which is
  // what closes the gap instead of merely narrowing it.
  const idH = drawIdentity(ctx, rec, brand, cx, y + nameSize, nameSize, tagSize, t, font, 'center');
  y += idH ? nameSize + idH / 2 : 0;

  const iconH = rect.h * 0.13;
  const stripW = measureSpecStrip(ctx, specs, iconH, font);
  y += rect.h * 0.07 + iconH / 2;
  drawSpecStrip(ctx, specs, cx - stripW / 2, y, iconH, ink, font, rec);

  // Portrait is a CENTRED stack, so the fine print follows the spec strip's
  // alignment rather than a rule about the right-hand side: "under the figures
  // it qualifies" is the instruction, and here those figures are centred.
  // Narrower than the band it sits in. At full width the default line fitted on
  // ONE 1,273px rule under a centred stack — the shape an eye slides off. This
  // column is close to the spec strip's own width, so the fine print reads as a
  // block belonging to it. A short custom disclaimer that fits still stays on
  // one line; nothing is forced to wrap.
  drawDisclaimer(ctx, rect, brand, format, 'center',
    cx, rect.y + rect.h * 0.87, rect.w * 0.58, rec);
}

const hex2rgb = (h) => {
  const s = String(h || '').replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
};
const relLum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

// The disclaimer is fine print by SIZE, not by fadedness — red line 7 makes it
// legally load-bearing, so it has to stay readable on every palette. A flat
// 0.55 alpha measured 3.77:1 on the Dark theme (everything else in the footer
// was 9.8:1). Raise the alpha just far enough to clear 4.5:1, never past the
// full-strength ink.
function disclaimerAlpha(ink, bg, base = 0.55) {
  const fg = hex2rgb(ink);
  const back = hex2rgb(bg);
  if (!bg) return base;
  const lb = relLum(back);
  for (let a = base; a <= 1.001; a += 0.05) {
    const mixed = fg.map((c, i) => c * a + back[i] * (1 - a));
    const lf = relLum(mixed);
    const [hi, lo] = lf > lb ? [lf, lb] : [lb, lf];
    if ((hi + 0.05) / (lo + 0.05) >= 4.5) return Math.min(a, 1);
  }
  return 1;
}

/**
 * Split a string across two lines of roughly equal width.
 *
 * Balanced rather than greedy: greedy wrapping fills the first line and leaves
 * a short remainder, which reads as an accident at this size. Every break point
 * between words is measured and the one with the smallest difference between
 * the two lines wins.
 *
 * @returns {string[]} one line when it already fits, otherwise two
 */
export function splitTwoLines(ctx, str, maxW) {
  const s = String(str || '').trim();
  if (!s) return [];
  if (ctx.measureText(s).width <= maxW) return [s];

  const words = s.split(/\s+/);
  if (words.length < 2) return [s];

  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const wa = ctx.measureText(a).width;
    const wb = ctx.measureText(b).width;
    const over = Math.max(0, wa - maxW) + Math.max(0, wb - maxW);
    // Overflow is disqualifying before balance is even considered — a line that
    // runs past the edge is a worse outcome than an uneven pair.
    const score = over * 1000 + Math.abs(wa - wb);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best.lines;
}

/**
 * The fine print, set under the spec strip and aligned with it.
 *
 * It used to run as ONE line centred across the whole canvas, which put it
 * under the logo as much as under the figures it qualifies — and at full canvas
 * width it was a single 167-character rule spanning the entire footer, the
 * shape a reader's eye skips. Sat under the specs, in two balanced lines, it
 * reads as a note attached to the numbers it is actually about (proximity: a
 * qualifier belongs next to what it qualifies).
 *
 * @param {'left'|'center'|'right'} align  matched to the spec strip's own
 * @param {number} x     the alignment edge
 * @param {number} yTop  baseline of the first line
 * @param {number} maxW  width the text must fit
 */
function drawDisclaimer(ctx, rect, brand, format, align, x, yTop, maxW, rec) {
  // Disclaimer line: default ON; text editable; toggleable off (handoff L3).
  if (brand.disclaimerOn === false) return;
  const t = typoScale(format);
  ctx.save();
  ctx.fillStyle = brand.footerInk;
  ctx.globalAlpha = disclaimerAlpha(brand.footerInk, brand.canvasBg);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const stack = fontStack(brand.font || 'Inter');
  const base = Math.max(minLegiblePx(format) * 0.9, px(15 * t));
  const str = brand.disclaimerText || DEFAULT_DISCLAIMER;

  // A custom disclaimer longer than two lines will hold at this size gets the
  // type stepped down rather than being allowed to run off the canvas. Red line
  // 7 makes this text load-bearing: a sentence that ends past the edge of the
  // image is worse than one set a point smaller. The floor is 80% — below that
  // it stops being print-legible, and shrinking further would trade one failure
  // for another — so an absurdly long line still overflows, visibly, rather
  // than silently becoming unreadable.
  let size = base;
  let lines = [];
  for (let i = 0; i <= 4; i++) {
    size = Math.round(base * (1 - i * 0.05));
    ctx.font = `400 ${size}px ${stack}`;
    lines = splitTwoLines(ctx, str, maxW);
    if (lines.every((ln) => ctx.measureText(ln).width <= maxW)) break;
  }
  ctx.font = `400 ${size}px ${stack}`;
  // 1.32 rather than the body's looser leading: two lines this small read as one
  // block, and spacing them apart would make them look like separate statements.
  const lineH = size * 1.32;
  lines.forEach((ln, i) => text(ctx, rec, ln, x, yTop + i * lineH));
  ctx.restore();
}

export const FOOTER_TEMPLATES = {
  square: footerSquare,
  landscape: footerLandscape,
  portrait: footerPortrait,
};
