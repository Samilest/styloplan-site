// Where a published render lives. A LEAF: nothing imported, so a page that
// only READS a published home -- embed.html, the poster in front of the 3D --
// can name the bucket and the key without pulling in publish.js, which needs
// the compositor to decide what a payload is (isPrintable), which needs the
// whole 2D pipeline: 110KB of Studio for two strings. publish.js re-exports
// both, so its own importers are unchanged.

/** The Storage bucket published renders live in — never `plans`, which is private. */
export const PUBLISHED_BUCKET = 'published';

/**
 * The table a published floor's row lives in. Named here, with the bucket, so
 * a page that only asks WHEN a floor went up (Projects' History) need not load
 * cloud-publish.js and the 3D reader it carries.
 */
export const PUBLISHED_TABLE = 'published_floors';

/**
 * The path a published render is read from, WITHIN that bucket.
 *
 * Addressed by floor and look rather than by user, because the reader has no
 * session and no idea whose account it came from. The bucket name is not part
 * of it: an earlier draft repeated it here and every object landed at
 * `published/published/<floor>/…`, which the storage policy then had to count
 * folders around.
 *
 * THE EXTENSION IS PART OF THE KEY, so it has to be a parameter rather than a
 * constant: floors published before this was measured are PNG objects at
 * `<floor>/<look>.png`, and nothing migrates them. Publishing writes .webp;
 * reading asks for .webp and falls back to .png, so an old link keeps working
 * and re-publishing a floor moves it over.
 *
 * WHY WEBP AT ALL. `style-client.js` stores the model's bytes unchanged and
 * this uploaded them unchanged, which meant a viewer downloaded the raw PNG the
 * model returned. Measured on four real renders: 3452, 3482, 2872 and 5446 KB
 * of PNG become 94, 88, 96 and 197 KB of WebP at q92 — 28x to 40x — because the
 * model's output carries a fine dither that PNG cannot compress and WebP simply
 * does not keep. At q92 the largest single-pixel difference across a full
 * 2048x2048 comparison was 12 of 255, and the share of pixels differing by more
 * than 8 was zero. Checked by eye at 1:1 on stair treads, a door swing and
 * fixture outlines: no visible change.
 */
export const renderPath = (floorId, look, ext = 'webp') => `${floorId}/${look}.${ext}`;

/**
 * Where a published floor's POSTER lives: the still of the 3D model that
 * embed.html shows in front of the model, captured at publish by the 3D page
 * itself (view3d.html, `?poster=WxH`) in the published look. One per floor,
 * beside the render, under the same folder the storage policy reads; the
 * extension follows the same WebP-first rule as the render. A floor
 * published before posters existed has none, and the poster page falls back
 * to the render.
 */
export const posterPath = (floorId, ext = 'webp', shape = '') => `${floorId}/poster${shape ? `-${shape}` : ''}.${ext}`;

/**
 * THE POSTER COMES IN TWO SHAPES, because the frame it is shown in does. The
 * embed code gives the frame the render's own shape, so the first poster
 * fits it exactly; but a phone floors the frame at 340px tall (a 375px wide
 * frame is then 1.1:1, not 1.8:1), and a host may give the frame a height of
 * its own. Fitted into a squarer frame, a wide poster letterboxes and the
 * model comes out small in a field of ground -- Saman, 2026-09-20, twice.
 * So the publisher draws a second, 5:4 poster, and the poster page shows
 * whichever is nearer the frame it finds itself in (embed.html). '' is the
 * render's own shape; the id is the file's suffix.
 */
export const POSTER_SHAPES = ['', '5x4'];
