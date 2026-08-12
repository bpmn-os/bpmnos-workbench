import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css';
import 'bpmn-js-side-panel/assets/side-panel.css';
import 'bpmn-js-animation/assets/animation.css';
import 'bpmn-js-animation/assets/token-panel.css';
import 'bpmn-js-toolbar/assets/toolbar.css';
import 'bpmnos-js/bpmnos.css';        // the decision-task and execution-data-box icons
import './execution-state/execution-state.css'; // the token entry's status/data/globals body
import './archive-toggle.css';                  // what a tab keeps of what the run has finished with
import './panel-filter.css';                    // and which of what it keeps a heading narrows to
import './messages/messages.css';               // the offer to deliver a message to a waiting token
import './sequences/sequences.css';             // the divider of a performer's list
import './decisions/decisions.css';             // the controls a choice is made with
import './app.less';

import BpmnModeler from 'bpmn-js/lib/Modeler.js';

import { BpmnPropertiesPanelModule } from 'bpmn-js-properties-panel';
import SidePanelModule from 'bpmn-js-side-panel';

// A bpmn:DataStore behind every bpmn:DataStoreReference. bpmn-js creates the store's counterpart, a
// bpmn:DataObject, for every bpmn:DataObjectReference, and creates nothing for a store, so a store
// reference would refer to nothing and the globals it declares would have nowhere to live.
import DataStoreModule from 'bpmn-js-datastore';

import LintModule from 'bpmn-js-bpmnlint';
import getRules from 'bpmnos-js/rules';           // the authoritative BPMN-OS rule set (essentials + engine/* + bpmnos/*)
import IssuesPanelModule from 'bpmn-workbench/issues'; // self-registering "Issues" side-panel tab
import createToolbar from 'bpmn-js-toolbar';         // on-canvas file/view toolbar (load/save/export/zoom)

// bpmn-js-animation: the "Tokens" side-panel tab (run/pause, speed, Load log) and the model⇄playback mode
// controller. Playback itself is our native EngineLogPlayer, registered as the `playback` service the
// TokenPanel drives (see EnginePlaybackModule).
import { TokenPanelModule, ModeModule, AUTO_FOCUS_ICON } from 'bpmn-js-animation';

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
import SequencesModule from './sequences/index.js';      // → the "Sequences" tab
import DecisionsModule from './decisions/index.js';      // → the "Decisions" tab
import TokenRowsModule from './token-rows/index.js';     // token rows a decision panel mounts
import createLiveRun from './live/index.js';            // the run the wasm engine performs, greedy or manual
import createModeButtons, { modeIcon } from './mode-buttons.js';
import createRunControls from './run-controls.js';   // the transport and the log, in the panel's footer
import createCanvasDisplay from './canvas-display/index.js'; // what a run has reached, on the canvas

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

    // The controls a run is driven by stand in the panel's footer, under every column, since they govern
    // the run and not the list of tokens. The tab therefore draws none, and there is one set of them.
    controls: false,

    // expanding a token row shows what that token holds: its status, the data it reads, and the globals
    renderTokenDetail: createTokenDetailRenderer({ get: (name) => modeler.get(name) })
  },
  messagesPanel: {
    // a run sends the messages, so in Model mode the tab says how a run is started, as the Tokens tab does
    modelNote: runNote
  },
  sequencesPanel: {
    // a run has the performers, so in Model mode this tab says the same as the two above it
    modelNote: runNote
  },
  decisionsPanel: {
    // a run asks for the choices, so in Model mode this tab says the same as the three above it
    modelNote: runNote
  },
  mode: {
    // read-only outside Model mode, except for the execution data box (see `modeExceptions`)
    exceptions: modeExceptions
  },
  sidePanel: {
    parent: '#side-panel',
    width: '320px',
    // Every tab a column. A column closes to its resizer, so a reader who wants one tab at a time has it
    // by closing the others and keeps their names in reach, which is what the tabbed view offered and no
    // more; and the panel is then arranged the same way whatever mode the workbench is in.
    viewMode: 'columns',
    header: '<div class="wb-brand">'
      + '<span class="wb-brand-name">BPMNOS Workbench</span>'
      + '<a class="wb-brand-gh" href="https://github.com/bpmn-os/bpmnos-workbench" target="_blank"'
      + ' rel="noopener" title="View source on GitHub" aria-label="GitHub repository">'
      + '<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg></a>'
      + '</div>'
  },
  additionalModules: [
    DataStoreModule,     // → a bpmn:DataStore behind every bpmn:DataStoreReference
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
    SequencesModule,      // → the "Sequences" tab
    DecisionsModule,      // → the "Decisions" tab
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

// On-canvas file/view toolbar (load, save, export SVG, centre, zoom).
//
// Loading, saving and exporting are about the model, so they have no place while a run is on: the canvas is
// read-only there and a control that can say nothing should not be offered. Looking at a diagram is valid
// whatever is happening on it, so centre and zoom stay in every mode.
//
// Auto-focus takes their place while a run is on. It is about the canvas rather than about any panel: while
// it is on, every token the run touches brings its instance to the front and drills to its plane, so the
// step being played is the one in view. The setting belongs to the animator, so the button reads it, writes
// it, and follows it changing; the toolbar is told an icon, a type, an action, and which configuration to
// show, and knows none of the rest.
const toolbar = createToolbar(modeler, {
  buttons: {
    'auto-focus': {
      icon: AUTO_FOCUS_ICON,
      type: 'toggle',
      title: 'Auto-focus',
      pressed: modeler.get('animator').getAutoFocus(),
      action: (on) => modeler.get('animator').autoFocus(on)
    }
  },
  configurations: {
    model: [ 'load', 'save', 'export', 'center', 'zoom-in', 'zoom-out' ],
    run: [ 'auto-focus', 'center', 'zoom-in', 'zoom-out' ]
  },
  configuration: 'model'
});

// The three sources a run has here — manual, greedy and playback — all put the workbench in `playback`, so
// the toolbar knows two states where the workbench knows four.
modeler.on('mode.changed', ({ mode }) => toolbar.setConfiguration(mode === 'model' ? 'model' : 'run'));

// Whoever else writes the setting, the button says what it is.
modeler.on('autoFocus.changed', ({ autoFocus }) => toolbar.setPressed('auto-focus', autoFocus));

// Every column closed to begin with, each one opened by a double click on the resizer that carries its name.
// The workbench says this and not the panel: a module that registers a tab knows what that tab wants, and
// only the application knows the whole arrangement. A reader accordingly meets the diagram with the whole
// canvas and with the names of everything they may open standing beside it, and arranges from there.
[ 'properties', 'issues', 'tokens', 'messages', 'sequences', 'decisions' ]
  .forEach((id) => modeler.get('sidePanel').setTabOpen(id, false));

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

// What a run has reached, shown at the top right of the canvas: the simulated time, which while the reader
// drives the run is also the control that advances it, and beneath it the objective the engine has
// accumulated.
const display = createCanvasDisplay(modeler);

// The player writes the objective of every record it draws, the engine maintaining it as the first global,
// so it is handed the display as the live run is. It is handed over rather than injected because the display
// is made here, after the modeller stands and therefore after the playback service was instantiated.
modeler.get('playback').setDisplay(display);

// The run the engine performs, in either mode. Greedy and manual are one run differing in which of the
// controller's dispatchers answer, so one module owns the session and the mode toggle turns it over.
const liveRun = createLiveRun(modeler, display);

// The controls a run is driven by, in the panel's footer: run and pause with the speed beside them, and the
// three that act on the run as a whole. The mode buttons say which of the log controls may act, a run that
// produces its own log having nothing to read.
const runControls = createRunControls(modeler);

createModeButtons(modeler, liveRun, runControls);

// The modeller is reachable from the browser console while developing, so that a panel can be driven with a
// fixture through the very events a run uses. It is not exposed by a production build.
if (import.meta.env.DEV) {
  window.modeler = modeler;
}

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
