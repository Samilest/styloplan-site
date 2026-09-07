// Artifact store — the plan images themselves (source, wireframe, styled).
//
// These used to travel between pages inside sessionStorage as base64 data URLs.
// That was fragile and, worse, they were never persisted at all: a confirmed
// floor kept only its labels and numbers, so the Projects page had no real plan
// to compose and fell back to a mock render. IndexedDB stores Blobs natively,
// has no ~5MB ceiling, and survives navigation — so the delivery pack can be
// built from the customer's actual render.
//
// Keys are `${scope}::${kind}` where scope is either 'draft' (an upload not yet
// attached to a project floor) or `${projectId}:${floorId}`. In production this
// module is the seam that becomes Supabase Storage: same four calls, remote
// bucket behind them.

// DELIBERATELY NOT RENAMED when the product became StyloPlan. An IndexedDB
// database is addressed BY NAME: change this and the browser opens a new, empty
// one, and every plan image, wireframe and render already stored is still on
// disk but unreachable. Nobody sees this string. Renaming it would be a data
// loss with no upside, and it would look like a bug rather than a rename.
const DB_NAME = 'plan-restyler';
const STORE = 'artifacts';
const VERSION = 1;

export const DRAFT = 'draft';
// 'styled-key' is a few bytes of text, not an image: the palette signature the
// stored styled render was produced from. Studio compares it before spending a
// credit, so revisiting a floor at the same palette is free. It lives in KINDS
// so it moves and is deleted with the images it describes.
// 'extraction' is the L1 JSON, stored next to the images so a floor is
// SELF-CONTAINED. It used to live only in sessionStorage, which meant opening a
// floor's link in a new tab found the images but not the reading of them, and
// the only recovery was to pay for the extraction again.
export const KINDS = [
  'source', 'wireframe', 'extraction',
  // PER-THEME RENDERS, and the reason is money.
  //
  // There used to be ONE `styled` slot. Rendering the second theme overwrote
  // the first, so a customer who paid a credit for the dark render, tried
  // light, and went back to dark found the cache empty and was CHARGED AGAIN
  // for a render they already owned — silently. Keeping them apart makes
  // switching between two paid looks free, the way changing colours already is.
  //
  // It also gives the 3D view a floor image that matches its own theme: a dark
  // model standing on a light plan was the only thing on offer before.
  'styled-light', 'styled-dark',
  'styled-light-key', 'styled-dark-key',
  // Legacy single-slot render. Read-only now: projects styled before the split
  // still open, and are treated as belonging to whichever theme their stored
  // key names.
  'styled', 'styled-key',
];

/** Which artifact holds the render for a theme. */
export const styledKind = (theme) => (theme === 'light' ? 'styled-light' : 'styled-dark');
export const styledKeyKind = (theme) => `${styledKind(theme)}-key`;

export const scopeFor = (projectId, floorId) =>
  projectId && floorId ? `${projectId}:${floorId}` : DRAFT;
const keyFor = (scope, kind) => `${scope}::${kind}`;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result ?? null);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/**
 * Store an image in THIS BROWSER and tell the account nothing.
 *
 * The one caller is the restore: a floor's pictures coming DOWN from the bucket
 * must not be sent straight back up to the path they were just read from.
 * Everything a person actually makes goes through `putArtifact`, which mirrors.
 *
 * @param {Blob|string} data  a Blob, or a data: URL to convert
 */
export async function putLocalArtifact(scope, kind, data) {
  const blob = typeof data === 'string' ? await dataUrlToBlob(data) : data;
  await tx('readwrite', (s) => s.put(blob, keyFor(scope, kind)));
  return blob;
}

/** @param {Blob|string} data  a Blob, or a data: URL to convert */
export async function putArtifact(scope, kind, data) {
  const blob = await putLocalArtifact(scope, kind, data);
  // Mirrored to Storage, and deliberately NOT awaited. The local copy is the
  // working one and is already saved; making the caller wait would put a
  // 2 MB upload in front of the preview that just finished rendering. A failed
  // upload leaves the app exactly as it was, and `pushScopes` picks it up later.
  import('./cloud-artifacts.js')
    .then((c) => c.uploadArtifact(scope, kind, blob))
    .catch(() => {});
  return blob;
}

export function getArtifact(scope, kind) {
  return tx('readonly', (s) => s.get(keyFor(scope, kind)));
}

/** Object URL for a stored artifact, or null. Caller may revoke; page unload does too. */
export async function getArtifactUrl(scope, kind) {
  const blob = await getArtifact(scope, kind);
  return blob ? URL.createObjectURL(blob) : null;
}

export async function hasArtifact(scope, kind) {
  return Boolean(await getArtifact(scope, kind));
}

/** Attach a draft upload to a floor once the reviewer confirms it. */
/**
 * Duplicate every stored image from one scope to another, leaving the original
 * in place. This is what "verify once, reuse forever" runs on: the source floor
 * must keep working after its plan has been reused elsewhere.
 * @returns {Promise<number>} how many images were copied
 */
export async function copyScope(fromScope, toScope) {
  if (fromScope === toScope) return 0;
  let copied = 0;
  for (const kind of KINDS) {
    const blob = await getArtifact(fromScope, kind);
    if (!blob) continue;
    await putArtifact(toScope, kind, blob);
    copied++;
  }
  return copied;
}

export async function moveScope(fromScope, toScope) {
  if (fromScope === toScope) return 0;
  let moved = 0;
  for (const kind of KINDS) {
    const blob = await getArtifact(fromScope, kind);
    if (!blob) continue;
    await putArtifact(toScope, kind, blob);
    await tx('readwrite', (s) => s.delete(keyFor(fromScope, kind)));
    moved++;
  }
  return moved;
}

/** Drop ONE stored image, leaving the rest of its scope alone. */
export async function deleteArtifact(scope, kind) {
  await tx('readwrite', (s) => s.delete(keyFor(scope, kind)));
}

/** Retention / "delete immediately after export" (handoff 9b). */
export async function deleteScope(scope) {
  for (const kind of KINDS) {
    await tx('readwrite', (s) => s.delete(keyFor(scope, kind)));
  }
  // Rejected renders are not in KINDS, so the loop above cannot see them and
  // they would sit in this browser forever after the floor was deleted.
  await clearRejects(scope);
  // Deleting locally and leaving the bytes on the server would make the
  // retention promise false, and the next sign-in would restore what the user
  // just deleted.
  import('./cloud-artifacts.js').then((c) => c.removeScope(scope)).catch(() => {});
}

/**
 * Take a floor's images off THIS COMPUTER and leave the account's copy alone.
 *
 * THE DIFFERENCE BETWEEN THIS AND `deleteScope` IS THE WHOLE OF A BUG. Signing
 * out called `deleteScope`, which is the retention operation: it removes the
 * bytes from the bucket too, deliberately, so that deleting a floor cannot be
 * undone by the next sign-in. Applied to sign-out that is exactly backwards —
 * the dialog promises "signing in again brings all of it back", and instead
 * every render the account had was destroyed. Compounded by the mirror not
 * covering the per-theme kinds at all (see SYNCED in cloud-artifacts.js), the
 * renders were simply gone, and had to be paid for again.
 *
 * Sign-out is the one caller. Deleting a floor or a project still means
 * `deleteScope`, and still means gone everywhere.
 */
export async function forgetScope(scope) {
  for (const kind of KINDS) {
    await tx('readwrite', (s) => s.delete(keyFor(scope, kind)));
  }
  // Rejected renders are diagnostic and were never mirrored, so they are not
  // "kept in the account" by leaving them here — they would just sit in this
  // browser after the person signed out of it.
  await clearRejects(scope);
}

/**
 * Bring a floor's images back from the bucket if this browser does not have
 * them. Called by the pages that OPEN a floor, never by `getArtifact` — that is
 * probed on every floor of the projects list to work out its stage, and a
 * network round trip per probe would put the whole list behind the connection.
 * @returns {Promise<number>} how many were restored
 */
export async function restoreScope(scope) {
  try {
    const c = await import('./cloud-artifacts.js');
    return await c.pullScope(scope);
  } catch { return 0; }
}

async function dataUrlToBlob(dataUrl) {
  return (await fetch(dataUrl)).blob();
}

/**
 * Which styled render a floor should be shown in, and in which look.
 *
 * THREE PAGES ASKED THIS QUESTION AND GAVE THREE ANSWERS. projects.html looked
 * for a kind called `styled` that nothing has ever written, so the project pack
 * shipped a placeholder for two months. studio.html tried the requested theme
 * and then that same dead kind, never the other look. view3d.html had it right.
 * One question with three implementations is the shape of nearly every drift
 * bug in this codebase, so it is one function now.
 *
 * The order is deliberate:
 *   1. the look that was asked for — usually the brand kit's own theme, which
 *      is what every other pixel on the page is composed from;
 *   2. the other look, because a floor rendered in only one should still ship
 *      rather than fall through to a placeholder;
 *   3. the legacy `styled` kind, for anything written before the per-theme
 *      kinds existed.
 *
 * `theme` comes back so the caller can say when it could not honour the ask.
 * Shipping the wrong look quietly is how a builder finds out from their client.
 *
 * @returns {Promise<{url: string, kind: string, theme: 'light'|'dark'|null,
 *                    exact: boolean} | null>} null when the floor has no render
 */
export async function resolveStyled(scope, prefer = 'light') {
  const want = prefer === 'dark' ? 'dark' : 'light';
  const other = want === 'dark' ? 'light' : 'dark';
  const tries = [
    [want, styledKind(want)],
    [other, styledKind(other)],
    [null, 'styled'],
  ];
  for (const [theme, kind] of tries) {
    if (await getArtifact(scope, kind)) {
      return { url: await getArtifactUrl(scope, kind), kind, theme, exact: theme === want };
    }
  }
  return null;
}

/**
 * Every kind a styled render can be stored under.
 *
 * Exported so that code which has to REMOVE a render — copying a floor to a
 * project with a different brand kit, say — cannot miss one. Deleting `styled`
 * alone left the old palette on the new project's plan, silently, because the
 * kinds that actually exist were not in the list.
 */
export const STYLED_KINDS = [
  'styled', 'styled-key',
  styledKind('light'), styledKind('dark'),
  styledKeyKind('light'), styledKeyKind('dark'),
];


/* ---------------------------------------------------------------------------
   REJECTED RENDERS — kept to be looked at, and nowhere else.

   Three renders of Plan A were paid for and thrown away, so all that survived
   was the verdict "3.1% apart" with no picture to hold against the wireframe.
   The money is spent either way; the evidence should not be.

   These deliberately do NOT go through putArtifact, and the reasons are the
   two things that would have gone wrong quietly:

     - putArtifact mirrors to Supabase Storage. A render our own check refused
       is not the customer's file and has no business in their bucket.
     - deleteScope iterates KINDS. A kind absent from that list is never
       cleaned up, so it is cleared explicitly there instead.

   They are also absent from KINDS on purpose, which is what keeps them out of
   a customer's backup: exportBackup walks KINDS too.
   --------------------------------------------------------------------------- */

const rejectKey = (scope, n) => `${scope}::reject/${n}`;
/** Everything under one scope's reject prefix, as an IDB key range. */
const rejectRange = (scope) =>
  IDBKeyRange.bound(`${scope}::reject/`, `${scope}::reject/￿`);

/** Store one refused attempt. Local only; never uploaded. */
export async function putReject(scope, n, blob) {
  await tx('readwrite', (s) => s.put(blob, rejectKey(scope, n)));
}

/** Blob URLs for a scope's refused attempts, in attempt order. */
export async function listRejects(scope) {
  const keys = await tx('readonly', (s) => s.getAllKeys(rejectRange(scope)));
  const out = [];
  for (const k of keys || []) {
    const blob = await tx('readonly', (s) => s.get(k));
    if (blob) out.push({ key: String(k), n: Number(String(k).split('/').pop()), url: URL.createObjectURL(blob) });
  }
  return out.sort((a, b) => a.n - b.n);
}

/** Drop a scope's refused attempts. Called before a fresh render and on delete. */
export async function clearRejects(scope) {
  await tx('readwrite', (s) => s.delete(rejectRange(scope)));
}
