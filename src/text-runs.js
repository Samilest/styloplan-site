// One layout pass, two serialisers.
//
// Every string and every logo the compositor draws is recorded here as it is
// drawn, so the SVG export can re-emit it as live text without recomputing the
// layout. Recomputing is how two outputs drift apart, and this project has
// already paid for that once.
//
// It also decides whether to PAINT. Compose with paintText:false and the layout
// runs identically but the strings are recorded instead of burned into the
// pixels — which is exactly the picture the SVG needs underneath its <text>
// elements. The old approach composed twice, once with labels and once without,
// and could only suppress room labels; the branding was baked either way.

/** Canvas normalises `font` to "<weight> <size>px <family>". Read it back
 *  rather than making every call site repeat what it just set. */
function readFont(font) {
  const f = String(font || '');
  const size = parseFloat((f.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 16;
  const w = f.match(/(?:^|\s)([1-9]00|bold|normal)(?:\s|$)/);
  const weight = !w ? 400 : w[1] === 'bold' ? 700 : w[1] === 'normal' ? 400 : Number(w[1]);
  return { size, weight };
}

/**
 * Canvas y means whatever `textBaseline` says; SVG y is always the alphabetic
 * baseline. A run recorded at textBaseline 'middle' and emitted unchanged sits
 * lower in the SVG than in the PNG — which is what the staircase direction word
 * was already doing.
 *
 * Converted per string from real glyph metrics rather than a ratio, so it is
 * exact for whatever font the brand kit is using.
 */
function toAlphabetic(ctx, text, y) {
  const base = ctx.textBaseline || 'alphabetic';
  if (base === 'alphabetic') return y;
  let m;
  try { m = ctx.measureText(String(text)); } catch { return y; }
  const asc = m.actualBoundingBoxAscent, desc = m.actualBoundingBoxDescent;
  if (!Number.isFinite(asc) || !Number.isFinite(desc)) return y;
  if (base === 'middle') return y + (asc - desc) / 2;
  if (base === 'top' || base === 'hanging') return y + asc;
  if (base === 'bottom' || base === 'ideographic') return y - desc;
  return y;
}

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.paintText=true]  false records without drawing
 * @param {boolean} [opts.paintLogo=true]  false reserves the logo's space
 *   without drawing its pixels, so the layout does not shift
 */
export function makeRecorder({ paintText = true, paintLogo = true } = {}) {
  const runs = [];
  const images = [];
  return {
    runs,
    images,
    /** Draw a line of text and record it. `extra` overrides anything captured. */
    text(ctx, str, x, y, extra) {
      if (paintText) ctx.fillText(str, x, y);
      const { size, weight } = readFont(ctx.font);
      runs.push({
        text: String(str),
        x,
        y: toAlphabetic(ctx, str, y),
        size,
        weight,
        fill: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '#000',
        opacity: ctx.globalAlpha === undefined ? 1 : ctx.globalAlpha,
        anchor: ctx.textAlign || 'center',
        ...extra,
      });
    },
    /** Draw a logo and record where it landed. */
    logo(ctx, img, x, y, w, h) {
      if (paintLogo) ctx.drawImage(img, x, y, w, h);
      images.push({ kind: 'logo', x, y, w, h, image: img });
    },
  };
}
