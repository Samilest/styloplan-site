// Patch tool — lets the USER delete something the styling model invented.
//
// Every other layer of this product is already under the customer's control:
// names, dimensions, label position and size, stairs, spec figures, palette,
// format, branding. The one thing they could not touch was the content of the
// rendered image itself. When the model drew two cars into a living room, or
// hatched an interior room, the only lever was "render again" — a credit and a
// coin toss. That single gap is what forces a customer to ask a human for help,
// which is exactly what an unattended product cannot afford.
//
// So: a deterministic removal, costing nothing, that takes a region back to
// plain floor.
//
// WHO CHOOSES THE REGION. Not the user, with a dragged rectangle — that was
// built and rejected. A free box asks for precision the user should not have to
// supply, and it can delete a real fixture with no reliable way to warn them
// (measured: a wireframe's ink density does not separate "empty floor" from
// "there is a toilet here"). The regions come from the hatch detector instead,
// as the exact GRID CELLS whose texture reads as diagonal hatching. A fixture
// beside the hatching has no diagonal texture and is never in the set, so the
// user is answering "is this area outdoor?" rather than operating an editor.
//
// It only ever REMOVES — and even that is masked. Wall-band pixels are carried
// through untouched, because a cell can still straddle a wall and erasing a
// wall misrepresents the home. Hatching and furniture can go; the building
// cannot.


/** Median of a sample, per channel — robust to a stray dark pixel. */
function medianColor(data) {
  const n = data.length / 4;
  if (!n) return [200, 200, 200];
  const ch = [[], [], []];
  for (let i = 0; i < data.length; i += 4) {
    ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
  }
  return ch.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; });
}

const PROXY_W = 400;   // the donor search runs here, not at full resolution

/**
 * Read the image once at low resolution and precompute, per pixel, the local
 * roughness and colour. Searching for a donor at full size cost 22 seconds on a
 * 1800x2400 render because every candidate meant its own getImageData; this
 * makes it one read and some arithmetic.
 */
function proxyOf(ctx, W, H) {
  const pw = Math.min(PROXY_W, W);
  const ph = Math.max(1, Math.round(H * (pw / W)));
  const c = document.createElement('canvas');
  c.width = pw; c.height = ph;
  const px = c.getContext('2d', { willReadFrequently: true });
  px.drawImage(ctx.canvas, 0, 0, pw, ph);
  const { data } = px.getImageData(0, 0, pw, ph);

  // Per-pixel roughness: how different this pixel is from its right and lower
  // neighbour. Walls, fixtures and hatching are rough; plain floor is not.
  const rough = new Float32Array(pw * ph);
  for (let y = 0; y < ph - 1; y++) {
    for (let x = 0; x < pw - 1; x++) {
      const i = (y * pw + x) * 4;
      rough[y * pw + x] =
        Math.abs(data[i] - data[i + 4]) + Math.abs(data[i] - data[i + pw * 4]);
    }
  }
  return { data, rough, pw, ph, sx: pw / W, sy: ph / H };
}

/**
 * Find a same-sized piece of plain floor elsewhere in the image, so the patch
 * inherits the real floor tone AND its tile grid. A flat fill would read as a
 * blank rectangle on a tiled floor; a cloned piece does not.
 * @returns {{x:number,y:number}|null} full-resolution top-left of the donor
 */
function findDonor(proxy, W, H, rect, targetTone) {
  const { data, rough, pw, ph, sx, sy } = proxy;
  const w = Math.max(2, Math.round(rect.w * sx));
  const h = Math.max(2, Math.round(rect.h * sy));
  if (w >= pw || h >= ph) return null;          // patch too big to find a donor for

  const hx = rect.x * sx, hy = rect.y * sy, hw = rect.w * sx, hh = rect.h * sy;
  const step = Math.max(2, Math.floor(Math.min(w, h) / 3));
  let best = null;

  for (let y = 0; y + h <= ph; y += step) {
    for (let x = 0; x + w <= pw; x += step) {
      // never sample from the hole we are filling
      if (x < hx + hw && x + w > hx && y < hy + hh && y + h > hy) continue;
      let rSum = 0, r = 0, g = 0, b = 0, n = 0;
      // sample a lattice inside the candidate rather than every pixel
      const sxStep = Math.max(1, Math.floor(w / 12));
      const syStep = Math.max(1, Math.floor(h / 12));
      for (let py = 0; py < h; py += syStep) {
        for (let px = 0; px < w; px += sxStep) {
          const p = (y + py) * pw + (x + px);
          rSum += rough[p];
          const i = p * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          n++;
        }
      }
      if (!n) continue;
      const e = rSum / n;
      const toneGap = Math.abs(r / n - targetTone[0])
        + Math.abs(g / n - targetTone[1]) + Math.abs(b / n - targetTone[2]);
      // Quiet first, matching tone second: a busy region that happens to average
      // the right colour would import a wall into the hole.
      const score = e * 3 + toneGap;
      if (!best || score < best.score) best = { x, y, score, e, toneGap };
    }
  }
  // A donor that is not actually plain floor is worse than a flat fill.
  //
  // The roughness gate sits at 12, not 6. Floor is not smooth — it carries the
  // tile grid, measured at roughly 8 on a real render — so a gate of 6 rejected
  // every piece of real floor and admitted only the empty canvas outside the
  // building, which then failed the tone test. The result was that the clone
  // path never ran and every patch fell back to a flat fill with no grid.
  if (!best || best.e >= 12 || best.toneGap >= 30) return null;
  return { x: Math.round(best.x / sx), y: Math.round(best.y / sy) };
}

/** The tone immediately AROUND a rect — what the hole should end up looking like. */
function surroundingTone(ctx, W, H, rect) {
  const pad = Math.max(4, Math.round(Math.min(rect.w, rect.h) * 0.25));
  const x0 = Math.max(0, rect.x - pad), y0 = Math.max(0, rect.y - pad);
  const x1 = Math.min(W, rect.x + rect.w + pad), y1 = Math.min(H, rect.y + rect.h + pad);
  const outer = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
  // Sample the ring only: the inside is the thing being removed.
  const keep = [];
  const rw = x1 - x0;
  for (let py = 0; py < y1 - y0; py++) {
    for (let px = 0; px < rw; px++) {
      const gx = x0 + px, gy = y0 + py;
      const inside = gx >= rect.x && gx < rect.x + rect.w && gy >= rect.y && gy < rect.y + rect.h;
      if (inside) continue;
      const i = (py * rw + px) * 4;
      keep.push(outer.data[i], outer.data[i + 1], outer.data[i + 2], 255);
    }
  }
  return medianColor(new Uint8ClampedArray(keep));
}

/**
 * Which pixels in a region are WALL, and must survive the fill.
 *
 * Walls are the extreme tone of a plan — near-white on the dark theme, near-black
 * on the light one — and they are THICK. Fixture strokes and hatch lines sit at
 * mid tones and are thin, so an erosion drops them while wall bands survive.
 * That distinction is what lets the tool delete an invented sofa but not a wall.
 */
function wallMask(ctx, rect, W, H) {
  const { data } = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  const n = rect.w * rect.h;
  const lum = new Float32Array(n);
  let sum = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    lum[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum[p];
  }
  // Decide polarity from the WHOLE image, not the patch: a rectangle drawn
  // entirely on a dark floor would otherwise look like a light-on-dark drawing
  // and mask the wrong pixels.
  const whole = ctx.getImageData(0, 0, Math.min(W, 200), Math.min(H, 200)).data;
  let wSum = 0, wN = 0;
  for (let i = 0; i < whole.length; i += 4) {
    wSum += 0.299 * whole[i] + 0.587 * whole[i + 1] + 0.114 * whole[i + 2]; wN++;
  }
  const inverted = (wSum / wN) < 128;

  const raw = new Uint8Array(n);
  for (let p = 0; p < n; p++) raw[p] = (inverted ? lum[p] > 205 : lum[p] < 70) ? 1 : 0;

  // Erode then dilate: thin strokes vanish, thick bands come back at full width.
  const R = 2;
  const tmp = new Uint8Array(n), out = new Uint8Array(n);
  const at = (a, x, y) => (x < 0 || y < 0 || x >= rect.w || y >= rect.h) ? 1 : a[y * rect.w + x];
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    let v = 1;
    for (let d = -R; d <= R && v; d++) if (!at(raw, x + d, y)) v = 0;
    tmp[y * rect.w + x] = v;
  }
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    let v = 1;
    for (let d = -R; d <= R && v; d++) if (!at(tmp, x, y + d)) v = 0;
    out[y * rect.w + x] = v;
  }
  // dilate back, a little wider than the erosion so edges are not shaved
  const grown = new Uint8Array(n);
  const D = R + 1;
  for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
    let v = 0;
    for (let dy = -D; dy <= D && !v; dy++) for (let dx = -D; dx <= D && !v; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < rect.w && yy < rect.h && out[yy * rect.w + xx]) v = 1;
    }
    grown[y * rect.w + x] = v;
  }
  return grown;
}

/**
 * Apply the user's patches to a rendered plan.
 * @param {HTMLCanvasElement|HTMLImageElement} planImage
 * @param {Array<{x,y,w,h}>} patches  normalized 0..1 against the plan image
 * @returns {HTMLCanvasElement} a new canvas; the input is untouched
 */
export function applyPatches(planImage, patches = []) {
  const W = planImage.naturalWidth || planImage.width;
  const H = planImage.naturalHeight || planImage.height;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(planImage, 0, 0, W, H);
  if (!patches.length) return out;
  // One low-resolution read shared by every patch in this pass.
  let proxy = proxyOf(ctx, W, H);

  for (const p of patches) {
    // Round the EDGES, not the origin and the size separately: rounding both
    // independently let the right and bottom edges land a pixel past the
    // requested area, so adjacent cells overlapped and a removal bled outside
    // the region it was given.
    const x0 = Math.max(0, Math.min(W, Math.round(p.x * W)));
    const y0 = Math.max(0, Math.min(H, Math.round(p.y * H)));
    const x1 = Math.max(0, Math.min(W, Math.round((p.x + p.w) * W)));
    const y1 = Math.max(0, Math.min(H, Math.round((p.y + p.h) * H)));
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    if (rect.w < 2 || rect.h < 2) continue;

    const tone = surroundingTone(ctx, W, H, rect);
    const keepWall = wallMask(ctx, rect, W, H);
    const target = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    const donor = findDonor(proxy, W, H, rect, tone);

    let fill = null;
    if (donor) {
      // Clone a quiet piece of floor, so the tile grid carries through.
      const dw = Math.min(rect.w, W - donor.x);
      const dh = Math.min(rect.h, H - donor.y);
      if (dw === rect.w && dh === rect.h) fill = ctx.getImageData(donor.x, donor.y, dw, dh);
    }

    for (let p = 0; p < rect.w * rect.h; p++) {
      if (keepWall[p]) continue;             // the building stays
      const i = p * 4;
      if (fill) {
        target.data[i] = fill.data[i];
        target.data[i + 1] = fill.data[i + 1];
        target.data[i + 2] = fill.data[i + 2];
      } else {
        target.data[i] = tone[0];
        target.data[i + 1] = tone[1];
        target.data[i + 2] = tone[2];
      }
      target.data[i + 3] = 255;
    }
    ctx.putImageData(target, rect.x, rect.y);
    // A later patch must see what this one did, or two overlapping patches
    // could both clone from the same now-stale floor.
    proxy = proxyOf(ctx, W, H);
  }
  return out;
}
