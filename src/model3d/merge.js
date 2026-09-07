// One draw call per material instead of one per wall.
//
// WHY. The model is tiny and expensive at the same time: 878 triangles drawn in
// 147 calls, measured at 1.10ms a frame on a desktop for a scene a GPU should
// finish in microseconds. Almost none of that is drawing — it is the cost of
// telling the GPU to draw, 147 times, sixty times a second. On a phone the same
// scene costs several times that, and the embed is on somebody else's website
// where the budget is not ours to spend.
//
// The cause is the construction, and the construction is right: a wall run is
// built as one box per rectangle plus one line loop per box, because that is how
// the extruder describes the plan and how every other part of this file reads it
// back. Those meshes never move relative to each other, so they do not need to
// be separate objects at draw time — only at build time.
//
// SO THIS RUNS AFTER THE MODEL IS BUILT, AND CHANGES NOTHING ABOUT HOW IT IS
// BUILT. Every mesh keeps the shape, the position and the material it was given;
// they are simply handed to the GPU together. Verified by rendering the same
// scene from the same camera before and after and comparing the pixels.
//
// WHAT IT DELIBERATELY LEAVES ALONE:
//   - anything with `userData.noMerge`, the escape hatch for a mesh that has to
//     stay addressable;
//   - sprites (the room labels), which are sorted and faded per label every
//     frame and are not static in any sense;
//   - lights, cameras and groups;
//   - a material with only one user, where merging would cost a copy and save
//     nothing.

/** Attributes that survive a merge, in the order they are written. */
const ATTRS = ['position', 'normal', 'uv'];

/**
 * A key that two geometries must share to be mergeable: the same material, the
 * same draw mode, and the same attributes. Anything else is left as it is —
 * this is an optimisation, and an optimisation that guesses is a defect.
 */
function bucketKey(obj, matId) {
  const g = obj.geometry;
  const has = ATTRS.filter((a) => g.getAttribute(a)).join(',');
  return `${obj.isLineSegments ? 'line' : 'mesh'}|${matId}|${has}|${g.index ? 'i' : 'n'}`;
}

/**
 * Merge the static meshes and line segments under `root`, in place.
 *
 * @param {object} root a THREE.Object3D holding the built model
 * @param {object} THREE the three module (this project has no bundler, so the
 *   namespace is passed rather than imported twice)
 * @param {(x:any)=>any} [keep] the caller's disposal tracker; merged geometries
 *   are handed to it so a rebuild frees them like any other
 * @returns {{before:number, after:number, merged:number}} draw-call counts
 */
export function mergeStatics(root, THREE, keep = (x) => x) {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();

  // Materials are compared by identity, and identity needs a stable name to key
  // a map on. `uuid` is that name and three assigns it already.
  const buckets = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!o.isMesh && !o.isLineSegments) return;
    before++;
    if (o.userData.noMerge || Array.isArray(o.material) || !o.geometry) return;
    const key = bucketKey(o, o.material.uuid);
    if (!buckets.has(key)) buckets.set(key, { material: o.material, isLine: o.isLineSegments, list: [] });
    buckets.get(key).list.push(o);
  });

  let merged = 0;
  for (const b of buckets.values()) {
    if (b.list.length < 2) continue;

    // Baked into root-local space, so the merged object needs no transform of
    // its own and sits exactly where its parts did.
    const parts = b.list.map((o) => {
      const g = o.geometry.clone();
      g.applyMatrix4(toRoot.clone().multiply(o.matrixWorld));
      return g;
    });

    const names = ATTRS.filter((a) => parts[0].getAttribute(a));
    const indexed = Boolean(parts[0].index);
    let vertices = 0, indices = 0;
    for (const g of parts) {
      vertices += g.getAttribute('position').count;
      indices += indexed ? g.index.count : 0;
    }

    const out = new THREE.BufferGeometry();
    for (const name of names) {
      const size = parts[0].getAttribute(name).itemSize;
      const data = new Float32Array(vertices * size);
      let at = 0;
      for (const g of parts) {
        const a = g.getAttribute(name);
        // Copied component by component: a source attribute can be
        // interleaved or normalised, and `array` would then not be what it
        // looks like.
        for (let i = 0; i < a.count; i++) {
          for (let k = 0; k < size; k++) data[at++] = a.getComponent(i, k);
        }
      }
      out.setAttribute(name, new THREE.BufferAttribute(data, size));
    }
    if (indexed) {
      // THE INDICES ARE OFFSET, and this is the whole trick. Each part's
      // indices count from its own first vertex; in a merged buffer they have
      // to count from where that part landed. Getting this wrong does not
      // throw — it draws a different building.
      const use32 = vertices > 65535;
      const idx = use32 ? new Uint32Array(indices) : new Uint16Array(indices);
      let at = 0, base = 0;
      for (const g of parts) {
        const src = g.index;
        for (let i = 0; i < src.count; i++) idx[at++] = src.getX(i) + base;
        base += g.getAttribute('position').count;
      }
      out.setIndex(new THREE.BufferAttribute(idx, 1));
    }

    const one = b.isLine
      ? new THREE.LineSegments(keep(out), b.material)
      : new THREE.Mesh(keep(out), b.material);
    // The parts were drawn in the order they were added and the merged object
    // takes the place of the first of them, so anything depending on draw order
    // against OTHER objects still sees what it saw.
    one.renderOrder = b.list[0].renderOrder;
    one.frustumCulled = b.list[0].frustumCulled;
    one.userData.mergedFrom = b.list.length;

    for (const o of b.list) o.parent?.remove(o);
    root.add(one);
    // The clones are scratch; the ORIGINALS are the caller's and are left for
    // the caller's own disposal list to free. Freeing them here would release
    // geometry a rebuild still expects to own.
    for (const g of parts) g.dispose();
    merged += b.list.length;
  }

  let after = 0;
  root.traverse((o) => { if (o.isMesh || o.isLineSegments) after++; });
  return { before, after, merged };
}
