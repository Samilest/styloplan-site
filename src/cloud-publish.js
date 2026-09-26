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
import { PUBLISHED_BUCKET, renderPath, posterPath, POSTER_SHAPES } from './publish.js';
import { PUBLISHED_TABLE } from './published-paths.js';
import { labelsOnRender, stairsOnRender } from './label-frame.js';
import { extrudeWalls, publishableGeometry, GEOMETRY_VERSION } from './model3d/extrude.js';
import { DEFAULT_WIDTH_FT } from './model3d/geometry.js';
import { planInkOf, readPlan, publishableOpenings, applyDecisions } from './model3d/window-read.js';

const TABLE = PUBLISHED_TABLE;

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
  // `version` is the geometry record's version inside the payload: what the
  // visitor's 3D was read with. Selected as its own column so staleness can
  // compare it without downloading the whole record.
  const { data, error } = await c.sb.from(TABLE)
    .select('floor_id, look, source_key, published_at, updated_at, version:payload->geometry->>version, poster:payload->>poster')
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
    .join('~') + (typeof payload?.below === 'boolean' ? `~below:${payload.below ? 1 : 0}` : '')
    // The openings join the same way: only once decided, so nothing published
    // before the Windows panel existed turns stale on the day it shipped.
    + (payload?.openings?.items?.length
      ? '~openings:' + payload.openings.items.map((o) => `${o.id}=${o.kind}`).join(',')
      : '')
    // The stair markers likewise: a marker moved, turned or switched changes
    // what the 3D stands up, so the published home is behind. Only once a
    // floor has any, so nothing published before turns stale today.
    + (payload?.staircases?.length
      ? '~stairs:' + payload.staircases.map((s) => `${s.id}|${s.direction}|${s.heading}|${s.kind || ''}|${s.printed === false ? 0 : 1}|${s.position.x.toFixed(4)}|${s.position.y.toFixed(4)}`).join(',')
      : '')
    // The builder's mark on the chip: a renamed company or a new website is
    // a change the buyer's page shows. Only once a brand travels.
    + (payload?.brand ? `~brand:${payload.brand.name}|${payload.brand.website || ''}` : '');
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
    // THE 3D IS PART OF WHAT WAS PUBLISHED. A record read with an older
    // geometry (its `version` behind GEOMETRY_VERSION) shows the visitor what
    // the reader could see then -- a v22 record has one door in six missing
    // -- and nothing on this machine changed to say so. Unknown stays "no
    // news", as the signature rule above; a number behind is a newer version
    // ready.
    if (row.version != null && Number(row.version) < GEOMETRY_VERSION) { out.push(r.floorId); continue; }
    // THE POSTER IS PART OF WHAT WAS PUBLISHED TOO (2026-09-20): a floor
    // published before it existed shows a builder's website the plan with
    // the button where every newer floor shows the model. One publish fixes
    // it for good, so unlike an unknown signature this is news worth giving.
    if (row.poster !== 'true') { out.push(r.floorId); continue; }
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

/** This floor's labels and stair markers, in the published render's own frame. */
async function inRenderFrame(row, renderBlob) {
  const scope = scopeFor(row.projectId, row.floorId);
  const stairs = row.payload.staircases || [];
  const wireBlob = await getArtifact(scope, 'wireframe');
  if (!wireBlob) return { labels: row.payload.labels, staircases: stairs };    // nothing to map from; send as stored
  const [wire, render] = await Promise.all([imageFrom(wireBlob), imageFrom(renderBlob)]);
  return { labels: labelsOnRender(row.payload.labels, wire, render), staircases: stairsOnRender(stairs, wire, render) };
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
export async function readingOf(renderBlob, labels, decisions = null) {
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
    //
    // THE SAME CALL view3d MAKES (readPlan): the width, the trace at that
    // width, and the openings read between THAT trace's walls. This used to
    // read them between `first`'s -- the trace at the default width, which
    // seals small rooms and drops thin walls (The Star's closet corner became
    // one thick block, and a 12.9ft "opening" was read down from it) -- and
    // hand a visitor windows cut in walls the record does not contain.
    const reading = readPlan({
      plan: planInkOf(img), first, labels, assumedWidthFt: DEFAULT_WIDTH_FT,
      retrace: (widthFt) => extrudeWalls(img, widthFt, { floor: false }),
    });
    const record = publishableGeometry(reading.ex);
    // THE OPENINGS TRAVEL WITH THE WALLS, in the render's pixels like the
    // labels, so a visitor's page frames the same windows and shutters the
    // same garage doors the builder's does, without reading the picture. The
    // builder's page maps them the same way (view3d, the fromPublished branch).
    // ...WITH THE BUILDER'S DECISIONS APPLIED, so the visitor sees the windows
    // the builder confirmed on their own 3D page, not the reader's draft.
    const { w, h } = reading.plan;
    const openings = publishableOpenings(applyDecisions(reading.read.openings, decisions, w, h).openings);
    // THE GAPS TOO (v36): every gap between collinear wall ends, whatever it
    // was read as. With them sealed the sheet can be flooded from its border
    // to tell a porch from a room (stairs.js outsideOf), which is how a
    // visitor's page stands a deck's steps as steps and a hall's as a well.
    // Rounded to the pixel; a few dozen small rectangles.
    const gaps = (reading.plan?.gaps || []).map((g) => ({ x0: Math.round(g.x0), y0: Math.round(g.y0), x1: Math.round(g.x1), y1: Math.round(g.y1) }));
    return record ? { ...record, openings, gaps } : null;
  } catch {
    return null;
  }
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
 * THE POSTER IS CAPTURED BY THE 3D PAGE, not here. A still of the model that
 * matches what a visitor sees after the click can only come from the page
 * that draws it -- its camera, its label layout, its openings -- so the page
 * hands in `poster(row, {width, height})`: it opens itself in a hidden frame
 * on that floor in this look and posts back one picture per shape in
 * POSTER_SHAPES -- the render's own, and a squarer one for the frames a
 * phone or a host makes squarer (view3d.html, `?poster=WxH,WxH`). Captured
 * BEFORE the row is written,
 * so the row can say whether it has one (`payload.poster`) and the reader
 * (published-read.js) never asks for a poster that is not there. A poster
 * that fails is a floor without one, never a floor that failed to publish:
 * the preview is not the product.
 *
 * @param {Array} rows what `homePayload().ready` returned
 * @param {{poster?: (row: object, size: {width: number, height: number}) => Promise<Array<Blob|null>|null>}} [opts]
 *   the pictures in POSTER_SHAPES' order; a missing one is a shape that did not draw
 * @returns {Promise<{published: number, failed: Array<{name: string, why: string}>, noPoster: string[]}>}
 *   `noPoster` names the floors that published without a fresh preview
 */
export async function publishFloors(rows, opts = {}) {
  const c = await ctx();
  if (!c) return { published: 0, failed: [{ name: 'Sign in', why: 'you are signed out' }] };

  let published = 0;
  const failed = [];
  const noPoster = [];
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
    const { labels: mapped, staircases } = await inRenderFrame(r, blob);
    let stills = null, posterAspect = null;
    if (opts.poster) {
      const img = await imageFrom(blob);
      stills = img ? await opts.poster(r, { width: img.naturalWidth, height: img.naturalHeight }).catch(() => null) : null;
      if (!stills?.[0]) { stills = null; noPoster.push(r.floorName); console.warn(`poster: none captured for ${r.floorName}`); }
      else posterAspect = img.naturalWidth / img.naturalHeight;
    }
    // A POSTER THAT DID NOT DRAW KEEPS THE ONE THAT DID. The row is rewritten
    // whole, so a failed capture used to write `poster: false` over a floor
    // whose previous poster was still in the bucket, and the builder's
    // website went from the model to the plan for no reason they were told
    // (The Sky, 2026-09-21). The previous row's answer stands until a new
    // picture replaces it; the caller is told (noPoster).
    let prior = { poster: false, posterAspect: null };
    if (!stills) {
      const { data } = await c.sb.from(TABLE).select('poster:payload->poster, aspect:payload->posterAspect').eq('floor_id', r.floorId).maybeSingle();
      if (data?.poster === true) prior = { poster: true, posterAspect: typeof data.aspect === 'number' ? data.aspect : null };
    }
    const payload = {
      ...r.payload,
      labels: mapped,
      ...(staircases.length ? { staircases } : {}),
      geometry: await readingOf(blob, mapped, r.payload?.openings || null),
      // True when the render-shaped poster exists, with its proportions, so
      // the poster page can choose between it and the squarer one by the
      // frame it finds itself in without downloading either first.
      poster: stills ? true : prior.poster,
      posterAspect: stills ? posterAspect : prior.posterAspect,
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
    for (const [i, shape] of POSTER_SHAPES.entries()) {
      const still = stills?.[i];
      if (!still) continue;
      // The same WebP-first rule as the render, and the same fallback. An
      // upload that fails leaves a row that says "poster" over an object that
      // is not there; the reader treats a poster it cannot fetch as none and
      // shows the plan, so this is a warning and not a failed floor.
      const p = await forTheWire(still);
      const pu = await c.sb.storage.from(PUBLISHED_BUCKET)
        .upload(posterPath(r.floorId, p.ext, shape), p.blob, { upsert: true, contentType: p.type });
      if (pu.error) console.warn(`poster: upload failed for ${r.floorName}: ${pu.error.message}`);
    }
    published++;
  }
  return { published, failed, noPoster };
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
    .remove(floors.flatMap((f) => ['webp', 'png'].flatMap((x) => [renderPath(f.floorId, f.look, x), ...POSTER_SHAPES.map((sh) => posterPath(f.floorId, x, sh))])))
    .catch(() => {});   // housekeeping; access is revoked by the row going

  const { data, error } = await c.sb.from(TABLE)
    .delete().in('floor_id', floors.map((f) => f.floorId)).select('floor_id');
  if (error) return { withdrawn: 0, error: error.message };
  return { withdrawn: data?.length || 0, error: null };
}
