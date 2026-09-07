// Back up and restore everything the app holds.
//
// Why this exists before Supabase. Today a customer's entire body of work —
// projects, brand kits, confirmed floors and every plan image — lives in one
// browser's localStorage and IndexedDB. Clearing site data destroys it, and
// there is no second copy anywhere. That is the real present risk; multi-user
// access is a later one.
//
// It is deliberately NOT a database migration. The schema is still moving (three
// shape changes in a single day: houseStyle on kits, checkedFor on labels,
// staircases through to the compositor), and writing migrations against a moving
// shape is wasted work. A file the user can keep costs a fraction of the effort
// and locks nothing in.
//
// One file, no dependencies: JSON with images inlined as data URLs. Large, but a
// backup is written once and read rarely, and a single file is a thing a person
// can actually put somewhere safe.

import { getProjects, getKits, saveProject, saveKit } from './store.js';
import { KINDS, scopeFor, getArtifact, putArtifact, DRAFT } from './artifacts.js';

// NOT RENAMED WITH THE PRODUCT. This string is the wire format's identity, not
// the brand: it is written inside every backup file already on someone's disk,
// and an import checks it. Changing it to match "StyloPlan" would make every
// existing backup unreadable by the app that wrote it — including the one Saman
// took on 2026-08-24. The product name a person reads is in the error messages
// below, and those did change.
const FORMAT = 'planrestyler.backup';
const VERSION = 1;

const blobToDataUrl = (blob) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => no(new Error('could not read stored image'));
  r.readAsDataURL(blob);
});

/** Every scope that any project refers to, plus the draft workspace. */
function allScopes(projects) {
  const out = new Set([DRAFT]);
  for (const p of projects) {
    for (const f of p.floors || []) {
      out.add(scopeFor(p.id, f.id));
      // A floor confirmed before scopes were floor-keyed may name its own.
      if (f.verified?.artifactScope) out.add(f.verified.artifactScope);
    }
  }
  return [...out];
}

/**
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<Blob>} a single .json file holding the whole account
 */
export async function exportBackup(onProgress = () => {}) {
  const projects = getProjects();
  const kits = getKits();
  const scopes = allScopes(projects);

  const artifacts = {};
  let done = 0;
  for (const scope of scopes) {
    for (const kind of KINDS) {
      const blob = await getArtifact(scope, kind);
      if (!blob) continue;
      artifacts[`${scope}::${kind}`] = await blobToDataUrl(blob);
    }
    onProgress(`Packing images ${++done} of ${scopes.length}…`);
  }

  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      projects: projects.length,
      kits: kits.length,
      images: Object.keys(artifacts).length,
    },
    projects,
    kits,
    artifacts,
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

/**
 * Read a backup file WITHOUT writing anything, so the caller can show the user
 * what it contains and what would change before they commit. Restoring is
 * destructive-by-id and must never happen on the strength of a filename.
 */
export async function inspectBackup(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not a StyloPlan backup (it is not valid JSON).');
  }
  if (data?.format !== FORMAT) {
    throw new Error('That file is not a StyloPlan backup.');
  }
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new Error(`This backup was written by a newer version of the app (v${data.version}).`);
  }
  if (!Array.isArray(data.projects) || !Array.isArray(data.kits)) {
    throw new Error('This backup is missing its projects or brand kits and cannot be restored.');
  }

  const existing = new Set(getProjects().map((p) => p.id));
  const incoming = data.projects.map((p) => p.id);
  return {
    data,
    exportedAt: data.exportedAt,
    projects: data.projects.length,
    kits: data.kits.length,
    images: Object.keys(data.artifacts || {}).length,
    // The honest headline for the confirm step: what disappears.
    overwrites: incoming.filter((id) => existing.has(id)).length,
    adds: incoming.filter((id) => !existing.has(id)).length,
  };
}

/**
 * Write an inspected backup into the app. Projects and kits with matching ids
 * are replaced; anything else already here is left alone, so a restore never
 * silently empties an account that has newer work in it.
 * @param {object} inspected the object returned by inspectBackup
 */
export async function restoreBackup(inspected, onProgress = () => {}) {
  const { data } = inspected;
  for (const kit of data.kits) saveKit(kit);
  for (const project of data.projects) saveProject(project);

  const entries = Object.entries(data.artifacts || {});
  let done = 0;
  for (const [key, dataUrl] of entries) {
    const sep = key.lastIndexOf('::');
    const scope = key.slice(0, sep);
    const kind = key.slice(sep + 2);
    if (!KINDS.includes(kind)) continue;   // ignore anything we do not recognise
    const res = await fetch(dataUrl);
    await putArtifact(scope, kind, await res.blob());
    onProgress(`Restoring images ${++done} of ${entries.length}…`);
  }
  return { projects: data.projects.length, kits: data.kits.length, images: done };
}
