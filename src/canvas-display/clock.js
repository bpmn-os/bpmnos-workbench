import { domify } from 'min-dom';

import format from './format.js';

/**
 * The simulated time a run has reached, and, where the reader advances time, the control that advances it.
 *
 * The time shown is the latest the player has drawn, which is what the canvas shows, and it comes from the
 * `playback` service's own events rather than from anything asked of the engine. A new run and a refresh
 * blank it back to what it read before a run began.
 *
 * While the reader advances time the readout is also a control: it takes the pointer, answers on hover, and
 * a click fires `clock.tick`. It says nothing about what a tick does — whatever drives the engine listens
 * for that event — and it wears the pulse a token wears when it waits for the reader, set through
 * `setWaiting` by whatever knows the engine has stalled. A tick is offered only while it can be answered,
 * which is the engine waiting with the diagram caught up.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {Element} parent  the display this reading stands in
 */
export default function createClock(modeler, parent) {
  const playback = modeler.get('playback', false),
        eventBus = modeler.get('eventBus');

  const el = domify('<div class="wb-display-chip wb-clock"><span class="wb-display-value"></span>'
    + timerIcon() + '</div>');

  parent.appendChild(el);

  const timeEl = el.querySelector('.wb-display-value');

  function setTime(t) {
    timeEl.textContent = format(t);
  }

  // the clock is a control only where a tick means something, which is the source the reader drives
  function setInteractive(on) {
    el.classList.toggle('wb-clock-interactive', !!on);

    if (!on) {
      setWaiting(false);
    }
  }

  // the engine is waiting for a tick
  function setWaiting(on) {
    el.classList.toggle('wb-clock-waiting', !!on);
  }

  el.addEventListener('click', () => {
    if (el.classList.contains('wb-clock-interactive') && el.classList.contains('wb-clock-waiting')) {
      eventBus.fire('clock.tick', {});
    }
  });

  setTime(playback && playback.getTime ? playback.getTime() : null);

  // the readout follows the run itself, which a source switch has already ended and refreshed by now
  eventBus.on('source.changed', (event) => setInteractive(event.source === 'manual'));

  modeler.on('playback.time', (event) => setTime(event.time));
  // a new run resets the clock (play() clears the time) — reflect the current time on any transport change
  modeler.on('playback.changed', () => setTime(playback && playback.getTime ? playback.getTime() : null));
  // footer Refresh clears the run — blank the readout back to its pre-run state (fires after playback.stop)
  modeler.on('tokenPanel.refresh', () => setTime(null));

  return { element: el, setWaiting };
}

// The bpmn-js timer-event marker, reproduced exactly (bpmn:TimerEventDefinition): an r=11 circle, the two
// clock hands, and twelve tick marks (each a rotated copy). Same geometry and stroke widths as the diagram
// symbol; the stroke inherits the display's colour. The viewBox is tight to the circle (18±12).
function timerIcon() {
  let ticks = '';

  for (let i = 0; i < 12; i++) {
    ticks += '<path stroke-width="1" transform="rotate(' + (i * 30) + ',18,18)" d="M 18,18 m 0,7.5 l -0,2.25"/>';
  }

  return '<svg class="wb-display-icon" viewBox="6 6 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="18" cy="18" r="11" fill="#fff"/>'
    + '<path d="M 18,18 l 2.25,-7.5 m -2.25,7.5 l 5.25,1.5"/>'
    + ticks
    + '</svg>';
}
