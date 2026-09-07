// Mirror plan images into Supabase Storage, and fetch them back on a miss.
//
// Same shape as the record sync: IndexedDB stays the WORKING copy and the
// bucket is a durable mirror. Nothing on the hot path waits for the network —
// Studio composes from the local blob, and an upload that fails leaves the app
// exactly as it was.
//
// WHY IMAGES CAME SECOND. Records are small and irreplaceable; a render can be
// bought again for a credit, a sign-off cannot be reconstructed at any price.
// So records went up first and this closes the remaining gap: a cleared browser
// currently loses the renders and keeps everything else.
//
// THE PATH IS THE ACCESS RULE. `<user-id>/<scope>/<kind>`, so Storage's policies
// answer "may this person touch this object" by comparing the first path segment
// to auth.uid() — see supabase/storage.sql. It also means an object cannot be
// written under someone else's prefix even if this file had a bug.

import { getSupabase } from './supabase-client.js';
import { KINDS } from './artifacts.js';

const BUCKET = 'plans';

/**
 * EVERY KIND A FLOOR HAS, taken from the list itself rather than restated.
 *
 * This was a hand-written five: `source, wireframe, styled, styled-key,
 * extraction`. It was written when there was ONE `styled` slot, and when that
 * slot was split into `styled-light` / `styled-dark` (plus their keys) this
 * list was not touched. So for every render made since the split there was NO
 * CLOUD COPY AT ALL — the mirror silently covered the legacy kind and nothing
 * the app actually writes.
 *
 * That is what made signing out destroy paid work: the local copies went, and
 * there was nothing on the server to come back from. Saman lost renders that
 * way and had to pay to make them again.
 *
 * Derived from KINDS so the two cannot drift again: a kind added to the store
 * is mirrored the day it exists, without anyone remembering this file.
 * `artifacts.js` reaches this module only through a dynamic import inside a
 * function, so importing it back here is not a cycle at load time.
 */
const SYNCED = KINDS;

async function ctx() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user ? { sb, uid: data.user.id } : null;
}

const pathFor = (uid, scope, kind) => `${uid}/${scope}/${kind}`;

/**
 * Send one artifact up. Never throws: a failed upload must not fail the render
 * that produced it, and the local copy is already safe.
 * @returns {Promise<boolean>} whether it landed
 */
export async function uploadArtifact(scope, kind, blob) {
  const c = await ctx();
  if (!c || !blob) return false;
  const { error } = await c.sb.storage.from(BUCKET)
    .upload(pathFor(c.uid, scope, kind), blob, {
      upsert: true,
      contentType: blob.type || 'application/octet-stream',
    });
  if (error) { console.warn(`upload ${kind} failed:`, error.message); return false; }
  return true;
}

/** Fetch one artifact down, or null when the account or the object is absent. */
export async function downloadArtifact(scope, kind) {
  const c = await ctx();
  if (!c) return null;
  const { data, error } = await c.sb.storage.from(BUCKET)
    .download(pathFor(c.uid, scope, kind));
  if (error) return null;          // a miss is ordinary, not a fault
  return data;
}

/** Drop a whole floor's images, so deleting a project does not leave bytes behind. */
export async function removeScope(scope) {
  const c = await ctx();
  if (!c) return;
  const paths = SYNCED.map((k) => pathFor(c.uid, scope, k));
  const { error } = await c.sb.storage.from(BUCKET).remove(paths);
  if (error) console.warn('remove failed:', error.message);
}

/**
 * Push every local artifact for the given scopes that the bucket does not have.
 *
 * Deliberately NOT a diff by content — comparing 2MB blobs to decide whether to
 * send 2MB is not a saving. It lists what is already there and sends the rest,
 * so a re-run after a partial upload finishes the job instead of repeating it.
 *
 * @param {Array<string>} scopes
 * @param {(done:number, total:number)=>void} [onProgress]
 */
export async function pushScopes(scopes, onProgress = () => {}) {
  const c = await ctx();
  if (!c) return { uploaded: 0, skipped: 0 };
  const { getArtifact } = await import('./artifacts.js');

  let uploaded = 0, skipped = 0, done = 0;
  const jobs = [];
  for (const scope of scopes) {
    const { data } = await c.sb.storage.from(BUCKET).list(`${c.uid}/${scope}`);
    const there = new Set((data || []).map((o) => o.name));
    for (const kind of SYNCED) {
      if (there.has(kind)) { skipped++; continue; }
      jobs.push({ scope, kind });
    }
  }
  for (const { scope, kind } of jobs) {
    const blob = await getArtifact(scope, kind);
    if (blob && await uploadArtifact(scope, kind, blob)) uploaded++;
    onProgress(++done, jobs.length);
  }
  return { uploaded, skipped };
}

/**
 * Fill IndexedDB from the bucket for one floor, for whatever is missing.
 *
 * This is the half that makes a cleared browser recoverable: the record sync
 * brings the floor back, and this brings its pictures back with it.
 * @returns {Promise<number>} how many were restored
 */
export async function pullScope(scope) {
  const c = await ctx();
  if (!c) return 0;
  const { getArtifact, putLocalArtifact } = await import('./artifacts.js');

  // ASK ONCE WHAT IS THERE, rather than a download per kind.
  //
  // This tried every kind in turn and took a failed round trip for each one the
  // floor does not have — and most floors have about half of them. Listing the
  // folder is a single request that answers for all of them, which is what
  // `pushScopes` already does in the other direction. It matters more now that
  // SYNCED covers every kind instead of five: the old shape would have doubled
  // the waiting, which is exactly the slow thumbnails Saman saw.
  const { data, error } = await c.sb.storage.from(BUCKET).list(`${c.uid}/${scope}`);
  if (error || !data?.length) return 0;
  const there = new Set(data.map((o) => o.name));

  let restored = 0;
  for (const kind of SYNCED) {
    if (!there.has(kind)) continue;
    if (await getArtifact(scope, kind)) continue;   // local copy wins
    const blob = await downloadArtifact(scope, kind);
    if (!blob) continue;
    // LOCAL WRITE ONLY. `putArtifact` mirrors what it stores back to the
    // bucket, so restoring a floor used to re-upload every byte it had just
    // downloaded — to the same path it came from.
    await putLocalArtifact(scope, kind, blob);
    restored++;
  }
  return restored;
}
