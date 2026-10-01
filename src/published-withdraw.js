// TAKING A PUBLISHED FLOOR DOWN, on its own so a page that deletes floors
// (projects.html) can do it without loading cloud-publish.js and the 3D reader
// it carries. cloud-publish.js re-exports `withdrawFloors`, so the 3D page's
// "Stop sharing" is this same code.

import { getSupabase } from './supabase-client.js';
import { PUBLISHED_BUCKET, PUBLISHED_TABLE, renderPath, posterPath, POSTER_SHAPES } from './published-paths.js';

async function ctx() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user ? { sb, uid: data.user.id } : null;
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

/**
 * Which of these floors are published, with their look, so a deletion can take
 * them down first.
 *
 * @param {string[]} floorIds
 * @returns {Promise<{signedIn: boolean, floors: Array<{floorId: string, look: string}>|null, error: string|null}>}
 *   `floors` null when the account could not be asked
 */
export async function publishedAmong(floorIds) {
  const c = await ctx();
  if (!c) return { signedIn: false, floors: [], error: null };
  if (!floorIds.length) return { signedIn: true, floors: [], error: null };
  const { data, error } = await c.sb.from(PUBLISHED_TABLE).select('floor_id, look').in('floor_id', floorIds);
  if (error) return { signedIn: true, floors: null, error: error.message };
  return { signedIn: true, floors: (data || []).map((r) => ({ floorId: r.floor_id, look: r.look })), error: null };
}
