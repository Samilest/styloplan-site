// Putting a home on the internet, and taking it off again.
//
// `src/publish.js` decides WHAT travels and is pure; this decides WHEN, and is
// the only module that sends it. The split is deliberate: the shape of what
// leaves a customer's machine is worth testing without a network, and the
// network is worth keeping out of the tests that check it.
//
// NOTHING HERE RUNS ON ITS OWN. Every function below is called from a builder
// pressing a button they were shown the consequences of. Opening the 3D page,
// rendering, copying an embed code — none of them publish. See
// docs/design-brief-embed-publishing.md.
//
// PUBLISHING IS A SNAPSHOT, not a live view. A builder who renders again does
// not silently change what is already on their customer's website; they press
// publish again. `staleness()` is what makes that kind rather than confusing —
// it is how the page can say "a newer version is ready" instead of leaving them
// to wonder why their site did not change.

import { getSupabase } from './supabase-client.js';
import { getArtifact, scopeFor, styledKind, styledKeyKind } from './artifacts.js';
import { PUBLISHED_BUCKET, renderPath } from './publish.js';
import { labelsOnRender } from './label-frame.js';
import { extrudeWalls, publishableGeometry } from './model3d/extrude.js';
import { DEFAULT_WIDTH_FT } from './model3d/geometry.js';
import { wallSegments, planGaps, ftPerPx } from './model3d/openings.js';
import { readWindows, publishableOpenings } from './model3d/window-read.js';
import { roomGraph } from './model3d/rooms.js';
import { calibrateWidthFt } from './model3d/calibrate.js';

const TABLE = 'published_floors';

async function ctx() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user ? { sb, uid: data.user.id } : null;
}

/**
 * The stored palette signature of a floor's render, or null.
 *
 * Read exactly the way Studio's `readStyledKey` reads it — a Blob, texted and
 * trimmed. Two readers of one fact is already one too many; two readers that
 * disagree about trailing whitespace would report a newer render on every
 * visit, which is the most annoying possible version of this feature.
 */
async function sourceKeyOf(projectId, floorId, look) {
  const held = await getArtifact(scopeFor(projectId, floorId), styledKeyKind(look));
  if (!held) return null;
  return (typeof held === 'string' ? held : await held.text()).trim();
}

/**
 * What is published for this project right now, read as its OWNER.
 *
 * Deliberately the table and not `published_home()`: the builder is entitled to
 * `source_key`, which is what tells them their published copy is behind their
 * latest render, and a visitor is not.
 *
 * THREE ANSWERS, NOT TWO, and the third is why this shape. Signed out and
 * "the query failed" both used to come back as null, so a signed-in builder
 * whose read failed was told to sign in — advice that cannot work, about a
 * problem they do not have. The first version of this file shipped that bug and
 * the browser check found it within a minute of a real query failing.
 *
 * @returns {Promise<{signedIn: boolean, rows: Map<string, object>|null, error: string|null}>}
 */
export async function publishedState(projectId) {
  const c = await ctx();
  if (!c || !projectId) return { signedIn: false, rows: null, error: null };
  const { data, error } = await c.sb.from(TABLE)
    .select('floor_id, look, source_key, published_at, updated_at')
    .eq('project_id', projectId);
  if (error) {
    console.warn('published state:', error.message);
    return { signedIn: true, rows: null, error: error.message };
  }
  return {
    signedIn: true,
    rows: new Map((data || []).map((r) => [r.floor_id, r])),
    error: null,
  };
}

/**
 * What a published copy is made OF, in one string.
 *
 * THE RENDER IS NOT THE WHOLE OF IT, and assuming it was left a real gap:
 * renaming a room in Review, or nudging a label, changes what a customer's
 * website shows but does not touch the palette signature — so the app would
 * have gone on saying "Published" with no hint that the published copy was
 * behind, forever. The first time it mattered was the day the label frame was
 * fixed: nothing about the renders changed, and every published home needed
 * sending again.
 *
 * Both halves, in a field that already exists. `source_key` is text and nobody
 * parses it but this file.
 */
function signature(styledKey, payload) {
  // FNV-1a over the fields that are actually published. Rounded, because a
  // float that ends ...0000001 after a drag is not a change anybody made.
  // The floor level joins the text only once it has been answered, so every
  // signature written before the question existed still matches itself and no
  // published home turns stale on the day this shipped.
  const text = (payload?.labels || [])
    .map((l) => `${l.id}|${l.name}|${l.dim || ''}|${l.x.toFixed(4)}|${l.y.toFixed(4)}`)
    .join('~') + (typeof payload?.below === 'boolean' ? `~below:${payload.below ? 1 : 0}` : '');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${styledKey || '-'}|${h.toString(36)}`;
}

/**
 * Which published floors are behind what is on this machine.
 *
 * Compares the published signature with the one this floor would publish now.
 * An UNKNOWN signature counts as "no news": a row published before the field
 * existed must not turn into a permanent nag about an update that may not
 * exist.
 *
 * @param {Array} rows what `homePayload().ready` returned for this look
 * @param {Map} published rows from publishedState()
 * @returns {Promise<string[]>} floor ids whose published copy is out of date
 */
export async function staleFloors(rows, published) {
  const out = [];
  for (const r of rows || []) {
    const row = published?.get(r.floorId);
    if (!row?.source_key || row.look !== r.look) continue;
    const key = await sourceKeyOf(r.projectId, r.floorId, r.look);
    if (signature(key, r.payload) !== row.source_key) out.push(r.floorId);
  }
  return out;
}

/** Decode a stored blob, or null — a picture we cannot read maps nothing. */
function imageFrom(blob) {
  return new Promise((ok) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); ok(null); };
    img.src = url;
  });
}

/** WebP quality for a published render. See the note on renderPath. */
const WEBP_QUALITY = 0.92;

/**
 * The render, re-encoded for the wire.
 *
 * FAILURE FALLS BACK TO THE ORIGINAL, which is the safe direction: a viewer
 * downloads a bigger file rather than no file. Returns the type alongside the
 * blob because the upload has to declare it, and declaring image/png over WebP
 * bytes is exactly the kind of lie that costs somebody an afternoon.
 */
async function forTheWire(blob) {
  const img = await imageFrom(blob);
  if (!img) return { blob, type: blob.type || 'image/png', ext: 'png' };
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const webp = await new Promise((ok) => c.toBlob(ok, 'image/webp', WEBP_QUALITY));
  // A browser that cannot encode WebP hands back a PNG (or null). Trust the
  // type it reports, never the type we asked for.
  if (!webp || webp.type !== 'image/webp') return { blob, type: blob.type || 'image/png', ext: 'png' };
  return { blob: webp, type: 'image/webp', ext: 'webp' };
}

/** This floor's labels, in the published render's own frame. */
async function inRenderFrame(row, renderBlob) {
  const scope = scopeFor(row.projectId, row.floorId);
  const wireBlob = await getArtifact(scope, 'wireframe');
  if (!wireBlob) return row.payload.labels;    // nothing to map from; send as stored
  const [wire, render] = await Promise.all([imageFrom(wireBlob), imageFrom(renderBlob)]);
  return labelsOnRender(row.payload.labels, wire, render);
}

/**
 * Read the plan out of a render, here, so no visitor has to.
 *
 * THE SAME REASON `inRenderFrame` EXISTS, applied to the heavier half. That one
 * moves a transform onto the machine that still holds both pictures; this moves
 * an analysis onto the machine that has already paid for it.
 *
 * Measured cold on The Sky: a visitor's first read of the plan goes from 2076ms
 * to 1503ms, and the record that buys that is 2.8 KB gzipped beside a 1.5 MB
 * image. Making it here costs the builder 367ms at publish, once.
 *
 * It is not an approximation of the reading — it IS the reading, produced by
 * the same function the visitor would have run. What changes is where it runs,
 * and that a slow phone no longer has to analyse a four-megapixel image before
 * it can show anything.
 *
 * NULL IS A FINE ANSWER. A floor published without a reading simply traces
 * locally, the way every floor did before this existed, so a failure here costs
 * speed and never correctness. That is also why it is wrapped: publishing must
 * not fail because an optimisation did.
 */
export async function readingOf(renderBlob, labels) {
  try {
    const img = await imageFrom(renderBlob);
    // `floor: false` skips building the texture canvas — the one part of the
    // result that cannot be published, and the expensive part of what is left.
    const first = extrudeWalls(img, DEFAULT_WIDTH_FT, { floor: false });
    // CALIBRATED HERE, ON THE MACHINE THAT HOLDS THE CONFIRMED LABELS, and the
    // width travels inside the reading as its extent. A visitor reads that
    // number back rather than assuming one, so the openings it cuts are in the
    // same frame as the walls it was handed. See calibrate.js and the note
    // above WIDTH_FT in view3d.html for why 40 was never only a look.
    const { widthFt, openings } = calibratedWidth(img, first, labels);
    const ex = widthFt === DEFAULT_WIDTH_FT ? first : extrudeWalls(img, widthFt, { floor: false });
    const record = publishableGeometry(ex);
    // THE OPENINGS TRAVEL WITH THE WALLS, in the render's pixels like the
    // labels, so a visitor's page frames the same windows and shutters the
    // same garage doors the builder's does, without reading the picture. The
    // builder's page maps them the same way (view3d, the fromPublished branch).
    return record ? { ...record, openings } : null;
  } catch {
    return null;
  }
}

/**
 * The same reading view3d does before it traces for real: the plan flooded
 * into rooms with no scale, each labelled room voting with its confirmed size.
 * `labels` are already in the render's frame here (see inRenderFrame).
 */
function calibratedWidth(img, first, labels) {
  if (!first?.trim) return { widthFt: DEFAULT_WIDTH_FT, openings: [] };
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const d = cx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let total = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) { lum[p] = (d[i] + d[i + 1] + d[i + 2]) / 3; total += lum[p]; }
  const inverted = total / (w * h) < 128;
  const ink = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) ink[p] = (inverted ? lum[p] > 150 : lum[p] < 105) ? 1 : 0;
  const seg = wallSegments(ink, w, h, {});
  // Both directions and the sparse-band symbols, from one place (planGaps).
  const gaps = planGaps(seg, { minGap: 20, maxGap: 400 });
  let widthFt = DEFAULT_WIDTH_FT;
  if (labels?.length) {
    const g = roomGraph({ mask: ink, W: w, H: h, segments: seg, gaps, doors: [] });
    const cal = calibrateWidthFt({
      labels, rooms: g.rooms, roomAt: g.roomAt, imgW: w, imgH: h,
      buildingPx: (first.trim.x1 - first.trim.x0) * w, fallback: DEFAULT_WIDTH_FT,
    });
    if (cal.calibrated) widthFt = cal.widthFt;
  }
  // THE SAME READING view3d MAKES (windowFills there): every opening with its
  // kind and its units, from the one reader both share. A visitor is handed
  // this record, so it has to carry the same windows.
  const scale = ftPerPx(seg, widthFt);
  const openings = scale ? publishableOpenings(readWindows({ ink, w, h, seg, gaps }, scale, labels).openings) : [];
  return { widthFt, openings };
}

/**
 * Publish floors of one home, in one look.
 *
 * The row goes first and the image second, in that order and not the other:
 * the storage policy consults the row to decide whether the upload is allowed,
 * so an image without a row cannot be written at all. It also fails safe — a
 * row whose upload failed shows a broken image, which is visible; an image with
 * no row would be an orphan nothing points at.
 *
 * @param {Array} rows what `homePayload().ready` returned
 * @returns {Promise<{published: number, failed: Array<{name: string, why: string}>}>}
 */
export async function publishFloors(rows) {
  const c = await ctx();
  if (!c) return { published: 0, failed: [{ name: 'Sign in', why: 'you are signed out' }] };

  let published = 0;
  const failed = [];
  for (const r of rows) {
    const key = signature(await sourceKeyOf(r.projectId, r.floorId, r.look), r.payload);
    const blob = await getArtifact(scopeFor(r.projectId, r.floorId), styledKind(r.look));
    if (!blob) { failed.push({ name: r.floorName, why: 'its render is not on this computer' }); continue; }

    // MAPPED BEFORE IT LEAVES. Stored positions are a fraction of the
    // wireframe; a buyer's browser has no wireframe and never will, so the
    // transform has to be applied here, on the machine that still holds both
    // pictures. See src/label-frame.js. What is published is therefore already
    // in the render's own frame — which is why view3d does not map again for a
    // visiting reader.
    const mapped = await inRenderFrame(r, blob);
    const payload = {
      ...r.payload,
      labels: mapped,
      geometry: await readingOf(blob, mapped),
    };
    const { error } = await c.sb.from(TABLE).upsert({
      floor_id: r.floorId,
      project_id: r.projectId,
      look: r.look,
      sort_order: r.sortOrder,
      floor_name: r.floorName,
      plan_title: r.planTitle,
      payload,
      source_key: key,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'floor_id' });
    if (error) { failed.push({ name: r.floorName, why: error.message }); continue; }

    const wire = await forTheWire(blob);
    const up = await c.sb.storage.from(PUBLISHED_BUCKET)
      .upload(renderPath(r.floorId, r.look, wire.ext), wire.blob,
              { upsert: true, contentType: wire.type });
    if (up.error) { failed.push({ name: r.floorName, why: up.error.message }); continue; }
    published++;
  }
  return { published, failed };
}

/**
 * Withdraw floors.
 *
 * The image is removed first and the row second, again for the policy's sake:
 * once the row is gone the delete policy has nothing to check the object
 * against. If the removal fails the row still goes, and the image is already
 * unreadable the moment it does — the bucket is not public and reading is
 * gated on the row existing. Which is to say withdrawing is safe even when the
 * housekeeping is not.
 *
 * @param {Array<{floorId: string, look: string}>} floors
 * @returns {Promise<{withdrawn: number, error: string|null}>}
 */
export async function withdrawFloors(floors) {
  const c = await ctx();
  if (!c) return { withdrawn: 0, error: 'you are signed out' };
  if (!floors.length) return { withdrawn: 0, error: null };

  await c.sb.storage.from(PUBLISHED_BUCKET)
    // BOTH EXTENSIONS. A floor published before the WebP change has a .png
    // object; one published after has .webp; a floor published across the
    // change could have left a .png behind. Removing only one would leave the
    // other readable for as long as its row existed.
    .remove(floors.flatMap((f) => ['webp', 'png'].map((x) => renderPath(f.floorId, f.look, x))))
    .catch(() => {});   // housekeeping; access is revoked by the row going

  const { data, error } = await c.sb.from(TABLE)
    .delete().in('floor_id', floors.map((f) => f.floorId)).select('floor_id');
  if (error) return { withdrawn: 0, error: error.message };
  return { withdrawn: data?.length || 0, error: null };
}
