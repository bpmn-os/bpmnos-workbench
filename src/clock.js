import { domify } from 'min-dom';

import dseg7Url from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2';

import './clock.css';

// Register the seven-segment LCD font (DSEG7 Classic) once, from the bundled woff2, so the readout shows
// the digital-clock face rather than falling back to a monospace.
if (typeof FontFace !== 'undefined' && document.fonts) {
  try {
    const face = new FontFace('DSEG7 Classic', 'url(' + dseg7Url + ')', { weight: '700' });
    face.load().then(f => document.fonts.add(f)).catch(() => {});
  } catch (err) {
    // no FontFace support — the CSS monospace fallback stands in
  }
}

/**
 * On-canvas simulation clock (top-right, fixed). Shows the current simulated time — the latest
 * clock-tick time streamed by the engine playback — as a right-aligned digital readout followed by the
 * BPMN timer-event clock face. Visible only outside `model` mode (i.e. during greedy / playback); the
 * time comes from the `playback` service's `playback.time` events.
 */

// The bpmn-js timer-event marker, reproduced exactly (bpmn:TimerEventDefinition): an r=11 circle, the two
// clock hands, and twelve tick marks (each a rotated copy). Same geometry/stroke widths as the diagram
// symbol; stroke inherits the clock colour (currentColor). viewBox is tight to the circle (18±12).
function timerIcon() {
  let ticks = '';
  for (let i = 0; i < 12; i++) {
    ticks += '<path stroke-width="1" transform="rotate(' + (i * 30) + ',18,18)" d="M 18,18 m 0,7.5 l -0,2.25"/>';
  }
  return '<svg class="wb-clock-icon" viewBox="6 6 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="18" cy="18" r="11" fill="#fff"/>'
    + '<path d="M 18,18 l 2.25,-7.5 m -2.25,7.5 l 5.25,1.5"/>'
    + ticks
    + '</svg>';
}

// Format a simulated-time number for the readout: integers as-is, otherwise trimmed to at most two
// decimals (BPMNOS timestamps are fixed-point and often whole numbers).
function fmt(t) {
  if (t == null) {
    return '––';
  }
  return Number.isInteger(t) ? String(t) : String(Math.round(t * 100) / 100);
}

export default function createClock(modeler) {
  const canvas = modeler.get('canvas');
  const mode = modeler.get('mode', false);
  const playback = modeler.get('playback', false);

  const el = domify('<div class="wb-clock"><span class="wb-clock-time"></span>' + timerIcon() + '</div>');
  canvas.getContainer().appendChild(el);
  const timeEl = el.querySelector('.wb-clock-time');

  function setTime(t) {
    timeEl.textContent = fmt(t);
  }

  // visible only outside model mode (greedy / playback share the `playback` mode). Toggle visibility (not
  // display) so the element keeps its box and stays measurable for the header alignment below.
  function sync() {
    const active = mode && mode.getMode ? mode.getMode() !== 'model' : false;
    el.style.visibility = active ? '' : 'hidden';
  }

  // Match the on-canvas mode-toggle box exactly — same top and same height — so the clock's
  // (semi-transparent) box lines up top and bottom with the toggles; the content centres within it.
  function alignVCenter() {
    const ref = document.querySelector('.wb-mode-buttons');
    if (!ref) {
      return;
    }
    const cRect = canvas.getContainer().getBoundingClientRect();
    const rRect = ref.getBoundingClientRect();
    if (!rRect.height) {
      return;
    }
    el.style.top = Math.round(rRect.top - cRect.top) + 'px';
    el.style.height = Math.round(rRect.height) + 'px';
  }

  setTime(playback && playback.getTime ? playback.getTime() : null);
  sync();

  requestAnimationFrame(alignVCenter);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(alignVCenter); // the LCD font changes the readout height → re-align
  }
  window.addEventListener('resize', alignVCenter);

  modeler.on('playback.time', event => setTime(event.time));
  // a new run resets the clock (play() clears the time) — reflect the current time on any transport change
  modeler.on('playback.changed', () => setTime(playback && playback.getTime ? playback.getTime() : null));
  // footer Refresh clears the run — blank the readout back to its pre-run state (fires after playback.stop)
  modeler.on('tokenPanel.refresh', () => setTime(null));
  modeler.on('mode.changed', sync);

  return el;
}
