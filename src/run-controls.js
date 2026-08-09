import { createControlsEntry } from 'bpmn-js-animation';

/**
 * The controls a run is driven by, in the panel's footer.
 *
 * The footer spans the panel and stands under every column, which is where what governs the whole run
 * belongs: the transport drives the run, not the list of tokens, and the reader who is watching the canvas
 * should not have to open a column to pause it. It is the animation's own entry, so the Tokens tab is told
 * to draw none and there is one set of controls rather than two over one state.
 *
 * While the workbench is modelling there is no run, so the footer holds nothing; the panel draws no band for
 * an empty footer, so the panel is simply shorter. The element is held rather than rebuilt, so a run
 * interrupted by a look at the model is the same run when the reader comes back.
 *
 * @param {Object} modeler
 * @returns {{ element: Element, setLogButton: Function }}
 */
export default function createRunControls(modeler) {
  const sidePanel = modeler.get('sidePanel', false),
        playback = modeler.get('playback', false);

  let loaded = null;   // a log read from a file, which is what playback replays

  const controls = createControlsEntry({
    playback,
    primitives: modeler.get('primitives'),
    eventBus: modeler.get('eventBus'),
    animation: modeler.get('animation'),

    // What the transport plays is a log read from a file. A run that produces its own — the greedy engine,
    // the manual one — registers a log source with the transport instead, and then there is nothing to read.
    resolveLog: () => loaded || [],
    canStart: () => (loaded && loaded.length > 0)
      || !!(playback && playback.getLogSource && playback.getLogSource()),
    onLoad: (log) => { loaded = log; }
  });

  const footer = sidePanel && sidePanel.getSlots().footer;

  if (footer) {
    footer.appendChild(controls.element);
  }

  // A run is not modelled, so the footer is empty while the workbench is. The element is taken out and put
  // back rather than hidden: an empty footer is a footer the panel does not draw, which is what makes the
  // panel shorter rather than leaving a band of nothing under the columns.
  modeler.on('mode.changed', ({ mode }) => {
    if (!footer) {
      return;
    }

    if (mode === 'model') {
      controls.element.remove();
    } else if (!controls.element.parentNode) {
      footer.appendChild(controls.element);
    }
  });

  return {
    element: controls.element,
    setLogButton: controls.setLogButton
  };
}
