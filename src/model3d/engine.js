// Build a 3D floor from validated geometry.
//
// WHERE THE INPUT COMES FROM. Step 3 of the pipeline — the final 2D render the
// customer has already confirmed — is what the image model sees. It hands back
// GEOMETRY ONLY (src/model3d/schema.js), which is then fitted to the confirmed
// dimensions (src/model3d/fit.js) and dressed with fixtures at real sizes
// (src/model3d/fixtures.js). Nothing in this file reads a name, a dimension or
// an area out of the model's output; every one of those comes from the record.
//
// WHY THE WALLS ARE SHORT. This is a section cut at SECTION_H, the convention
// an architect already uses: slice the building at one height, draw everything
// below at true scale, let anything taller be cut. The generated prototype
// instead used 4ft walls with full-size furniture, so a 6ft fridge stood taller
// than the wall next to it. One plane, applied to everything, is what makes it
// read as deliberate.
//
// This is the ONLY file that imports three.js, so replacing the renderer later
// means editing one place (same rule as pdf.js and supabase-js in src/vendor).

import * as THREE from 'three';
import { drawnHeight, CATALOG, carsForGarage, placeStair, SECTION_H } from './fixtures.js';
import {
  wallPieces, extentOf, DOOR_H, WALL_T, subtractRects, windowPieces,
} from './geometry.js';

export { wallPieces, extentOf, framing } from './geometry.js';
// Re-exported so callers reach one module for everything scene-related, while
// the colour maths stays in a file that does not import three and can therefore
// be tested in node.
export { themeFromPalette, THEMES } from './theme3d.js';
// Imported as well as re-exported: a re-export creates no local binding, and
// buildExtruded reads THEMES itself.
import { THEMES, themeFromPalette, labelOn, haloOn } from './theme3d.js';
import { mergeStatics } from './merge.js';

/**
 * How tall one line of label stands, as a share of the plan's shorter side.
 *
 * 3% of a 40-unit building is 1.2 units — roughly the height a room name is
 * drawn at on the plan itself, rather than the 6% it used to be.
 */
const LABEL_SHARE = 0.03;
const LABEL_UNIT_DEFAULT = 1.2;

/**
 * Text drawn to a canvas and hung above the floor. The room name and its
 * dimension come from the confirmed record and are never recomputed here.
 *
 * THE LABEL SITS AT ITS OWN POINT AND NOWHERE ELSE. A version of this raised
 * colliding labels onto leader lines, the way a 3D map declutters — and it was
 * reverted the same day: with the text sized in screen space, a distant label's
 * "one line of clearance" is several feet of building, so labels floated up and
 * read as belonging to the room behind. Saman's report was "some are in the
 * wrong places", and they were.
 *
 * Position is the customer's own placement — Review and Studio both edit it —
 * so the viewer may change how a label is DRAWN and never where it is. Crowding
 * is handled by depth instead: see layoutLabels in view3d.html.
 */
function labelSprite(name, dim, colour, atX, atZ, unit = LABEL_UNIT_DEFAULT, halo = null) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const titleFont = '700 84px Inter, system-ui, sans-serif';
  // 70, NOT 52. At 52 the dimension read at 0.62 of the name, which is a fine
  // ratio on a flat sheet and not on this one: the label lies on the floor in
  // perspective, so it is foreshortened, and the line is digits rather than
  // words -- there is no word-shape to recognise a half-legible "15' X 16'" by.
  //
  // 62 was tried first and Saman still could not read it; 0.83 is the size that
  // answers the report rather than gesturing at it.
  //
  // AND WHY IT IS NOT THE 2D'S NUMBER. The compositor reads a dimension at 0.70
  // of the name and cannot go higher without changing its own layout maths (see
  // the note there). This surface needs more and can take more: nothing here is
  // reserved by name size, and the canvas height is fixed.
  //
  // WHAT IT COSTS, since it is not free. The canvas is as wide as its widest
  // line, and on a SHORT name the dimension is already that line -- DEN, BATH
  // and W.I.C were dimension-driven at 52px too. Those labels get wider, in the
  // smallest rooms, which is where there is least room to be wider in. The
  // trade is deliberate: a label that is read and slightly crowded beats one
  // that fits and cannot be read. Type size is unaffected either way, because
  // the canvas HEIGHT is what maps to the sprite's height and that is fixed.
  const subFont = '400 70px Inter, system-ui, sans-serif';
  ctx.font = titleFont;
  const tw = ctx.measureText(name).width;
  let sw = 0;
  if (dim) { ctx.font = subFont; sw = ctx.measureText(dim).width; }
  // +64 rather than +48: the halo is stroked outside the glyphs and was being
  // clipped at the canvas edge on the widest line.
  cv.width = Math.ceil(Math.max(tw, sw)) + 64;
  cv.height = dim ? 236 : 140;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /**
   * A CARTOGRAPHIC HALO: stroke the glyph, then fill over it.
   *
   * The label is light in both looks now, so on a pale floor the halo is the
   * only thing holding it up. Drawn the way every map draws one — Esri, Mapbox
   * and Apple Maps all stroke the ground colour under the letterforms rather
   * than putting a plate or a drop shadow behind them, because a plate boxes
   * the drawing up and a shadow implies a light direction this scene does not
   * have.
   *
   * Three details are what separate a halo from an outline:
   *
   *   * DOUBLE WIDTH, FILLED OVER. A canvas stroke straddles the glyph's path,
   *     so half of it lands inside the letter. Stroking at twice the width we
   *     want and then filling the glyph on top leaves exactly that width
   *     outside and the letterform untouched — thin strokes stay thin.
   *   * ROUND JOINS. Mitred corners on a bold face spike out at every serif
   *     junction and read as spikes rather than as a soft ground.
   *   * PROPORTIONAL. About an eighth of the type size, which is the range the
   *     map styles land in; a fixed pixel width would be a ring on the name and
   *     a hairline on the dimension beneath it.
   */
  const write = (text, font, y, ratio) => {
    ctx.font = font;
    if (halo) {
      const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || '84');
      ctx.strokeStyle = halo;
      ctx.lineWidth = size * ratio * 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(text, cv.width / 2, y);
    }
    ctx.fillStyle = colour;
    ctx.fillText(text, cv.width / 2, y);
  };
  write(name, titleFont, dim ? 86 : 70, 0.125);
  // Lighter on the dimension: it is a thinner face, and the same eighth would
  // close the counters in 8 and 0.
  if (dim) write(dim, subFont, 172, 0.10);

  const tex = new THREE.CanvasTexture(cv);
  // TAGGED sRGB, like the floor texture beside it.
  //
  // Without this three treats the canvas as linear data and re-encodes it on
  // output, which LIGHTENS every dark value: the light theme's label ink is
  // #292827 (41), and 41 read as linear encodes to about 111 — #6f6f6f, a mid
  // grey. That is the "labels get lost in the wall colour" report, and the
  // arithmetic matches the screenshot exactly.
  //
  // It hid in the dark theme because that label is near-white, and 255 stays
  // 255 through the same conversion. The bug only appeared once a theme needed
  // dark text, which is why it arrived with the light view rather than before.
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false,
  }));
  // The shape of the drawn text, so the viewer can size the sprite in SCREEN
  // terms without measuring the canvas again.
  sp.userData.aspect = cv.width / cv.height;
  sp.userData.twoLine = Boolean(dim);
  // SIZED FROM THE PLAN, not from a constant. This was a flat 2.4 units for a
  // name and 3.2 with a dimension — on a building 40 units across, that is a
  // single line of text six percent of the whole floor's width, and it read as
  // oversized against the drawing beneath it (reported 2026-08-17).
  //
  // `unit` is a fraction of the building's SHORTER side, so a long narrow plan
  // does not get giant text and a compact one does not get illegible text. The
  // two-line form stays proportionally taller than the one-line form.
  const h = unit * (dim ? 1.33 : 1);
  sp.scale.set(h * cv.width / cv.height, h, 1);
  sp.position.set(atX, 1.8, atZ);
  sp.renderOrder = 999;
  return sp;
}

/**
 * Build a floor from EXTRUDED walls and the confirmed plan laid on the ground.
 *
 * ONE RULE: if it is not a wall, it comes flat off the confirmed render.
 *
 * The extruded rectangles give the walls their height, and they are the
 * drawing's own walls so they cannot be in the wrong place. Everything else —
 * fixtures, cars, door arcs, stair treads, window lines — is the drawing lying
 * on the ground, which is more faithful than modelling each one and cannot
 * invent anything.
 *
 * Cars are drawn once, in 2D, where `plannedCars` already governs them through
 * the styling prompt's CARS variable. Raising a second set here would be the
 * same claim made twice from two sources, and the two can disagree: a garage
 * would show two flat cars and one standing one. The only thing added on top of
 * the drawing is HEIGHT, for the walls and the stair — the one thing a flat
 * plan cannot carry.
 *
 * @param {Object} ex          result of extrudeWalls()
 * @param {Object} opts
 * @param {'dark'|'light'} [opts.theme]
 * @param {Array}  [opts.labels]  confirmed labels, x/y normalized on the footprint
 *
 * NOT `opts.stairs`. This builder declared the option and never read it, and
 * the paragraph above still describes raising the stair, so a reader wiring it
 * up got nothing and no error. `buildFloor` below does implement it, from the
 * same confirmed record, with placeStair and drawStair.
 *
 * The 3D view uses THIS builder, so its staircases are whatever the styled
 * render already draws: flat, on the floor texture, correct in position and
 * direction because Review confirmed them, but not raised. Wiring it here needs
 * the same trim mapping the labels needed — confirmed x/y are normalised to the
 * whole render and `e` is the trimmed building — and that mapping is the thing
 * that put BATH and BEDROOM-B on top of walls when it was missing. So it is a
 * change to make deliberately, not one to slip into a doc fix.
 *
 * BUILT, TRIED AND REMOVED 2026-09-03. Read this before a second attempt.
 *
 * A flight can genuinely be measured off the render — a tread is a THIN LONG
 * line where a wall is a THICK one, and that found ten flights across the seven
 * test plans with NO false positives, ~200ms a plan. The measurement is kept and
 * runs in test/stair-probe.html; it is not the part that failed.
 *
 * What failed is the join to the record. On Jordan, the only fixture with
 * confirmed staircases, one of three matched:
 *
 *   * two flights are broken up by their own landings and rails, so fewer than
 *     five clean treads survive and the reading gives up on a stair a person can
 *     see perfectly well;
 *   * and st3's confirmed marker sits 0.11 of the render from the flight it
 *     names, because Review places it by hand. No detector fixes that. Opening
 *     the matching slack that far starts matching a stair to whatever else is
 *     nearby, which is precisely how a test window ended up in Jordan's garage.
 *
 * ONE STAIR RAISED AND TWO LEFT FLAT ON THE SAME FLOOR IS WORSE THAN THREE
 * FLAT. A customer reads the inconsistency as a fault, and it is one. Standing a
 * standard flight on the unmatched markers was tried first and is worse again —
 * Jordan's st1 came out half outside the building.
 *
 * So the sequence, if this is ever picked up again, is not to improve the
 * detector. It is to put the detector in REVIEW, where it can snap the marker
 * onto the flight that is actually drawn, or say it cannot find one. That makes
 * the confirmed record better — which is the third item on the four-point check
 * — and only then is there anything here worth raising.
 *
 * @returns {{group, extent, labelGroup, notes, dispose}}
 */
export function buildExtruded(ex, opts = {}) {
  // The Studio's palette wins when there is one; the fixed pair is the
  // fallback for a plan that has not been styled yet. Never a third choice —
  // see theme3d.js.
  const T = opts.palette
    ? themeFromPalette({ ...opts.palette, theme: opts.theme === 'light' ? 'light' : 'dark' })
    : THEMES[opts.theme === 'light' ? 'light' : 'dark'];
  // THE NAMES FOLLOW THE FLOOR THEY SIT ON, not the palette's idea of it.
  //
  // theme3d picks the label colour from `palette.floors`, which is right for a
  // scene built to the palette and wrong when the floor on screen is not the
  // floor the palette describes. That happens whenever a look has no render of
  // its own and borrows the other one's: a light palette over a borrowed dark
  // render put near-black names on a charcoal floor — legible as a smudge,
  // which is exactly what the note in theme3d warned about in the other
  // direction. `ex.floorTone` is that floor, measured. Same rule, real input.
  const labelColour = Array.isArray(ex.floorTone) ? labelOn(ex.floorTone) : T.label;
  // Measured against the same tone as the label, so the pair stays a pair.
  const labelHalo = Array.isArray(ex.floorTone) ? haloOn(ex.floorTone) : T.labelHalo;
  const group = new THREE.Group();
  const notes = [];
  const owned = [];
  const keep = (o) => { owned.push(o); return o; };
  const e = ex.extent;
  const W = e.x1 - e.x0, D = e.z1 - e.z0;

  const lineMat = keep(new THREE.LineBasicMaterial({ color: T.line }));
  // LIT, NOT PAINTED.
  //
  // Everything here used to be `MeshBasicMaterial`: unlit, so every face of
  // every wall carried exactly one colour at every angle and the model read as
  // a flat mass however you turned it. Three hand-picked tones — body, edge,
  // top — were an attempt to fake what light does for free, and they could
  // never respond to the camera.
  //
  // Lambert is deliberate over a PBR material: these are drafted volumes, not
  // objects with a surface finish, and the moment they gain roughness and
  // specular they stop looking like a drawing.
  const wallMat = keep(new THREE.MeshLambertMaterial({ color: T.wall }));
  const innerMat = keep(new THREE.MeshLambertMaterial({ color: T.wallInner ?? T.wall }));
  // A wall belongs to the ENVELOPE if it touches the building's outer bound.
  // Tolerance is a fraction of the plan, not a fixed number of feet, so it
  // holds whatever size the building is.
  const tol = Math.max(W, D) * 0.02;
  const isEnvelope = (r) => r.x0 <= e.x0 + tol || r.x1 >= e.x1 - tol
    || r.z0 <= e.z0 + tol || r.z1 >= e.z1 - tol;

  // Soft and even, so the difference between faces is a gradient rather than a
  // hard cut. The hemisphere carries most of it — sky above, bounced ground
  // below — and one weak directional gives the walls a consistent side to be
  // brighter on. No shadows: a shadow implies a sun, and this is a diagram.
  // THE RATIO IS THE WHOLE CONTROL, and the first attempt had it backwards.
  //
  // A strong hemisphere light lights every face from every direction, which is
  // "soft" but also FLAT — the walls came out within a few percent of each
  // other and a viewer could not tell one plane from the next. Angular
  // difference comes from the DIRECTIONAL light; the ambient only decides how
  // dark the faces turned away from it are allowed to get.
  //
  // So: ambient down, key up. The fill from the opposite side stops the darkest
  // faces going to mud without flattening the model again.
  group.add(keep(new THREE.HemisphereLight(0xffffff, T.bg, 0.85)));
  const key = keep(new THREE.DirectionalLight(0xffffff, 2.0));
  key.position.set(-0.6, 1, 0.35);
  group.add(key);
  // FILL RAISED 0.55 -> 0.90, and the reason is a measurement not a taste.
  //
  // Saman photographed walls that read as "short and dark grey" beside walls
  // that read as correct and white, and asked why some walls were being built
  // wrong. Measured from the scene itself rather than from the picture: the
  // model contains exactly TWO meshes -- the whole wall network as ONE solid at
  // a uniform height, and the floor plane. No wall is short. No wall has a
  // different material. Every wall is the same height and the same colour.
  //
  // What differs is which light reaches a face. With ambient 0.85, key 2.0 and
  // fill 0.55, a face turned toward the key receives 2.85 and a face turned
  // toward the fill receives 1.40 -- a ratio of 2.04, which is enough for one
  // wall to read as a different object from its neighbour rather than as the
  // same wall seen from another side. At 0.90 the ratio is 1.63: the gradient
  // that tells one plane from the next is still there (the note above is right
  // that killing it flattens the model), and the dark side stops reading as a
  // defect.
  const fill = keep(new THREE.DirectionalLight(0xffffff, 0.90));
  fill.position.set(0.7, 0.5, -0.6);
  group.add(fill);

  // Wall outlines, ON — but drawn in `wallEdge`, a whisper away from the wall
  // itself, not in the bright `line` colour.
  const showEdges = opts.edges !== false;
  const edgeMat = keep(new THREE.LineBasicMaterial({ color: T.wallEdge ?? T.line }));

  // ---- the plan itself, on the ground
  if (ex.floor) {
    const tex = keep(new THREE.CanvasTexture(ex.floor));
    tex.colorSpace = THREE.SRGBColorSpace;
    // MIPMAPS ON, and this is the fix for the dark specks.
    //
    // The plan image is 1696x2528 mapped onto a 38x60ft plane and viewed at a
    // grazing angle, so a screen pixel covers many texels. With `LinearFilter`
    // as the MINIFICATION filter there is no mipmap chain: the sampler takes a
    // single texel per pixel and the drawing's fine dark linework — burner
    // rings, fixture outlines, the floor grid — aliases into sharp black specks
    // that swim as the camera moves. That is exactly the reported symptom, and
    // it is why the specks sat on top of a cooktop where the render is clean
    // and no geometry exists.
    //
    // Five other explanations were measured out first: stray geometry, traced
    // dust (a real defect, fixed separately), painted shadows, and z-fighting
    // against the wall bottoms.
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    // The ground is the DRAWING's extent, not the building's — they differ
    // wherever the plan shows a porch, deck or patio outside the walls. Falls
    // back to the building for a geometry built before floorRect existed.
    const fr = ex.floorRect || { x0: e.x0, z0: e.z0, x1: e.x0 + W, z1: e.z0 + D };
    const fw = fr.x1 - fr.x0, fd = fr.z1 - fr.z0;
    const geo = keep(new THREE.PlaneGeometry(fw, fd));
    // POLYGON OFFSET, and it is not cosmetic tuning.
    //
    // The plan image lies at y = 0 and every wall box's BOTTOM face is also at
    // y = 0, so the two are coplanar. Coplanar faces tie in the depth buffer
    // and the winner flips per pixel and per camera angle — which is exactly
    // what showed on screen: sharp black rectangles lying flat on the floor,
    // moving when the view moved, in the wall's own near-black colour, even on
    // top of a cooktop where no wall exists.
    //
    // It took four wrong answers to get here: stray geometry (there is none
    // under 2.5ft in the whole scene), traced dust (a real defect, fixed, but
    // not this one), and shadows painted into the 2D render (the render is
    // clean at the exact pixel the click probe named). Pushing the floor back
    // in depth breaks the tie without moving anything a viewer can measure.
    const floorMat = keep(new THREE.MeshBasicMaterial({
      map: tex, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      // TRANSPARENT, because the sheet fades out at its edges rather than
      // ending in a hard rectangle. Without this three ignores that alpha and
      // the fade is invisible work.
      transparent: true,
    }));
    const plane = new THREE.Mesh(geo, floorMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(fr.x0 + fw / 2, 0, fr.z0 + fd / 2);
    group.add(plane);
  }

  // ---- the walls, with the window openings taken out of them first.
  // Drawn before subtraction, each wall is one solid box and fills its own
  // windows.
  // WINDOWS ARE FLAT, LIKE EVERYTHING ELSE.
  //
  // Fixtures, door swings, stair treads and cars all ride on the floor as the
  // drawing already has them — one rule, no exceptions. Windows were the single
  // exception, built as 3D framed openings, and every window defect on this
  // pipeline came from that exception: the detector finds some openings and not
  // others, so some got frames and the rest stayed as raw gaps between walls,
  // which reads as a building half-finished.
  //
  // A window drawn flat cannot be inconsistent, cannot be invented, and cannot
  // be missing — it is whatever the confirmed render drew. The frame geometry
  // and the detector are kept (engine builds from opts.windows if given, and
  // openings.js is fully tested) for when detection is good enough that every
  // opening gets the same treatment.
  const windows = opts.windows || [];
  // A window either interrupts a traced wall or FILLS A GAP between two of
  // them, and both happen on the same plan.
  //
  // Measured on Jordan: a window read off the wireframe at x26.43-30.89 landed
  // between walls ending at 26.37 and starting at 30.92 — the styled render
  // breaks its wall there too. Two independent readings of the same drawing
  // agreeing on an opening is the best evidence there is that it is real, so
  // clipping the frame to wall pixels would throw away exactly the windows we
  // are most sure of. Where there is wall to clip to, clip; where there is a
  // gap, the window is the frame.
  const frames = [];
  for (const w of windows) {
    const pieces = windowPieces([w], ex.walls);
    frames.push(...(pieces.length ? pieces : [w]));
  }
  const solidWalls = subtractRects(ex.walls, frames);
  const wallBox = (r, height) => {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    if (w <= 0 || d <= 0 || height <= 0) return;
    const g = keep(new THREE.BoxGeometry(w, height, d));
    const m = new THREE.Mesh(g, isEnvelope(r) ? wallMat : innerMat);
    m.position.set((r.x0 + r.x1) / 2, height / 2, (r.z0 + r.z1) / 2);
    group.add(m);
    if (showEdges) {
      // THE CUT CAP, and on the apron it is doing real work. A wall that simply
      // stops partway up reads as unfinished construction — that is what killed
      // the fourth attempt. A drawn line across the top of it is the drafting
      // convention for "the building is cut here", which is what turns a short
      // wall into a section and a section into something deliberate.
      const edge = new THREE.LineSegments(keep(new THREE.EdgesGeometry(g)), edgeMat);
      edge.position.copy(m.position);
      group.add(edge);
    }
  };
  // ONE SOLID PER WALL NETWORK, when the extruder could give us outlines.
  //
  // A wall built as a pile of boxes shows every seam where two of them meet,
  // and eight passes of cleaning up after that are in this file's history, all
  // reverted. `ex.shapes` is the same ink described as closed boundaries, so a
  // whole run of wall — corners, junctions and all — comes out as a single
  // mesh with nothing inside it to draw a line on.
  //
  // The rectangles stay the fallback, and stay the source for everything else:
  // windows map onto them, and the guards in view3d measure them.
  //
  // AND A RECTANGLE CANNOT BE DIAGONAL. That is the deeper reason and the one
  // that finally moved this out from behind its flag: a plan that draws a wall
  // at an angle gets a stack of axis-aligned plates, and there is no cleaning up
  // after that because nothing went wrong — the model was asked for a diagonal
  // and rectangles are what it has. Outlines are polygons and simply carry the
  // angle. On the wall Saman photographed, three genuinely diagonal segments
  // replace seventeen plate edges.
  //
  // THE OUTLINES, WITH THE SAME OPENINGS THE RECTANGLES GET.
  //
  // `solidWalls` above is the rectangle list with every window frame already
  // subtracted, and this path used to skip it entirely — so a plan whose
  // confirmed record carries window openings had them filled back in the moment
  // outlines were switched on.
  //
  // `ex.reshape` cuts the openings into the ink and traces the boundary again,
  // rather than subtracting a rectangle from a polygon with holes. See
  // `traceOutlines` in extrude.js: the two paths now produce their openings by
  // the same means instead of by two implementations that have to agree, and a
  // PUBLISHED floor — which returns a stored record and never runs the trace —
  // gets its own `reshape` built from the ink rectangles the record carries.
  // The `ex.shapes` fallback is for a record published before those travelled.
  const outlines = opts.outline
    ? (ex.reshape ? ex.reshape(frames) : (ex.shapes || []))
    : [];
  if (outlines.length) {
    for (const sh of outlines) {
      // A THREE.Shape is built in XY and extruded along Z, so it is laid down
      // afterwards: rotate -90 about X puts the plan on the ground and sends
      // the extrusion up.
      //
      // THAT ROTATION NEGATES Z. It sends (x, y, z) to (x, z, -y), so a ring
      // handed over in plan coordinates comes out mirrored about z = 0 — the
      // walls built clean and then stood beside the floor instead of on it,
      // which is exactly what the first outline render showed. Feeding -z in
      // cancels it. The rectangles never went through here, which is why only
      // the outlines moved.
      const flat = ([x, z]) => new THREE.Vector2(x, -z);
      const shape = new THREE.Shape(sh.outer.map(flat));
      for (const ring of sh.holes) shape.holes.push(new THREE.Path(ring.map(flat)));
      const g = keep(new THREE.ExtrudeGeometry(shape, {
        depth: SECTION_H, bevelEnabled: false, curveSegments: 1,
      }));
      g.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(g, wallMat);
      group.add(mesh);
      if (showEdges) {
        // On a single solid, EdgesGeometry emits a line only where two faces
        // actually turn a corner — so the junctions inside a wall run, which
        // is what every seam complaint was about, produce nothing.
        group.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(g)), edgeMat));
      }
    }
  } else {
    for (const r of solidWalls) wallBox(r, SECTION_H);
  }
  // ---- windows: an opening, and nothing put back into it.
  //
  // CLOSED AGAIN 2026-08-31, ON SAMAN'S CALL. FIVE ATTEMPTS, FIVE REVERTS.
  // Read docs/research-brief-3d-windows.md and -2.md before a sixth.
  //
  // The fifth was the sill apron: wall from the floor to a 3ft sill across the
  // opening and nothing above it, so a window read as a notch in the wall top
  // while a doorway kept a full-height gap. The geometry was sound and the
  // numbers were good — five aprons on Plan A, 4.3 to 4.8ft long and 0.37 to
  // 0.66 thick against a 0.38 median wall. On screen it read as a wall standing
  // in the window, and Saman said take it out.
  //
  // WHAT IT COST, written down so a sixth attempt does not pay it again. Three
  // rounds went on aprons that were built correctly and were INCHES long,
  // because windowPieces clips a window to the wall rects it overlaps and the
  // tracer breaks the wall AT the opening, so only the ends touch wall. Fixing
  // that made them full length — and full length is what finally showed the
  // real objection, which was never about size.
  //
  // So the wall is taken away across the opening and nothing is put back. The
  // model claims exactly what the plan supports: an opening is HERE, and it is
  // THIS WIDE. A window and a doorway look alike, which is honest, because from
  // a floor plan alone they differ only in a height nobody gave us.

  // WHERE THE WINDOWS CAME FROM, per window rather than as a blanket claim.
  // This line said "from the confirmed record" whatever the source, and on Plan
  // A every one of the seven had been read off the render instead — the record
  // carries no window openings at all. A debug line that misreports provenance
  // is worse than none: it is the line you reason from.
  const confirmed = windows.filter((w) => w.fromRecord).length;
  const source = windows.length === 0 ? ''
    : confirmed === windows.length ? ' from your confirmed record'
      : confirmed === 0 ? ' read off the render, not from your record'
        : ` — ${confirmed} confirmed, ${windows.length - confirmed} read off the render`;
  notes.push(`${ex.walls.length} wall rectangles from the confirmed render`
    + `, ${windows.length} window${windows.length === 1 ? '' : 's'}${source}.`);

  // ---- labels, from the confirmed record only
  //
  // MAPPED THROUGH THE TRIM FIRST. A confirmed label's x/y are normalised to
  // the WHOLE render, and the render carries the styling prompt's fixed 7-8%
  // margin on all four sides. `e` is the trimmed building. Using the raw
  // fraction against `e` stretched every name outward from the centre — small
  // in the middle of the plan and worst at the edges, which is why BATH and
  // BEDROOM-B ended up standing on walls while BONUS ROOM looked about right.
  const t = ex.trim;
  const unTrim = (v, lo, hi) => (hi > lo ? (v - lo) / (hi - lo) : v);
  const labelGroup = new THREE.Group();
  labelGroup.visible = opts.labels !== false;
  for (const l of opts.labels || []) {
    if (!l?.name) continue;
    const lx = t ? unTrim(l.x, t.x0, t.x1) : l.x;
    const ly = t ? unTrim(l.y, t.y0, t.y1) : l.y;
    labelGroup.add(labelSprite(l.name, l.dim, labelColour,
      e.x0 + lx * W, e.z0 + ly * D, Math.min(W, D) * LABEL_SHARE, labelHalo));
  }
  group.add(labelGroup);

  // ONE DRAW CALL PER MATERIAL, after everything above has had its say.
  //
  // Deliberately the last thing that happens, and deliberately a separate
  // module: nothing above needs to know about it, and it can be removed in one
  // line if it is ever in the way. The labels are added first and skipped by it
  // — they are sprites, sorted and faded per label every frame, and the only
  // part of this model that is not static.
  //
  // Measured on The Sky: 147 draw calls to 6, 1.10ms a frame to 0.16ms, with
  // the rendered pixels unchanged.
  // `?merge=0` turns it off — the escape hatch this file already gives every
  // other optional pass, and the only way to compare the merged drawing against
  // the unmerged one in the same browser, which is how it was checked.
  if (opts.merge !== false) {
    const m = mergeStatics(group, THREE, keep);
    notes.push(`${m.before} drawn objects merged to ${m.after}.`);
  }

  return {
    group,
    extent: e,
    labelGroup,
    notes,
    dispose() {
      owned.forEach((o) => o.dispose?.());
      labelGroup.children.forEach((sp) => { sp.material.map?.dispose(); sp.material.dispose(); });
      group.clear();
    },
  };
}

/**
 * @param {{rooms:Array, walls:Array}} geometry  validated and already fitted
 * @param {Object} opts
 * @param {'dark'|'light'} [opts.theme]
 * @param {boolean} [opts.labels]     room names on
 * @param {boolean} [opts.fixtures]   essentials on
 * @returns {{group:THREE.Group, extent:Object, notes:string[], dispose:Function}}
 *   `notes` records every decision worth reporting — the car counts and why.
 */
export function buildFloor(geometry, opts = {}) {
  // The Studio's palette wins when there is one; the fixed pair is the
  // fallback for a plan that has not been styled yet. Never a third choice —
  // see theme3d.js.
  const T = opts.palette
    ? themeFromPalette({ ...opts.palette, theme: opts.theme === 'light' ? 'light' : 'dark' })
    : THEMES[opts.theme === 'light' ? 'light' : 'dark'];
  const group = new THREE.Group();
  const notes = [];
  const owned = [];   // everything that has to be released on dispose

  const track = (o) => { owned.push(o); return o; };
  const lineMat = track(new THREE.LineBasicMaterial({ color: T.line }));
  const softMat = track(new THREE.LineBasicMaterial({ color: T.line, transparent: true, opacity: 0.45 }));
  const wallMat = track(new THREE.MeshBasicMaterial({ color: T.wall }));
  const leafMat = track(new THREE.MeshBasicMaterial({ color: T.leaf }));
  const floorMat = track(new THREE.MeshBasicMaterial({ color: T.floor }));

  /** A solid with its edges picked out — the line art is what carries the
   *  drawing, the fill only stops you seeing through the building. */
  const box = (cx, cy, cz, sx, sy, sz, mat, edges = true) => {
    const g = track(new THREE.BoxGeometry(sx, sy, sz));
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx, cy, cz);
    group.add(m);
    if (edges) {
      const e = new THREE.LineSegments(track(new THREE.EdgesGeometry(g)), lineMat);
      e.position.copy(m.position);
      group.add(e);
    }
    return m;
  };

  // ---- floor plates
  for (const r of geometry.rooms) {
    box((r.x0 + r.x1) / 2, -0.1, (r.z0 + r.z1) / 2,
      r.x1 - r.x0, 0.2, r.z1 - r.z0, floorMat, false);
  }

  // ---- walls, cut at the section plane
  const doors = [], windows = [];
  for (const w of geometry.walls) {
    const t = w.t || WALL_T;
    for (const p of wallPieces(w)) {
      const len = p.e - p.s, h = p.y1 - p.y0;
      const c = (p.s + p.e) / 2, cy = (p.y0 + p.y1) / 2;
      if (w.axis === 'x') box(c, cy, w.f, len, h, t, wallMat);
      else box(w.f, cy, c, t, h, len, wallMat);
    }
    for (const o of w.open || []) {
      const s = o.c - o.w / 2, e = o.c + o.w / 2;
      if (o.k === 'win') windows.push({ axis: w.axis, f: w.f, s, e });
      else if (o.k !== 'garage') doors.push({ axis: w.axis, f: w.f, s, e, w: o.w, swing: o.swing || 1, k: o.k });
    }
  }

  // ---- glazing: gone with the head height.
  //
  // A pane needs a sill AND a head to span between, and the head is above this
  // model's cut plane — see the windows note in buildExtruded. wallPieces gives
  // this builder the same apron by the same rule, so compare3d shows the two
  // builders answering a window the same way instead of one glazing it and the
  // other notching it.

  // ---- door leaves and their swing arcs
  for (const dr of doors) {
    const leaves = dr.k === 'double'
      ? [{ hinge: dr.s, len: dr.w / 2, dir: 1 }, { hinge: dr.e, len: dr.w / 2, dir: -1 }]
      : [{ hinge: dr.s, len: dr.w, dir: 1 }];
    for (const lf of leaves) {
      const hx = dr.axis === 'x' ? lf.hinge : dr.f;
      const hz = dr.axis === 'x' ? dr.f : lf.hinge;
      const closed = dr.axis === 'x' ? [lf.dir, 0] : [0, lf.dir];
      const open = dr.axis === 'x' ? [0, dr.swing] : [dr.swing, 0];

      const lg = track(new THREE.BoxGeometry(lf.len, DOOR_H * 0.9, 0.07));
      lg.translate(lf.len / 2, 0, 0);
      const theta = Math.atan2(-open[1], open[0]);
      const leaf = new THREE.Mesh(lg, leafMat);
      leaf.rotation.y = theta;
      leaf.position.set(hx, DOOR_H * 0.45, hz);
      const edge = new THREE.LineSegments(track(new THREE.EdgesGeometry(lg)), lineMat);
      edge.rotation.y = theta;
      edge.position.copy(leaf.position);
      group.add(leaf, edge);

      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const a = (Math.PI / 2) * (i / 16);
        pts.push(new THREE.Vector3(
          hx + lf.len * (Math.cos(a) * closed[0] + Math.sin(a) * open[0]), 0.06,
          hz + lf.len * (Math.cos(a) * closed[1] + Math.sin(a) * open[1])));
      }
      group.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), softMat));
    }
  }

  // ---- fixtures. Only cars for now, and only where a confirmed label says the
  // room is a garage — the count comes from our own rule, never from the model.
  if (opts.fixtures !== false) {
    for (const r of geometry.rooms) {
      const name = r.label?.name || '';
      if (!/GARAGE|CARPORT/i.test(name)) continue;
      const res = carsForGarage(r.label, r);
      notes.push(`${name}: ${res.count} car${res.count === 1 ? '' : 's'} — ${res.why}`);
      for (const spot of res.spots) drawCar(group, spot, lineMat, track);
    }
  }

  // ---- stairs, from the confirmed record. The model is not asked for them:
  // Review already makes the customer confirm the count and direction, and it
  // is the third item on the four-point check.
  for (const st of opts.stairs || []) {
    const placed = placeStair(st, extentOf(geometry.rooms));
    drawStair(group, placed, lineMat, wallMat, track);
    notes.push(`Staircase: ${placed.treads} treads, ${placed.up ? 'UP' : 'DOWN'} — from the confirmed record.`);
  }

  // ---- labels, from the confirmed record only
  const labelGroup = new THREE.Group();
  labelGroup.visible = opts.labels !== false;
  for (const r of geometry.rooms) {
    if (!r.label?.name) continue;   // an unlabelled space stays unlabelled
    const le = extentOf(geometry.rooms);
    labelGroup.add(labelSprite(r.label.name, r.label.dim, T.label,
      (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2,
      Math.min(le.x1 - le.x0, le.z1 - le.z0) * LABEL_SHARE, T.labelHalo));
  }
  group.add(labelGroup);

  const extent = extentOf(geometry.rooms);
  return {
    group,
    extent,
    labelGroup,
    notes,
    dispose() {
      for (const o of owned) o.dispose?.();
      labelGroup.children.forEach((sp) => { sp.material.map?.dispose(); sp.material.dispose(); });
      group.clear();
    },
  };
}

// A car in plan, as an outline. Two stacked boxes read as a crate — the 2D
// render draws a recognisable silhouette and the 3D looked like a different
// product beside it. These are half-profiles in feet, mirrored, and they are
// what a sedan looks like from above: a nose that tapers, a cabin set back, a
// tail that is squarer than the front.
const CAR_BODY = [
  [0.00, -7.85], [1.35, -7.60], [2.35, -6.90], [2.90, -5.30], [3.00, -2.40],
  [3.00, 1.20], [2.92, 4.20], [2.55, 6.40], [1.70, 7.55], [0.00, 7.85],
];
const CAR_CABIN = [
  [0.00, -3.30], [1.55, -3.05], [2.15, -2.20], [2.30, -0.40],
  [2.25, 1.60], [1.95, 2.90], [1.20, 3.55], [0.00, 3.75],
];

/** Mirror a half-profile into a closed loop. Drawing only one side and
 *  reflecting it is what keeps the two halves identical — an outline traced by
 *  hand on both sides never quite matches, and the eye sees it. */
function mirrored(half) {
  const pts = half.map((p) => [p[0], p[1]]);
  for (let i = half.length - 2; i >= 1; i--) pts.push([-half[i][0], half[i][1]]);
  return pts;
}

function loopAt(pts, y, mat, track) {
  const v = pts.map((p) => new THREE.Vector3(p[0], y, p[1]));
  return new THREE.LineLoop(track(new THREE.BufferGeometry().setFromPoints(v)), mat);
}

/** Vertical ties at a few points, so the outline reads as a solid rather than
 *  two floating rings. */
function ribs(pts, y0, y1, at, mat, track, into) {
  for (const i of at) {
    const p = pts[i % pts.length];
    into.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p[0], y0, p[1]), new THREE.Vector3(p[0], y1, p[1]),
    ])), mat));
  }
}

function drawCar(group, spot, mat, track) {
  const c = CATALOG.car;
  const h = drawnHeight(c);
  const g = new THREE.Group();
  g.position.set(spot.x, 0, spot.z);
  g.rotation.y = spot.rot;

  const body = mirrored(CAR_BODY);
  const cabin = mirrored(CAR_CABIN);
  const beltline = h * 0.52;
  g.add(loopAt(body, 0.3, mat, track), loopAt(body, beltline, mat, track));
  g.add(loopAt(cabin, beltline, mat, track), loopAt(cabin, h, mat, track));
  ribs(body, 0.3, beltline, [0, 4, 9, 13], mat, track, g);
  ribs(cabin, beltline, h, [0, 3, 7, 11], mat, track, g);
  group.add(g);
}

/**
 * A flight of stairs, drawn tread by tread.
 *
 * Position, heading and direction come from the confirmed record. The step
 * count follows from the run length and a real 10in tread, so a flight is never
 * a decorative number of lines — and the flight climbs toward the heading when
 * it goes UP and away from it when it goes DOWN, which is the one thing a
 * reviewer checks on the 2D drawing.
 */
function drawStair(group, s, mat, wallMat, track) {
  const g = new THREE.Group();
  g.position.set(s.x, 0, s.z);
  g.rotation.y = s.rot;

  const run = s.d / s.treads;
  const rise = Math.min(SECTION_H, s.treads * (7 / 12)) / s.treads;
  for (let i = 0; i < s.treads; i++) {
    // Height grows along the flight for an UP run and shrinks for a DOWN one,
    // so the two read differently at a glance instead of looking identical.
    const step = s.up ? (i + 1) : (s.treads - i);
    const top = step * rise;
    const geo = track(new THREE.BoxGeometry(s.w, top, run));
    const m = new THREE.Mesh(geo, wallMat);
    m.position.set(0, top / 2, -s.d / 2 + run * (i + 0.5));
    const e = new THREE.LineSegments(track(new THREE.EdgesGeometry(geo)), mat);
    e.position.copy(m.position);
    g.add(m, e);
  }
  group.add(g);
}
