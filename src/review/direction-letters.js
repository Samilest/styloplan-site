// UP AND DN, AND NOTHING ELSE.
//
// The tracing letters a staircase's direction beside it, and the styling model
// copies those letters into the render more readily than any other text, so they
// are taken off the drawing before it is sent. The step that did it took off
// every unclaimed block of three marks or fewer, as a white rectangle. Measured
// on the fixture tracings (2026-10-05): of 127 patches it painted, about 30 were
// UP or DN, and about 55 were drawing -- cooktops, toilets, basins, door leaves
// and arcs, armchairs, closet hangers, pieces of wall -- handed to the model as
// blank paper. The rest was text, which the cover after it hides where it
// reads a word or a label says one was written.
//
// So this reads the two words it exists for, letter by letter, by what a letter
// is made of:
//
//   U  no hole, a side down each edge        P  a straight back, a hole in the top
//   N  no hole, a side down each edge        D  a straight back, a hole the
//                                               height of it, and a curved front
//
// A sink's basin or a burner has a hole but no straight back; a 0 or an O has
// no straight back either, and a D's back is straight where its front is
// round. The digits that pair up like these words -- 10, 20, 36, 76 -- and the
// letters -- AM, SQ, OF -- each fail on one letter. Measured on the fixtures
// (2026-10-06): every UP and DN read, nothing of the drawing, no other text.
//
// The pair must also be two letters -- one height, letter-shaped, a letter's
// width apart -- and stand alone on its row, because UPPER starts with UP.

/** Tolerances, in pixels of a 900-wide reading, scaled to the one in hand. */
const REF_W = 900;

/**
 * The direction words a drawing carries, as the ink of their letters, read at
 * one threshold.
 *
 * @param {{ink: Uint8Array, w: number, h: number}} map the drawing's ink, 1 = ink
 * @returns {{word: 'UP'|'DN', x: number, y: number, pixels: Int32Array}[]}
 *   each word's centre (0..1) and the indices of its letters' ink pixels
 */
export function findDirectionWords({ ink, w, h }) {
  const s = w / REF_W;
  const { comps, label } = componentsOf(ink, w, h);
  // The same window a letter is read through everywhere else (anchors.js).
  // The walls are far bigger, and with the lines taken out (withoutLines)
  // there are none left to set aside as the largest mark.
  const glyphs = comps.filter((c) => c.h >= 5 * s && c.h <= 22 * s && c.w <= 40 * s && c.area >= 8 * s);
  for (const g of glyphs) { g.holes = holesOf(g, label, w); g.edges = edgesOf(g, label, w); }

  const byX = [...glyphs].sort((a, b) => a.minX - b.minX);
  const sameRow = (a, b) => {
    const shared = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + 1;
    return shared * 2 >= Math.min(a.h, b.h);
  };
  const gapOf = (a, b) => b.minX - a.maxX - 1;
  // Letters of one word sit closer than a word space: a third of their height
  // takes UP and DN and leaves the X and the 4 of `14'-0" X 4'-11"` apart.
  const near = (a, b) => sameRow(a, b) && gapOf(a, b) >= -1 && gapOf(a, b) <= 0.3 * Math.max(a.h, b.h);
  const letterShaped = (g) => g.w >= 0.3 * g.h && g.w <= 1.2 * g.h;
  // A neighbour that would make the pair part of a longer word is another
  // letter of that word: its height, and letter-shaped. The small arrowhead
  // drawn beside a DN is neither, and it used to hide the DN.
  const letterLike = (o, ref) => letterShaped(o) && o.h >= 0.8 * ref && o.h <= 1.25 * ref;

  // THE LETTERS. Measured on every UP and DN of the fixtures and every pair
  // that looked like one (2026-10-06): a U's or an N's sides run 0.82-1.00 of
  // its height and the nearest other mark's 0.71 (an S); a P's or a D's back
  // 0.94-1.00 and an O's 0.78-0.89; a P's hole ends by 0.56 of the height, a
  // D's not before 0.85.
  const sided = (g) => g.holes.length === 0 && g.edges.left >= 0.75 && g.edges.right >= 0.75;
  const backed = (g) => g.holes.length === 1 && g.edges.left >= 0.9 && g.holes[0].top <= 0.25;
  const isP = (g) => backed(g) && g.holes[0].bottom <= 2 / 3;
  // A D's back reaches its top and bottom rows and its round front does not:
  // at least a row short at each end. An O is the same both sides.
  const isD = (g) => backed(g) && g.holes[0].bottom >= 0.75 && Math.round((g.edges.left - g.edges.right) * g.h) >= 2;

  const out = [];
  for (let i = 0; i < byX.length; i++) {
    const a = byX[i];
    // its right-hand neighbour on the row
    let b = null;
    for (let j = i + 1; j < byX.length && byX[j].minX - a.maxX <= 2 * a.h; j++) {
      if (near(a, byX[j])) { b = byX[j]; break; }
    }
    if (!b) continue;
    if (Math.max(a.h, b.h) > 1.25 * Math.min(a.h, b.h)) continue;   // one height
    if (!letterShaped(a) || !letterShaped(b)) continue;
    // U and P, D and N are letters of a width; a 1 beside a 0 is not.
    if (Math.max(a.w, b.w) > 1.6 * Math.min(a.w, b.w)) continue;
    // alone on the row: no other letter of a word just before it or just after it
    const ref = (a.h + b.h) / 2;
    const lone = !glyphs.some((o) => o !== a && o !== b && sameRow(o, a) && letterLike(o, ref)
      && ((o.maxX < a.minX && a.minX - o.maxX - 1 <= 0.6 * ref)
        || (o.minX > b.maxX && o.minX - b.maxX - 1 <= 0.6 * ref)));
    if (!lone) continue;
    const word = sided(a) && isP(b) ? 'UP' : isD(a) && sided(b) ? 'DN' : null;
    if (!word) continue;
    out.push({
      word,
      x: ((a.minX + b.maxX) / 2) / w,
      y: ((Math.min(a.minY, b.minY) + Math.max(a.maxY, b.maxY)) / 2) / h,
      pixels: Int32Array.from([...pixelsOf(a, label, w), ...pixelsOf(b, label, w)]),
    });
  }
  return out;
}

/**
 * The direction words on a drawing, read twice.
 *
 * TYPE IS DRAWN OVER HAIRLINES. Jordan's DN sits between two treads with the
 * D's back against one of them, so the D is part of the line and never a
 * letter; the same on Jordan 2, 3 and 4. Darkness does not take them apart:
 * Jordan 2's treads are as dark (48-56) as the soft edge of Jordan's D (up to
 * 47). Length does. No stroke of a letter is longer than the tallest letter,
 * so the second reading leaves out every straight run longer than that, across
 * or down, and the treads go while the letters stay whole.
 *
 * The runs are measured on a fainter reading, halfway from the threshold to
 * the paper. A grey hairline sits right at the threshold (Jordan 2's at
 * 119-148), so at the threshold it reads as stretches with gaps, each shorter
 * than a letter, that still hold the letter to the line. Fainter, it is one.
 * But fainter, a line's soft edge is a run too, and where a letter's stroke
 * stands in that column (Jordan 3's N) it is part of it. So a run is a line
 * only where most of it is ink at the threshold: the line itself is, its edge
 * is ink only where the letter is.
 *
 * @param {(lum: number) => {ink: Uint8Array, w: number, h: number}} read the
 *   drawing's ink at a luminance threshold, 1 = ink
 * @param {number} lum the threshold
 * @returns {{word: 'UP'|'DN', x: number, y: number, pixels: Int32Array}[]}
 */
export function directionWords(read, lum) {
  const map = read(lum);
  const found = findDirectionWords(map);
  const faint = read(Math.round((lum + 255) / 2));
  for (const word of findDirectionWords(withoutLines(map, faint.ink))) {
    // the same word, read both ways: its centre within a letter of the other
    const span = Math.sqrt(word.pixels.length) / map.w;
    if (found.some((f) => Math.abs(f.x - word.x) < 2 * span && Math.abs(f.y - word.y) < 2 * span)) continue;
    found.push(word);
  }
  return found;
}

/**
 * The ink, less every straight run of `lines` longer than a letter can be,
 * down or across, that is mostly ink.
 */
function withoutLines({ ink, w, h }, lines) {
  const s = w / REF_W;
  // the glyph window of findDirectionWords: a letter is at most 22 tall, 40 wide
  const down = 22 * s, across = 40 * s;
  const out = ink.slice();
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h;) {
      if (!lines[y * w + x]) { y++; continue; }
      let e = y;
      while (e < h && lines[e * w + x]) e++;
      if (e - y > down) {
        let inked = 0;
        for (let k = y; k < e; k++) inked += ink[k * w + x];
        if (inked * 2 > e - y) for (let k = y; k < e; k++) out[k * w + x] = 0;
      }
      y = e;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w;) {
      if (!lines[y * w + x]) { x++; continue; }
      let e = x;
      while (e < w && lines[y * w + e]) e++;
      if (e - x > across) {
        let inked = 0;
        for (let k = x; k < e; k++) inked += ink[y * w + k];
        if (inked * 2 > e - x) for (let k = x; k < e; k++) out[y * w + k] = 0;
      }
      x = e;
    }
  }
  return { ink: out, w, h };
}

/** 8-connected components of the ink, with a label image to read them back. */
function componentsOf(ink, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!ink[p0] || label[p0] !== -1) continue;
    const id = comps.length;
    let area = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    stack.push(p0); label[p0] = id;
    while (stack.length) {
      const p = stack.pop();
      area++;
      const x = p % w, y = (p - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (ink[q] && label[q] === -1) { label[q] = id; stack.push(q); }
        }
      }
    }
    comps.push({ id, area, minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return { comps, label };
}

/**
 * The holes a mark encloses -- regions of paper inside its box that the paper
 * around it cannot reach -- each as the span of the mark's height it covers
 * (0 top, 1 bottom). A pinhole a couple of pixels across is an antialiasing
 * gap, not a counter, and is not counted.
 */
function holesOf(g, label, w) {
  const bw = g.w + 2, bh = g.h + 2;
  const mine = (x, y) => {
    const ix = g.minX + x - 1, iy = g.minY + y - 1;
    if (x < 1 || y < 1 || x > g.w || y > g.h) return false;
    return label[iy * w + ix] === g.id;
  };
  const seen = new Uint8Array(bw * bh);
  let top = 0, bottom = 0;
  const fill = (sx, sy) => {
    const st = [sy * bw + sx]; seen[sy * bw + sx] = 1; let n = 0;
    while (st.length) {
      const p = st.pop(); n++;
      const x = p % bw, y = (p - x) / bw;
      if (y < top) top = y; if (y > bottom) bottom = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const q = ny * bw + nx;
        if (!seen[q] && !mine(nx, ny)) { seen[q] = 1; st.push(q); }
      }
    }
    return n;
  };
  fill(0, 0);
  const least = Math.max(3, Math.round(0.01 * g.w * g.h));
  const holes = [];
  for (let y = 1; y <= g.h; y++) {
    for (let x = 1; x <= g.w; x++) {
      const p = y * bw + x;
      if (seen[p] || mine(x, y)) continue;
      top = g.h; bottom = 0;
      if (fill(x, y) >= least) holes.push({ top: (top - 1) / g.h, bottom: bottom / g.h });
    }
  }
  return holes;
}

/**
 * How much of a mark's height its left and right edges are inked, looking in
 * from each side a fifth of its width: a straight side runs the full height,
 * a curve only its middle.
 */
function edgesOf(g, label, w) {
  const band = Math.max(1, Math.round(0.2 * g.w));
  let left = 0, right = 0;
  for (let y = g.minY; y <= g.maxY; y++) {
    let l = false, r = false;
    for (let k = 0; k < band; k++) {
      if (label[y * w + g.minX + k] === g.id) l = true;
      if (label[y * w + g.maxX - k] === g.id) r = true;
    }
    left += l ? 1 : 0; right += r ? 1 : 0;
  }
  return { left: left / g.h, right: right / g.h };
}

/** The ink pixels of one mark, as indices into the drawing. */
function* pixelsOf(g, label, w) {
  for (let y = g.minY; y <= g.maxY; y++) {
    for (let x = g.minX; x <= g.maxX; x++) {
      const p = y * w + x;
      if (label[p] === g.id) yield p;
    }
  }
}
