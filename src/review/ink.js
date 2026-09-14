// One definition of "which pixels are linework".
//
// Three modules used to answer this question with three different bodies of
// code and three different constants, on the same images:
//
//   registration.js   width 512   ink < 120   inverted ink > 140
//   text-guard.js     width 900   ink < 128   inverted ink > 150
//   anchors.js        width 900   ink < 128   no polarity detection at all
//
// Same question, different answers, so the guards could in principle disagree
// about where the walls are, where the glyphs are, and where a label should
// sit. This module is the single implementation.
//
// THE NUMBERS ARE DELIBERATELY NOT RECONCILED HERE. Each caller still passes
// the constants it was calibrated with, so this refactor changes no behaviour —
// that was verified against a fixture corpus before and after. Reconciling them
// is a real decision with real risk, and it should be made against that corpus,
// not smuggled in as part of a cleanup.

/**
 * @param {HTMLImageElement|HTMLCanvasElement} img
 * @param {object} opt
 * @param {number} opt.width          working width; height follows the aspect
 * @param {number} opt.lum            dark-on-light cut: darker than this is ink
 * @param {number} [opt.lumInverted]  light-on-dark cut: brighter than this is ink
 * @param {boolean} [opt.detectPolarity=true]  when false, always dark-on-light
 * @param {number} [opt.structureLumInverted]  a second, higher inverted cut that
 *   keeps only the built fabric; on a dark plan the outdoor hatch is light
 *   enough to pass `lumInverted` and would otherwise count as wall structure.
 * @param {'average'|'extreme'} [opt.downsample='average']  how a block of
 *   source pixels becomes one working pixel. See `sampleLum` below — this is
 *   the difference between a hairline surviving the shrink and being averaged
 *   into the paper.
 * @returns {{ink:Uint8Array, structure:Uint8Array, w:number, h:number, inverted:boolean}}
 */
export function inkMap(img, opt) {
  const { width, lum: LUM, lumInverted: LUM_INV, structureLumInverted } = opt;
  const detectPolarity = opt.detectPolarity !== false;

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const w = width;
  const h = Math.max(1, Math.round(srcH * (w / srcW)));

  const s = sampleLum(img, w, h, srcW, srcH, opt.downsample === 'extreme');

  let inverted = false;
  if (detectPolarity) {
    let dark = 0, n = 0;
    for (let p = 0; p < s.mean.length; p++) {
      if (!s.opaque[p]) continue;
      n++;
      if (s.mean[p] < LUM) dark++;
    }
    // Linework is always the minority of a plan. If most of the image is dark,
    // the drawing is light-on-dark and the bright pixels are the linework.
    //
    // POLARITY IS ALWAYS READ FROM THE MEAN, never from the extreme. It is a
    // question about the FIELD — is most of this page dark? — and the darkest
    // sample in every block answers a different question. On `extreme` a light
    // plan whose hairlines touch most blocks would otherwise read as dark and
    // the whole map would invert.
    inverted = n > 0 && dark / n > 0.5;
  }

  // The linework is whichever end of the block is furthest from the paper:
  // darkest on a light plan, brightest on a dark one.
  const lum = opt.downsample === 'extreme' ? (inverted ? s.max : s.min) : s.mean;

  const ink = new Uint8Array(w * h);
  const structure = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) {
    if (!s.opaque[p]) continue;
    const l = lum[p];
    if (inverted) {
      if (l > LUM_INV) ink[p] = 1;
      if (structureLumInverted === undefined || l > structureLumInverted) structure[p] = 1;
    } else if (l < LUM) {
      ink[p] = 1;
      structure[p] = 1;
    }
  }
  return { ink, structure, w, h, inverted };
}

// How big a picture is read at full resolution before pooling. A hairline is
// only preserved if the pool actually SEES it, so the read has to stay well
// above the working width; 2048 is 4x the widest caller and covers every plan
// in the corpus at its native size.
const MAX_READ = 2048;

/**
 * Luminance per working pixel, three ways: the mean of the block, its darkest
 * sample and its brightest.
 *
 * WHY THE EXTREME EXISTS. Shrinking with `drawImage` averages, and averaging is
 * what a plan drawn in single hairlines cannot survive. Measured at
 * registration's own 512px working width: one black line, one source pixel
 * wide, in a 2048px drawing lands in a block with three white neighbours and
 * comes back at luminance ~191 — nowhere near the 120 ink cut. The line is
 * simply gone.
 *
 * That is not a small effect. Counting ink pixels at 512 across the corpus,
 * pooling the darkest sample instead of the mean moves every poche-walled plan
 * by 1.4-1.6x (Jordan 21432 -> 33538, Madison 19476 -> 34169) and the one
 * thin-lined plan by 10.6x (Plan A 2471 -> 26158). Plan A does not carry an
 * order of magnitude less linework than the others; the shrink was deleting it.
 *
 * The consequence downstream was a drawing that could never be confirmed. With
 * only 2471 ink pixels to compare, a mask holding a fraction of the real walls,
 * anything at all that changed the pen — and STYLING LEGITIMATELY CHANGES THE
 * PEN — dominated the reading: the same plan compared against a copy of itself
 * with the stroke one working pixel heavier read 33.5% of its linework as
 * missing, against a 35% reject line, while Jordan read 0.0%.
 *
 * Pooling the extreme does not invent ink. It says "there is linework
 * somewhere in this block", which is the only honest answer when the block is
 * smaller than the pen.
 */
function sampleLum(img, w, h, srcW, srcH, extreme) {
  // The cheap path is byte-for-byte what this function always did: let the
  // canvas do the shrink. Every caller that has not asked for `extreme` keeps
  // its calibration untouched.
  if (!extreme) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const mean = new Float32Array(w * h);
    const opaque = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      if (data[i + 3] <= 100) continue;
      opaque[p] = 1;
      mean[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    return { mean, min: mean, max: mean, opaque };
  }

  const rw = Math.min(srcW, MAX_READ);
  const rh = Math.max(1, Math.round(srcH * (rw / srcW)));
  const c = document.createElement('canvas');
  c.width = rw; c.height = rh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, rw, rh);
  const { data } = ctx.getImageData(0, 0, rw, rh);

  const n = w * h;
  const sum = new Float64Array(n), cnt = new Float64Array(n);
  const min = new Float32Array(n).fill(255), max = new Float32Array(n).fill(0);
  const opaque = new Uint8Array(n);
  const mean = new Float32Array(n);
  for (let y = 0; y < rh; y++) {
    const ty = Math.min(h - 1, ((y * h) / rh) | 0) * w;
    for (let x = 0; x < rw; x++) {
      const i = (y * rw + x) * 4;
      if (data[i + 3] <= 100) continue;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const p = ty + Math.min(w - 1, ((x * w) / rw) | 0);
      opaque[p] = 1;
      sum[p] += l; cnt[p]++;
      if (l < min[p]) min[p] = l;
      if (l > max[p]) max[p] = l;
    }
  }
  for (let p = 0; p < n; p++) if (cnt[p]) mean[p] = sum[p] / cnt[p];
  return { mean, min, max, opaque };
}
