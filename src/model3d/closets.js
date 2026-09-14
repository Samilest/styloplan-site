// THE CLOSET, READ AS A THING -- so its door can be read as a door.
//
// A closet door drawn shut across its mouth is two panels overlapping on two
// tracks (a bypass pair), a zigzag (a bifold), or one bar (a shut leaf). The
// first of those is also, stroke for stroke, a sliding window's symbol, and
// on Jordan's basement four windows hung as doors the day the pair was read;
// so it was not read, and Plan A's three closets stood open in the 3D with
// the symbol plain on the floor (Saman, 2026-09-14).
//
// What tells them apart is not in the symbol but around it: a closet is a
// shallow CLOSED CELL behind its mouth -- flood from just inside the mouth
// with the mouth sealed and the flood stops within a few feet on every side
// (the fireplace's own test) -- and the cell carries the drafter's closet
// furniture: a rod line parallel to the mouth, a shelf line (often dashed),
// or the row of hanger strokes along the rod. A window has no cell behind
// it, or an unbounded one.
//
// Everything in render pixels; the caller maps to the model's feet.

import { cellBehind } from './fireplace.js';

/**
 * Every closet mouth among the doorways.
 *
 * @param {Uint8Array} mask  ink, 1 per pixel
 * @param {Uint8Array} ground  the extruder's walls, 1 per pixel (wallRaster)
 * @param {Array} gaps  doorways `{x0,y0,x1,y1,horizontal,face?}`
 * @param {object} o  `ftPerPx`, `wallPx`
 * @returns {Map<object, {side:number, depth:number, span:number, hatch:number, rod:boolean, cell:object}>}
 */
export function findClosets(mask, ground, W, H, gaps, o = {}) {
  const scale = o.ftPerPx;
  const out = new Map();
  if (!scale) return out;
  const px = (ft) => ft / scale;
  for (const gap of gaps) {
    const hz = !!gap.horizontal;
    const [c0, c1] = gap.face || (hz ? [gap.y0, gap.y1] : [gap.x0, gap.x1]);
    const a0 = hz ? gap.x0 : gap.y0, a1 = hz ? gap.x1 : gap.y1;
    const w = a1 - a0;
    if (w * scale < 2 || w * scale > 10) continue;
    for (const side of [1, -1]) {
      const cell = cellBehind(ground, W, H, gap, side, { cap: px(14) * px(5), seal: Math.round(o.wallPx || px(0.5)) });
      if (!cell) continue;
      const depth = hz ? (side > 0 ? cell.y1 - c1 : c0 - cell.y0) : (side > 0 ? cell.x1 - c1 : c0 - cell.x0);
      const span = hz ? cell.x1 - cell.x0 : cell.y1 - cell.y0;
      // A reach-in closet: a foot and a half to four and a half deep, no
      // wider than a bedroom wall, and wide enough for its own mouth.
      if (depth * scale < 1.3 || depth * scale > 4.5 || span * scale > 14 || span < w * 0.8) continue;
      // Its furniture, read along rows parallel to the mouth inside the cell:
      // a ROD is a run over half the span; HANGERS are strokes crossing a
      // row -- each a short run on the row, and walked along the stroke a
      // hand to a foot and a half long, never wall to wall (a stair's treads
      // cross the rows too, and span the cell: The Sky's stairs read as a
      // closet three times when runs alone were counted; so did Geena's bath
      // alcove on its outline); a SHELF is a dashed line, short runs along
      // one row that are no thicker than a hairline.
      const inCell = (x, y) => x >= cell.x0 && x < cell.x1 && y >= cell.y0 && y < cell.y1 && !ground[y * W + x] && mask[y * W + x];
      const face = side > 0 ? c1 : c0;
      const s0 = Math.round(hz ? cell.x0 : cell.y0), s1 = Math.round(hz ? cell.x1 : cell.y1);
      const at = (a, c) => inCell(hz ? a : c, hz ? c : a);
      // The stroke through (a, c) across the row: walked both ways along c.
      const strokeLen = (a, c) => {
        let len = 1;
        for (const dir of [1, -1]) {
          let miss = 0;
          for (let k = 1; k < span; k++) {
            const cc = c + dir * k;
            let hit = false;
            for (let da = -1; da <= 1 && !hit; da++) if (at(a + da, cc)) hit = true;
            if (hit) { len++; miss = 0; } else if (++miss > 1) break;
          }
        }
        return len;
      };
      let rod = false, hatch = 0, dashes = 0;
      for (let d = Math.round(px(0.3)); d < depth - 2; d += 2) {
        const c = Math.round(face + side * d);
        const runs = [];
        let start = null;
        for (let a = s0; a <= s1; a++) {
          const on = a < s1 && at(a, c);
          if (on && start === null) start = a;
          if (!on && start !== null) { runs.push([start, a]); start = null; }
        }
        if (runs.some(([a, b]) => b - a >= span * 0.5)) rod = true;
        let hangers = 0, dash = 0;
        for (const [a, b] of runs) {
          const wide = b - a;
          if (wide > px(0.35)) continue;
          const len = strokeLen(Math.round((a + b) / 2), c);
          if (len * scale >= 0.25 && len * scale <= 1.6 && len < span * 0.8) hangers++;
          else if (len <= 3 && wide >= 2) dash++;
        }
        hatch = Math.max(hatch, hangers);
        dashes = Math.max(dashes, dash);
      }
      if (hatch < 4 && !(dashes >= 4 && rod)) continue;
      out.set(gap, { side, depth, span, hatch, rod, dashes, cell });
      break;
    }
  }
  return out;
}
