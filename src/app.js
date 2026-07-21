import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import '@bpmn-io/properties-panel/dist/assets/properties-panel.css';
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css';
import 'bpmn-js-side-panel/assets/side-panel.css';
import 'bpmn-js-animation/assets/animation.css';
import 'bpmn-js-animation/assets/token-panel.css';
import './bpmnos.css';
import './app.less';

import BpmnModeler from 'bpmn-js/lib/Modeler';

import { BpmnPropertiesPanelModule } from 'bpmn-js-properties-panel';
import SidePanelModule from 'bpmn-js-side-panel';

import LintModule from 'bpmn-js-bpmnlint';
import getRules from 'bpmn-workbench/rules';      // essential model-checking rules (bundle carries rationales)
import IssuesPanelModule from 'bpmn-workbench/issues'; // self-registering "Issues" side-panel tab
import createToolbar from 'bpmn-workbench/toolbar';   // on-canvas file/view toolbar (open/save/export/zoom)

// bpmn-js-animation: the "Tokens" side-panel tab (run/pause, speed, Load log) and the model⇄playback mode
// controller. Playback itself is our native EngineLogPlayer, registered as the `playback` service the
// TokenPanel drives (see EnginePlaybackModule).
import { TokenPanelModule, ModeModule } from 'bpmn-js-animation';

// BPMNOS bpmn-js modules: the moddle extension + the decision-task decorator and properties panel.
import BPMNOSModdleDescriptor from 'bpmnos-js/moddle';
import BPMNOSModule from 'bpmnos-js';
import ContextPadCompatModule from './context-pad-compat';

// native BPMN-OS execution-log playback (this repo) — overrides the packaged `playback` service
import EnginePlaybackModule from './playback';
import createModeButtons, { modeIcon } from './mode-buttons';

import newDiagram from './newDiagram.bpmn?raw';

const moddleExtensions = {
  bpmnos: BPMNOSModdleDescriptor
};

// The side panel auto-hosts the properties panel as its first "Properties" tab (we deliberately do not
// set the properties panel's own `parent`); IssuesPanelModule adds "Issues", TokenPanelModule adds "Tokens".
const modeler = new BpmnModeler({
  container: '#canvas',
  linting: {
    bpmnlint: getRules()
  },
  tokenPanel: {
    // shown in the Tokens tab while in Model mode — points at the on-canvas Playback button (same icon)
    modelNote: 'Click ' + modeIcon('fa-play wb-mode-play', 'playback')
      + ' to start/end playback of a BPMN-OS execution log (load one with "Load log").'
  },
  sidePanel: {
    parent: '#side-panel',
    width: '320px',
    header: '<div class="wb-brand">'
      + '<span class="wb-brand-name">BPMNOS Workbench</span>'
      + '<a class="wb-brand-gh" href="https://github.com/bpmn-os/bpmnos-workbench" target="_blank"'
      + ' rel="noopener" title="View source on GitHub" aria-label="GitHub repository">'
      + '<i class="fab fa-github"></i></a>'
      + '</div>'
  },
  additionalModules: [
    BpmnPropertiesPanelModule,
    BPMNOSModule,
    ContextPadCompatModule,
    SidePanelModule,
    LintModule,
    IssuesPanelModule,
    TokenPanelModule,     // → "Tokens" tab (run/pause, speed, Load log)
    ModeModule,           // → mode.setMode('model'|'playback')
    EnginePlaybackModule  // → overrides `playback` with the native engine-log player (list last)
  ],
  moddleExtensions
});

modeler.importXML(newDiagram).catch(err => console.error('failed to import diagram', err));

// On-canvas file/view toolbar (open, save, export SVG, centre, zoom) — packaged by bpmn-workbench.
createToolbar(modeler);

// The on-canvas Playback toggle (the transport lives in the Tokens side-panel tab).
createModeButtons(modeler);

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
