import {
  domify,
  event as domEvent
} from 'min-dom';

import { createTableEntry } from 'bpmn-js-side-panel';

import './input.css';

/*
 * createInput — what a run is given: the model, the lookup tables it references, and the instance data.
 *
 * The provider owns the grids and nothing else. It builds the instance table and one table per lookup the
 * model references, each editable in place (bpmn-js-side-panel's table entry), and hands them back one at a
 * time for a host to mount where it likes. It knows neither who runs nor where its tables are shown, so the
 * same provider serves a greedy run and a manual one, in a tab apiece today and, should the interface move
 * them, in an overlay asked before a run starts.
 *
 * Each table says what it is: a key the host may hold it under, the name it is known by, and the file it was
 * read from, which is the source the model declares for a lookup, the name of a file the reader has loaded,
 * or nothing at all.
 *
 * The grids own the content: the model supplies each table's header (columns) so a grid shows its header
 * even for a brand-new model with no file yet, and the user can type rows straight in — no file needed.
 * A grid owns its file too, saving and loading a CSV from its own footer, so what this module adds is only
 * what the model knows: which columns a source declares, and a place to say so when a loaded file names
 * others.
 *
 * What a table holds outlives the provider. A provider lives as long as a run does, and a reader going back
 * to modelling ends the run, so the instance rows they typed and the files they read into the lookups would
 * be gone every time they looked at the model. The text is therefore kept by whoever outlives a run and
 * handed in here, under the key of the table it belongs to, and put back into the table of that key when the
 * tables are built again. A lookup is keyed by the file the model reads it from, so a lookup the model no
 * longer declares is never asked for, and one whose declared columns have changed restores nothing, the text
 * naming columns the table no longer has.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {import('../engine/EngineRunner.js').default} runner  asked which lookup tables the model needs
 * @param {Map<string, {csv: string, source: string?}>} [kept]  what each table held, across the runs
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
export default function createInput(modeler, runner, kept = new Map()) {
  let tables = [];          // what the model asks for, in the order a host is to show it
  let tableListeners = [];  // called whenever that set changes, which is whenever a model is read

  let error = null;         // why the model could not be read, if it could not
  let sources = {};         // lookup-table name -> its `source` filename as declared in the BPMN XML
  let functions = {};       // `source` filename -> the `name` the model looks that table up through
  let headers = {};         // lookup-table name -> its declared `header` (semicolon-separated column names)
  let frozen = false;       // a run is on, so the tables state what it was given rather than take a change
  let instanceField = null; // the instance grid field
  let lookupFields = {};    // lookup-table name -> its grid field
  let listeners = [];       // called whenever what the input holds changes

  function changed() {
    listeners.forEach(listener => listener());
  }

  function onChange(listener) {
    listeners.push(listener);
  }

  /** The tables the model asks for, instance first. A host mounts each where it wants it. */
  function getTables() {
    return tables.slice();
  }

  /**
   * Called whenever the set of tables changes, which is whenever a model is read: a host that shows them
   * mounts the new set and forgets the old, the lookups being a property of the model.
   */
  function onTables(listener) {
    tableListeners.push(listener);
  }

  function tablesChanged() {
    tableListeners.forEach((listener) => listener(getTables()));
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

  /**
   * Whether the tables are the reader's to change. What a run is given cannot change under it — a change
   * gives the run up rather than amending it — so the tables state what this run was given while it is on,
   * and are editable again once it is over, the next run being given whatever they hold then.
   */
  function setReadOnly(on) {
    frozen = !!on;
    tables.forEach((table) => table.setReadOnly(frozen));
  }

  function destroy() {
    listeners = [];
    tableListeners = [];
    tables.forEach((table) => table.element.remove());
    tables = [];
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
    modeler.saveXML({ format: false })
      .then(({ xml }) => {
        sources = tableSources(xml); // name -> source filename, for labelling the grids
        // The function a lookup is read through, by the file it is read from: the engine reports a lookup by
        // its file, and the model declares the name beside it, so this is the map above read backwards
        // rather than the same XML parsed again.
        functions = Object.fromEntries(Object.entries(sources).map(([ name, source ]) => [ source, name ]));
        headers = tableHeaders(xml); // name -> declared column header, for the grid columns
        return runner.loadModel(xml);
      })
      .then(required => renderForm(required || []))
      .catch(err => renderError(String((err && err.message) || err)));
  }

  // --- the tables (bpmn-js-side-panel's table entry, in its design system) ----------------------------

  function reset() {
    tables.forEach((table) => table.element.remove());
    tables = [];
    instanceField = null;
    lookupFields = {};
  }

  // A model that cannot be read leaves no tables, and the message goes where a host shows it: there is
  // nothing to show a grid of, and a grid of nothing would say the model was read and empty.
  function renderError(message) {
    reset();
    error = message;
    tablesChanged();
  }

  function renderForm(required) {
    reset();
    error = null;

    instanceField = makeTableField({
      key: 'instance',
      name: 'Instance',
      filename: 'instance.csv',
      source: null,               // the instance table is the one the model names no file for
      columns: INSTANCE_COLUMNS
    });

    for (const name of required) {
      const source = sources[name] || name;
      // columns come straight from the table's declared `header` (semicolon-separated column names)
      const columns = (headers[name] || '').split(';').map(c => c.trim()).filter(Boolean);

      // A lookup is known by the function an expression reads it through and is read from a file, so it is
      // named by the one and says the other. A model that declares no name for it has only the file, and
      // then the file is all there is to call it by.
      const fn = functions[name];

      lookupFields[name] = makeTableField({
        key: 'lookup:' + name,
        name: fn ? fn + '(…)' : source,
        filename: source,
        source,                    // a lookup is read from the file the model declares
        columns
      });
    }

    tablesChanged();
    changed();
  }

  // One table field: a nested (caret-left) collapsible labelled by the source name, holding the editable
  // grid. The grid owns its content and its file — a table is rows under named columns, which is a CSV, so
  // saving one and loading one are the table's own controls in its footer. What is left here is what only
  // this panel knows: which columns the model declares for this source, and where to say so when a loaded
  // file names others. A file so refused leaves the table as it was, and the complaint stands until
  // something changes, an edit included, since the message is about a file and not about the rows.
  function makeTableField({ key, name, filename, source: declared, columns }) {
    const element = domify('<div></div>');
    const complaint = domify('<div class="wb-input-error" hidden></div>'); // shown after a header mismatch
    const held = kept.get(key);

    const table = createTableEntry({
      columns: columns.slice(),
      rows: [],
      // No cap: the table stands alone in its column, so it is as tall as its rows and the column scrolls.
      // A cap would put a scrollbar inside a scrollbar and leave the column half empty whenever the window
      // is tall.
      filename,
      clearable: true,
      readOnly: frozen,
      onChange: () => { complaint.hidden = true; keep(field); changed(); },
      onLoad: (loaded) => { field.source = loaded; keep(field); tablesChanged(); },
      // A table emptied is read from nothing: what it is read from is what put those rows there, and the
      // rows are gone. A lookup falls back to the file the model declares for it, which is what the model
      // says whatever the table holds.
      onClear: () => { field.source = declared; keep(field); tablesChanged(); },
      onError: (message) => { complaint.hidden = false; complaint.textContent = message; }
    });

    element.appendChild(table.element);
    element.appendChild(complaint);

    const field = {
      key,
      name,
      source: declared,
      element,
      setReadOnly: table.setReadOnly,
      getCsv: () => table.getCsv(),
      rowCount: () => table.getRows().filter(row => !isEmptyRow(row)).length // ignore blank rows for "ready"
    };

    // What was in this table when it was last built, where the table is still the same table. A run ends and
    // its columns are taken away whenever the reader goes back to modelling, and what they typed or read in
    // would go with them; it is held outside this provider, which lives only as long as a run, and put back
    // here. `setCsv` refuses text naming other columns, so a header that has changed under it restores
    // nothing, which is the answer the row would otherwise have had to be checked for.
    if (held && table.setCsv(held.csv)) {
      field.source = held.source;
    }

    tables.push(field);

    return field;
  }

  // A table's content, kept under what the table is of. A lookup is keyed by the file the model reads it
  // from, so a lookup the model no longer declares is simply never asked for again.
  function keep(field) {
    kept.set(field.key, { csv: field.getCsv(), source: field.source });
  }

  return {
    load,
    getTables,
    onTables,
    getError: () => error,
    ready,
    getInstances,
    getLookups,
    onChange,
    setReadOnly,
    destroy
  };
}

// The instance CSV format is fixed by BPMNOSInstances.jl (and accepted by the engine's stochastic
// provider): a six-column header. The engine ignores the header row itself, but the grid needs it.
const INSTANCE_COLUMNS = [
  'INSTANCE_ID', 'NODE_ID', 'INITIALIZATION', 'DISCLOSURE', 'READY', 'COMPLETION'
];

// a row is empty (ignored on download and when feeding the engine) if every cell is blank/whitespace
function isEmptyRow(row) {
  return !row.some(cell => String(cell).trim() !== '');
}


