// Client-side L1 runner: quality-gated upload → wireframe + extraction,
// with stepwise status callbacks (handoff UX principle 6 — transparent
// processing status, no generic spinners).
//
// mode 'mock': bundled sample plan, fully client-side, zero API spend.
// mode 'live': POSTs to the server adapter endpoints (key stays server-side).

import { makeMockPlan } from './mock-plan.js';
import { makeMockWireframe, mockExtraction } from './mock-l1.js';
import { frameForModel } from './aspect.js';
import { register } from './review/registration.js';
import { postAI } from './api.js';
import { ATTEMPTS, newJobId } from './credit-jobs.js';
import { apiUrl } from './api-origin.js';

const loadImage = (src) => new Promise((res, rej) => {
  const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
});

export async function fetchHealth() {
  try {
    const r = await fetch(apiUrl('/api/health'));
    if (!r.ok) return { live: false };
    return await r.json();
  } catch {
    return { live: false };
  }
}

/**
 * @param {File|null} file - null in mock mode (bundled sample)
 * @param {'mock'|'live'} mode
 * @param {(stage:string, state:'run'|'done'|'error', detail?:string)=>void} onStage
 * @returns {{ sourceUrl, wireframeUrl, extraction }}
 */
export async function runL1(file, mode, onStage) {
  if (mode === 'mock') return runMock(onStage);
  return runLive(file, onStage);
}

async function runMock(onStage) {
  await document.fonts.load('500 20px Roboto');
  onStage('read', 'run');
  const plan = makeMockPlan();
  await delay(500);
  onStage('read', 'done', 'bundled sample plan (1600×1200)');

  onStage('extract', 'run');
  await delay(900);
  const extraction = mockExtraction();
  onStage('extract', 'done', `identified ${extraction.spaceCount} spaces`);

  onStage('wireframe', 'run');
  await delay(1200);
  const wf = makeMockWireframe();
  onStage('wireframe', 'done');

  return { sourceUrl: plan.toDataURL('image/png'), wireframeUrl: wf.toDataURL('image/png'), extraction };
}

// The wireframe is the accuracy FOUNDATION: every later check — label anchors,
// the styling registration, the text guard — is measured against it, not
// against the customer's plan. A wireframe that merged two rooms therefore
// passes everything downstream, because everything downstream agrees with it.
//
// Despite that, it used to be generated once and accepted unconditionally,
// while the styling pass — which is not load-bearing for accuracy — got three
// verified attempts. This closes that asymmetry.
//
// Only the silhouette check is used: it is source-anchored and measured
// reliable (0.04–0.5% on good pairs, 16–212% on broken ones). Space counting is
// deliberately NOT checked here — three approaches were measured and rejected
// (geometric flood fill, model read-back, reverse coverage), all unstable
// enough to fire on good plans. That one stays a human confirmation.
//
// The re-draws are FREE: the limit is taken from src/credit-jobs.js, which
// derives the free-retry budget from it, and every attempt of one upload
// carries the same job id. Charging for a re-draw would charge the customer for
// our silhouette check failing.
const MAX_WIREFRAME_ATTEMPTS = ATTEMPTS['/api/wireframe'];

async function renderWireframe(post, sourceUrl, onStage) {
  const source = await loadImage(sourceUrl);
  let last = null;
  for (let attempt = 1; attempt <= MAX_WIREFRAME_ATTEMPTS; attempt++) {
    if (attempt > 1) onStage('wireframe', 'run', `re-drawing (attempt ${attempt}, no extra credit)`);
    const j = await post('/api/wireframe');
    const url = `data:${j.mimeType};base64,${j.imageBase64}`;
    const img = await loadImage(url);
    const reg = register(source, img);
    last = { url, base64: j.imageBase64, registration: reg, attempts: attempt };
    if (reg.aspectDev <= reg.aspectTolerance) {
      onStage('wireframe', 'done',
        attempt > 1 ? `matched the plan on attempt ${attempt}` : undefined);
      return last;
    }
    onStage('wireframe', 'run', `outline ${(reg.aspectDev * 100).toFixed(1)}% apart, re-drawing`);
  }
  // Out of attempts: hand it back anyway, flagged. The Review Station already
  // shows the mismatch, and throwing would discard a render we paid for.
  //
  // "still off by X%" asserted a defect. The check did not find one — it
  // failed to confirm, which on a construction sheet is the normal reading
  // even when the drawing is right. Say that, and point at the one thing that
  // can actually settle it.
  onStage('wireframe', 'done',
    `outline not confirmed, ${(last.registration.aspectDev * 100).toFixed(1)}% apart. Compare in the X-Ray`);
  return last;
}

async function runLive(file, onStage) {
  onStage('read', 'run');
  const { base64, mimeType, dataUrl } = await fileToBase64(file);
  onStage('read', 'done', `${file.name} (${Math.round(file.size / 1024)} KB)`);

  // The wireframe must come back the same shape as the plan that went in.
  // Naming the nearest permitted frame is what stops the model choosing its own
  // and redrawing the plan to fill it (src/aspect.js).
  const srcImg = await loadImage(dataUrl);
  // Trimmed to the drawing, then padded to that exact frame, so the model has
  // no gap to close by stretching the plan — neither the canvas's nor the
  // drawing's. The extraction pass reads the same image; trimming white margin
  // changes nothing it is asked to transcribe. See frameForModel.
  const { canvas: framedCanvas, aspectRatio } = frameForModel(srcImg);
  const framedUrl = aspectRatio ? framedCanvas.toDataURL('image/png') : dataUrl;
  const framed = framedUrl === dataUrl
    ? { data: base64, type: mimeType }
    : { data: framedUrl.split(',')[1], type: 'image/png' };

  // One upload is one job. Shared by every call below, which is safe because
  // the meter keys a job by ENDPOINT as well: the extraction and the read-back
  // are each charged once regardless, and only the wireframe's own re-draws
  // ride on the free-retry budget.
  const jobId = newJobId();
  const body = JSON.stringify({ imageBase64: framed.data, mimeType: framed.type, aspectRatio, jobId });
  const post = (path) => postAI(path, body);

  // The two AI passes run in PARALLEL (handoff L1).
  onStage('extract', 'run');
  onStage('wireframe', 'run');
  const extractP = post('/api/extract').then((j) => {
    onStage('extract', 'done', `identified ${j.extraction?.spaceCount ?? '?'} spaces`);
    return j.extraction;
  }).catch((e) => { onStage('extract', 'error', e.message); throw e; });
  const wireframeP = renderWireframe(post, framedUrl, onStage)
    .catch((e) => { onStage('wireframe', 'error', e.message); throw e; });

  // Settle both before deciding. Promise.all would reject the moment the cheap
  // extraction failed and throw away the wireframe — the expensive render we
  // already paid for. Now a failure in one never discards the other.
  const [exSettled, wfSettled] = await Promise.allSettled([extractP, wireframeP]);
  if (wfSettled.status === 'rejected') throw wfSettled.reason;
  const wireframe = wfSettled.value;
  if (exSettled.status === 'rejected') {
    const err = new Error(`The wireframe rendered, but reading the plan's rooms failed: ${exSettled.reason.message}`);
    err.partial = { wireframeUrl: wireframe.url };   // keep the paid render recoverable
    throw err;
  }
  const extraction = exSettled.value;

  // Third pass: read the wireframe's own labels back and cross-check them
  // against the source reading. Corrupted numbers are invisible to the user
  // otherwise, because the composite draws from the extraction JSON.
  onStage('crosscheck', 'run');
  let readBack = null;
  try {
    const j = await postAI('/api/read-back-labels',
      { imageBase64: wireframe.base64, mimeType: 'image/png' });
    readBack = j.labels || [];
    const { crossCheckDimensions } = await import('./review/crosscheck.js');
    const cc = crossCheckDimensions(extraction.spaces, readBack);
    onStage('crosscheck', cc.disagreed ? 'warn' : 'done',
      cc.disagreed
        ? `${cc.disagreed} dimension${cc.disagreed > 1 ? 's' : ''} disagree between the two readings`
        : `${cc.agreed} dimensions confirmed by two independent readings`);
  } catch (e) {
    // A failed cross-check must never block the plan — it is an extra check.
    onStage('crosscheck', 'error', e.message);
  }

  return { sourceUrl: dataUrl, wireframeUrl: wireframe.url, extraction, readBack };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = fr.result;
      resolve({ dataUrl, base64: dataUrl.split(',')[1], mimeType: file.type });
    };
    fr.onerror = () => reject(new Error('Could not read file'));
    fr.readAsDataURL(file);
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
