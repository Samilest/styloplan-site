// Mirror the local store into Supabase, and back.
//
// THE SHAPE OF THIS, AND WHY.
//
// The product works signed out. Everything the compositor does is local and
// free, and `ensureSeed()` gives a brand kit to someone who has never made an
// account. That is deliberate and it survives here: localStorage stays the
// WORKING copy and the cloud is a durable MIRROR. Nothing in the app reads from
// the network on the hot path, so a slow connection cannot make dragging a
// label feel slow.
//
// WHY MERGE RATHER THAN "PUSH" OR "PULL". The first sign-in has three shapes —
// local work and an empty cloud, an empty browser and a populated cloud, or
// both. A one-directional sync has to guess which, and guessing wrong deletes
// somebody's afternoon. Merging per record by `updated_at` handles all three
// with one rule and never silently drops a row: the newest version of each
// project wins, and a record present on only one side is copied to the other.
//
// WHAT THIS DOES NOT DO. It does not resolve two people editing the same floor
// at the same moment; the later write wins and the earlier one is gone. That is
// honest for a single-user product and must be revisited with teams — see
// `can_access` in supabase/schema.sql, which is the seam for that.
//
// Images are NOT here. They live in IndexedDB via src/artifacts.js, which is
// already written as the seam for Supabase Storage. Records first because they
// are small, they are what the verification claim rests on, and they cannot be
// reconstructed at any price — a render can be bought again, a sign-off cannot.

import { getSupabase } from './supabase-client.js';

const nowIso = () => new Date().toISOString();

// ---- shape mapping. The columns were chosen to mirror the local objects, so
// these stay dull on purpose: anything clever here is a place for the two
// shapes to drift.

const kitToRow = (k, owner) => ({
  id: k.id,
  owner_id: owner,
  name: k.name ?? 'My brand kit',
  company_name: k.companyName ?? '',
  tagline: k.tagline ?? '',
  logo_data_url: k.logoDataUrl ?? null,
  font: k.font ?? 'Inter',
  // The tint rides INSIDE `palette` rather than taking a column of its own. It
  // is palette data, the column is already jsonb, and a new column means another
  // hand-run migration for a two-field object. Sending a key the table does not
  // have fails the whole upsert, which would take the rest of the kit down with
  // it — so this is not merely convenient, it is the safe shape.
  palette: { ...(k.palette ?? {}), tint: k.planTint ?? { mode: 'off' } },
  disclaimer_on: k.disclaimerOn !== false,
  disclaimer_text: k.disclaimerText ?? null,
  house_style: k.houseStyle ?? {},
  updated_at: k.updatedAt ?? nowIso(),
});

const rowToKit = (r) => ({
  id: r.id,
  name: r.name,
  companyName: r.company_name,
  tagline: r.tagline,
  logoDataUrl: r.logo_data_url,
  font: r.font,
  // Unpacked back out, so the rest of the app never sees the nesting.
  palette: (({ tint, ...rest }) => rest)(r.palette ?? {}),
  disclaimerOn: r.disclaimer_on,
  disclaimerText: r.disclaimer_text,
  houseStyle: r.house_style,
  planTint: r.palette?.tint ?? { mode: 'off', brand: '#2E6B4F' },
  updatedAt: r.updated_at,
});

const projToRow = (p, owner) => ({
  id: p.id,
  owner_id: owner,
  name: p.name,
  brand_kit_id: p.brandKitId ?? null,
  is_sample: Boolean(p.isSample),
  archived: Boolean(p.archived),
  collapsed: Boolean(p.collapsed),
  created_at: p.createdAt ?? nowIso(),
  updated_at: p.updatedAt ?? nowIso(),
});

// `owner_id` is deliberately absent: a trigger fills it from the parent project,
// because a client that names the owner is a client that can name someone else's.
const floorToRow = (f, projectId, i) => ({
  id: f.id,
  project_id: projectId,
  name: f.name,
  status: f.status ?? 'new',
  mock: f.mock !== false,
  verified: f.verified ?? null,
  versions: f.versions ?? [],
  sort_order: i,
  updated_at: f.updatedAt ?? nowIso(),
});

const rowToFloor = (r) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  mock: r.mock,
  verified: r.verified,
  versions: r.versions ?? [],
  updatedAt: r.updated_at,
});

/** Newest wins, and a missing timestamp is treated as oldest rather than newest
 *  — an un-stamped local row must never overwrite a stamped cloud one. */
const newer = (a, b) => (String(a?.updatedAt || a?.updated_at || '') >
                         String(b?.updatedAt || b?.updated_at || '') ? a : b);

/**
 * Merge two lists of records by id.
 *
 * A DELETION IS A FACT, NOT THE ABSENCE OF ONE. Deleting a project removed it
 * from this machine and wrote nothing down, so the next sync found it on the
 * cloud side only — and the rule below, correctly, keeps a record that exists
 * on one side. Saman deleted The Avi, added a floor to another project, and The
 * Avi came back. It was not a sync failure; the sync did exactly what it was
 * told, because nothing had told it the project was gone.
 *
 * `tombs` is {id: when}, and it is weighed the same way everything else here is
 * weighed: newest wins. A deletion at 10:00 removes a cloud copy last touched
 * at 09:00, and does NOT remove one edited at 11:00 on another machine — that
 * edit is later news than the deletion, and the merge exists to keep later news.
 *
 * @returns {{merged:Array, toPush:Array, buried:Array}} everything, the subset
 *   the cloud does not already have in its newest form, and the ids whose cloud
 *   rows should now be dropped.
 */
export function mergeById(local, cloud, tombs = null) {
  const byId = new Map();
  const buried = [];
  for (const c of cloud || []) {
    const when = tombs?.[c.id];
    if (when && String(when) > String(c.updatedAt || c.updated_at || '')) {
      buried.push(c.id);
      continue;
    }
    byId.set(c.id, { rec: c, from: 'cloud' });
  }
  const toPush = [];
  for (const l of local || []) {
    const hit = byId.get(l.id);
    if (!hit) { byId.set(l.id, { rec: l, from: 'local' }); toPush.push(l); continue; }
    const win = newer(l, hit.rec);
    if (win === l) { byId.set(l.id, { rec: l, from: 'local' }); toPush.push(l); }
  }
  return { merged: [...byId.values()].map((v) => v.rec), toPush, buried };
}

async function client() {
  const sb = await getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data?.user ? { sb, uid: data.user.id } : null;
}

/**
 * Bring local and cloud into agreement.
 *
 * @param {Object} local {kits, projects}  — from src/store.js
 * @returns {Promise<{kits:Array, projects:Array, pushed:number, pulled:number}|null>}
 *   null when there is no account or no cloud, so callers fall through to
 *   whatever they already had.
 */
export async function syncAll(local) {
  const c = await client();
  if (!c) return null;
  const { sb, uid } = c;

  const [kitRes, projRes, floorRes] = await Promise.all([
    sb.from('brand_kits').select('*'),
    sb.from('projects').select('*'),
    sb.from('floors').select('*').order('sort_order'),
  ]);
  if (kitRes.error || projRes.error || floorRes.error) {
    console.error('sync read failed:', (kitRes.error || projRes.error || floorRes.error).message);
    return null;
  }

  const cloudKits = (kitRes.data || []).map(rowToKit);
  // A DELETED FLOOR IS NOT PULLED BACK IN.
  //
  // The tombstone is what makes the deletion durable: until the server row is
  // actually gone, every pull would otherwise hand the floor straight back, and
  // it would ride into the merged project on whichever record won. Deleting by
  // intent, not by absence — a floor added on ANOTHER device is not tombstoned
  // here and is never touched.
  const floorTombs = (local.deleted || {}).floors || {};
  const floorsByProject = new Map();
  for (const r of floorRes.data || []) {
    if (floorTombs[r.id]) continue;
    if (!floorsByProject.has(r.project_id)) floorsByProject.set(r.project_id, []);
    floorsByProject.get(r.project_id).push(rowToFloor(r));
  }
  const cloudProjects = (projRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    brandKitId: r.brand_kit_id,
    isSample: r.is_sample,
    archived: r.archived,
    collapsed: r.collapsed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    floors: floorsByProject.get(r.id) || [],
  }));

  const tombs = local.deleted || {};
  const kits = mergeById(local.kits, cloudKits, tombs.kits);
  const projects = mergeById(local.projects, cloudProjects, tombs.projects);

  // A FAILED PUSH IS REPORTED, NOT ONLY LOGGED.
  //
  // These errors used to go to the console and nowhere else, and the function
  // returned a result that looked like success. That was survivable while the
  // only caller was a background mirror — the next sync would try again. It
  // stopped being survivable when signing out began CLEARING the local copy
  // after syncing: a swallowed push would have reported success, the records
  // would have been removed from the machine, and they would not have been in
  // the account either. The caller has to be able to ask whether the work is
  // actually safe.
  const errors = [];
  let pushed = 0;
  if (kits.toPush.length) {
    const { error } = await sb.from('brand_kits')
      .upsert(kits.toPush.map((k) => kitToRow(k, uid)));
    if (error) { console.error('kit push failed:', error.message); errors.push(error.message); }
    else pushed += kits.toPush.length;
  }
  if (projects.toPush.length) {
    // Projects before floors: a floor's insert is checked against its parent's
    // owner, so the parent has to exist first.
    const { error } = await sb.from('projects')
      .upsert(projects.toPush.map((p) => projToRow(p, uid)));
    if (error) {
      console.error('project push failed:', error.message);
      errors.push(error.message);
    } else {
      pushed += projects.toPush.length;
      const rows = projects.toPush.flatMap((p) =>
        (p.floors || []).map((f, i) => floorToRow(f, p.id, i)));
      if (rows.length) {
        const { error: fe } = await sb.from('floors').upsert(rows);
        if (fe) { console.error('floor push failed:', fe.message); errors.push(fe.message); }
        else pushed += rows.length;
      }

    }
  }

  // AND THE ROWS THE DELETIONS BURY. Hiding them locally is only half of it:
  // left on the server they come back the moment this machine's copy is not the
  // newer one, and they follow the account to every other device.
  //
  // Floors first, then the project: a floor row points at its parent, so
  // removing the parent first can be refused. Only ids the server actually
  // accepted are reported as done, so a failure is retried on the next sync
  // rather than being forgotten.
  const buriedOk = { projects: [], kits: [], floors: [] };
  // The floors this machine deleted, removed from the server for good. Reported
  // only when the delete succeeded, so a failure is retried on the next sync
  // instead of the note being dropped and the floor returning.
  const floorTombIds = Object.keys(floorTombs);
  if (floorTombIds.length) {
    const { error: fe } = await sb.from('floors').delete().in('id', floorTombIds);
    if (fe) { console.error('floor delete failed:', fe.message); errors.push(fe.message); }
    else buriedOk.floors = floorTombIds;
  }
  if (projects.buried.length) {
    const { error: fe } = await sb.from('floors').delete().in('project_id', projects.buried);
    if (fe) { console.error('floor delete failed:', fe.message); errors.push(fe.message); }
    const { error } = await sb.from('projects').delete().in('id', projects.buried);
    if (error) { console.error('project delete failed:', error.message); errors.push(error.message); }
    else if (!fe) buriedOk.projects = projects.buried;
  }
  if (kits.buried.length) {
    const { error } = await sb.from('brand_kits').delete().in('id', kits.buried);
    if (error) { console.error('kit delete failed:', error.message); errors.push(error.message); }
    else buriedOk.kits = kits.buried;
  }

  return {
    kits: kits.merged,
    projects: projects.merged,
    buried: buriedOk,
    errors,
    pushed,
    pulled: (cloudKits.length + cloudProjects.length) - kits.toPush.length - projects.toPush.length,
  };
}
