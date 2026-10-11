// THE POST SYMBOL, read from the render, for the 3D to build.
//
// A porch or deck post is drawn on a plan as a small square -- a 6"x6" box
// with an X through it on the source, a hollow box on the wireframe (the
// wireframe prompt keeps the outline and drops the X), and on the render
// whatever the styling makes of that: a hollow box in its line, or a filled
// square in the wall's tone. The FILLED one already stands: it is wall ink,
// wall-thick both ways, and the tracer keeps it (isWallSized: "a square of
// wall is a wall") -- The Avi Top's five, run9's six. The HOLLOW one stood
// as nothing, a symbol on the floor (The Sky's covered deck, three 6x6
// posts; Saman, 2026-09-21: "shouldn't the model read these as columns?").
//
// So a post is read as a CLOSED EMPTY SQUARE in the drawing's ink:
//
//   1. a CELL: a 4-connected region of no ink, small (its box a quarter to a
//      foot and a quarter across, counting the line) and square (aspect no
//      more than 1.3), with the cell filling its box (a diagonal strip of a
//      deck's hatch boxes square too, and fills a tenth of it);
//   2. a RING around it: a square of ink one to four pixels out, nine tenths
//      of its four sides inked and all four corners (a letter's bowl and a
//      circle fail the corners; there are no letters on a render anyway);
//   3. OUTSIDE the walls: the stairs reader's flood, with every opening and
//      gap sealed, reaches it (a post stands on a deck, a porch, a carport;
//      what this refuses is the inside of the house, where a small square is
//      a drain, a fixture or a mullion cell as often as a column -- interior
//      columns are not read, said here so nobody wonders);
//   4. ALONE: no other cell of the same size shares a side with it (a row of
//      equal boxes is a stair's treads between a rail and a rim, or a tile),
//      and no LETTER stands beside it: no piece of ink half to three times
//      the box's height and no wider than two and a half of it within a box
//      and a half to either side, or above or below. A render carries no words -- except the stair's
//      own UP or DN, which the styling sometimes keeps from the wireframe
//      and the text guard lets through at two glyphs (Madison 4). The bowl
//      of that P is a closed empty square a third of a foot across, and the
//      U beside it is what says it is a letter.
//
// Measured on the 36 renders of the corpus (test/post-render-probe.html): the six
// hollow posts the corpus draws with contrast (The Sky, both looks; Geena,
// light) and nothing else. Geena's dark look draws its three as a square of
// luminance 60 on a ground of 51 with no line, which no ink sees; they are
// missed there, not invented anywhere. A post read from the WIREFRAME was
// tried before (test/posts-reader.mjs, 2026-09-12, 70% precision, not
// shipped): the wireframe carries type and window symbols, and every false
// post was a digit or a mullion cell. The render carries almost none of
// that, and the flood keeps the reader out of the walls.
//
// Everything is read in render pixels and returned in model feet.

import { inkMaskOf } from './window-read.js';
import { frameOf, outsideOf } from './stairs.js';
import { components } from './extrude.js';

/** The post's box, line included: a 4x4 to a 15" pier. */
export const POST_MIN_FT = 0.25;
export const POST_MAX_FT = 1.25;
/** The empty inside must be this wide, so there is an inside. */
const INNER_MIN_FT = 0.12;
const MAX_ASPECT = 1.3;
const MIN_FILL = 0.9;      // the cell's pixels over its box: an empty square, not a strip
const MIN_SIDES = 0.9;     // of the ring's four sides inked
const RING_REACH = 4;      // pixels out from the cell the ring may sit

/** Every 4-connected empty region no wider than `maxPx`, away from the sheet's edge. */
export function smallCells(ink, W, H, maxPx) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  const cap = maxPx * maxPx * 2;
  for (let s = 0; s < W * H; s++) {
    if (ink[s] || seen[s]) continue;
    let n = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, edge = false, big = false;
    stack.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      n++;
      const x = p % W, y = (p - x) / W;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (n > cap || x1 - x0 > maxPx || y1 - y0 > maxPx) big = true;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      // A region grown past the size stops growing here; what is left of it
      // seeds its own floods, each stopped the same way, so the whole sheet
      // costs one visit per pixel.
      if (big) continue;
      if (x > 0 && !ink[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && !ink[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !ink[p - W] && !seen[p - W]) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && !ink[p + W] && !seen[p + W]) { seen[p + W] = 1; stack.push(p + W); }
    }
    if (big || edge) continue;
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n });
  }
  return out;
}

/** The square ring around a cell: the offset whose four sides carry the most ink, and its corners. */
export function ring(ink, W, H, c) {
  const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && ink[y * W + x] === 1;
  const near = (x, y) => at(x, y) || at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
  let best = null;
  for (let d = 1; d <= RING_REACH; d++) {
    const X0 = c.x0 - d, X1 = c.x1 - 1 + d, Y0 = c.y0 - d, Y1 = c.y1 - 1 + d;
    let n = 0, hit = 0;
    for (let x = X0; x <= X1; x++) { n += 2; if (near(x, Y0)) hit++; if (near(x, Y1)) hit++; }
    for (let y = Y0 + 1; y < Y1; y++) { n += 2; if (near(X0, y)) hit++; if (near(X1, y)) hit++; }
    const sides = n ? hit / n : 0;
    const corners = [near(X0, Y0), near(X1, Y0), near(X0, Y1), near(X1, Y1)].filter(Boolean).length;
    if (!best || sides > best.sides) best = { d, sides, corners };
  }
  return best;
}

/**
 * Every post the render draws as a hollow square outside the walls.
 *
 * @param {HTMLImageElement} img  the render
 * @param {object} ex  its extrusion (walls, extent, trim, wallFloorFt)
 * @param {object} o
 * @param {Array<{x0,x1,z0,z1}>} o.openings  every opening and gap between
 *   the walls, in model feet, for the flood; with none the answer is no
 *   posts, because without the flood nothing is known to be outside
 * @param {object} [o.ink]  inkMaskOf's record, when the caller has it
 * @returns {Array<{x0:number,z0:number,x1:number,z1:number,sizeFt:number,
 *   px:{x0,y0,x1,y1}}>}  the post's box in model feet, line included
 */
export function findPosts(img, ex, o = {}) {
  if (!ex?.extent || !ex.trim) return [];
  const outside = outsideOf(ex, o.openings || []);
  if (!outside) return [];
  const { ink, w: W, h: H } = o.ink || inkMaskOf(img);
  const F = frameOf(img, ex);
  const ftPerPx = F.ftPerPx;
  if (!(ftPerPx > 0)) return [];
  const cells = smallCells(ink, W, H, Math.ceil(POST_MAX_FT / ftPerPx));
  const rows = [];
  for (const c of cells) {
    const wFt = (c.x1 - c.x0) * ftPerPx, hFt = (c.y1 - c.y0) * ftPerPx;
    if (Math.min(wFt, hFt) < INNER_MIN_FT) continue;
    const fill = c.n / ((c.x1 - c.x0) * (c.y1 - c.y0));
    if (fill < MIN_FILL) continue;
    const r = ring(ink, W, H, c);
    const box = { x0: c.x0 - r.d, y0: c.y0 - r.d, x1: c.x1 + r.d, y1: c.y1 + r.d };
    const bw = (box.x1 - box.x0) * ftPerPx, bh = (box.y1 - box.y0) * ftPerPx;
    const aspect = Math.max(bw, bh) / Math.min(bw, bh);
    rows.push({ c, r, box, wFt, hFt, sizeFt: Math.max(bw, bh),
      square: aspect <= MAX_ASPECT && Math.min(bw, bh) >= POST_MIN_FT && Math.max(bw, bh) <= POST_MAX_FT,
      ringed: r.sides >= MIN_SIDES && r.corners === 4 });
  }
  // The ink's pieces, for the letter test: glyph-sized ones only (a wall, a
  // rim or a deck's fill is one huge piece and no letter).
  const maxPx = POST_MAX_FT / ftPerPx;
  let glyphs = null;
  const letterBeside = (b) => {
    if (!glyphs) glyphs = components(ink, W, H).filter((g) => g.x1 - g.x0 <= 3 * maxPx && g.y1 - g.y0 <= 3 * maxPx);
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    return glyphs.some((g) => {
      const gw = g.x1 - g.x0, gh = g.y1 - g.y0;
      // not the post's own ring (or a piece of it)
      if (g.x0 >= b.x0 - 1 && g.x1 <= b.x1 + 1 && g.y0 >= b.y0 - 1 && g.y1 <= b.y1 + 1) return false;
      const gapX = Math.max(g.x0 - b.x1, b.x0 - g.x1), gapY = Math.max(g.y0 - b.y1, b.y0 - g.y1);
      const overlapY = Math.min(g.y1, b.y1) - Math.max(g.y0, b.y0), overlapX = Math.min(g.x1, b.x1) - Math.max(g.x0, b.x0);
      // A letter in the same row: half to three times the box's height (the
      // box may be a letter's bowl, and a bowl is a third to all of its
      // letter), at most two and a half boxes wide, within a box and a half.
      const inRow = gh >= 0.5 * bh && gh <= 3 * bh && gw <= 2.5 * bw && gapX >= -1 && gapX <= 1.5 * bw && overlapY >= 0.5 * bh;
      // or the same column, for a word that runs up the page
      const inCol = gw >= 0.5 * bw && gw <= 3 * bw && gh <= 2.5 * bh && gapY >= -1 && gapY <= 1.5 * bh && overlapX >= 0.5 * bw;
      return inRow || inCol;
    });
  };
  const out = [];
  for (const p of rows) {
    if (!p.square || !p.ringed) continue;
    const cx = F.X((p.box.x0 + p.box.x1) / 2), cz = F.Z((p.box.y0 + p.box.y1) / 2);
    if (!outside(cx, cz)) continue;
    const alone = !rows.some((q) => q !== p
      && Math.abs(q.wFt - p.wFt) <= 0.25 * p.wFt && Math.abs(q.hFt - p.hFt) <= 0.25 * p.hFt
      && Math.max(p.c.x0, q.c.x0) - Math.min(p.c.x1, q.c.x1) <= 2 * p.r.d + 2
      && Math.max(p.c.y0, q.c.y0) - Math.min(p.c.y1, q.c.y1) <= 2 * p.r.d + 2);
    if (!alone || letterBeside(p.box)) continue;
    out.push({ x0: F.X(p.box.x0), x1: F.X(p.box.x1), z0: F.Z(p.box.y0), z1: F.Z(p.box.y1), sizeFt: +p.sizeFt.toFixed(2), px: p.box });
  }
  return out;
}
