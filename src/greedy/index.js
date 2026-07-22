import {
  domify,
  event as domEvent
} from 'min-dom';

import { createCollapsibleEntry, createTableEntry } from 'bpmn-js-side-panel';

import EngineRunner from './EngineRunner';
import './greedy.css';

/*
 * createGreedy — the greedy-simulation source. It owns a Web Worker running the BPMN-OS wasm engine
 * (EngineRunner) and, while active, renders an "Input" entry in the Tokens tab where the instance and
 * each referenced lookup table are edited **in place** as grids (bpmn-js-side-panel's table entry).
 *
 * The grids own the content: the model supplies each table's header (columns) so a grid shows its header
 * even for a brand-new model with no file yet, and the user can type rows straight in — no file needed.
 * A load icon fills a grid from a CSV (validating its header), a download icon exports it; both live in
 * the grid footer next to the add-row button.
 *
 * It runs the engine ONLY when playback starts, via the panel's log-source hook (`playback.setLogSource`):
 * the footer's play button pulls a log from the source on an idle→start, so **play runs greedy**; pause
 * just pauses playback and resume continues it (no re-run). The run is seeded, so a replay is
 * reproducible; the footer's **Refresh** re-rolls the seed and drops the cache, so the next play runs a
 * fresh greedy trajectory.
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
  let lastXml = '';         // the current model XML (for deriving lookup columns)
  let sources = {};         // lookup-table name -> its `source` filename as declared in the BPMN XML
  let headers = {};         // lookup-table name -> its declared `header` (semicolon-separated column names)
  let instanceField = null; // the instance grid field
  let lookupFields = {};    // lookup-table name -> its grid field
  let seed = newSeed();     // caller-owned engine seed; Refresh re-rolls it
  let cachedLog = null;     // the current run's log (reproducible replay until Refresh / inputs change)

  function newSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  // Map each lookup table's `name` (the engine key) to its `source` filename as declared in the BPMN XML
  // (`<…:table name="X" source="X.csv"/>`), so a grid is labelled with the filename the model references.
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

  // Map each lookup table's `source` filename to its declared `header` (`<…:table … header="From;To;Duration"/>`).
  // Keyed by `source` because that is what the engine returns as the lookup name (e.g. "durations.csv").
  function tableHeaders(xml) {
    const map = {};
    const re = /<[\w.-]+:table\b([^>]*)>/g;
    let m;
    while ((m = re.exec(xml))) {
      const source = (m[1].match(/\bsource\s*=\s*"([^"]*)"/) || [])[1];
      const header = (m[1].match(/\bheader\s*=\s*"([^"]*)"/) || [])[1];
      if (source && header) {
        map[source] = header;
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
  // of grids (instance + one per lookup). Run on activation and again whenever a new model is imported;
  // resets the seed/cache and withdraws the log source until the input is ready.
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
        lastXml = xml;
        sources = tableSources(xml); // name -> source filename, for labelling the grids
        headers = tableHeaders(xml); // name -> declared column header, for the grid columns
        return runner.loadModel(xml);
      })
      .then(required => {
        if (!entry) {
          return; // deactivated while loading
        }
        renderForm(required || []);
      })
      .catch(err => entry && renderError(String((err && err.message) || err)));
  }

  // Run is enabled once the instance grid has at least one row — an empty instance has nothing to
  // simulate. Referenced lookups may be left empty (a table only matters if the model looks it up at run).
  function ready() {
    return !!instanceField && instanceField.rowCount() > 0;
  }

  // (Re)register the log source with the transport: offered once the input is ready, withdrawn otherwise.
  // Any prior run is now stale, so drop the cache — the next play runs the engine afresh.
  function syncSource() {
    cachedLog = null;
    playback.setLogSource(ready() ? produceLog : null);
  }

  // The log source: yields the current run's log, running the engine (with the current seed) on first
  // demand and caching it, so play/pause/resume/stop replay one deterministic run. Each grid is serialised
  // on demand, so the engine always sees what's currently typed in. Consulted only on an idle→start.
  async function produceLog() {
    if (cachedLog) {
      return cachedLog;
    }
    try {
      for (const [ name, field ] of Object.entries(lookupFields)) {
        runner.setLookup(name, field.getCsv());
      }
      const result = await runner.run(instanceField.getCsv(), seed);
      cachedLog = result.log;
      return cachedLog;
    } catch (err) {
      console.error('[greedy] run failed:', err);
      return []; // empty → the play button no-ops; the next play retries
    }
  }

  // --- rendering (into the collapsible entry's body, in the side panel's design system) ---------------

  function reset() {
    body.innerHTML = '';
    instanceField = null;
    lookupFields = {};
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

  function renderForm(required) {
    reset();

    instanceField = makeTableField({
      label: 'Instance',
      filename: 'instance.csv',
      columns: INSTANCE_COLUMNS
    });
    body.appendChild(instanceField.element);

    for (const name of required) {
      const source = sources[name] || name;
      // columns come straight from the table's declared `header` (semicolon-separated column names)
      const columns = (headers[name] || '').split(';').map(c => c.trim()).filter(Boolean);
      const field = makeTableField({
        label: source,
        filename: source,
        columns
      });
      lookupFields[name] = field;
      body.appendChild(field.element);
    }

    syncSource();
  }

  // One table field: a nested (caret-left) collapsible labelled by the source name, holding the editable
  // grid. The grid owns the content and starts empty (header only); a load icon fills it from a CSV, a
  // download icon exports it — both in the grid footer, left of / with the add-row button.
  function makeTableField({ label, filename, columns }) {
    const collapsible = createCollapsibleEntry({ id: 'greedy-' + label, label, open: true, caretSide: 'left' });

    const gridHost = domify('<div></div>');
    const error = domify('<div class="wb-input-error" hidden></div>'); // shown only after a header mismatch
    const fileInput = domify('<input type="file" accept=".csv,text/csv" hidden/>');
    collapsible.contentEl.appendChild(gridHost);
    collapsible.contentEl.appendChild(error);
    collapsible.contentEl.appendChild(fileInput);

    let cols = columns.slice();
    let table = null;

    function build(rows) {
      gridHost.innerHTML = '';
      table = createTableEntry({
        columns: cols,
        rows: rows || [],
        maxHeight: GRID_MAX_HEIGHT, // ~10 rows under the fixed header, then scroll
        onChange: syncSource
      });
      const load = iconButton(LOAD_ICON, 'Load ' + filename, () => fileInput.click());
      const download = iconButton(SAVE_ICON, 'Download ' + filename, doDownload);
      table.footerEl.append(load, download); // load left of download, in the footer's right slot
      gridHost.appendChild(table.element);
    }

    function doDownload() {
      const blob = new Blob([ serialize(cols, table.getRows()) ], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // Load a CSV: validate its header against the model's declared columns (trimmed, case-insensitive),
    // then load the rows keeping the model's column names. The engine ignores the CSV header (positional),
    // but we still check it so a wrong file is caught here rather than failing cryptically at run time.
    domEvent.bind(fileInput, 'change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        return;
      }
      file.text().then(text => {
        const parsed = parseCsv(text);
        if (!headersMatch(parsed.header, cols)) {
          error.hidden = false;
          error.textContent = 'Unexpected header in ' + file.name;
          return;
        }
        error.hidden = true;
        table.setRows(parsed.rows);
        syncSource();
      });
      fileInput.value = '';
    });

    build([]);

    return {
      element: collapsible.element,
      getCsv: () => serialize(cols, table.getRows()),
      rowCount: () => table.getRows().filter(row => !isEmptyRow(row)).length // ignore blank rows for "ready"
    };
  }

  function iconButton(svg, title, onClick) {
    const btn = domify('<button type="button"></button>');
    btn.title = title;
    btn.innerHTML = svg;
    domEvent.bind(btn, 'click', onClick);
    return btn;
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

// The instance CSV format is fixed by BPMNOSInstances.jl (and accepted by the engine's stochastic
// provider): a six-column header. The engine ignores the header row itself, but the grid needs it.
const INSTANCE_COLUMNS = [
  'INSTANCE_ID', 'NODE_ID', 'INITIALIZATION', 'DISCLOSURE', 'READY', 'COMPLETION'
];

// grid height cap: ~10 rows under the fixed header, then scroll
const GRID_MAX_HEIGHT = 'calc(10 * var(--bjs-table-row-h, 27px))';

// instance/lookup CSV is ';'-delimited, cells verbatim (commas/quotes/expressions kept as-is)
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  return {
    header: (lines[0] || '').split(';').map(s => s.trim()),
    rows: lines.slice(1).map(l => l.split(';').map(s => s.trim()))
  };
}

// a row is empty (ignored on download and when feeding the engine) if every cell is blank/whitespace
function isEmptyRow(row) {
  return !row.some(cell => String(cell).trim() !== '');
}

function serialize(columns, rows) {
  const filled = rows.filter(row => !isEmptyRow(row));
  return [ columns.join('; ') ].concat(filled.map(r => r.join(';'))).join('\n');
}

// header matches iff same column count and each name equal after trimming, case-insensitively
function headersMatch(fileHeader, expected) {
  return fileHeader.length === expected.length &&
    fileHeader.every((h, i) => h.trim().toLowerCase() === String(expected[i]).trim().toLowerCase());
}

// footer icons (feather-style): load = upload-into-tray, download = save-from-tray
const LOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
  '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

const SAVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
  '<polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
