// The rooms a plan encloses, and what the doors connect.
//
// WHY THIS EXISTS. Door detection has one hard problem left, and it is not
// finding doors: it is knowing, on a plan nobody has checked by hand, whether
// what was found is right. Counting one plan proves nothing about the next
// one, and a customer's plan is always the next one.
//
// A door is not a mark on paper. It is a way THROUGH a wall, from one enclosed
// space to another, and that is checkable without any labelling: flood the
// plan into rooms, then ask each detected door which two rooms it joins. A
// reading that says "this door leads from the kitchen back into the kitchen"
// is wrong, and it says so itself.
//
// So this is a measurement, not a filter. It reports; the caller decides.
// Nothing here removes a door — a rule that silently dropped detections would
// destroy the one thing this is for, which is an honest count of how wrong the
// reading is.

import { components } from './extrude.js';

/**
 * The plan's enclosed spaces, and the door graph over them.
 *
 * @param {object} o
 * @param {Uint8Array} o.mask ink
 * @param {number} o.W
 * @param {number} o.H
 * @param {{horizontal:Array,vertical:Array}} o.segments traced walls
 * @param {Array} o.gaps every opening, from collinearGaps — used to SEAL the
 *   rooms apart. Without them the flood walks through every doorway and the
 *   whole floor is one room, which is the mistake outsideAir documents.
 * @param {Array} o.doors from findDoors
 * @param {number} [o.minRoomPx] anything smaller is a sliver, not a room
 * @returns {{rooms: Array, edges: Array, report: object}}
 */
export function roomGraph({ mask, W, H, segments, gaps = [], doors = [], minRoomPx }) {
  const floor = W * H;
  const minRoom = minRoomPx ?? Math.round(floor * 0.0008);

  // ---- THE BARRIER: walls, plus a bar across every opening.
  //
  // Rooms are only separate if the doorways are shut. This is the same trick
  // `sealedOutside` uses to keep the flood outside the building, applied one
  // level in: seal every opening and the floor falls apart into rooms.
  const barrier = new Uint8Array(floor);
  const paint = (x0, y0, x1, y1) => {
    const ax = Math.max(0, Math.floor(x0));
    const bx = Math.min(W - 1, Math.ceil(x1));
    const ay = Math.max(0, Math.floor(y0));
    const by = Math.min(H - 1, Math.ceil(y1));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) barrier[y * W + x] = 1;
  };
  for (const r of segments.horizontal) paint(r.x0, r.y0, r.x1, r.y1);
  for (const r of segments.vertical) paint(r.x0, r.y0, r.x1, r.y1);
  for (const g of gaps) paint(g.x0, g.y0, g.x1, g.y1);

  // ---- THE SPACES.
  const open = new Uint8Array(floor);
  for (let p = 0; p < floor; p++) open[p] = barrier[p] ? 0 : 1;
  const all = components(open, W, H);

  // Which component owns each pixel, so a probe point can be looked up rather
  // than searched for. `components` gives boxes and counts; the id map is
  // rebuilt here by flooding once more, which is cheap beside the search.
  const id = new Int32Array(floor).fill(-1);
  const stack = [];
  let next = 0;
  for (let s = 0; s < floor; s++) {
    if (!open[s] || id[s] >= 0) continue;
    const me = next++;
    id[s] = me;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      const x = p % W;
      if (x > 0 && open[p - 1] && id[p - 1] < 0) { id[p - 1] = me; stack.push(p - 1); }
      if (x < W - 1 && open[p + 1] && id[p + 1] < 0) { id[p + 1] = me; stack.push(p + 1); }
      if (p >= W && open[p - W] && id[p - W] < 0) { id[p - W] = me; stack.push(p - W); }
      if (p < floor - W && open[p + W] && id[p + W] < 0) { id[p + W] = me; stack.push(p + W); }
    }
  }

  // THE SHEET IS NOT A ROOM. Whatever touches the border is the paper around
  // the building; everything else that is big enough is a room.
  const outside = new Set();
  for (let x = 0; x < W; x++) {
    if (id[x] >= 0) outside.add(id[x]);
    if (id[(H - 1) * W + x] >= 0) outside.add(id[(H - 1) * W + x]);
  }
  for (let y = 0; y < H; y++) {
    if (id[y * W] >= 0) outside.add(id[y * W]);
    if (id[y * W + W - 1] >= 0) outside.add(id[y * W + W - 1]);
  }

  const area = new Map();
  for (let p = 0; p < floor; p++) if (id[p] >= 0) area.set(id[p], (area.get(id[p]) || 0) + 1);
  const rooms = [...area.entries()]
    .filter(([k, n]) => !outside.has(k) && n >= minRoom)
    .map(([k, n]) => ({ id: k, px: n }));
  const roomIds = new Set(rooms.map((r) => r.id));

  // ---- WHAT EACH DOOR JOINS.
  //
  // Probed on both sides of the doorway, out along the wall's normal, past the
  // wall's own thickness. The hinge sits ON the wall, so a probe taken at the
  // hinge would read the wall; the point sampled is the middle of the closed
  // leaf, which is the middle of the doorway.
  const at = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return -1;
    return id[yi * W + xi];
  };
  const edges = [];
  for (const d of doors) {
    const mx = d.x + d.along[0] * d.radius * 0.5;
    const my = d.y + d.along[1] * d.radius * 0.5;
    // SEVERAL DISTANCES, NOT ONE. A single probe at a fixed reach lands on the
    // bar that seals the doorway, or inside a fixture drawn against the wall,
    // often enough to matter: on the plan whose doors are all confirmed
    // correct, one probe called five of fourteen "leading nowhere". Walking
    // outward and taking the first real space is the same question asked
    // where it can be answered.
    const walk = (sign) => {
      let fallback = -1;
      for (const k of [0.45, 0.7, 1.0, 1.4, 1.9]) {
        const reach = Math.max(6, d.radius * k);
        const v = at(mx + d.into[0] * reach * sign, my + d.into[1] * reach * sign);
        if (v >= 0 && (outside.has(v) || roomIds.has(v))) return v;
        if (v >= 0 && fallback < 0) fallback = v;
      }
      return fallback;
    };
    const a = walk(1);
    const b = walk(-1);
    const side = (v) => (v < 0 ? 'nothing' : outside.has(v) ? 'outside' : roomIds.has(v) ? v : 'sliver');
    edges.push({ door: d, a: side(a), b: side(b) });
  }

  const isRoom = (v) => typeof v === 'number';
  const joins = edges.filter((e) => isRoom(e.a) && isRoom(e.b) && e.a !== e.b);
  const toOutside = edges.filter((e) => (e.a === 'outside') !== (e.b === 'outside'));
  // BOTH SIDES THE SAME ROOM: a door that leads where you already are. Either
  // the reading is wrong, or the wall it hangs on is not a wall.
  const sameRoom = edges.filter((e) => isRoom(e.a) && e.a === e.b);
  const nowhere = edges.filter((e) => e.a === 'nothing' || e.b === 'nothing'
    || e.a === 'sliver' || e.b === 'sliver');

  // Rooms with no way in. A recall signal rather than a precision one: every
  // room has a door in life, so a room without one is a door we did not read.
  const reached = new Set();
  for (const e of joins) { reached.add(e.a); reached.add(e.b); }
  for (const e of toOutside) { if (isRoom(e.a)) reached.add(e.a); if (isRoom(e.b)) reached.add(e.b); }
  const sealedRooms = rooms.filter((r) => !reached.has(r.id));

  // Two doors between the same pair. Real in a big house (a room with two ways
  // in), so this is reported and not judged.
  const seen = new Map();
  let repeats = 0;
  for (const e of joins) {
    const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) > 1) repeats++;
  }

  return {
    rooms,
    edges,
    report: {
      rooms: rooms.length,
      doors: doors.length,
      joinTwoRooms: joins.length,
      toOutside: toOutside.length,
      sameRoomBothSides: sameRoom.length,
      leadNowhere: nowhere.length,
      roomsWithNoDoor: sealedRooms.length,
      repeatedPairs: repeats,
      // The one number to read first. Everything a door can be that is not
      // "between two spaces" counts against it.
      suspect: sameRoom.length + nowhere.length,
    },
  };
}
