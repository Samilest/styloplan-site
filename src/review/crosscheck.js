// Dimension cross-check (handoff L2: "dimension strings compared … between
// source and wireframe. Mismatches flagged in red").
//
// Corrupted numbers are the one failure a user cannot see: the composite draws
// its labels from the extraction JSON, so a wrong figure ships looking exactly
// like a right one. Two independent readings expose it — the extraction reads
// the ORIGINAL drawing, the read-back reads what the image model TRANSCRIBED
// into the wireframe. On The Geena these disagreed on two of three corrupted
// dimensions (DECK 11'-11" vs 11'-9", MASTER BDRM 15'-0" vs 13'-0").
//
// Honest limit: when both readings make the SAME mistake the check stays
// silent, so it narrows the risk rather than eliminating it.

// Strip only meaningless variation — quote style, spacing, case, the ×/x/X
// separator — never digits.
export function normalizeDim(s) {
  if (s == null) return null;
  return String(s)
    .replace(/[‘’ʼ´`]/g, "'")   // curly apostrophes → '
    .replace(/[“”ʺ]/g, '"')          // curly quotes → "
    .replace(/[×]/g, 'x')                      // × → x
    .replace(/[‐-―]/g, '-')               // dashes → -
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function normalizeName(s) {
  if (s == null) return null;
  return String(s).replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

/**
 * @param {Array} extracted  spaces from the source extraction ({name, dim})
 * @param {Array} readBack   labels read back off the wireframe ({name, dim})
 * @returns {{rows:Array, agreed:number, disagreed:number, unpaired:number}}
 */
export function crossCheckDimensions(extracted, readBack) {
  const named = (extracted || []).filter((s) => s.name);
  const pool = (readBack || []).filter((l) => l.name).map((l) => ({ ...l, used: false }));

  const rows = named.map((s) => {
    const key = normalizeName(s.name);
    // exact name match first, then a containment fallback for wording drift
    let hit = pool.find((l) => !l.used && normalizeName(l.name) === key);
    if (!hit) {
      hit = pool.find((l) => !l.used && key && normalizeName(l.name) &&
        (normalizeName(l.name).includes(key) || key.includes(normalizeName(l.name))));
    }
    if (hit) hit.used = true;

    // A space with no dimension at all has nothing to verify — reporting it
    // as a problem would bury the real mismatches in noise.
    if (s.dim == null && (!hit || hit.dim == null)) {
      return { name: s.name, extracted: null, wireframe: null, status: 'no-dimension' };
    }
    if (!hit) return { name: s.name, extracted: s.dim, wireframe: null, status: 'unverified' };
    const a = normalizeDim(s.dim), b = normalizeDim(hit.dim);
    return {
      name: s.name,
      extracted: s.dim,
      wireframe: hit.dim,
      status: a === b ? 'agree' : 'disagree',
    };
  });

  return {
    rows,
    agreed: rows.filter((r) => r.status === 'agree').length,
    disagreed: rows.filter((r) => r.status === 'disagree').length,
    unverified: rows.filter((r) => r.status === 'unverified').length,
    skipped: rows.filter((r) => r.status === 'no-dimension').length,
  };
}
