import {
  domify,
  classes as domClasses,
  event as domEvent
} from 'min-dom';

import './mode-buttons.css';

/**
 * On-canvas **Playback** button (top-left, above the palette) — same look as bpmn-workbench's mode
 * buttons. Greyed = **Model** (editing); activating it enters **playback**, clicking it again returns to
 * Model. The heavy lifting (disable editing, clear tokens) is done by bpmn-js-animation's `mode`
 * controller — this button just calls `mode.setMode(...)`, reflects the current mode, and brings the
 * matching side-panel tab to the front (Issues in Model, Tokens in Playback). Manual and greedy
 * simulation are later work packages — hence a single button for now.
 */
// The composite mode icon (a thin outline ring with an inner glyph) as an HTML string, so the on-canvas
// button and the Tokens-panel "model" note use the exact same visuals. Pass `mode` to make the icon a
// clickable mode switch (the TokenPanel wires data-set-mode).
export function modeIcon(inner, mode) {
  const attr = mode ? ' data-set-mode="' + mode + '"' : '';
  return '<span class="fa-stack wb-mode-icon"' + attr + '>'
    + '<i class="far fa-circle fa-stack-2x"></i>'
    + '<i class="fas ' + inner + ' fa-stack-1x wb-mode-inner"></i>'
    + '</span>';
}

export default function createModeButtons(modeler) {
  const mode = modeler.get('mode');
  const canvas = modeler.get('canvas');
  const sidePanel = modeler.get('sidePanel', false);
  const container = canvas.getContainer();

  const el = domify(`
    <div class="wb-mode-buttons">
      <button type="button" data-mode="playback" title="Playback">${modeIcon('fa-play wb-mode-play')}</button>
    </div>
  `);
  container.appendChild(el);

  const buttons = Array.from(el.querySelectorAll('button'));

  function render() {
    const current = mode.getMode();
    buttons.forEach(b => domClasses(b).toggle('active', b.getAttribute('data-mode') === current));
  }

  buttons.forEach(b => domEvent.bind(b, 'click', () => {
    const target = b.getAttribute('data-mode');
    // toggle: clicking the active mode returns to Model
    mode.setMode(mode.getMode() === target ? 'model' : target);
  }));

  modeler.on('mode.changed', event => {
    render();
    if (sidePanel) {
      sidePanel.activate(event.mode === 'model' ? 'issues' : 'tokens');
    }
  });

  render();
  return el;
}
