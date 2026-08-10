/**
 * The tables a run is given, each in a column of its own.
 *
 * The instance table and every lookup the model references stand to the right of everything a run produces,
 * so that what a run is given is read on one side and what it produced on the other. Each names itself in
 * its band and, beneath the name, the file it was read from: a lookup is read from the file the model
 * declares for it, and the instance table is the one that may have none and then says so.
 *
 * The set of lookups is a property of the model, so the columns of the old model are taken away and those of
 * the new one added whenever a model is read. Two consequences are worth stating rather than discovering.
 * The reader's place moves when a tab that is being shown is taken away, `removeTab` activating the first
 * that remains. And the rightmost column is the first thing clipped when the columns want more room than the
 * window has, so the last lookup is what gives way, which costs nothing while the columns start closed.
 *
 * @param {Object} modeler
 * @param {Object} input  the provider, which owns the tables and says when the set of them changes
 * @returns {{ remove: () => void }}
 */
export default function mountInputTabs(modeler, input) {
  const sidePanel = modeler.get('sidePanel', false);

  if (!sidePanel) {
    return { remove() {} };
  }

  // the tabs in the panel, by the table each shows, so that a rebuild takes away exactly what it put there
  // and so that what has not changed can be left where it is
  let shown = new Map();

  function clear() {
    shown.forEach(({ id }) => sidePanel.removeTab(id));
    shown = new Map();
  }

  function build(tables) {
    // Which tables there are is a property of the model, and a rebuild is for a model that has changed.
    // Reading a file into one of them changes what it was read from and nothing else, so the columns stay
    // as they are — a rebuild would take them away and put them back closed, losing the column the reader
    // had opened along with its width and where it was scrolled to.
    const sameTables = tables.length === shown.size && tables.every((table) => shown.has(table.key));

    if (sameTables) {
      tables.forEach((table) => setSource(shown.get(table.key).source, table.source));

      return;
    }

    clear();

    tables.forEach((table, index) => {
      const id = 'input:' + table.key;

      const { header, body } = sidePanel.addTab({
        id,
        label: table.name,
        // Right of the columns a run fills, the last of which stands at -3. They keep the order the model
        // asks for: the instance table, then the lookups as the engine reports them.
        priority: -10 - index,
        // Closed, as every column of this workbench is: a run beginning is no reason to open a column the
        // reader did not ask for, and its name stands on its resizer for whoever wants it.
        open: false
      });

      const name = document.createElement('h1'),
            source = document.createElement('div');

      name.className = 'bjs-tab-name';
      name.textContent = table.name;

      source.className = 'bjs-tab-source';
      setSource(source, table.source);

      header.append(name, source);
      body.appendChild(table.element);

      shown.set(table.key, { id, source });
    });
  }

  build(input.getTables());
  input.onTables(build);

  return { remove: clear };
}

/**
 * What a table was read from, or that it was read from nothing. An absence is said rather than left blank,
 * and said in the tab's own band, since a table filled by hand is a table a reader may wonder about.
 */
function setSource(element, source) {
  element.textContent = source || 'No file selected';
  element.classList.toggle('wb-input-no-source', !source);
}

