// WHAT PEOPLE DO IN THE APP, AND WHERE IT BREAKS (2026-09-26).
//
// Nothing in the app was measured. The failures of one week were seen only
// because Saman was the one uploading; with customers we would not know where
// they stop, which step fails, or how long Review takes. `track` records a step
// in OUR OWN database (supabase/events.sql, log_event), which keeps legal.html's
// "no third-party analytics" true.
//
// THREE RULES, and each is why a function here exists:
//   - It never throws and is never awaited. A measurement that could fail or
//     slow a page would cost more than it tells.
//   - It records steps, times and reasons, never content: every value is cut to
//     a number, a boolean or 200 characters, and no image or plan text is sent
//     on purpose. An error's message is the one free text, and it is trimmed.
//   - Signed out, nothing is sent: there is no one to attribute it to, and the
//     server refuses it anyway.
//
// Event names are plain identifiers (the table's check), and test/events.test
// reads every call of track in the code to hold them to it.

import { getSupabase } from './supabase-client.js';

/** The page, without its extension: "studio", "review". */
const pageName = () => (location.pathname.split('/').pop() || 'projects.html').replace(/\.html$/, '').slice(0, 40);

/**
 * A failure's words without the plan in them. An error can carry the start of
 * a model's answer ("did not return valid JSON: {"spaces": [{"name": "KITCHEN"
 * ..."), which is the plan's content, and legal.html says none is recorded. The
 * sentence before the first { or [ is what says what went wrong.
 */
export const reasonOf = (message) => String(message ?? '').split(/[{[]/)[0].trim().slice(0, 200);

/** Every value as a number, a boolean or a short string. Nothing nested. */
export function cleanDetail(detail) {
  const out = {};
  for (const [k, v] of Object.entries(detail || {})) {
    if (v == null || !/^[a-z][a-z0-9_]{0,30}$/i.test(k)) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000; }
    else if (typeof v === 'boolean') out[k] = v;
    else if (k === 'reason' || k === 'message') out[k] = reasonOf(v);
    else out[k] = String(v).slice(0, 200);
  }
  return out;
}

/** Record that something happened. Fire and forget. */
export function track(name, detail = {}) {
  (async () => {
    try {
      const sb = await getSupabase();
      if (!sb) return;
      const { data } = await sb.auth.getSession();
      if (!data?.session) return;
      await sb.rpc('log_event', { p_name: name, p_page: pageName(), p_detail: cleanDetail(detail) });
    } catch { /* a measurement never fails a page */ }
  })();
}

/**
 * Errors nobody saw. A script error or an unhandled rejection is recorded with
 * its message and where it came from; five per page load at most, so a loop of
 * one error cannot fill anyone's hourly allowance. Installed once, by the
 * header every app page draws (chrome.js).
 */
let watching = false;
export function watchErrors() {
  if (watching) return;
  watching = true;
  let left = 5;
  addEventListener('error', (e) => {
    if (left-- <= 0 || !e.message) return;
    track('client_error', { message: e.message, file: String(e.filename || '').split('/').pop(), line: e.lineno });
  });
  addEventListener('unhandledrejection', (e) => {
    if (left-- <= 0) return;
    track('client_error', { message: String(e.reason?.message || e.reason || 'unhandled rejection') });
  });
}
