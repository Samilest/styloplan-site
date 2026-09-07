// What changed between two sign-offs.
//
// The highest-value work on a plan library is not the first graphic, it is the
// UPDATE: a new elevation, a moved wall, a revised dimension set. A builder
// coming back to a plan asks one question — "what is different from the version
// we approved last time?" — and until now the product could not answer it.
//
// It cannot diff the DRAWING: there is no wall or room geometry, only a raster
// from the image model. But it can diff the RECORD, and the record is what the
// verification report is actually about. Room names, dimensions, the space
// count and the listing figures are all structured data already stored on every
// confirmed floor. Those are the fields a builder means when they ask what
// changed.
//
// Pure functions, no DOM: this is the part that must be exactly right, so it is
// testable in node.

/** The comparable part of a sign-off. Deliberately small — snapshots are kept
 *  per floor in localStorage, so they carry fields, not images. */
export function snapshotOf(verified) {
  if (!verified) return null;
  const rooms = (verified.labels || []).filter((l) => l.kind !== 'equipment');
  return {
    at: verified.confirmedAt || null,
    by: verified.confirmedBy || null,
    spaces: rooms.length,
    labels: rooms.map((l) => ({ id: l.id, name: l.name ?? null, dim: l.dim ?? null })),
    specs: {
      beds: verified.specs?.beds ?? null,
      baths: verified.specs?.baths ?? null,
      sqft: verified.specs?.sqft ?? null,
    },
    // Which drawing this sign-off was made against.
    //
    // Without it the feature can lie. A builder uploads revision B, a wall has
    // moved but every room name and dimension reads the same, the extraction
    // returns identical fields — and the history says "re-confirmed with no
    // change", about a different drawing. The record is all this can compare,
    // so it has to at least know WHICH drawing the record describes.
    source: verified.source || null,
  };
}

/**
 * Identify a source file by its bytes, so a re-upload of the same drawing is
 * recognised and a revision is not.
 * @returns {Promise<{bytes:number, sha:string}|null>}
 */
export async function sourceFingerprint(blob) {
  if (!blob || !globalThis.crypto?.subtle) return null;
  try {
    const buf = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const sha = [...new Uint8Array(hash)].slice(0, 8)
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    return { bytes: buf.byteLength, sha };
  } catch {
    return null;                    // never block a sign-off over a fingerprint
  }
}

const shown = (v) => (v == null || v === '' ? 'None' : String(v));
const roomName = (l) => l.name || 'unlabelled space';

/**
 * Changes from `a` to `b`, as sentences a builder can read.
 *
 * Matched by label id, not by position: a room added in the middle would
 * otherwise report every room after it as renamed.
 *
 * @returns {Array<{kind:string, text:string}>} empty when nothing changed
 */
export function diffVersions(a, b) {
  if (!a || !b) return [];
  const out = [];
  const byId = (s) => new Map(s.labels.map((l) => [l.id, l]));
  const A = byId(a), B = byId(b);

  for (const [id, nb] of B) {
    const na = A.get(id);
    if (!na) { out.push({ kind: 'added', text: `${roomName(nb)} added` }); continue; }
    if ((na.name ?? null) !== (nb.name ?? null)) {
      out.push({ kind: 'renamed', text: `${shown(na.name)} renamed to ${shown(nb.name)}` });
    }
    if ((na.dim ?? null) !== (nb.dim ?? null)) {
      out.push({
        kind: 'dimension',
        text: `${roomName(nb)}: ${shown(na.dim)} → ${shown(nb.dim)}`,
      });
    }
  }
  for (const [id, na] of A) {
    if (!B.has(id)) out.push({ kind: 'removed', text: `${roomName(na)} removed` });
  }

  // Reported FIRST, and separately from the fields: "the drawing changed" is a
  // different fact from "a dimension changed", and the dangerous case is a new
  // drawing whose fields happen to read the same.
  const sa = a.source, sb = b.source;
  if (sa && sb && (sa.sha !== sb.sha)) {
    out.unshift({ kind: 'source', text: 'Source plan file changed' });
  }

  if (a.spaces !== b.spaces) {
    out.unshift({ kind: 'count', text: `Spaces: ${a.spaces} → ${b.spaces}` });
  }
  for (const [key, label] of [['beds', 'Bedrooms'], ['baths', 'Bathrooms'], ['sqft', 'Total size']]) {
    if ((a.specs?.[key] ?? null) !== (b.specs?.[key] ?? null)) {
      out.push({ kind: 'specs', text: `${label}: ${shown(a.specs?.[key])} → ${shown(b.specs?.[key])}` });
    }
  }
  return out;
}

// Enough to answer "what changed recently" without letting one floor grow
// without limit in localStorage. The oldest entries fall off the back.
export const MAX_VERSIONS = 20;

/** Append a sign-off, skipping a re-confirmation that changed nothing. */
export function pushVersion(list, snap) {
  const out = Array.isArray(list) ? list.slice() : [];
  const last = out[out.length - 1];
  if (last && diffVersions(last, snap).length === 0) return out;
  out.push(snap);
  return out.slice(-MAX_VERSIONS);
}
