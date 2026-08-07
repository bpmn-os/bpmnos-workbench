import {
  domify,
  event as domEvent
} from 'min-dom';

import { createCollapsibleEntry, createTableEntry } from 'bpmn-js-side-panel';

import './input.css';

/*
 * createInput — what a run is given: the model, the lookup tables it references, and the instance data.
 *
 * The provider owns the grids and nothing else. It renders an "Input" entry — the instance table and one
 * table per lookup the model references, each editable in place (bpmn-js-side-panel's table entry) — and
 * hands the element back for a host to mount. It knows neither who runs nor where it is shown, so the same
 * provider serves a greedy run and a manual one, in the Tokens tab today and, should the interface move it,
 * in an overlay asked before a run starts.
 *
 * The grids own the content: the model supplies each table's header (columns) so a grid shows its header
 * even for a brand-new model with no file yet, and the user can type rows straight in — no file needed.
 * A grid owns its file too, saving and loading a CSV from its own footer, so what this module adds is only
 * what the model knows: which columns a source declares, and a place to say so when a loaded file names
 * others.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {import('../engine/EngineRunner.js').default} runner  asked which lookup tables the model needs
 * @returns {{
 *   element: Element,
 *   load: () => void,
 *   ready: () => boolean,
 *   getInstances: () => string,
 *   getLookups: () => Object,
 *   onChange: (function(): void) => void,
 *   destroy: () => void
 * }}
 */
export default function createInput(modeler, runner) {
  const entry = createCollapsibleEntry({ id: 'wb-input', label: 'Input', open: true });
  const body = entry.contentEl;

  let lastXml = '';         // the current model XML (for deriving lookup columns)
  let sources = {};         // lookup-table name -> its `source` filename as declared in the BPMN XML
  let headers = {};         // lookup-table name -> its declared `header` (semicolon-separated column names)
  let instanceField = null; // the instance grid field
  let lookupFields = {};    // lookup-table name -> its grid field
  let listeners = [];       // called whenever what the input holds changes

  function changed() {
    listeners.forEach(listener => listener());
  }

  function onChange(listener) {
    listeners.push(listener);
  }

  // Run is enabled once the instance grid has at least one row — an empty instance has nothing to
  // simulate. Referenced lookups may be left empty (a table only matters if the model looks it up at run).
  function ready() {
    return !!instanceField && instanceField.rowCount() > 0;
  }

  function getInstances() {
    return instanceField ? instanceField.getCsv() : '';
  }

  function getLookups() {
    return Object.fromEntries(
      Object.entries(lookupFields).map(([ name, field ]) => [ name, field.getCsv() ])
    );
  }

  function destroy() {
    listeners = [];
    entry.destroy();
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

  // Read the current diagram and ask the engine which lookup tables it references, then render a fresh set
  // of grids (instance + one per lookup). Run when the provider is mounted and again whenever a new model
  // is imported. A load is a change like any other, so a host learns of it through `onChange`.
  function load() {
    renderLoading();
    modeler.saveXML({ format: false })
      .then(({ xml }) => {
        lastXml = xml;
        sources = tableSources(xml); // name -> source filename, for labelling the grids
        headers = tableHeaders(xml); // name -> declared column header, for the grid columns
        return runner.loadModel(xml);
      })
      .then(required => renderForm(required || []))
      .catch(err => renderError(String((err && err.message) || err)));
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

    changed();
  }

  // One table field: a nested (caret-left) collapsible labelled by the source name, holding the editable
  // grid. The grid owns its content and its file — a table is rows under named columns, which is a CSV, so
  // saving one and loading one are the table's own controls in its footer. What is left here is what only
  // this panel knows: which columns the model declares for this source, and where to say so when a loaded
  // file names others. A file so refused leaves the table as it was, and the complaint stands until
  // something changes, an edit included, since the message is about a file and not about the rows.
  function makeTableField({ label, filename, columns }) {
    const collapsible = createCollapsibleEntry({ id: 'wb-input-' + label, label, open: true, caretSide: 'left' });

    const gridHost = domify('<div></div>');
    const error = domify('<div class="wb-input-error" hidden></div>'); // shown only after a header mismatch
    collapsible.contentEl.appendChild(gridHost);
    collapsible.contentEl.appendChild(error);

    let cols = columns.slice();
    let table = null;

    function build(rows) {
      gridHost.innerHTML = '';
      table = createTableEntry({
        columns: cols,
        rows: rows || [],
        maxHeight: GRID_MAX_HEIGHT, // ~10 rows under the fixed header, then scroll
        filename,
        onChange: () => { error.hidden = true; changed(); },
        onError: (message) => { error.hidden = false; error.textContent = message; }
      });
      gridHost.appendChild(table.element);
    }

    build([]);

    return {
      element: collapsible.element,
      getCsv: () => table.getCsv(),
      rowCount: () => table.getRows().filter(row => !isEmptyRow(row)).length // ignore blank rows for "ready"
    };
  }

  return {
    element: entry.element,
    load,
    ready,
    getInstances,
    getLookups,
    onChange,
    destroy
  };
}

// The instance CSV format is fixed by BPMNOSInstances.jl (and accepted by the engine's stochastic
// provider): a six-column header. The engine ignores the header row itself, but the grid needs it.
const INSTANCE_COLUMNS = [
  'INSTANCE_ID', 'NODE_ID', 'INITIALIZATION', 'DISCLOSURE', 'READY', 'COMPLETION'
];

// grid height cap: ~10 rows under the fixed header, then scroll
const GRID_MAX_HEIGHT = 'calc(10 * var(--bjs-table-row-h, 27px))';

// a row is empty (ignored on download and when feeding the engine) if every cell is blank/whitespace
function isEmptyRow(row) {
  return !row.some(cell => String(cell).trim() !== '');
}


