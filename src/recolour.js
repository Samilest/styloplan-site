// Recolour a styled render into tints of one brand colour.
//
// Why this exists: the image model will not take a colour instruction. Two live
// tests proved it (a hex code, then a plain-English colour name — both produced
// the same neutral grey; see AGENT-HANDOFF). So the plan's colour cannot come
// from the model, and the only honest place left to set it is here.
//
// It works because the renders are almost monochrome. Measured on the shipped
// fixtures: the dark render is 95.9% neutral pixels, the light one 84.2%. A
// near-grey image carries all of its shading in LUMINANCE, so replacing the grey
// ramp with a coloured one keeps every shadow, the vignette, the tile grid and
// the wall thickness exactly as drawn, and changes only the hue.
//
// WHY MONOTONE AND NOT THREE COLOURS. There used to be separate controls for
// background, floors and walls, anchored at the luminances the prompts hard-code
// (60 / 72 / 241 on the dark render). It did not work, and the measurement says
// why: of every pixel that changed when only "floors" was set, 2.1% was floor
// and 97.9% was not. Between the floor anchor at 72 and the wall anchor at 241
// lies a 169-step gap where all the linework, fixtures, stairs, cars and tile
// grid live, and each of them takes a share of whatever the floor was set to.
// A luminance ramp cannot tell a floor field from a fixture outline of the same
// lightness — the same class of limit as the coverage probe not being able to
// tell a wall from a letterform.
//
// Monotone removes the problem rather than working around it. When every colour
// in the image is a tint of one hue, a line picking up the floor's colour is not
// an error — it is the point. And it matches how builders actually hold a brand:
// one primary colour, not a three-colour palette.
//
// This is a DISPLAY TRANSFORM. The stored artifact is never touched, so the
// registration and baked-text guards always measure the render the model
// actually returned. Same rule as dimension rounding: the underlying value is
// never overwritten.

/** #rgb or #rrggbb -> [r,g,b]. null for anything else, so a half-typed value in
 *  a text field is a no-op rather than a crash. */
export function rgb(hex) {
  const s = String(hex || '').trim();
  const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
  const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (m3) return [...m3[1]].map((c) => parseInt(c + c, 16));
  if (!m6) return null;
  const n = parseInt(m6[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const LUM = ([r, g, b]) => r * 0.299 + g * 0.587 + b * 0.114;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

/**
 * The tones each theme's render is drawn in. These are the colours the styling
 * prompts hard-code, so they are not a guess — they are what the model puts on
 * the canvas every time. Kept because the Studio swatches show what is already
 * on screen, and because the report names them.
 */
export const PLAN_TONES = {
  light: { background: '#EDEAE3', floors: '#D6D2CA', walls: '#2B2B2B' },
  dark: { background: '#3A3D40', floors: '#46494C', walls: '#F2F1EE' },
};

// Mixing toward black and toward white already desaturates the ends by itself,
// the way ink on paper does. The only extra easing needed is in the last few
// percent at each extreme, where a hue would just look like a colour cast on
// something that should read as pure paper or pure ink.
//
// A first attempt eased saturation by distance from the BRAND's own lightness,
// and the result was almost colourless: this render puts 83% of its pixels
// below luminance 66 and 4% above 235, so nearly every pixel was at a "far from
// the brand" position and got desaturated. Easing has to be anchored to the
// ends of the range, not to where the brand happens to sit.
const EDGE = 0.06;      // fraction at each end over which the hue fades out
const EDGE_SAT = 0.35;  // how much hue survives at pure black / pure white

/**
 * A 256-entry ramp of tints of one colour, indexed by luminance.
 *
 * Built in RGB against white and black rather than in HSL, because a tint
 * towards white and a shade towards black are exactly what "lighter" and
 * "darker" mean to the eye, and HSL lightness is not.
 */
export function monoRamp(hex) {
  const base = rgb(hex);
  if (!base) return null;
  const bl = LUM(base) / 255;              // where the brand colour sits, 0..1
  const r = new Uint8Array(256), g = new Uint8Array(256), b = new Uint8Array(256);

  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // The neutral this pixel would be, and the fully-saturated tint of the brand
    // at the same lightness. Mixing between them controls how strongly the hue
    // shows without moving the pixel's lightness.
    let tint;
    if (t <= bl) {
      // darker than the brand: shade it toward black
      const k = bl > 0 ? t / bl : 0;
      tint = base.map((c) => c * k);
    } else {
      // lighter than the brand: tint it toward white
      const k = bl < 1 ? (t - bl) / (1 - bl) : 0;
      tint = base.map((c) => c + (255 - c) * k);
    }
    // Full hue across the body of the range; eased only where the image is
    // effectively pure black or pure white.
    const edge = Math.min(t, 1 - t) / EDGE;
    const sat = edge >= 1 ? 1 : EDGE_SAT + (1 - EDGE_SAT) * edge;
    const grey = t * 255;
    r[i] = clamp255(grey + (tint[0] - grey) * sat);
    g[i] = clamp255(grey + (tint[1] - grey) * sat);
    b[i] = clamp255(grey + (tint[2] - grey) * sat);
  }
  return { r, g, b };
}

/** True when there is nothing to apply. */
export function isDefaultTone(tone) {
  return !tone || tone.mode !== 'mono' || !rgb(tone.brand);
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement} img the styled render
 * @param {Object} [tone] {mode:'mono', brand:'#RRGGBB'}
 * @returns {HTMLImageElement|HTMLCanvasElement} a new canvas, or `img` itself
 *   when there is nothing to do — so the default path costs nothing.
 */
export function recolourPlan(img, tone) {
  if (isDefaultTone(tone)) return img;
  const ramp = monoRamp(tone.brand);
  if (!ramp) return img;

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const id = ctx.getImageData(0, 0, w, h);
  const p = id.data;
  // EVERY pixel, including the outdoor hatch. Under three-colour editing the
  // hatch was skipped so its beige survived as the one thing saying "outside";
    // in monotone a single off-hue field is the only wrong thing on the canvas,
  // and the distinction survives anyway because the hatch is a PATTERN — the
  // diagonal lines read as outdoor whatever colour they are tinted.
  for (let i = 0; i < p.length; i += 4) {
    const l = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0;
    p[i] = ramp.r[l]; p[i + 1] = ramp.g[l]; p[i + 2] = ramp.b[l];
  }
  ctx.putImageData(id, 0, 0);
  return out;
}
