// One user-initiated action costs one credit, however many times WE have to
// ask the model to get it right.
//
// THE DEFECT THIS FIXES. Both paid image paths retry internally: the styling
// client re-rolls when registration or the text guard rejects a render, and the
// L1 client re-draws when the wireframe silhouette does not match the plan.
// Every attempt was a separate POST, and server.js charges per POST — so one
// press of "Render this palette (1 credit)" spent up to three. Measured
// 2026-08-22: one click, three `POST /api/style`, all 200 OK. The customer was
// billed the most precisely when the product was failing them, silently.
//
// That contradicts the pricing promise the handoff already makes — "1 credit =
// 1 floor in 1 theme", "one credit includes EVERYTHING, no per-option
// surcharges" — and the principle already written into server.js's own COST
// table, where the enclosure check is free because "charging a customer to be
// told where OUR mistake might be is how a meter loses trust". A re-roll is the
// same thing: our own verification rejected our own render.
//
// HOW. The client mints one job id per user action and sends it with every
// attempt of that action. The first attempt is charged; the retries that job is
// allowed to make are free. The budget is derived from the retry loops
// themselves (ATTEMPTS below), so raising a loop's limit cannot quietly
// re-introduce the bug.
//
// ---------------------------------------------------------------------------
// THIS FILE IS LOADED BY THE BROWSER. Keep it that way.
// ---------------------------------------------------------------------------
//
// src/l1-client.js and src/style-client.js import ATTEMPTS and newJobId from
// here, and both run in the page. The numbers have to be shared — that is the
// whole point of deriving the free-retry budget from the retry loops, so raising
// a loop's limit cannot silently re-introduce the billing bug.
//
// So nothing here may reach the server's half. src/supabase-server.js holds the
// service_role key, which bypasses row-level security entirely, and one import
// added at the wrong end of this file would ship it to every visitor. The
// counting and the rules live in src/credit-meter.js and supabase/jobs.sql; this
// file is the numbers and the id, and it stays free of imports.

/** How many times each loop may ask the model for ONE user action. */
export const ATTEMPTS = {
  '/api/style': 3,      // src/style-client.js — registration + text guard
  '/api/wireframe': 3,  // src/l1-client.js — silhouette check
};

/** Free retries a job gets after its charged first attempt. */
export const FREE_RETRIES = Object.fromEntries(
  Object.entries(ATTEMPTS).map(([path, n]) => [path, n - 1]),
);

/** Forget a job this long after its last attempt. Mirrors public.job_ttl(). */
export const JOB_TTL_MS = 15 * 60 * 1000;

/**
 * A builder preparing ten floors, each needing all three wireframe attempts,
 * spends thirty image calls — more than a real day's work and still bounded.
 * Here rather than in the SQL because it is a product decision that gets argued
 * about; the counting is what moved to Postgres.
 */
export const FREE_IMAGE_PER_DAY = 30;

/**
 * The free TEXT calls, which had no ceiling at all until 2026-09-04.
 *
 * /api/extract, /api/read-back-labels and /api/room-inventory are free, reach
 * the model, and were gated by a sign-in and nothing else. Measured with one
 * fresh account: eighteen calls, eighteen answered, no credit moved and no
 * counter changed.
 *
 * The same 30, from the same day's work: ten floors is thirty wireframe
 * attempts, and ten floors is also about thirty text calls — an extraction and
 * a label read-back each, plus the re-traces. Counted separately from the
 * images so a day of text cannot eat the expensive budget.
 */
export const FREE_TEXT_PER_DAY = 30;

/**
 * Which allowance a free path draws on, or null for a path that costs nothing
 * to serve.
 *
 * NAMED HERE, NOT IN THE HANDLER, so adding an endpoint means answering the
 * question. A path absent from this table is unthrottled, which is exactly how
 * three of them came to be — the old rule was a set called FREE_IMAGE_PATHS,
 * and a text endpoint simply was not an image, so nobody had to decide.
 */
export const FREE_KIND = {
  '/api/wireframe': 'image',
  '/api/extract': 'text',
  '/api/read-back-labels': 'text',
  '/api/room-inventory': 'text',
  // Carries no image and calls no model — it gives a credit back. Its own
  // ceiling is FAILED_REFUNDS_PER_DAY.
  '/api/render-failed': null,
};

/** How many of a kind one account may have in a day. */
export const FREE_PER_DAY = { image: FREE_IMAGE_PER_DAY, text: FREE_TEXT_PER_DAY };

/**
 * HOW MANY FREE IMAGE CALLS ONE CREDIT BUYS.
 *
 * The wireframe is free to the customer and an IMAGE call on our key --
 * $0.1585 measured, 46% of a floor's best-case cost. A rolling daily allowance
 * renewed it forever, so an account that never bought anything could draw
 * $1,736 a year. Tying it to credits instead means an account may prepare
 * exactly what it could pay to render, retries included, and nothing renews on
 * its own.
 *
 * NOT A NEW NUMBER. It is the retry limit on the same endpoint, so raising the
 * retries raises the allowance by construction and the two cannot drift.
 * `image` is the only kind with a per-credit budget: text calls are thirty
 * times cheaper and keep the daily window, because blocking an upload is the
 * one thing that would stop somebody who was about to buy more.
 */
export const FREE_PER_CREDIT = { image: ATTEMPTS['/api/wireframe'] };

/**
 * At three a day, the worst case is nine style calls we are not paid for, per
 * account, per day. That is the price of not charging people for our own
 * defects, and it is a price we can name. See src/credit-meter.js for why a
 * ceiling has to exist at all.
 */
export const FAILED_REFUNDS_PER_DAY = 3;

/** An id for one user action. Opaque — the server never parses it. */
export function newJobId() {
  return (globalThis.crypto?.randomUUID?.())
    || `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ignore anything that is not a plain, bounded id. An unusable value is not an
 * error: the request is charged as its own job, which is the old behaviour and
 * the safe direction to fail in.
 *
 * STILL CHECKED, though the SQL is parameterised and could not be injected
 * through. The id becomes a primary-key value in a shared table, so an unbounded
 * one is a row of arbitrary size written by anyone who can sign in.
 */
export const cleanId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(v) ? v : null);
