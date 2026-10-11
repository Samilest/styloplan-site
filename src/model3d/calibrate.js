// HOW WIDE THE BUILDING IS, from the dimensions the customer confirmed.
//
// WHY THIS EXISTS. The 3D model was built on `DEFAULT_WIDTH_FT = 40`, with a
// comment beside it saying the number "sets only the proportion of wall height
// to footprint" and is "a look, not a measurement". Measured, that is not what
// it does. extrudeWalls turns it into feet-per-pixel, and everything downstream
// is gated in feet:
//
//   closeNarrowGaps   seals any gap under 1.25ft as wall
//   isWallSized       drops a piece under 0.5ft, or thin and under 3ft
//   classifyOpening   garage 8-20ft, window 1.5-7ft, else "opening"
//
// So on a plan that is 80ft wide and assumed to be 40, every real distance
// reads at half: a 2.5ft closet door is sealed shut, a 5ft closet wall is
// dropped as a sliver, a 16ft garage door lands in the window band, and the
// walls stand twice as tall against the footprint as they should. That is the
// render Saman photographed on The Star: closet walls missing, doorways filled,
// walls too tall. Three complaints, one constant. Measured on Jordan, the same
// render traced at 40 and at 80 yields 72 and 80 wall pieces.
//
// WHAT IS READ, AND WHY IT IS NOT A BREACH OF RED LINE 2. The customer confirmed
// "KITCHEN 12'-0" x 10'-0"" in Review. The plan floods into rooms without any
// scale, and the flooded room under that label has a width and a height in
// pixels. Their ratio to the confirmed figures is pixels per foot, measured
// off the customer's own numbers and never off a guess. Nothing here derives a
// dimension: the figures go in, a scale comes out, and the only thing the scale
// touches is how the model is proportioned. No number produced here is ever
// printed.
//
// ROBUST, NOT CLEVER. Every room votes; the median wins. A room whose flooded
// box does not match its stated rectangle in BOTH axes is not counted: an open
// plan living room floods into the dining room, a closet whose door was read
// as a gap floods into the bedroom, and either would vote with a box that is
// not the room the customer measured. Two agreeing rooms are enough to
// calibrate; fewer, and the caller keeps its fallback and says so.

import { dimToFeet } from '../house-style.js';

/** How far the two axes may disagree before a room is not the rectangle it claims. */
export const AGREEMENT_MIN = 0.85;
/** Nothing sensible is narrower or wider than this. Outside it, the fallback stands. */
export const WIDTH_MIN_FT = 15, WIDTH_MAX_FT = 250;
/** How many rooms must agree before the constant is overruled. */
export const VOTES_MIN = 2;

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};

/**
 * One label's vote: the pixels-per-foot its room implies, and whether it counts.
 *
 * @param {{x:number,y:number}} box  the flooded room's box in render pixels
 * @param {[number,number]} ft  the confirmed dimension, feet
 */
export function roomVote(box, ft) {
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const [a, b] = ft;
  if (!(w > 0 && h > 0 && a > 0 && b > 0)) return null;
  // The dimension is printed "W x D" but the plan may be drawn either way up,
  // so both pairings are tried and the one whose axes agree is the reading.
  const tryPair = (fx, fy) => {
    const sx = w / fx, sy = h / fy;
    return { sx, sy, agreement: Math.min(sx, sy) / Math.max(sx, sy) };
  };
  const p1 = tryPair(a, b), p2 = tryPair(b, a);
  const best = p1.agreement >= p2.agreement ? p1 : p2;
  return {
    pxPerFt: (best.sx + best.sy) / 2,
    agreement: best.agreement,
    used: best.agreement >= AGREEMENT_MIN,
  };
}

/**
 * @param {Object} o
 * @param {Array} o.labels  confirmed labels with x,y as fractions of the RENDER
 *   (see labelsOnRender) and `dim` as transcribed
 * @param {Array} o.rooms  from roomGraph: {id, px, x0,y0,x1,y1} in render pixels
 * @param {(x:number,y:number)=>number} o.roomAt  from roomGraph
 * @param {number} o.imgW  render width in pixels
 * @param {number} o.imgH  render height in pixels
 * @param {number} o.buildingPx  the building's width in render pixels, as the
 *   extruder bounds it, so the answer is in the extruder's own frame
 * @param {number} o.fallback  what to answer when the labels cannot say
 * @returns {{widthFt:number, calibrated:boolean, used:number, samples:Array, why:string}}
 */
export function calibrateWidthFt({ labels, rooms, roomAt, imgW, imgH, buildingPx, fallback }) {
  const byId = new Map((rooms || []).map((r) => [r.id, r]));
  const samples = [];
  for (const l of labels || []) {
    const ft = dimToFeet(l?.dim);
    if (!ft) continue;
    const px = l.x * imgW, py = l.y * imgH;
    const id = roomAt ? roomAt(px, py) : -1;
    const room = byId.get(id);
    if (!room) {
      samples.push({ name: l.name, dim: l.dim, used: false, why: 'no enclosed room under the label' });
      continue;
    }
    const v = roomVote(room, ft);
    if (!v) continue;
    samples.push({
      name: l.name, dim: l.dim, roomPx: { w: room.x1 - room.x0 + 1, h: room.y1 - room.y0 + 1 },
      pxPerFt: v.pxPerFt, agreement: v.agreement, used: v.used,
      why: v.used ? 'agrees in both axes'
        : 'the flooded space is not this room\'s rectangle (open plan, or joined to a neighbour through a doorway)',
    });
  }
  const votes = samples.filter((s) => s.used).map((s) => s.pxPerFt);
  const fail = (why) => ({ widthFt: fallback, calibrated: false, used: votes.length, samples, why });
  if (votes.length < VOTES_MIN) {
    return fail(`${votes.length} of ${samples.length} labelled rooms could be measured; ${VOTES_MIN} are needed`);
  }
  if (!(buildingPx > 0)) return fail('the building has no measured width');
  const widthFt = buildingPx / median(votes);
  if (widthFt < WIDTH_MIN_FT || widthFt > WIDTH_MAX_FT) {
    return fail(`${widthFt.toFixed(1)}ft is outside ${WIDTH_MIN_FT}-${WIDTH_MAX_FT}ft`);
  }
  return {
    widthFt, calibrated: true, used: votes.length, samples,
    why: `${votes.length} rooms agree at ${median(votes).toFixed(2)} px/ft`,
  };
}
