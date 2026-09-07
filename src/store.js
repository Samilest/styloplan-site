// Client-side store for brand kits + projects (localStorage). Schema mirrors
// the future Supabase tables. Per the handoff schema requirement: each floor's
// `verified` sub-object is a SELF-CONTAINED asset (labels, stairs, specs,
// extraction, sign-off) so a confirmed floor can later be promoted to a
// reusable "verified model" without restructuring.
//
// One project = one home model = N floors, sharing one brand kit + palette.

import { PRESETS } from './palettes.js';
import { EMPTY_HOUSE_STYLE } from './house-style.js';
import { snapshotOf, pushVersion } from './versions.js';

// The `pr.` prefix is from the old name and DELIBERATELY STAYS. localStorage is
// addressed by key: rename these and every existing customer opens the app to
// an empty account, their projects and brand kits still on disk and unreachable.
// No user ever sees these strings. See DB_NAME in artifacts.js, same reasoning.
// `deleted` is the newest key, and the only one that records something that is
// NOT there. See noteDeleted.
const K = {
  kits: 'pr.brandkits', projects: 'pr.projects', active: 'pr.active',
  deleted: 'pr.deleted',
};

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const save = (key, v) => localStorage.setItem(key, JSON.stringify(v));
const uid = () => Math.random().toString(36).slice(2, 10);

// Every write is stamped, because the cloud merge decides who wins by this
// field and an unstamped record is treated as the OLDEST there. Without a stamp
// a project edited here would lose to a stale copy on the server on every
// sign-in — the one outcome the merge exists to prevent. See src/cloud-store.js.
const stamp = (rec) => ({ ...rec, updatedAt: new Date().toISOString() });

/**
 * First-run state.
 *
 * Seeds a brand kit and NOTHING ELSE. A default settings row is ordinary; a
 * fabricated PROJECT is not — the old seed put "The Geena", two floors and a
 * company called Northgate Homes in front of someone who had never used the
 * product, with nothing marking it as a sample. That is the same class of
 * problem the floor-scoped rework already fixed once (a demo plan landing in a
 * customer's project), one level up. Now the list starts genuinely empty and
 * the sample is something the user asks for by name.
 */
export function ensureSeed() {
  if (!load(K.kits, null)) {
    save(K.kits, [{
      id: 'kit-default',
      // Neutral, and obviously theirs to fill in — not an invented company.
      name: 'My brand kit',
      companyName: '',
      tagline: '',
      logoDataUrl: null,          // null → placeholder mark drawn at render time
      font: 'Inter',
      palette: { ...PRESETS[0] },
      // Off by default: Light and Dark are finished looks, and a plan tinted
      // before the builder has chosen a colour would be tinted in ours.
      planTint: { mode: 'off', brand: '#2E6B4F' },
      disclaimerOn: true,
      disclaimerText: null,
      // The builder's own labelling standard. Starts EMPTY on purpose: an
      // unconfigured kit must never silently reword a customer's plan. See
      // src/house-style.js.
      houseStyle: { ...EMPTY_HOUSE_STYLE },
    }]);
  }
  if (!load(K.projects, null)) save(K.projects, []);
  if (!load(K.active, null)) save(K.active, { kitId: 'kit-default', projectId: null });

  // Installs from before the seed was removed still hold the fabricated
  // "proj-geena". Deleting it would throw away work if the user built on it, so
  // label it instead — but only while it is untouched. Once a floor has been
  // confirmed it is that person's asset and gets no badge from us.
  const ps = getProjects();
  const stale = ps.find((p) => p.id === 'proj-geena' && p.isSample === undefined);
  if (stale && !stale.floors.some((f) => f.verified)) {
    stale.isSample = true;
    save(K.projects, ps);
  }
}

/**
 * The sample project, created only when the user asks for it.
 *
 * Flagged `isSample` so the list can say so plainly. Nothing else in the app
 * treats it differently — it is a real project the user can work in or delete,
 * which is the point: a demo you cannot tell from your own work is the problem,
 * a demo that says what it is is a feature.
 */
export function createSampleProject() {
  const kit = getActiveKit();
  const p = {
    id: `proj-${uid()}`,
    name: 'The Geena (sample)',
    brandKitId: kit?.id || 'kit-default',
    isSample: true,
    createdAt: new Date().toISOString(),
    floors: [
      { id: `floor-${uid()}`, name: 'Main Floor', status: 'new', mock: true, verified: null },
      { id: `floor-${uid()}`, name: 'Upper Floor', status: 'new', mock: true, verified: null },
    ],
  };
  return saveProject(p);
}

// ---- brand kits
export const getKits = () => load(K.kits, []);
export function saveKit(kit) {
  const kits = getKits();
  kit = stamp(kit);
  const i = kits.findIndex((k) => k.id === kit.id);
  if (i >= 0) kits[i] = kit; else kits.push({ ...kit, id: kit.id || `kit-${uid()}` });
  save(K.kits, kits);
  scheduleSync();
  return kit;
}
export function deleteKit(id) {
  save(K.kits, getKits().filter((k) => k.id !== id));
  noteDeleted('kits', id);
  scheduleSync();
}
/**
 * A kit's house style, safe for kits saved before the field existed.
 * Always returns a usable object, so callers never branch on its absence.
 */
export function houseStyleOf(kit) {
  return { ...EMPTY_HOUSE_STYLE, ...(kit?.houseStyle || {}) };
}

export function getActiveKit() {
  const kits = getKits();
  return kits.find((k) => k.id === load(K.active, {}).kitId) || kits[0] || null;
}
export function setActiveKit(kitId) {
  save(K.active, { ...load(K.active, {}), kitId });
}

// ---- projects & floors
// Writes reach the cloud shortly after they happen, not on the next sign-in.
//
// This was sign-in only, and the gap was the whole point of the feature: sign
// in, work for an hour, clear the browser, and every project made in that hour
// was gone — while the IMAGES survived, because `putArtifact` uploads on write.
// Measured exactly that way. Records now follow the same rule as images.
//
// Debounced rather than immediate because a rename fires a save per keystroke,
// and the local copy is already safe the instant it is written; this only
// decides how soon the mirror catches up.
const SYNC_DELAY = 2500;
let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncCloud().catch(() => {}); }, SYNC_DELAY);
}

/**
 * Bring the browser and the account into agreement.
 *
 * Runs on sign-in, and shortly after any write. The local copy is the working
 * one — the cloud is a mirror, not the source — so nothing here is on the hot
 * path and a failure leaves the app exactly as it was.
 *
 * Safe to call signed out: `syncAll` returns null and nothing is touched.
 * @returns {Promise<{pushed:number, pulled:number}|null>}
 */
export async function syncCloud() {
  const { syncAll } = await import('./cloud-store.js');
  const out = await syncAll({
    kits: getKits(), projects: getProjects(), deleted: getDeletions(),
  });
  if (!out) return null;
  // Written straight to localStorage rather than through saveKit/saveProject:
  // those stamp `updatedAt`, which would mark everything just pulled as edited
  // here and push it all straight back on the next sync.
  save(K.kits, out.kits);
  save(K.projects, out.projects);
  // The note is kept until the cloud row is actually gone. A delete that failed
  // leaves it in place, so the record stays hidden here and the next sync tries
  // again — rather than the note being dropped and the record walking back in.
  forgetDeletions('projects', out.buried?.projects);
  forgetDeletions('kits', out.buried?.kits);
  forgetDeletions('floors', out.buried?.floors);
  // `errors` travels with the counts because one caller — signing out — has to
  // know whether the work is actually in the account before it removes it from
  // this computer. A push that failed used to look exactly like one that worked.
  return { pushed: out.pushed, pulled: out.pulled, errors: out.errors || [] };
}

/**
 * Bring every floor's pictures back onto this computer from the account.
 *
 * THE OTHER HALF OF SIGNING IN. The record sync restores the projects, the
 * floors and the sign-offs, and until this existed it stopped there: the list
 * came back with every thumbnail reading "no plan yet", and opening a floor
 * showed no render, because the images live in IndexedDB and this browser had
 * none. Only `restoreScope` fetched them, and only when a floor page ran.
 *
 * Cheap when there is nothing to do: `pullScope` skips any kind already held
 * locally, so on the machine the work was done on this walks the list and
 * downloads nothing.
 *
 * Never throws — a browser that could not fetch its pictures still has its
 * records, which is strictly better than the sign-in appearing to fail.
 *
 * @returns {Promise<number>} how many images were brought down
 */
export async function restoreArtifacts() {
  try {
    const { restoreScope, scopeFor } = await import('./artifacts.js');
    let restored = 0;
    for (const p of getProjects()) {
      for (const f of p.floors || []) {
        restored += await restoreScope(scopeFor(p.id, f.id));
      }
    }
    return restored;
  } catch { return 0; }
}

/**
 * Put every local picture the account does not have into the account.
 *
 * THE OTHER HALF OF THE SAME HOLE. `putArtifact` mirrors an image at the moment
 * it is written, so from now on new work is safe — but nothing was ever
 * uploading what already existed. `pushScopes` was written for exactly this and
 * had no caller at all, so every render made before the mirror was fixed was
 * still sitting in one browser only, one cleared cache from gone.
 *
 * It lists what the bucket already holds and sends the rest, so running it on
 * every sync is cheap after the first time and finishes a partial upload rather
 * than repeating it.
 *
 * @returns {Promise<number>} how many images were uploaded
 */
export async function backUpArtifacts() {
  try {
    const { scopeFor } = await import('./artifacts.js');
    const { pushScopes } = await import('./cloud-artifacts.js');
    const scopes = getProjects().flatMap((p) =>
      (p.floors || []).map((f) => scopeFor(p.id, f.id)));
    if (!scopes.length) return 0;
    const { uploaded } = await pushScopes(scopes);
    return uploaded;
  } catch { return 0; }
}

export const getProjects = () => load(K.projects, []);
export function saveProject(p) {
  const ps = getProjects();
  p = stamp(p);
  const i = ps.findIndex((x) => x.id === p.id);
  if (i >= 0) ps[i] = p; else ps.push(p);
  save(K.projects, ps);
  scheduleSync();
  return p;
}
export function createProject(name, brandKitId) {
  const p = {
    id: `proj-${uid()}`, name, brandKitId,
    createdAt: new Date().toISOString(),
    floors: [{ id: `floor-${uid()}`, name: 'Main Floor', status: 'new', mock: true, verified: null }],
  };
  return saveProject(p);
}
export function addFloor(projectId, name) {
  const p = getProjects().find((x) => x.id === projectId);
  if (!p) return null;
  p.floors.push({ id: `floor-${uid()}`, name, status: 'new', mock: true, verified: null });
  saveProject(p);
  return p;
}
/**
 * "Verify once, reuse forever" (handoff Phase-2, highest-priority backlog).
 *
 * Copy a CONFIRMED floor into another project so its plan can be output again —
 * new brand kit, new palette, new format — without uploading or reviewing it a
 * second time. The brand kit is a property of the PROJECT, so producing the same
 * home for a different brand is precisely the operation that needs this.
 *
 * The `verified` asset was designed self-contained for exactly this (the schema
 * requirement in the handoff), so the copy is a clone plus a new artifact scope.
 *
 * What is deliberately NOT inherited:
 *  - `confirmedBy` / `confirmedAt` are RE-STAMPED to the person doing the reuse.
 *    A sign-off is a statement by a named person on a date; carrying the
 *    original forward would put someone's name on a document they did not issue
 *    (red line 7 — the report's headline is that human's claim).
 *  - `styled` and `styled-key` are left behind by the caller, so the new floor
 *    renders against its own palette rather than showing the old one's image.
 *
 * @returns {{project, floor, sourceScope, scope}|null}
 */
export function reuseFloor(srcProjectId, srcFloorId, destProjectId, confirmedBy) {
  const { floor: src } = getFloor(srcProjectId, srcFloorId);
  const dest = getProjects().find((x) => x.id === destProjectId);
  if (!src?.verified || !dest) return null;

  const id = `floor-${uid()}`;
  const scope = `${dest.id}:${id}`;
  const verified = JSON.parse(JSON.stringify(src.verified));
  verified.artifactScope = scope;
  // Keep the ORIGINAL sign-off. The honest record of a reused plan is two
  // statements, not one: a person examined this drawing on some date, and a
  // (possibly different) person put it out again later. Overwriting the first
  // left the report able to claim only the second, which reads as though a
  // fresh review had happened.
  verified.reusedFrom = {
    projectId: srcProjectId,
    floorId: srcFloorId,
    confirmedBy: verified.confirmedBy,
    confirmedAt: verified.confirmedAt,
  };
  verified.confirmedBy = confirmedBy || verified.confirmedBy;
  verified.confirmedAt = new Date().toISOString();

  // A reused floor keeps its own name, but the destination may already have one
  // called that — dropping a second "Main Floor" into a project leaves two rows
  // the user cannot tell apart. Disambiguate rather than silently collide.
  let name = src.name;
  if (dest.floors.some((f) => f.name === name)) {
    let n = 2;
    while (dest.floors.some((f) => f.name === `${src.name} (${n})`)) n++;
    name = `${src.name} (${n})`;
  }
  const floor = { id, name, status: 'confirmed', mock: false, verified };
  dest.floors.push(floor);
  saveProject(dest);
  return { project: dest, floor, sourceScope: src.verified.artifactScope || `${srcProjectId}:${srcFloorId}`, scope };
}

/**
 * Drop a floor. Refuses a floor that has been confirmed: losing a verified
 * asset should take the deliberate act of deleting its project, not a stray
 * click. Returns the artifact scope so the caller can clear its images.
 */
/**
 * Drop a floor.
 *
 * A CONFIRMED floor still refuses by default, and the reason has not changed:
 * losing a verified asset should not be possible by a stray click. What changed
 * is that "delete the whole project" is no longer the only deliberate act
 * available — a caller that has actually asked the person, naming the floor and
 * saying what goes with it, passes `force` and gets to delete one floor.
 *
 * Saman needed this to clear a floor whose plan and renders were destroyed by
 * the old sign-out, which left a confirmed row that could never be completed and
 * could not be removed without taking its project with it.
 *
 * @param {{force?: boolean}} [opts] force: the caller has confirmed with the user
 * @returns {string|null} the artifact scope to clear, or null if nothing was removed
 */
export function removeFloor(projectId, floorId, opts = {}) {
  const p = getProjects().find((x) => x.id === projectId);
  const f = p?.floors.find((x) => x.id === floorId);
  if (!p || !f) return null;
  if (f.verified && !opts.force) return null;
  p.floors = p.floors.filter((x) => x.id !== floorId);
  // A TOMBSTONE, THE SAME AS A DELETED PROJECT GETS.
  //
  // Without one, a removed floor was only ABSENT from the project record, and
  // absence is not a fact the sync can act on: floors are their own table, so
  // the row survived on the server and came back the moment the cloud's copy of
  // the project won the newest-wins merge — which is what happened every time
  // Saman opened Studio and came back. Deleting by INTENT rather than by
  // absence also means a floor another device added is never mistaken for one
  // this device deleted.
  noteDeleted('floors', floorId);
  saveProject(p);
  // The floor's own scope, so the caller can clear its images. Taken from the
  // record when it has one: a reused floor's images live where `reuseFloor` put
  // them, which is this same shape today but is the record's to say.
  return f.verified?.artifactScope || `${projectId}:${floorId}`;
}

// Archiving is not deleting: a finished model stays available and countable,
// it just stops filling the working list. Kept as a flag on the project so no
// data moves and restoring is exact.
export function archiveProject(id, archived = true) {
  const p = getProjects().find((x) => x.id === id);
  if (!p) return null;
  p.archived = archived;
  if (archived) p.collapsed = true;
  return saveProject(p);
}

/** Fold state, persisted so a long list stays the shape the user left it. */
export function setProjectCollapsed(id, collapsed) {
  const p = getProjects().find((x) => x.id === id);
  if (!p) return null;
  p.collapsed = collapsed;
  return saveProject(p);
}

/**
 * Remove a project AND report every artifact scope it owned, so the caller can
 * clear the stored plan images too. Dropping the row alone would leave the
 * customer's uploads sitting in IndexedDB with nothing pointing at them —
 * against the handoff's retention promise (9b) and impossible to clean up later.
 * @returns {string[]} scopes to pass to deleteScope()
 */
/**
 * Take this account's work off this computer, and name the scopes to delete.
 *
 * SIGNING OUT HAS TO MEAN SOMETHING. localStorage is the working copy and the
 * cloud the mirror, which is right for a local-first product and wrong for the
 * one gesture that means "I am done here". On a shared machine — a laptop in a
 * site office is the real case — a builder signed out and their client's room
 * names and dimensions stayed on screen for whoever sat down next. "It never
 * left your browser" is our explanation, not something the person looking at
 * the screen can check.
 *
 * NOTHING IS LOST, and that is a precondition rather than a hope: the caller
 * syncs first and does not call this if the sync fails. For an account holder
 * every local record is mirrored, so signing back in brings all of it back.
 *
 * Brand kits stay. They are the builder's own house style rather than a
 * customer's plan, they carry no client data, and `ensureSeed` would put an
 * empty one back on the next load anyway.
 *
 * @returns {string[]} the artifact scopes whose images the caller must delete —
 *   they live in IndexedDB, which this module does not own.
 */
export function clearLocalWork() {
  const scopes = getProjects().flatMap((p) => p.floors.map((f) => `${p.id}:${f.id}`));
  save(K.projects, []);
  const active = load(K.active, null);
  if (active) save(K.active, { ...active, projectId: null });
  return scopes;
}

/**
 * A DELETION IS WRITTEN DOWN, because the cloud merge keeps any record that
 * exists on one side only — and after a local delete, the cloud copy is exactly
 * that. Saman deleted The Avi, added a floor to another project, and The Avi
 * came back on the next sync. Nothing had gone wrong in the sync; nothing had
 * told it the project was gone.
 *
 * Stamped, so it is weighed like every other record: a deletion beats a cloud
 * copy older than itself and loses to one edited afterwards on another machine.
 */
function noteDeleted(kind, id) {
  const all = load(K.deleted, {});
  all[kind] = { ...(all[kind] || {}), [id]: new Date().toISOString() };
  save(K.deleted, all);
}

/** {projects:{id:when}, kits:{id:when}} — what this machine has deleted. */
export const getDeletions = () => load(K.deleted, {});

/** Called once the cloud row is actually gone, so the note is not kept forever. */
export function forgetDeletions(kind, ids) {
  if (!ids?.length) return;
  const all = load(K.deleted, {});
  if (!all[kind]) return;
  for (const id of ids) delete all[kind][id];
  save(K.deleted, all);
}

export function deleteProject(id) {
  const p = getProjects().find((x) => x.id === id);
  if (!p) return [];
  save(K.projects, getProjects().filter((x) => x.id !== id));
  noteDeleted('projects', id);
  scheduleSync();
  return p.floors.map((f) => `${p.id}:${f.id}`);
}

export function getFloor(projectId, floorId) {
  const p = getProjects().find((x) => x.id === projectId);
  return { project: p, floor: p?.floors.find((f) => f.id === floorId) || null };
}

// Persist a floor's review sign-off. `verified` is the promotable asset:
// { labels, staircases, specs, extraction, registration, artifactScope,
//   confirmedBy, confirmedAt }
// The plan images are NOT inlined here — `artifactScope` points at them in the
// IndexedDB artifact store (src/artifacts.js), which becomes Supabase Storage
// in production. Keeping this row small is what makes a verified floor
// promotable to a reusable "verified model".
/**
 * Persist label geometry set in Studio back onto the floor's verified row.
 *
 * Without this the delivery pack composes from `verified.labels`, which Studio
 * never wrote to — so "Download all" would quietly ship the ORIGINAL positions
 * while the Studio preview showed the corrected ones. Only geometry and the
 * per-render check flag travel: names and dimensions are the transcription and
 * are owned by Review.
 */
export function updateFloorLabelGeometry(projectId, floorId, labels, staircases) {
  const { project, floor } = getFloor(projectId, floorId);
  if (!floor?.verified) return null;
  const by = new Map(labels.map((l) => [l.id, l]));
  floor.verified.labels = floor.verified.labels.map((l) => {
    const src = by.get(l.id);
    // `hidden` travels too. Studio can take a label off the image — a stray
    // PORCH the sheet printed in its margin, a name the builder does not want
    // on the listing — and that is a decision about the DELIVERABLE, so it has
    // to survive a reload like the position and the size do. It is not a
    // decision about the space: the count, the report and Review are untouched,
    // which is why it sets the same flag the house style uses rather than
    // removing anything.
    return src
      ? { ...l, x: src.x, y: src.y, size: src.size, hidden: src.hidden, checkedFor: src.checkedFor }
      : l;
  });
  // STAIR MARKERS MOVE TOO, now that Studio lets them be dragged. Only the
  // position travels: direction, flights and the divider are the reviewer's
  // sign-off and are owned by Review, exactly as names and dimensions are.
  if (staircases) {
    const st = new Map(staircases.map((x) => [x.id, x]));
    floor.verified.staircases = (floor.verified.staircases || []).map((x) => {
      const src = st.get(x.id);
      return src?.position ? { ...x, position: { ...src.position } } : x;
    });
  }
  saveProject(project);
  return floor;
}

/**
 * Persist the areas the user erased from the styled render.
 *
 * Kept on `verified` beside the labels so the delivery pack renders the same
 * corrected image the user approved in Studio — the geometry write-back had to
 * be added for exactly this reason, and a patch that lived only in the preview
 * would reproduce that bug.
 */
export function updateFloorPatches(projectId, floorId, patches) {
  const { project, floor } = getFloor(projectId, floorId);
  if (!floor?.verified) return null;
  floor.verified.patches = patches.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  saveProject(project);
  return floor;
}

/**
 * The plan title the customer typed in Studio, kept on the floor so the 3D view
 * and any later visit read the same words. Stored empty rather than as the
 * default string: a blank field means "use the default", and writing the
 * default in would freeze it, so renaming the project would stop reaching a
 * title the customer never actually chose. See planTitleOf.
 */
export function setFloorTitle(projectId, floorId, title) {
  const { project, floor } = getFloor(projectId, floorId);
  if (!floor) return null;
  const next = (title || '').trim();
  if ((floor.planTitle || '') === next) return floor;
  floor.planTitle = next;
  saveProject(project);
  return floor;
}

/**
 * Which look's render this floor's 3D geometry is read from, remembered.
 *
 * WHY A FLOOR REMEMBERS THIS. `view3d.html` traces every render a floor has and
 * keeps the tidiest reading, which is a good rule with one bad property: it is
 * decided again on every load, over whatever renders exist at that moment. So
 * rendering the second look can hand the contest to a different image and
 * rebuild a building the customer has already seen — measured on one plan, 102
 * rectangles and a 52.88 ft plan becoming 72 and 52.18 ft. Same floor, same
 * look, a different model than yesterday.
 *
 * Pinning the LOOK rather than the reading is deliberate. A stored reading needs
 * a version-and-dimensions guard to say whether it still describes the picture;
 * a stored look needs nothing, because the same image through the same code is
 * the same building — and when the extruder improves, every floor improves with
 * it instead of holding an old answer until something invalidates it.
 *
 * See docs/turning-point-2026-09-06-geometry-pin.md, including the cost this
 * accepts on purpose: a floor pinned to a poorer render stays pinned to it.
 *
 * @param {string} look 'dark' or 'light'
 */
export function setFloorGeoLook(projectId, floorId, look) {
  const { project, floor } = getFloor(projectId, floorId);
  if (!floor) return null;
  const next = look === 'light' ? 'light' : 'dark';
  if (floor.geoLook === next) return floor;
  floor.geoLook = next;
  saveProject(project);
  return floor;
}

export function setFloorVerified(projectId, floorId, verified) {
  const { project, floor } = getFloor(projectId, floorId);
  if (!floor) return null;
  floor.verified = verified;
  floor.status = 'confirmed';
  // A record of what was approved each time, so a builder returning to a plan
  // can be told what changed since the version they signed off before. Only the
  // comparable fields are kept, and a re-confirmation that changed nothing adds
  // no entry (see pushVersion).
  floor.versions = pushVersion(floor.versions, snapshotOf(verified));
  saveProject(project);
  return floor;
}
