import {
  domify,
  event as domEvent
} from 'min-dom';

import { createTableEntry, DELETE_ICON, LOAD_ICON, SAVE_ICON } from 'bpmn-js-side-panel';

import './input.css';

/*
 * createInput — what a run is given: the model, the contents of the inputs it declares, and the instance data.
 *
 * The provider owns the fields and nothing else. It builds the instance table and one field per input the
 * model declares, and hands them back one at a time for a host to mount where it likes. The instance and a
 * lookup table are rows under named columns, edited in place in a grid (bpmn-js-side-panel's table entry); a
 * matrix, whose width a schema may leave open, is edited as the CSV it is read from, and an object as its
 * JSON, each in a text field, whose content the engine checks against the input's schema when it builds the
 * model. It knows neither who runs nor where its tables are shown, so the
 * same provider serves a greedy run and a manual one, in a tab apiece today and, should the interface move
 * them, in an overlay asked before a run starts.
 *
 * Each table says what it is: a key the host may hold it under, the name it is known by, and the file it was
 * read from, which is the source the model declares for a lookup, the name of a file the reader has loaded,
 * or nothing at all.
 *
 * The fields own the content: the model supplies a lookup's columns, the names its typed header declares, so
 * a grid shows its header even for a brand-new model with no file yet, and the user can type rows straight in
 * — no file needed. A field owns its file too, saving and loading it from its own footer, so what this module
 * adds is only what the model knows: which inputs it declares, what each is, and a place to say so when a
 * loaded file names other columns.
 *
 * What a table holds outlives the provider. A provider lives as long as a run does, and a reader going back
 * to modelling ends the run, so the instance rows they typed and the files they read into the lookups would
 * be gone every time they looked at the model. The text is therefore kept by whoever outlives a run and
 * handed in here, under the key of the field it belongs to, and put back into the field of that key when the
 * fields are built again. An input is keyed by its type and the file the model reads it from, so an input the
 * model no longer declares is never asked for, and a lookup whose declared columns have changed restores
 * nothing, the text naming columns the table no longer has.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {import('../engine/EngineRunner.js').default} runner  asked which inputs the model needs
 * @param {Map<string, {text: string, source: string?}>} [kept]  what each field held, across the runs
 * @returns {{
 *   element: Element,
 *   load: () => void,
 *   ready: () => boolean,
 *   getInstances: () => string,
 *   getInputContents: () => Object,
 *   onChange: (function(): void) => void,
 *   destroy: () => void
 * }}
 */
export default function createInput(modeler, runner, kept = new Map()) {
  let tables = [];          // what the model asks for, in the order a host is to show it
  let tableListeners = [];  // called whenever that set changes, which is whenever a model is read

  let error = null;         // why the model could not be read, if it could not
  let declared = {};        // `source` filename -> the input the model declares with it
  let frozen = false;       // a run is on, so the fields state what it was given rather than take a change
  let instanceField = null; // the instance grid field
  let inputFields = {};     // `source` filename -> the field of the input read from it
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
  // simulate. The inputs may be left empty here; the engine says so when it builds a model lacking one.
  function ready() {
    return !!instanceField && instanceField.rowCount() > 0;
  }

  function getInstances() {
    return instanceField ? instanceField.getCsv() : '';
  }

  /** The content of every input the model declares, by its source, as the engine takes it. */
  function getInputContents() {
    return Object.fromEntries(
      Object.entries(inputFields).map(([ source, field ]) => [ source, field.getText() ])
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

  // The inputs the model declares, by the file each is read from, which is what the engine reports an input
  // by. They are taken from the execution data, which reads them from the model the modeller holds.
  function declaredInputs() {
    const executionData = modeler.get('executionData', false);

    return Object.fromEntries(
      (executionData ? executionData.getInputs() : []).map((input) => [ input.source, input ])
    );
  }

  // Read the current diagram and ask the engine which inputs it declares, then render a fresh set of fields
  // (instance + one per input). Run when the provider is mounted and again whenever a new model is imported.
  // A load is a change like any other, so a host learns of it through `onChange`.
  function load() {
    modeler.saveXML({ format: false })
      .then(({ xml }) => {
        declared = declaredInputs();
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
    inputFields = {};
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

    for (const source of required) {
      const input = declared[source] || { type: 'lookup', source };

      // An input is known by the name an expression reads it through and is read from a file, so it is named
      // by the one and says the other, a lookup as the call it is. A model that declares no name for it has
      // only the file, and then the file is all there is to call it by.
      const name = input.name ? input.name + (input.type === 'lookup' ? '(…)' : '') : source;

      if (input.type === 'matrix' || input.type === 'object') {
        inputFields[source] = makeTextField({
          key: input.type + ':' + source,
          name,
          filename: source,
          source,
          json: input.type === 'object'
        });
        continue;
      }

      // a lookup's columns are the names its typed header declares, each before the colon stating its type
      const columns = (input.schema || '').split(';')
        .map((column) => column.split(':')[0].trim())
        .filter(Boolean);

      inputFields[source] = makeTableField({
        key: 'lookup:' + source,
        name,
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
      getText: () => table.getCsv(),
      rowCount: () => table.getRows().filter(row => !isEmptyRow(row)).length // ignore blank rows for "ready"
    };

    // What was in this table when it was last built, where the table is still the same table. A run ends and
    // its columns are taken away whenever the reader goes back to modelling, and what they typed or read in
    // would go with them; it is held outside this provider, which lives only as long as a run, and put back
    // here. `setCsv` refuses text naming other columns, so a header that has changed under it restores
    // nothing, which is the answer the row would otherwise have had to be checked for.
    if (held && table.setCsv(held.text)) {
      field.source = held.source;
    }

    tables.push(field);

    return field;
  }

  // One text field, for an input whose content is edited as the text it is read from: a matrix as its CSV,
  // without a header row, its width being whatever its rows have, and an object as its JSON. The field owns
  // its file as a grid does, emptying, loading and saving it from controls in the same footer, and checks
  // only what can be checked without the engine, that the JSON of an object is JSON; whether the content
  // fits the input's schema is the engine's to say when it builds the model.
  function makeTextField({ key, name, filename, source: declaredSource, json }) {
    const element = domify('<div class="bjs-entry bjs-table-entry wb-input-text"></div>');
    const text = domify('<textarea class="wb-input-text-area" spellcheck="false"></textarea>');
    const complaint = domify('<div class="wb-input-error" hidden></div>');
    const footer = domify('<div class="bjs-table-footer"><span></span><div class="bjs-table-footer-actions"></div></div>');
    const actions = footer.querySelector('.bjs-table-footer-actions');
    const held = kept.get(key);
    const editControls = [];

    text.placeholder = json ? 'JSON' : 'CSV, one row per line, without a header row';

    const check = () => {
      if (!json || text.value.trim() === '') {
        complaint.hidden = true;
        return;
      }
      try {
        JSON.parse(text.value);
        complaint.hidden = true;
      }
      catch (error) {
        complaint.hidden = false;
        complaint.textContent = 'Not JSON: ' + error.message;
      }
    };

    const control = (icon, title, onClick, edits) => {
      const button = domify('<button type="button"></button>');

      button.title = title;
      button.setAttribute('aria-label', title);
      button.innerHTML = icon;
      domEvent.bind(button, 'click', onClick);
      actions.appendChild(button);

      if (edits) {
        editControls.push(button);
      }
    };

    control(DELETE_ICON, 'Clear ' + filename, () => {
      text.value = '';
      field.source = declaredSource;
      check();
      keep(field);
      changed();
      tablesChanged();
    }, true);

    const file = domify('<input type="file" hidden>');

    file.accept = json ? '.json,application/json' : '.csv,text/csv';
    domEvent.bind(file, 'change', () => {
      const chosen = file.files && file.files[0];

      if (chosen) {
        chosen.text().then((content) => {
          text.value = content;
          field.source = chosen.name;
          check();
          keep(field);
          changed();
          tablesChanged();
        });
      }
      file.value = ''; // so that choosing the same file again is a change
    });
    actions.appendChild(file);
    control(LOAD_ICON, 'Load ' + filename, () => file.click(), true);

    control(SAVE_ICON, 'Save ' + filename, () => {
      const link = domify('<a></a>');

      link.href = URL.createObjectURL(new Blob([ text.value ], { type: json ? 'application/json' : 'text/csv' }));
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    });

    domEvent.bind(text, 'input', () => { check(); keep(field); changed(); });

    element.appendChild(text);
    element.appendChild(footer);
    element.appendChild(complaint);

    const setReadOnly = (on) => {
      text.readOnly = !!on;
      editControls.forEach((button) => { button.disabled = !!on; });
    };

    const field = {
      key,
      name,
      source: declaredSource,
      element,
      setReadOnly,
      getText: () => text.value
    };

    if (held) {
      text.value = held.text;
      field.source = held.source;
      check();
    }

    setReadOnly(frozen);
    tables.push(field);

    return field;
  }

  // A field's content, kept under what the field is of. An input is keyed by its type and the file the model
  // reads it from, so an input the model no longer declares is simply never asked for again.
  function keep(field) {
    kept.set(field.key, { text: field.getText(), source: field.source });
  }

  return {
    load,
    getTables,
    onTables,
    getError: () => error,
    ready,
    getInstances,
    getInputContents,
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


