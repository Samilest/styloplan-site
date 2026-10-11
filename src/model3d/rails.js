// RAILINGS: A GUARD THE PLAN DRAWS WHERE THE STYLING DREW A WALL.
//
// Saman, 2026-09-29, on Plan B's top floor: the stairwell stood inside three
// full-height walls, "very tall and meaningless for a stair going down". The
// source plan draws two of its sides as a RAILING -- a band with baluster
// ticks along one face -- and one as a wall. The wireframe keeps the ticks;
// the styled render, which the 3D reads its walls from, drew all three as the
// same thick white wall. So the render cannot say which is which, and the
// wireframe can.
//
// THE SYMBOL (docs/plan-symbols.md): a guard is drawn as a line or a band with
// short strokes along one face, evenly spaced -- the balusters. A wall is a
// band with clean faces. What else meets a wall's face at a regular spacing is
// a flight's treads, and those are LONG lines that run on across the stair; a
// baluster tick is a few pixels and stops. That is the whole test: along each
// long face of a wall the render built, in the wireframe, strokes that start
// at the face, stop within a fraction of the band's own thickness, and repeat
// at a baluster's spacing along most of the wall.
//
// Read on the machine that has the wireframe (the builder's page and the
// publisher); the result travels in the geometry record as `rails`, so a
// visitor's page, which never has the wireframe, builds the same guard.

import { planContentBox } from '../plan-trim.js';
import { mapFrame } from '../compositor.js';
import { frameOf } from './stairs.js';

/** A baluster's spacing on a plan, centre to centre: 4in (the code's gap) to 20in (a sparse symbol). */
const TICK_SPACING_FT = [0.33, 1.7];

/**
 * Which of the extruder's walls the wireframe draws as a railing.
 *
 * @param {object} ex the extrusion (walls in model feet, extent, trim)
 * @param {HTMLImageElement|HTMLCanvasElement} render the picture the walls were read from
 * @param {HTMLImageElement|HTMLCanvasElement} wire the wireframe of the same plan
 * @param {{trace?:Function}} [o] `trace(record)` sees every wall's measurements
 * @returns {Array<{x0,x1,z0,z1, wall:number, face:'lo'|'hi', ticks:number, spacingFt:number}>}
 *   the railing walls' rectangles in model feet; `face` is the side the
 *   balusters are drawn on (lo = -z or -x)
 */
export function railsFromWireframe(ex, render, wire, o = {}) {
  if (!ex?.walls?.length || !ex.extent || !ex.trim || !render || !wire) return [];
  const F = frameOf(render, ex);
  const from = planContentBox(render), to = planContentBox(wire);
  const WW = wire.naturalWidth || wire.width, WH = wire.naturalHeight || wire.height;
  const cv = document.createElement('canvas');
  cv.width = WW; cv.height = WH;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(wire, 0, 0);
  const d = g.getImageData(0, 0, WW, WH).data;
  // TWO CUTS OF ONE DRAWING. `ink` is the dark line work: the band and a
  // tick. `drawn` is anything drawn at all, down to a light grey: the test
  // that a tick STOPS. Jordan's, Jordan 3's and Another 2's treads are grey
  // hairlines; at the dark cut only the joint where each meets the wall is
  // ink, and that joint is a perfect short tick -- three stairs' walls read as
  // railings until a stroke had to end in blank paper.
  const ink = new Uint8Array(WW * WH), drawn = new Uint8Array(WW * WH);
  for (let i = 0, p = 0; p < WW * WH; i += 4, p++) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    ink[p] = v < 128 ? 1 : 0;
    drawn[p] = v < 215 ? 1 : 0;
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < WW && y < WH ? ink[y * WW + x] : 0);
  const anyAt = (x, y) => (x >= 0 && y >= 0 && x < WW && y < WH ? drawn[y * WW + x] : 0);
  // model feet -> wireframe px, through the render's frame and the two content boxes
  const toWire = (x, z) => {
    const f = mapFrame({ x: F.PX(x) / F.W, y: F.PY(z) / F.H }, from, to);
    return [f.x * WW, f.y * WH];
  };
  const [ax, ay] = toWire(ex.extent.x0, ex.extent.z0), [bx, by] = toWire(ex.extent.x1, ex.extent.z1);
  const pxPerFt = Math.abs(bx - ax) / (ex.extent.x1 - ex.extent.x0) || Math.abs(by - ay) / (ex.extent.z1 - ex.extent.z0);
  const out = [];
  ex.walls.forEach((w, i) => {
    const horizontal = w.x1 - w.x0 >= w.z1 - w.z0;
    const lenFt = horizontal ? w.x1 - w.x0 : w.z1 - w.z0;
    if (lenFt < 2) return;
    const [p0x, p0y] = toWire(w.x0, w.z0), [p1x, p1y] = toWire(w.x1, w.z1);
    // along = the wall's run, across = its thickness, in wireframe px
    const a0 = Math.round(horizontal ? p0x : p0y), a1 = Math.round(horizontal ? p1x : p1y);
    const c0 = horizontal ? p0y : p0x, c1 = horizontal ? p1y : p1x;
    const T = Math.max(3, Math.abs(c1 - c0));
    const mid = (c0 + c1) / 2;
    const px = (a, c) => (horizontal ? at(a, c) : at(c, a));
    const anyPx = (a, c) => (horizontal ? anyAt(a, c) : anyAt(c, a));
    // THE BAND AS THE WIREFRAME DRAWS IT: the rows (across) inked along most of
    // the wall's middle. Its lines run the whole length; a tick or a tread
    // crosses a row at one point.
    const m0 = Math.round(a0 + (a1 - a0) * 0.1), m1 = Math.round(a1 - (a1 - a0) * 0.1);
    if (m1 - m0 < 8) return;
    const cover = (c) => { let n = 0; for (let a = m0; a < m1; a++) if (px(a, c)) n++; return n / (m1 - m0); };
    let lo = null, hi = null;
    for (let c = Math.round(mid - 1.5 * T); c <= Math.round(mid + 1.5 * T); c++) {
      if (cover(c) >= 0.8) { if (lo === null) lo = c; hi = c; }
    }
    if (lo === null) { o.trace?.({ wall: i, why: 'no band in the wireframe' }); return; }
    const band = hi - lo + 1;
    // A TICK: ink on the row just outside the face, none a tick's length
    // further out (a tread or a hatch line runs on), and narrow along the wall.
    const reach = Math.max(3, Math.round(band * 0.35));
    const faceTicks = (dir) => {
      const edge = dir < 0 ? lo : hi;
      const near = (a) => px(a, edge + dir) || px(a, edge + 2 * dir);
      // it stops: nothing drawn, however faint, a tick's length further out
      const far = (a) => { for (let k = reach + 1; k <= 2 * reach + 1; k++) if (anyPx(a, edge + dir * k)) return true; return false; };
      const runs = [];
      let s = -1;
      for (let a = a0; a <= a1 + 1; a++) {
        const on = a <= a1 && near(a) && !far(a);
        if (on && s < 0) s = a;
        if (!on && s >= 0) { runs.push([s, a - 1]); s = -1; }
      }
      const narrow = runs.filter(([p, q]) => q - p + 1 <= Math.max(4, band * 0.4));
      const centres = narrow.map(([p, q]) => (p + q) / 2);
      const gaps = centres.slice(1).map((c, k) => c - centres[k]);
      const sorted = gaps.slice().sort((p, q) => p - q), med = sorted[sorted.length >> 1] || 0;
      const even = gaps.length ? gaps.filter((v) => Math.abs(v - med) <= med * 0.3).length / gaps.length : 0;
      const spanFrac = centres.length > 1 ? (centres[centres.length - 1] - centres[0]) / Math.max(1, a1 - a0) : 0;
      return { ticks: narrow.length, runs: runs.length, spacingFt: med / pxPerFt, even, spanFrac };
    };
    for (const [dir, face] of [[-1, 'lo'], [1, 'hi']]) {
      const f = faceTicks(dir);
      const rail = f.ticks >= 3 && f.even >= 0.7 && f.spanFrac >= 0.6
        && f.spacingFt >= TICK_SPACING_FT[0] && f.spacingFt <= TICK_SPACING_FT[1];
      o.trace?.({ wall: i, face, lenFt: +lenFt.toFixed(1), band, ...f, rail });
      if (rail) { out.push({ x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1, wall: i, face, ticks: f.ticks, spacingFt: +f.spacingFt.toFixed(2) }); break; }
    }
  });
  // A GUARD ENDS AT THE WALL IT RUNS INTO. The extruder's rectangle runs on
  // through the corner where a wall crosses its end, and cut out whole it took
  // that corner out of the wall that goes on (Plan B's main floor: a notch in
  // the stair's side wall, the rail ending in it). The corner is the wall's.
  const isRail = new Set(out.map((r) => r.wall));
  for (const r of out) {
    const horizontal = r.x1 - r.x0 >= r.z1 - r.z0;
    const t = horizontal ? r.z1 - r.z0 : r.x1 - r.x0;
    ex.walls.forEach((w, j) => {
      if (isRail.has(j)) return;
      const [wa0, wa1, wc0, wc1] = horizontal ? [w.x0, w.x1, w.z0, w.z1] : [w.z0, w.z1, w.x0, w.x1];
      const [ra0, ra1, rc0, rc1] = horizontal ? [r.x0, r.x1, r.z0, r.z1] : [r.z0, r.z1, r.x0, r.x1];
      // it overlaps the band, runs ACROSS it (longer across than along) and on
      // past one face, and stands at one of the band's ends
      // (across, touching is enough: the extruder gives the corner to one of
      // the two, often the band, and the other starts at its face)
      if (!(wc0 <= rc1 + t / 2 && wc1 >= rc0 - t / 2) || !(wa0 < ra1 && wa1 > ra0)) return;
      if (wc1 <= rc1 + t / 2 && wc0 >= rc0 - t / 2) return;
      if (wa1 - wa0 >= wc1 - wc0) return;
      const at1 = wa1 >= ra1 - 2 * t, at0 = wa0 <= ra0 + 2 * t;
      if (at1 && !at0) { if (horizontal) r.x1 = Math.min(r.x1, w.x0); else r.z1 = Math.min(r.z1, w.z0); }
      else if (at0 && !at1) { if (horizontal) r.x0 = Math.max(r.x0, w.x1); else r.z0 = Math.max(r.z0, w.z1); }
    });
  }
  return out.filter((r) => Math.max(r.x1 - r.x0, r.z1 - r.z0) >= 1);
}
