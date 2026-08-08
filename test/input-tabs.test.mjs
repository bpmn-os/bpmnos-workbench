import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

/**
 * The columns what a run is given stands in.
 *
 * The provider owns the tables and says when the set of them changes; this module turns that set into
 * columns of the panel. What is asserted is what a reader sees: a column per table, named, saying what it
 * was read from, in the order the model asks for, replaced when a model is read and taken away with the run.
 */
async function mount() {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');

  globalThis.document = document;

  const { default: mountInputTabs } = await import('../src/input/tabs.js');

  const added = new Map();

  const sidePanel = {
    addTab({ id, label, priority }) {
      const header = document.createElement('div'),
            body = document.createElement('div');

      added.set(id, { id, label, priority, header, body });

      return { header, body };
    },
    removeTab: (id) => added.delete(id)
  };

  let announce = () => {};

  const input = {
    getTables: () => [],
    onTables: (listener) => { announce = listener; }
  };

  const handle = mountInputTabs({ get: () => sidePanel }, input);

  return {
    added,
    handle,
    table: (key, name, source) => ({ key, name, source, element: document.createElement('div') }),
    announce: (tables) => announce(tables)
  };
}

test('a table stands in a column of its own, right of what a run produces', async () => {
  const panel = await mount();

  panel.announce([
    panel.table('instance', 'Instance', null),
    panel.table('lookup:costs.csv', 'costs.csv', 'costs.csv')
  ]);

  assert.deepEqual([ ...panel.added.keys() ], [ 'input:instance', 'input:lookup:costs.csv' ]);

  const instance = panel.added.get('input:instance'),
        costs = panel.added.get('input:lookup:costs.csv');

  assert.equal(instance.label, 'Instance');
  assert.ok(instance.priority < -3, 'right of Decisions, the last column a run fills');
  assert.ok(costs.priority < instance.priority, 'and the lookups in the order the model asks for');
});

test('a column names itself, and names the file it was read from', async () => {
  const panel = await mount();

  panel.announce([
    panel.table('instance', 'Instance', null),
    panel.table('lookup:costs.csv', 'costs.csv', 'costs.csv')
  ]);

  const source = (id) => panel.added.get(id).header.querySelector('.bjs-tab-source');

  assert.equal(panel.added.get('input:instance').header.querySelector('.bjs-tab-name').textContent, 'Instance');
  assert.equal(source('input:instance').textContent, 'No file selected');
  assert.ok(source('input:instance').classList.contains('wb-input-no-source'),
    'an absence is said in the voice of an absence');

  assert.equal(source('input:lookup:costs.csv').textContent, 'costs.csv');
  assert.ok(!source('input:lookup:costs.csv').classList.contains('wb-input-no-source'));
});

test('a column holds the table the provider built', async () => {
  const panel = await mount();

  const instance = panel.table('instance', 'Instance', null);

  panel.announce([ instance ]);

  assert.equal(panel.added.get('input:instance').body.firstChild, instance.element);
});

test('the lookups of a model replace those of the model before it', async () => {
  const panel = await mount();

  panel.announce([ panel.table('instance', 'Instance', null), panel.table('lookup:a.csv', 'a.csv', 'a.csv') ]);
  assert.deepEqual([ ...panel.added.keys() ], [ 'input:instance', 'input:lookup:a.csv' ]);

  panel.announce([ panel.table('instance', 'Instance', null), panel.table('lookup:b.csv', 'b.csv', 'b.csv') ]);
  assert.deepEqual([ ...panel.added.keys() ], [ 'input:instance', 'input:lookup:b.csv' ],
    'the lookups are a property of the model, so those of the old one go with it');
});

test('the columns go when the run that mounted them goes', async () => {
  const panel = await mount();

  panel.announce([ panel.table('instance', 'Instance', null), panel.table('lookup:a.csv', 'a.csv', 'a.csv') ]);
  panel.handle.remove();

  assert.deepEqual([ ...panel.added.keys() ], [], 'a run ended leaves no column of its input behind');
});
