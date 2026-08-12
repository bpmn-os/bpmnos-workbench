import { domify } from 'min-dom';

import dseg7Url from 'dseg/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2';

import createClock from './clock.js';
import createObjective from './objective.js';

import './canvas-display.css';

// Register the seven-segment LCD font (DSEG7 Classic) once, from the bundled woff2, so a readout shows the
// digital face rather than falling back to a monospace. It is registered here rather than in either reading,
// both wearing it and neither owning it.
if (typeof FontFace !== 'undefined' && document.fonts) {
  try {
    const face = new FontFace('DSEG7 Classic', 'url(' + dseg7Url + ')', { weight: '700' });
    face.load().then(f => document.fonts.add(f)).catch(() => {});
  } catch (err) {
    // no FontFace support — the CSS monospace fallback stands in
  }
}

/**
 * What a run has reached, shown on the canvas: the readings a run has that belong to no token.
 *
 * There are two. The clock is the simulated time the player has drawn, and, where the reader advances time,
 * the control that advances it. The objective is what the run has accumulated, visible in all run modes
 * (greedy, manual, playback) since the engine now maintains it as a global. They stand one above the other
 * at the top right, in one appearance, and they are shown, aligned and blanked together: each is a reading
 * of the same run, so nothing about when a run begins, ends or is refreshed belongs to either of them.
 *
 * What a reading means is the reading's own: the clock takes a tick and wears the pulse while the engine
 * waits for one, and the objective says which way it is read. Neither knows of the other.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @returns {{ element: Element, setWaiting: (boolean) => void, setObjective: (number?) => void }}
 */
export default function createCanvasDisplay(modeler) {
  const canvas = modeler.get('canvas');
  const mode = modeler.get('mode', false);
  const eventBus = modeler.get('eventBus');

  const el = domify('<div class="wb-canvas-display"></div>');

  canvas.getContainer().appendChild(el);

  const clock = createClock(modeler, el);
  const objective = createObjective(modeler, el);

  // Shown outside Model mode, where there is a run to show a reading of. Visibility rather than display, so
  // the element keeps its box and stays measurable for the alignment below.
  function sync() {
    const active = mode && mode.getMode ? mode.getMode() !== 'model' : false;

    el.style.visibility = active ? '' : 'hidden';
  }

  // Match the on-canvas mode-toggle box exactly — same top, and the same height for every reading, one
  // reading being drawn as another and the box each stands in being part of that.
  function alignVCenter() {
    const ref = document.querySelector('.wb-mode-buttons');

    if (!ref) {
      return;
    }

    const cRect = canvas.getContainer().getBoundingClientRect(),
          rRect = ref.getBoundingClientRect();

    if (!rRect.height) {
      return;
    }

    el.style.top = Math.round(rRect.top - cRect.top) + 'px';
    [ clock.element, objective.element ].forEach((reading) => {
      reading.style.height = Math.round(rRect.height) + 'px';
    });
  }

  sync();

  requestAnimationFrame(alignVCenter);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(alignVCenter); // the LCD font changes a readout's height → re-align
  }
  window.addEventListener('resize', alignVCenter);

  eventBus.on('mode.changed', sync);

  return {
    element: el,
    setWaiting: clock.setWaiting,
    setObjective: objective.set
  };
}
