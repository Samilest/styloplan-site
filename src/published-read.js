// Reading a published home — the visitor's side of publishing.
//
// Everything else in this app reads the plan out of the browser it is running
// in. A buyer on a builder's website has never opened StyloPlan, so their
// browser holds nothing, and that is the whole reason the embed did not work on
// a real site. This is the other end of `cloud-publish.js`: no session, no
// account, one project id out of the URL the builder pasted.
//
// IT RETURNS THE SHAPE THE PAGE ALREADY READS. `readFloorContext()` gives
// `{project, floor, scope}` with the floor carrying its confirmed labels; so
// does this. The 3D page then has ONE model builder, ONE label layout and ONE
// floor picker with a different source behind them — not a second renderer for
// visitors, which is the drift fault this project keeps finding in itself.
//
// LOCAL FIRST, PUBLISHED SECOND, always. A builder looking at their own work
// keeps seeing their latest, offline, exactly as before; only a reader with
// nothing falls through to here. See docs/design-brief-embed-publishing.md.

import { getSupabase } from './supabase-client.js';
import { scopeFor } from './artifacts.js';
import { PUBLISHED_BUCKET, renderPath, posterPath, POSTER_SHAPES } from './published-paths.js';

/**
 * A published home, shaped like a local floor context.
 *
 * @param {string} projectId  from the embed URL
 * @param {string} floorId    which floor of it to show
 * @returns {Promise<null|{
 *   ctx: {project: object, floor: object, scope: string},
 *   look: 'light'|'dark',
 *   renderUrl: (look: string) => Promise<string|null>,
 * }>} null when nothing is published under that id — including when this
 *   deployment has no Supabase at all, which is not an error.
 */
export async function readPublishedHome(projectId, floorId) {
  if (!projectId || !floorId) return null;
  const sb = await getSupabase();
  if (!sb) return null;

  // No session is used and none is needed: `published_home` is granted to anon
  // and returns one project's rows. There is no listing — a reader must know
  // the id, and the id is in the code the builder pasted.
  const { data, error } = await sb.rpc('published_home', { p_project: projectId });
  if (error) { console.warn('published home:', error.message); return null; }
  const rows = data || [];
  const here = rows.find((r) => r.floor_id === floorId);
  if (!here) return null;

  // THE FLOORS ARE THE PUBLISHED ONES, in the builder's own order. A floor they
  // did not publish is simply not there — the same rule the embed's picker
  // already follows for an unrendered floor, and for the same reason: a visitor
  // is not the person who could do anything about it.
  const floors = rows.map((r) => ({
    id: r.floor_id,
    name: r.floor_name,
    // The builder's own words for this floor, saved at publish time.
    // `planTitleOf` reads the floor's saved title first, so the caption over
    // the model is the same string Studio prints on the sheet — by
    // construction, not by a second rule agreeing with the first.
    planTitle: r.plan_title,
    // The page reads labels off `verified`, because that is where a signed-off
    // record keeps them. Published rows carry only what a buyer's page draws --
    // and the floor level, which the 3D view reads from the same place it
    // does for the builder (`specs.below`, answered in Review).
    verified: {
      labels: r.payload?.labels || [],
      // The stair markers, mapped onto the render at publish, so the 3D can
      // stand the stairs up and print UP/DN as the builder's page does.
      staircases: r.payload?.staircases || [],
      specs: { below: typeof r.payload?.below === 'boolean' ? r.payload.below : null },
      // The builder's decisions about the openings travel too, for the one
      // case the published reading is refused (a record from before the
      // openings travelled, MIN_SHIPPED_VERSION) and the visitor's page reads
      // the picture itself: it then applies the same decisions the builder's
      // page does, from the same place.
      openings: r.payload?.openings || null,
    },
    // The builder's mark for the chip in the corner (publish.js brandOf):
    // the company name and, when set, the website it opens.
    brand: r.payload?.brand && r.payload.brand.name ? { name: String(r.payload.brand.name), website: r.payload.brand.website ? String(r.payload.brand.website) : '' } : null,
  }));

  // DOWNLOADED ONCE PER PAGE. The 3D page asks for the render more than once —
  // the tracer reads it to build the walls, and the floor picture asks again —
  // and each ask was a fresh trip to Supabase for the same megabyte, over a
  // visitor's phone connection. One promise, reused. A failure is NOT kept, so
  // a flaky connection can still succeed on the next try.
  let pending = null;
  const pendingPoster = new Map();
  // WebP first, PNG second, for the render and the poster alike (see
  // published-paths.js). A blob: URL, for the reason below; null when the
  // object is not there.
  async function fetchObject(pathFor, what) {
    let blob = null, e = null;
    for (const ext of ['webp', 'png']) {
      const got = await sb.storage.from(PUBLISHED_BUCKET).download(pathFor(ext));
      if (got.data) { blob = got.data; e = null; break; }
      e = got.error;
    }
    if (e) { console.warn(`published ${what}:`, e.message); return null; }
    return blob ? URL.createObjectURL(blob) : null;
  }
  // A LINK, NOT THE BYTES, for the poster: the still is only ever shown, so
  // the taint that rules the render out of an <img> (below) does not apply,
  // and a signed link is a NEW URL every time -- which is what gets past
  // the storage edge cache. A republished poster lands at the same path,
  // and download() of that path kept handing anyone who had fetched the
  // old one the old one for up to an hour (measured, supabase/publish-test;
  // Saman saw his republished poster not change). Signing a missing object
  // is an error, not a link, so the fallback order still holds.
  async function signedUrl(pathFor, what) {
    let e = null;
    for (const ext of ['webp', 'png']) {
      const got = await sb.storage.from(PUBLISHED_BUCKET).createSignedUrl(pathFor(ext), 3600);
      if (got.data?.signedUrl) return got.data.signedUrl;
      e = got.error;
    }
    if (e) console.warn(`published ${what}:`, e.message);
    return null;
  }
  async function fetchRender() {
    // THE BYTES, NOT A LINK TO THEM — and this is not a preference.
    //
    // The 3D model is TRACED from the render: the pipeline draws it to a canvas
    // and reads it back with getImageData. An <img> pointed at another origin
    // taints that canvas, and every read throws SecurityError. The first
    // version of this returned the signed URL and a visitor got no model at all
    // — the whole point of the step, failing for exactly the person it was
    // written for. A blob: URL is same-origin, so the tracer reads it the way
    // it reads a local render. Same download either way; only the taint differs.
    // WEBP FIRST, PNG SECOND. Publishing writes WebP now; floors published
    // before that are PNG objects at the old key and nothing migrates them, so
    // asking for one extension only would blank a link that has been on a
    // builder's website for weeks. Two round trips in the old case, one in the
    // new, and the new case is the one that repeats.
    return fetchObject((ext) => renderPath(floorId, here.look, ext), 'render');
  }

  return {
    ctx: {
      // No project NAME: nothing published carries one, and a visitor has no
      // reader for it. The title comes off the floor, where the builder saved
      // it. Inventing a project name here would put a guess on their website.
      project: { id: projectId, floors },
      floor: floors.find((f) => f.id === floorId),
      scope: scopeFor(projectId, floorId),
    },
    look: here.look,
    // THE PLAN, ALREADY READ — see `readingOf` in cloud-publish.js. Null on a
    // floor published before this existed, and the caller then traces the render
    // itself exactly as it always did. Passed through untouched: `extrudeWalls`
    // is the one place that decides whether a record is usable, because it is
    // the only place that knows what it would have produced instead.
    geometry: here.payload?.geometry || null,
    renderUrl: (look) => {
      // ONE LOOK PER PUBLISHED HOME. Asking for the other one is not an error
      // to report, it is a picture that does not exist — the caller falls back
      // to the published look, which is the builder's choice anyway.
      if (look !== here.look) return Promise.resolve(null);
      pending ||= fetchRender().catch((err) => { pending = null; throw err; });
      return pending;
    },
    // THE STILL OF THE MODEL, for the poster page (embed.html): captured by
    // the builder's 3D page at publish, in this look, in each of
    // POSTER_SHAPES. The row says whether there is one, so a floor published
    // before posters existed is not asked for; a shape the bucket cannot
    // hand over is none (a floor published before the second shape existed
    // has only the first), and the caller falls back -- to the other shape,
    // then to the plan.
    poster: here.payload?.poster === true,
    posterAspect: typeof here.payload?.posterAspect === 'number' && here.payload.posterAspect > 0 ? here.payload.posterAspect : null,
    posterUrl: (shape = '') => {
      if (here.payload?.poster !== true || !POSTER_SHAPES.includes(shape)) return Promise.resolve(null);
      if (!pendingPoster.has(shape)) {
        pendingPoster.set(shape, signedUrl((ext) => posterPath(floorId, ext, shape), 'poster')
          .catch(() => { pendingPoster.delete(shape); return null; }));
      }
      return pendingPoster.get(shape);
    },
  };
}
