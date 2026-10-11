// THE SELECTION SLIDES (Saman, 2026-10-04: the sliding tabs picked from
// MicroKit, built here on our own tokens rather than copied).
//
// A segmented control used to jump: in one frame the old option lost its fill
// and the new one gained it, so the eye had to find where the choice had gone.
// Now one fill moves from the old option to the new, the way an iOS segmented
// control does, and the change reads as a single movement.
//
// The fill is a separate element behind the buttons (`.glider`, src/ui.css),
// placed over whichever button is selected. The selected button gives up its
// own fill while a glider stands in for it, so there is exactly one. Nothing
// about how a control is chosen changes: each page still marks its button
// `.active` or `aria-selected="true"`, and this watches for that.
//
// It moves only when the choice changes. Placed at load, on resize and when a
// hidden control first shows (a dialog opening), it is set without motion: a
// fill sliding in from nowhere is not a choice being made. Reduced motion sets
// it without motion always (the transition lives in ui.css, under the global
// reduce rule).

const isOn = (b) => b.classList.contains('active') || b.getAttribute('aria-selected') === 'true';

/**
 * Give a segmented control a sliding fill.
 * @param {HTMLElement|null} group the control; its buttons are its children
 */
export function glide(group) {
  if (!group || group.querySelector(':scope > .glider')) return;
  const mark = document.createElement('span');
  mark.className = 'glider still';
  mark.setAttribute('aria-hidden', 'true');
  group.prepend(mark);
  group.classList.add('has-glider');

  // ONE TRANSFORM CARRIES BOTH THE MOVE AND THE CHANGE OF SIZE (Saman,
  // 2026-10-04: the blue ran past the button, jumped, then settled). The fill
  // used to slide by transform but resize by width, and only a transform runs
  // off the main thread: when the page then redrew the plan for the new format
  // (a second of main thread), the fill arrived at the new button still the
  // old button's width, and its size caught up all at once. Now it takes its
  // new size at once and is drawn from the old box by translate + scale (the
  // FLIP technique), so the whole movement is one compositor animation.
  let box = null;   // where the fill rests: {x, y, w, h} in the group
  const place = (move) => {
    const on = [...group.children].find((b) => b !== mark && b.tagName === 'BUTTON' && isOn(b));
    if (!on || !on.offsetWidth) { mark.hidden = true; box = null; return; }
    const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
    // Re-marking the same choice (a page setting aria-selected again) is not a
    // move, and must not cut a slide short.
    if (move && box && !mark.hidden && to.x === box.x && to.y === box.y && to.w === box.w && to.h === box.h) return;
    const from = move && box && !mark.hidden ? box : null;
    mark.hidden = false;
    mark.classList.add('still');
    mark.style.width = `${to.w}px`;
    mark.style.height = `${to.h}px`;
    mark.style.transform = from
      ? `translate(${from.x}px, ${from.y}px) scale(${from.w / to.w}, ${from.h / to.h})`
      : `translate(${to.x}px, ${to.y}px)`;
    void mark.offsetWidth;   // commit the starting box before motion comes back
    mark.classList.remove('still');
    if (from) mark.style.transform = `translate(${to.x}px, ${to.y}px)`;
    box = to;
  };

  // A choice: a button's class or aria-selected changed. The glider's own
  // class is not a choice.
  new MutationObserver((list) => {
    if (list.some((m) => m.target !== mark)) place(true);
  }).observe(group, { subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
  // A layout change: resized, or shown for the first time.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => place(false)).observe(group);
  place(false);
}

/**
 * Run `fn` once the frame after a choice has been drawn. A control whose choice
 * starts heavy work (redrawing the plan) hands that work here, so the fill's
 * movement is committed to the compositor before the main thread is taken: it
 * then keeps moving while the work runs, instead of waiting it out.
 * @param {() => void} fn
 */
export const afterPaint = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));

/**
 * What a choice brought in arrives rather than appears: a short fade from part
 * way, on the same curve and step as the fill. Nothing under reduced motion.
 * @param {HTMLElement|null} el
 */
export function arrive(el) {
  if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 180, easing: 'cubic-bezier(.2, .8, .2, 1)' });
}
