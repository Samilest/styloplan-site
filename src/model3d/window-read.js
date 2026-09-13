// THE WINDOWS OF A RENDER, READ ONCE AND READ THE SAME WAY EVERYWHERE.
//
// view3d read the windows for the builder's own model and cloud-publish read
// them again, in its own copy of the same steps, for the published record —
// and the copies drifted: the publisher filled windows the viewer had stopped
// filling, and knew nothing of the kinds the viewer had learned to draw. One
// reading now, in one file, and the record a visitor is handed carries every
// opening the builder saw, with its kind and its units.
//
// Everything here is in the render's own pixels. The caller maps to the
// model's feet, because only the caller knows the extent it traced.

import {
  planGaps, glazedOpenings, exteriorGaps, medianWallThickness, classifyOpening,
  outdoorSeeds, interiorWindows, windowStyle,
} from './openings.js';

/**
 * Every opening the render draws, with its kind, for the market look to frame
 * or shutter: 'win' gets glass, 'garage' a roller door, the rest stay open.
 * Exterior openings first, then the interior windows.
 *
 * The same reading windowsFromWireframe makes -- glazing symbol, exterior
 * test -- and then classifyOpening's structural test on top, because
 * "exterior and glazed" also catches a porch bay under its roof line and a
 * garage door behind its panel line. A porch bay stays open. A window wider
 * than the classifier's band (7ft) is not a window either, which is the known
 * limit of this rule and is reported rather than hidden.
 *
 * @param {object} plan  `{ ink, w, h, seg, gaps }` -- the ink mask, its size,
 *   the wall runs (wallSegments) and the gaps (planGaps, 20..400px)
 * @param {number} scale  feet per pixel (ftPerPx); nothing is read without it
 * @param {Array}  labels  the confirmed room names, positioned as fractions of
 *   the render -- the outdoors and the garage are named by them
 * @returns {{fills: Array, openings: Array, note: string}} `fills` are the
 *   exterior windows alone (what wallMask once painted back in as wall)
 */
export function readWindows(plan, scale, labels = []) {
  const { ink, w, h, seg, gaps } = plan;
  if (!scale) return { fills: [], openings: [], note: 'no scale' };
  const glazed = glazedOpenings({ w }, { mask: ink, low: null }, gaps);
  const bridge = planGaps(seg, { minGap: 20, maxGap: 4000 });
  const wallPx = medianWallThickness(ink, w, h) || Math.round(w / 100);
  // A PORCH IS OUTDOORS, whatever its outline does to the flood. The Star's
  // covered porch is drawn closed -- posts, slab edge, dashed roof line -- so
  // the living room's three glazed openings onto it were never exterior and
  // never classified; Saman circled them. The customer's own PORCH / DECK /
  // PATIO label says where the outdoors is, and the flood starts there too.
  const seeds = outdoorSeeds(labels, ink, w, h, wallPx * 3);
  const exterior = exteriorGaps(ink, w, h, seg, glazed, {
    bridge, faceDepth: Math.max(3, Math.round(wallPx * 2)), seeds,
  });
  const kinds = exterior.map((g) => classifyOpening(ink, w, h, g, scale, {}));
  // A GARAGE'S OPENING IS A GARAGE DOOR. The classifier reads the symbol, and
  // The Star's two garage doors came back "cased opening" -- the drawing puts
  // a dashed apron outside them and nothing across them -- while an 8.1ft
  // porch bay came back "garage". The confirmed labels settle it more simply
  // (Saman's rule, 2026-09-12): an exterior opening whose nearest confirmed
  // room name is GARAGE is a garage door, and nothing else is. Flooding the
  // plan into rooms was tried first and does not work here, because a garage
  // with its doors open is not an enclosed room to a flood.
  const garageLabels = labels.filter((l) => /garage/i.test(l.name || ''));
  const nearest = (x, y) => {
    let best = null, bd = Infinity;
    for (const l of labels) {
      const d = Math.hypot(l.x * w - x, l.y * h - y);
      if (d < bd) { bd = d; best = l; }
    }
    return { label: best, ft: bd * scale };
  };
  exterior.forEach((gp, i) => {
    const cx = (gp.x0 + gp.x1) / 2, cy = (gp.y0 + gp.y1) / 2, off = wallPx * 3;
    const probes = gp.horizontal ? [[cx, cy - off], [cx, cy + off]] : [[cx - off, cy], [cx + off, cy]];
    const garage = garageLabels.length && probes.some(([x, y]) => {
      const n = nearest(x, y);
      return n.label && /garage/i.test(n.label.name || '') && n.ft < 30;
    });
    if (garage) kinds[i] = { ...kinds[i], kind: 'garage', why: `${kinds[i].widthFt.toFixed(1)}ft, nearest room is the garage` };
    else if (kinds[i].kind === 'garage') kinds[i] = { ...kinds[i], kind: 'opening', why: kinds[i].why + ' — but no garage named here' };
  });
  const fills = exterior.filter((g, i) => kinds[i].kind === 'win');
  const left = kinds.filter((k) => k.kind !== 'win').map((k) => `${k.widthFt.toFixed(1)}ft ${k.kind}`);
  // AN INTERIOR WINDOW IS STILL A WINDOW. The Star draws its window symbol
  // on the foyer's wall onto the living room and on the guest bath's; the
  // exterior test kept both empty, and Saman said the symbol cannot be
  // ignored. interiorWindows frames the interior openings drawn the way this
  // plan draws its windows, and its comment carries the measured trade.
  const interior = interiorWindows({ mask: ink, W: w, H: h, seg, glazed, exterior, exteriorWindows: fills, scale });
  // WHICH KIND OF WINDOW, from the symbol: fixed, slider or double-hung, and
  // the units between its mullions (windowStyle). The engine draws each.
  const styled = (g) => (g.kind === 'win'
    ? { ...g, units: windowStyle(ink, w, h, g, { widthFt: (g.horizontal ? g.x1 - g.x0 : g.y1 - g.y0) * scale }).units }
    : g);
  const openings = [...exterior.map((g, i) => ({ ...g, kind: kinds[i].kind })), ...interior].map(styled);
  const styles = {};
  for (const g of openings) for (const u of g.units || []) styles[u.style] = (styles[u.style] || 0) + 1;
  return {
    fills,
    openings,
    note: `${fills.length} of ${exterior.length} exterior openings framed as windows`
      + (left.length ? ` · left open: ${left.join(', ')}` : '')
      + (interior.length ? ` · ${interior.length} interior window(s)` : '')
      + (Object.keys(styles).length ? ` · units: ${Object.entries(styles).map(([k, n]) => `${n} ${k}`).join(', ')}` : ''),
  };
}

/**
 * What a published record keeps of a reading: the rectangles, their kinds and
 * their units, and nothing the viewer recomputes. The `why` strings and the
 * classifier's scores stay behind -- they are for the console, and a record
 * is read by every visitor on every open.
 */
export function publishableOpenings(openings) {
  return (openings || [])
    .filter((g) => g.kind === 'win' || g.kind === 'garage')
    .map((g) => ({
      x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, horizontal: !!g.horizontal, kind: g.kind,
      ...(g.units?.length ? { units: g.units.map((u) => ({ lo: u.lo, hi: u.hi, style: u.style, ...(u.sashes?.length ? { sashes: u.sashes } : {}) })) } : {}),
    }));
}
