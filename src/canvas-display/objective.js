import { domify } from 'min-dom';

import format from './format.js';

/**
 * What the run has accumulated: the objective the engine maintains as a global, written beneath the clock.
 *
 * It is the engine's own value and is written after each advance, the run being paced by what has been
 * drawn, so the number stands for the state the clock beside it shows. The objective is maintained in
 * `globals[Index::Objective]` by the engine and is therefore present in every token record of a log
 * from the new engine.
 *
 * The engine accumulates its objective assuming maximisation, which is the model's semantics and not a
 * setting. What the icon offers is therefore how the reader reads the number: `trending-up`, which is the
 * value as the engine holds it, or `trending-down`, which is the same run written as a minimisation, the
 * value multiplied by minus one. Clicking it says nothing to the engine.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {Element} parent  the display this reading stands in
 */
export default function createObjective(modeler, parent) {
  const eventBus = modeler.get('eventBus');

  const el = domify('<div class="wb-display-chip wb-objective"><span class="wb-display-value"></span>'
    + '<button type="button" class="wb-objective-sense"></button></div>');

  parent.appendChild(el);

  const valueEl = el.querySelector('.wb-display-value'),
        senseEl = el.querySelector('.wb-objective-sense');

  let value = null,      // what the engine holds, as the engine holds it
      maximising = true; // how the reader reads it, which is theirs and not the run's

  function draw() {
    valueEl.textContent = format(value === null || value === undefined ? value : (maximising ? value : -value));
    senseEl.innerHTML = maximising ? TRENDING_UP : TRENDING_DOWN;
    senseEl.title = maximising ? 'Objective (maximization)' : 'Objective (minimization)';
    senseEl.setAttribute('aria-label', senseEl.title);
  }

  // What the run has reached, which only a running engine has. Where it has none the reading is blank, which
  // is what a run that has not begun and a run that was refreshed both are.
  function set(next) {
    value = next === undefined ? null : next;
    draw();
  }

  // Shown where a run is active (greedy, manual, or playback). The objective is now maintained by the
  // engine in globals, so logs carry it in every token record.
  function setSource(source) {
    el.hidden = !(source === 'greedy' || source === 'manual' || source === 'playback');
  }

  senseEl.addEventListener('click', () => {
    maximising = !maximising;
    draw();
  });

  setSource(null);
  draw();

  // A source switch ends the run and refreshes it, so the reading it produced goes with it; how the reader
  // reads the number is theirs and survives, being about the reading rather than about the run.
  eventBus.on('source.changed', (event) => {
    set(null);
    setSource(event.source);
  });

  modeler.on('tokenPanel.refresh', () => set(null));

  return { element: el, set };
}

// Feather's trending-up and trending-down, the icon language the on-canvas controls of this application are
// drawn in.
const TRENDING_UP = trend('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>');
const TRENDING_DOWN = trend('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>');

function trend(paths) {
  return '<svg class="wb-display-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + paths
    + '</svg>';
}
