import {
  domify,
  event as domEvent
} from 'min-dom';

import { createCollapsibleEntry } from 'bpmn-js-side-panel';

import EngineRunner from './EngineRunner';
import './greedy.css';

/**
 * createGreedy — the greedy-simulation source. It owns a Web Worker running the BPMN-OS wasm engine
 * autonomously (no controller → greedy controller + guided evaluator + TimeWarp clock), and — while
 * greedy is active — an **Input** collapsible entry in the **Tokens** tab (mounted through the panel's
 * `addControl` slot, so it sits below the auto-focus toggle with the panel's own group styling).
 * Activating greedy sends the current model to the worker, which reports the lookup tables it references;
 * the entry then renders a file picker per table plus one for the instance CSV.
 *
 * It runs the engine ONLY when playback starts, via the panel's log-source hook (`playback.setLogSource`):
 * the footer's play button pulls a log from the source on an idle→start, so **play runs greedy**; pause
 * and resume act on the already-running animation and never re-run. A run's log is cached so replays are
 * reproducible; the footer's **Refresh** re-rolls the seed and drops the cache, so the next play runs a
 * fresh greedy trajectory. Nothing greedy-specific lives upstream — the library only knows "a log source".
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @returns {{ activate: () => void, deactivate: () => void }}
 */
export default function createGreedy(modeler) {
  const sidePanel = modeler.get('sidePanel', false);
  const tokenPanel = modeler.get('tokenPanel', false); // hosts the Input control + footer transport
  const playback = modeler.get('playback'); // our EngineLogPlayer (registered as `playback`)
  const eventBus = modeler.get('eventBus');

  const runner = new EngineRunner();

  let entry = null;         // the collapsible Input entry in the Tokens tab
  let body = null;          // entry.contentEl
  let controlHandle = null; // handle from tokenPanel.addControl (removes the entry on deactivate)
  let tables = {};          // lookup-table name -> csv (null until a file is chosen)
  let sources = {};         // lookup-table name -> its `source` filename as declared in the BPMN XML
  let instanceCsv = null;
  let seed = newSeed();     // caller-owned engine seed; Refresh re-rolls it
  let cachedLog = null;     // the current run's log (reproducible replay until Refresh / inputs change)

  function newSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  // Map each lookup table's `name` (what the engine keys `addLookupTable` by, via getLookupTableNames) to
  // its `source` filename as declared in the BPMN XML (`<…:table name="X" source="X.csv"/>`), so the input
  // pickers are labelled with the filename the model references, not the internal table name.
  function tableSources(xml) {
    const map = {};
    const re = /<[\w.-]+:table\b([^>]*)>/g;
    let m;
    while ((m = re.exec(xml))) {
      const name = (m[1].match(/\bname\s*=\s*"([^"]*)"/) || [])[1];
      const source = (m[1].match(/\bsource\s*=\s*"([^"]*)"/) || [])[1];
      if (name) {
        map[name] = source || name;
      }
    }
    return map;
  }

  function activate() {
    if (!tokenPanel || entry) {
      return;
    }
    entry = createCollapsibleEntry({ id: 'greedy-input', label: 'Input', open: true });
    body = entry.contentEl;
    controlHandle = tokenPanel.addControl(entry.element); // below auto-focus, in the controls region
    if (sidePanel) {
      sidePanel.activate('tokens');
    }
    loadFromModel();
  }

  function deactivate() {
    playback.stop();
    playback.setLogSource(null); // stop offering greedy runs to the transport
    cachedLog = null;
    if (controlHandle) {
      controlHandle.remove();
      controlHandle = null;
    }
    if (entry) {
      entry.destroy();
      entry = null;
      body = null;
    }
  }

  // Read the current diagram and ask the engine which lookup tables it references, then render a fresh set
  // of file pickers. Run on activation and again whenever a new model is imported (the referenced tables
  // and any chosen files no longer apply); resets the seed/cache and withdraws the log source until ready.
  function loadFromModel() {
    if (!entry) {
      return;
    }
    seed = newSeed();
    cachedLog = null;
    playback.setLogSource(null);
    renderLoading();
    modeler.saveXML({ format: false })
      .then(({ xml }) => {
        sources = tableSources(xml); // name -> source filename, for labelling the pickers
        return runner.loadModel(xml);
      })
      .then(required => {
        if (!entry) {
          return; // deactivated while loading
        }
        tables = {};
        (required || []).forEach(name => { tables[name] = null; });
        instanceCsv = null;
        renderForm();
      })
      .catch(err => entry && renderError(String((err && err.message) || err)));
  }

  function ready() {
    return instanceCsv != null && Object.values(tables).every(csv => csv != null);
  }

  // (Re)register the log source with the transport: offered once every input is chosen, withdrawn
  // otherwise. Any prior run is now stale, so drop the cache — the next play runs the engine afresh.
  function syncSource() {
    cachedLog = null;
    playback.setLogSource(ready() ? produceLog : null);
  }

  // The log source: yields the current run's log, running the engine (with the current seed) on first
  // demand and caching it, so play/pause/resume/stop replay one deterministic run. Refresh clears the
  // cache (and re-rolls the seed) to force a fresh run. Consulted only on an idle→start (see TokenPanel).
  async function produceLog() {
    if (cachedLog) {
      return cachedLog;
    }
    try {
      for (const [ name, csv ] of Object.entries(tables)) {
        runner.setLookup(name, csv);
      }
      const result = await runner.run(instanceCsv, seed);
      cachedLog = result.log;
      return cachedLog;
    } catch (err) {
      console.error('[greedy] run failed:', err);
      return []; // empty → the run button no-ops; the next play retries
    }
  }

  // --- rendering (into the collapsible entry's body, in the side panel's design system) ---------------

  function reset() {
    body.innerHTML = '';
  }

  function hint(text) {
    const el = domify('<div class="wb-input-hint"></div>');
    el.textContent = text;
    return el;
  }

  function renderLoading() {
    reset();
    body.appendChild(hint('Reading the model…'));
  }

  function renderError(message) {
    reset();
    const err = domify('<div class="wb-input-error"></div>');
    err.textContent = message;
    body.appendChild(err);
  }

  function renderForm() {
    reset();

    body.appendChild(filePicker('Instance', csv => { instanceCsv = csv; syncSource(); }));
    for (const name of Object.keys(tables)) {
      body.appendChild(filePicker(sources[name] || name, csv => { tables[name] = csv; syncSource(); }));
    }

    syncSource();
  }

  // one file field, in the side panel's design system (label above a full-width button that opens the
  // file picker and then shows the chosen file name) — matches the properties-panel field look.
  function filePicker(label, onCsv) {
    const field = domify('<div class="wb-input-field"></div>');
    const labelEl = domify('<label class="wb-input-label"></label>');
    labelEl.textContent = label;
    const button = domify('<button type="button" class="wb-input-btn wb-input-file">Choose file…</button>');
    const input = domify('<input type="file" accept=".csv,text/csv" hidden/>');

    domEvent.bind(button, 'click', () => input.click());
    domEvent.bind(input, 'change', () => {
      const file = input.files && input.files[0];
      if (!file) {
        return;
      }
      file.text().then(csv => {
        onCsv(csv);
        button.textContent = file.name;
        button.title = file.name;
      });
    });

    field.appendChild(labelEl);
    field.appendChild(button);
    field.appendChild(input);
    return field;
  }

  // Refresh (footer) re-rolls the seed and drops the current run, so the next play runs greedy again with
  // a different trajectory. The panel has already stopped playback + cleared the canvas before firing.
  eventBus.on('tokenPanel.refresh', () => {
    if (!entry) {
      return; // only while greedy is active
    }
    seed = newSeed();
    cachedLog = null;
  });

  // a new model was imported (toolbar "Open") — if greedy is active, re-derive its inputs from it
  eventBus.on('import.done', () => loadFromModel());

  eventBus.on([ 'diagram.destroy' ], () => runner.destroy());

  return { activate, deactivate };
}
