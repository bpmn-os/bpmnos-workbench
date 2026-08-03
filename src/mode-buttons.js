import {
  domify,
  classes as domClasses,
  event as domEvent
} from 'min-dom';

import './mode-buttons.css';

/**
 * On-canvas mode buttons (top-left, above the palette) — same look as bpmn-workbench. Three sources share
 * bpmn-js-animation's **playback** animation mode (editing off, token rendering, the Tokens-tab
 * transport): **manual** (a hand) runs the engine with the user advancing time and taking the decisions;
 * **greedy** (microchip) runs the wasm engine to the end and replays it; **playback** (play) replays a
 * loaded log. Greyed = **Model** (editing). The bar tracks which source is active. `greedy` is the
 * controller from createGreedy.
 */

// FontAwesome 6 free icon paths, inlined (no icon font / CDN). The ring is `circle` (regular); the inner
// glyph is a solid icon composed at fa-stack proportions (glyph at half the ring, centred). `w` is the
// glyph's native viewBox width (all FA icons are 512 tall); `dx` optically re-centres it.
const RING = 'M464 256a208 208 0 1 0 -416 0 208 208 0 1 0 416 0zM0 256a256 256 0 1 1 512 0 256 256 0 1 1 -512 0z';
const GLYPHS = {
  manual: { // hand-pointer (solid) — the same glyph bpmn-workbench uses for its manual simulation
    d: 'M448 240v96c0 3.084-.356 6.159-1.063 9.162l-32 136C410.686 499.23 394.562 512 376 512H168a40.004 40.004 0 0 1-32.35-16.473l-127.997-176c-12.993-17.866-9.043-42.883 8.822-55.876 17.867-12.994 42.884-9.043 55.877 8.823L104 315.992V40c0-22.091 17.908-40 40-40s40 17.909 40 40v200h8v-40c0-22.091 17.908-40 40-40s40 17.909 40 40v40h8v-24c0-22.091 17.908-40 40-40s40 17.909 40 40v24h8c0-22.091 17.908-40 40-40s40 17.909 40 40z',
    w: 448
  },
  greedy: { // microchip (solid)
    d: 'M176 24c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 40c-35.3 0-64 28.7-64 64l-40 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l40 0 0 56-40 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l40 0 0 56-40 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l40 0c0 35.3 28.7 64 64 64l0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40 56 0 0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40 56 0 0 40c0 13.3 10.7 24 24 24s24-10.7 24-24l0-40c35.3 0 64-28.7 64-64l40 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-40 0 0-56 40 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-40 0 0-56 40 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-40 0c0-35.3-28.7-64-64-64l0-40c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 40-56 0 0-40c0-13.3-10.7-24-24-24s-24 10.7-24 24l0 40-56 0 0-40zM160 128l192 0c17.7 0 32 14.3 32 32l0 192c0 17.7-14.3 32-32 32l-192 0c-17.7 0-32-14.3-32-32l0-192c0-17.7 14.3-32 32-32zm16 48l0 160 160 0 0-160-160 0z',
    w: 512
  },
  playback: { // play (solid)
    d: 'M91.2 36.9c-12.4-6.8-27.4-6.5-39.6 .7S32 57.9 32 72l0 368c0 14.1 7.5 27.2 19.6 34.4s27.2 7.5 39.6 .7l336-184c12.8-7 20.8-20.5 20.8-35.1s-8-28.1-20.8-35.1l-336-184z',
    w: 448, dx: 8
  }
};

// The composite mode icon (an outline ring with a small centred inner glyph) as one inline SVG string, so
// the on-canvas buttons and the Tokens-panel "model" note use the exact same visuals. `glyph` is a GLYPHS
// key: 'greedy' (a microchip) or 'playback' (a play triangle). Pass `source` to make it a clickable inline
// switch in the model note — createModeButtons delegates clicks on `data-mode-source` to setSource (NOT the
// TokenPanel's `data-set-mode`, whose raw mode.setMode would reject 'greedy', which is a source not a mode).
export function modeIcon(glyph, source) {
  const g = GLYPHS[glyph];
  const attr = source ? ' data-mode-source="' + source + '"' : '';
  const tx = g ? Math.round((512 - g.w * 0.5) / 2) + (g.dx || 0) : 0;
  return '<svg class="wb-mode-icon"' + attr + ' viewBox="0 0 512 512" fill="currentColor" aria-hidden="true">'
    + '<path d="' + RING + '"/>'
    + (g ? '<g transform="translate(' + tx + ' 128) scale(0.5)"><path d="' + g.d + '"/></g>' : '')
    + '</svg>';
}

export default function createModeButtons(modeler, greedy, manual) {
  const mode = modeler.get('mode');
  const eventBus = modeler.get('eventBus');
  const canvas = modeler.get('canvas');
  const sidePanel = modeler.get('sidePanel', false);
  const animation = modeler.get('animation', false);
  const playback = modeler.get('playback', false);
  const tokenPanel = modeler.get('tokenPanel', false);
  const container = canvas.getContainer();

  const el = domify(`
    <div class="wb-mode-buttons">
      <button type="button" data-source="manual" title="Manual simulation">${modeIcon('manual')}</button>
      <button type="button" data-source="greedy" title="Greedy simulation">${modeIcon('greedy')}</button>
      <button type="button" data-source="playback" title="Playback">${modeIcon('playback')}</button>
    </div>
  `);
  container.appendChild(el);

  const buttons = Array.from(el.querySelectorAll('button'));
  let source = null; // 'manual' | 'greedy' | 'playback' | null (= model / editing)

  function render() {
    buttons.forEach(b => domClasses(b).toggle('active', b.getAttribute('data-source') === source));
  }

  // A source switch is a fresh session and does what the panel's Refresh does: the run ends, the tokens
  // are cleared, and the refresh is announced, whereupon each source gives up its run and the clock blanks.
  // The stop is awaited so that nothing is still being drawn when the canvas is cleared.
  async function refreshSession() {
    if (playback) {
      await playback.stop();
    }
    if (animation) {
      animation.clear();
    }
    eventBus.fire('tokenPanel.refresh', {});
  }

  async function setSource(requested) {
    const next = requested === source ? null : requested; // clicking the active source returns to Model
    if (next !== source) {
      await refreshSession();
    }
    source = next;
    if (source === 'manual') {
      greedy && greedy.deactivate();
      mode.setMode('playback'); // editing off + token rendering; the run is driven by the user
      manual && manual.activate();
    } else if (source === 'greedy') {
      manual && manual.deactivate();
      mode.setMode('playback'); // editing off + token rendering; greedy adds its Input tab
      greedy && greedy.activate();
    } else if (source === 'playback') {
      manual && manual.deactivate();
      greedy && greedy.deactivate();
      mode.setMode('playback');
    } else {
      manual && manual.deactivate();
      greedy && greedy.deactivate();
      mode.setMode('model');
    }
    // greedy produces the engine log → offer "Save log"; playback replays a file → "Load log". Both run
    // in the anim 'play' mode, so the panel can't tell them apart on its own — bpmnos owns this choice.
    if (tokenPanel && tokenPanel.setLogButton) {
      tokenPanel.setLogButton(source === 'playback' ? 'load' : 'save');
    }
    // The mode service knows `model` and `playback`, and all three sources are the latter to it, so what
    // tells them apart is announced here: whatever needs to know which source is running listens for this.
    eventBus.fire('source.changed', { source });
    render();
  }

  buttons.forEach(b => domEvent.bind(b, 'click', () => setSource(b.getAttribute('data-source'))));

  // A "model note" repeats these icons inline (modeIcon(..., source) → data-mode-source), in the Tokens tab
  // and in the Messages tab. Delegate clicks on the element holding the panes, so an icon switches source
  // whichever tab shows it — same path as the buttons, surviving the note being re-rendered and needing no
  // list of tabs kept in step with the panel. (We do NOT use the TokenPanel's data-set-mode, whose raw
  // mode.setMode would throw on 'greedy'.)
  const tokensPane = sidePanel && sidePanel.getTab && sidePanel.getTab('tokens'),
        panes = tokensPane && tokensPane.pane && tokensPane.pane.parentNode;
  if (panes) {
    domEvent.bind(panes, 'click', event => {
      const icon = event.target.closest && event.target.closest('[data-mode-source]');
      if (icon) {
        setSource(icon.getAttribute('data-mode-source'));
      }
    });
  }

  modeler.on('mode.changed', event => {
    // an external switch back to Model (e.g. via another control) clears the active source
    if (event.mode === 'model' && source) {
      source = null;
      manual && manual.deactivate();
      greedy && greedy.deactivate();
    }
    render();
    // The tab the user is on is theirs: a mode switch changes what a tab shows, the Tokens tab gaining its
    // controls and the Properties tab its note, and moving them elsewhere while they read would be the
    // control taking the panel over.
  });

  render();
  return el;
}
