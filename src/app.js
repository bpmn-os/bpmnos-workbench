import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css';
import 'bpmn-js-side-panel/assets/side-panel.css';
import 'bpmn-js-animation/assets/animation.css';
import 'bpmn-js-animation/assets/token-panel.css';
import 'bpmnos-js/bpmnos.css';        // the decision-task and execution-data-box icons
import './execution-state/execution-state.css'; // the token entry's status/data/globals body
import './messages/messages.css';               // the offer to deliver a message to a waiting token
import './app.less';

import BpmnModeler from 'bpmn-js/lib/Modeler.js';

import { BpmnPropertiesPanelModule } from 'bpmn-js-properties-panel';
import SidePanelModule from 'bpmn-js-side-panel';

import LintModule from 'bpmn-js-bpmnlint';
import getRules from 'bpmnos-js/rules';           // the authoritative BPMN-OS rule set (essentials + engine/* + bpmnos/*)
import IssuesPanelModule from 'bpmn-workbench/issues'; // self-registering "Issues" side-panel tab
import createToolbar from 'bpmn-workbench/toolbar';   // on-canvas file/view toolbar (open/save/export/zoom)

// bpmn-js-animation: the "Tokens" side-panel tab (run/pause, speed, Load log) and the model⇄playback mode
// controller. Playback itself is our native EngineLogPlayer, registered as the `playback` service the
// TokenPanel drives (see EnginePlaybackModule).
import { TokenPanelModule, ModeModule } from 'bpmn-js-animation';

// BPMNOS bpmn-js modules: the moddle extension + the decision-task decorator and properties panel.
import BPMNOSModdleDescriptor from 'bpmnos-js/moddle';
import BPMNOSModule from 'bpmnos-js';
import ExecutionDataModule from 'bpmnos-js/execution-data'; // the `executionData` registry service
import AnnotationModule, { annotationRole } from 'bpmnos-js/annotation'; // the on-canvas execution data box
import ContextPadCompatModule from './context-pad-compat.js';

// native BPMN-OS execution-log playback (this repo) — overrides the packaged `playback` service
import EnginePlaybackModule from './playback/index.js';
// → `executionState`: the values a run produces, and the body of a token entry that shows them
import ExecutionStateModule, { createTokenDetailRenderer } from './execution-state/index.js';
import MessagesModule from './messages/index.js';        // → the "Messages" tab
import TokenRowsModule from './token-rows/index.js';     // token rows a decision panel mounts
import createGreedy from './greedy/index.js';           // greedy simulation: runs the wasm engine live
import createManual from './manual/index.js';           // manual simulation: the user advances the run
import createModeButtons, { modeIcon } from './mode-buttons.js';
import createClock from './clock.js';               // on-canvas simulation clock (top-right)

import newDiagram from 'bpmnos-js/newDiagram.bpmn?raw'; // the authoritative BPMN-OS starter (status + instance data)

const moddleExtensions = {
  bpmnos: BPMNOSModdleDescriptor
};

/**
 * What stays editable while a simulation or a playback is on.
 *
 * The canvas is read-only there, since the process is not being edited, but an execution data box is about
 * reading a model rather than changing one: it is opened to see what a node declares, pushed aside when it
 * covers something, and widened when its content is cut off. So the lightbulb keeps working, and a box may
 * be created, moved, resized and deleted, while everything else stays as read-only as before. Such a box is
 * a `bpmn:TextAnnotation` in the model, so this does write to the model and to its undo history, which is
 * right for something the user does on purpose.
 *
 * `bpmnos-js` says what an element is to a box and the mode says what may be done while a run is on; this is
 * the whole of what joins the two.
 */
const modeExceptions = [ {
  operations: [
    'appendShape',    // the lightbulb, which appends the box to its host
    'updateProperties', // showing and hiding it
    'moveShape', 'moveElements', 'moveConnection', 'layoutConnection', // pushing it aside
    'resizeShape',    // widening it
    'removeElements', 'removeShape', 'removeConnection' // taking it away again
  ],
  entries: [ 'bpmnos-annotation' ],
  applies: (operation, element) => {
    const role = annotationRole(element);

    // creating a box is an operation on the element that gets one; everything else is on the box itself,
    // or on the association, which follows its box
    return operation === 'appendShape' || operation === 'contextPad'
      ? !!role
      : role === 'box' || role === 'association';
  }
} ];

// The side panel auto-hosts the properties panel as its first "Properties" tab (we deliberately do not
// set the properties panel's own `parent`); IssuesPanelModule adds "Issues", TokenPanelModule adds "Tokens".
// Both tabs a run concerns say the same thing while there is no run: how one is started. The icons are the
// on-canvas mode buttons' own, and a click on one switches source through the same path they do.
const runNote = 'Click ' + modeIcon('manual', 'manual')
  + ' to simulate manually, ' + modeIcon('greedy', 'greedy')
  + ' to start/end a greedy simulation, or ' + modeIcon('playback', 'playback')
  + ' to start/end playback of execution logs.';

const modeler = new BpmnModeler({
  container: '#canvas',
  linting: {
    bpmnlint: getRules()
  },
  tokenPanel: {
    // shown in the Tokens tab while in Model mode — points at the on-canvas mode buttons (same icons)
    modelNote: runNote,

    // expanding a token row shows what that token holds: its status, the data it reads, and the globals
    renderTokenDetail: createTokenDetailRenderer({ get: (name) => modeler.get(name) })
  },
  messagesPanel: {
    // a run sends the messages, so in Model mode the tab says how a run is started, as the Tokens tab does
    modelNote: runNote
  },
  mode: {
    // read-only outside Model mode, except for the execution data box (see `modeExceptions`)
    exceptions: modeExceptions
  },
  sidePanel: {
    parent: '#side-panel',
    width: '320px',
    header: '<div class="wb-brand">'
      + '<span class="wb-brand-name">BPMNOS Workbench</span>'
      + '<a class="wb-brand-gh" href="https://github.com/bpmn-os/bpmnos-workbench" target="_blank"'
      + ' rel="noopener" title="View source on GitHub" aria-label="GitHub repository">'
      + '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>'
      + '</div>'
  },
  additionalModules: [
    BpmnPropertiesPanelModule,
    BPMNOSModule,
    ExecutionDataModule, // → `executionData`: what each element declares and inherits (not in the full module)
    AnnotationModule,    // → the on-canvas execution data box, opened from the context pad's lightbulb
    ContextPadCompatModule,
    SidePanelModule,
    LintModule,
    IssuesPanelModule,
    TokenPanelModule,     // → "Tokens" tab (run/pause, speed, Load log)
    ModeModule,           // → mode.setMode('model'|'playback')
    ExecutionStateModule, // → `executionState`: status, data and globals per token, written by the player
    MessagesModule,       // → the "Messages" tab
    TokenRowsModule,      // token rows, drawn as the Tokens tab draws them, for panels that decide
    EnginePlaybackModule  // → overrides `playback` with the native engine-log player (list last)
  ],
  moddleExtensions
});

// Fit the diagram to the viewport whenever a model is imported and rendered — the toolbar's "Center"
// action (canvas fit-viewport), invoked automatically. Covers the initial diagram, toolbar "Open", and
// the ?src= deep-link below.
modeler.on('import.done', () => {
  try {
    modeler.get('canvas').zoom('fit-viewport', 'auto');
  } catch (err) {
    // nothing to fit (e.g. an import that didn't render) — ignore
  }
});

modeler.importXML(newDiagram).catch(err => console.error('failed to import diagram', err));

// On-canvas file/view toolbar (open, save, export SVG, centre, zoom) — packaged by bpmn-workbench.
createToolbar(modeler);

// The Properties tab holds no meaning while a run is on: the canvas is read-only, so its fields would edit
// a model that is not being edited. The tab keeps its title and its place and says what may be done
// instead, which is to read what an element declares from its execution data box. The Tokens tab does the
// same the other way round, showing a note while the workbench is in Model mode.
const propertiesNote = 'Select an element and click '
  + '<span class="bpmnos-icon-annotation-show wb-note-icon"></span> or '
  + '<span class="bpmnos-icon-annotation-hide wb-note-icon"></span> '
  + 'to show or hide its execution data.';

modeler.on('mode.changed', ({ mode }) => {
  const sidePanel = modeler.get('sidePanel', false);

  if (sidePanel && sidePanel.getTab('properties')) {
    sidePanel.setNote('properties', mode === 'model' ? null : propertiesNote);
  }
});

// On-canvas simulation clock (top-right): the current clock-tick time, and, while the user drives the run,
// the control that advances it.
const clock = createClock(modeler);

// The on-canvas mode toggles: manual simulation (a hand, the user advances the run), greedy simulation
// (microchip, runs the wasm engine to the end) and playback (play).
const greedy = createGreedy(modeler);
const manual = createManual(modeler, clock);
createModeButtons(modeler, greedy, manual);

// Optional deep-linking: ?src=<url> loads a diagram on startup.
const src = new URL(window.location.href).searchParams.get('src');
if (src) {
  const xhttp = new XMLHttpRequest();
  xhttp.onreadystatechange = function() {
    if (this.readyState === 4 && this.status === 200) {
      modeler.importXML(xhttp.responseText);
    } else if (this.readyState === 4) {
      console.warn('Failed to load ' + src + ' (status ' + this.status + ')');
    }
  };
  xhttp.open('GET', src, true);
  xhttp.send();
}
