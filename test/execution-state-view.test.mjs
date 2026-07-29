import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import ExecutionStateStore from '../src/execution-state/Store.js';
import sections from '../src/execution-state/sections.js';

import { registryOf } from './support/model.mjs';

/**
 * The view is a function of the declarations and the values: what a token entry shows follows from the node
 * the token rests at and what the store holds for it, and nothing else. The rows are tested as data, and the
 * body they are drawn into is tested for the one property that is not a matter of appearance, which is that
 * a value changing while a body is open is written into the body rather than rebuilding it.
 */

// the entry points that touch the DOM read the global `document` as they are called, so give them one
async function view() {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');

  globalThis.document = document;

  const { default: createExecutionStateView } = await import('../src/execution-state/View.js');

  return { document, createExecutionStateView };
}

async function state() {
  const registry = await registryOf('nested-data.bpmn'),
        store = new ExecutionStateStore(registry);

  store.createToken({ node: 'MainProcess', label: 'I1' });
  store.createToken({ node: 'PlainSub', label: 'I1', parentNode: 'MainProcess', parentLabel: 'I1' });
  store.createToken({ node: 'PlainTask', label: 'I1', parentNode: 'PlainSub', parentLabel: 'I1' });

  return { registry, store };
}

const record = (status, data, globals) => ({
  processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainTask', state: 'BUSY', status, data, globals
});

test('the rows are what the node declares, in the order it declares them', async () => {
  const { registry, store } = await state();

  store.apply(record({ amount: 17, note: 'held' }, { main_data: 'outer', plain_data: 'inner' }));

  assert.deepEqual(sections(registry, store, 'PlainTask', 'I1'), [
    {
      category: 'status',
      label: 'Status',
      rows: [
        { id: 'Status_Amount', name: 'amount', value: 17 },
        { id: 'Status_Note', name: 'note', value: 'held' }
      ]
    },
    {
      category: 'data',
      label: 'Data',
      rows: [
        { id: 'Data_Main', name: 'main_data', value: 'outer' },
        { id: 'Data_Plain', name: 'plain_data', value: 'inner' }
      ]
    },
    {
      category: 'globals',
      label: 'Globals',
      rows: [ { id: 'Global_Budget', name: 'budget', value: null } ]
    }
  ]);
});

test('neither keyword is shown, and a value the run has not produced is null', async () => {
  const { registry, store } = await state();

  const shown = sections(registry, store, 'PlainTask', 'I1')
    .flatMap((section) => section.rows.map((row) => [ row.name, row.value ]));

  assert.deepEqual(shown, [
    [ 'amount', null ], [ 'note', null ], [ 'main_data', null ], [ 'plain_data', null ],
    [ 'budget', null ]
  ], 'the declarations stand before any record, each without a value');

  assert.ok(!shown.some(([ name ]) => name === 'timestamp' || name === 'instance'));
});

test('a section with no rows is left out', async () => {
  const { store } = await state();

  // a process declaring nothing beyond the two keywords, which every process declares
  const bare = {
    get: () => ({
      status: [ { id: 'Timestamp', name: 'timestamp', scope: 'status', declaringElement: 'P' } ],
      data: [ { id: 'Instance', name: 'instance', scope: 'data', declaringElement: 'P' } ],
      globals: []
    }),
    getElements: () => []
  };

  assert.deepEqual(sections(bare, store, 'P', 'I1'), [],
    'nothing is shown where nothing but the keywords is declared');
});

test('a body shows a name and a value for every declaration', async () => {
  const { document, createExecutionStateView } = await view(),
        { registry, store } = await state();

  store.apply(record({ amount: 17 }, { plain_data: 'inner' }));

  const element = document.createElement('div');

  createExecutionStateView(registry, store).render('PlainTask', 'I1', element);

  const names = [ ...element.querySelectorAll('.wb-attribute-name') ].map((node) => node.textContent),
        values = [ ...element.querySelectorAll('.wb-attribute-value') ].map((node) => node.textContent);

  assert.deepEqual(names, [ 'amount', 'note', 'main_data', 'plain_data', 'budget' ]);
  assert.deepEqual(values, [ '17', 'null', 'null', 'inner', 'null' ]);

  const [ , note ] = [ ...element.querySelectorAll('.wb-attribute-value') ];

  assert.ok(note.classList.contains('wb-attribute-null'), 'an absent value is marked as such');
});

test('a value that changes is written into the body, which is not rebuilt', async () => {
  const { document, createExecutionStateView } = await view(),
        { registry, store } = await state();

  store.apply(record({ amount: 17 }, { plain_data: 'inner' }));

  const element = document.createElement('div');

  document.body.appendChild(element);
  createExecutionStateView(registry, store).render('PlainTask', 'I1', element);

  const [ amount ] = [ ...element.querySelectorAll('.wb-attribute-value') ];

  assert.equal(amount.textContent, '17');

  store.apply(record({ amount: 42 }, { plain_data: 'inner' }));

  assert.equal(amount.textContent, '42', 'the very element that carried the value now carries the new one');
  assert.equal(element.querySelectorAll('.wb-attribute').length, 5, 'and the body around it stands');
});

test('a number that is not whole is shown to two decimal places', async () => {
  const { document, createExecutionStateView } = await view(),
        { registry, store } = await state();

  const element = document.createElement('div');

  document.body.appendChild(element);
  store.apply(record({ amount: 3.14159, note: 'held' }, { plain_data: [ 1.5, 2, 'Origin' ] }));
  createExecutionStateView(registry, store).render('PlainTask', 'I1', element);

  const values = [ ...element.querySelectorAll('.wb-attribute-value') ].map((node) => node.textContent);

  assert.equal(values[0], '3.14');
  assert.equal(values[3], '[1.50, 2, Origin]', 'a collection shows each member as it would read alone');

  store.apply(record({ amount: 12 }, {}));

  assert.equal(element.querySelectorAll('.wb-attribute-value')[0].textContent, '12',
    'a whole number keeps its own form');
});

test('a value that goes away reads as null again', async () => {
  const { document, createExecutionStateView } = await view(),
        { registry, store } = await state();

  const element = document.createElement('div');

  document.body.appendChild(element);
  store.apply(record({ amount: 17, note: 'held' }, {}));
  createExecutionStateView(registry, store).render('PlainTask', 'I1', element);

  const [ , note ] = [ ...element.querySelectorAll('.wb-attribute-value') ];

  assert.equal(note.textContent, 'held');

  store.apply(record({ amount: 17 }, {}));

  assert.equal(note.textContent, 'null');
  assert.ok(note.classList.contains('wb-attribute-null'));
});

test('a body no longer in the document is dropped on the next announcement', async () => {
  const { document, createExecutionStateView } = await view(),
        { registry, store } = await state();

  const element = document.createElement('div');

  document.body.appendChild(element);
  createExecutionStateView(registry, store).render('PlainTask', 'I1', element);

  const [ amount ] = [ ...element.querySelectorAll('.wb-attribute-value') ];

  element.remove();
  store.apply(record({ amount: 42 }, {}));

  assert.equal(amount.textContent, 'null', 'what was drawn into it is no longer kept current');
});

test('a body reading nothing that moved is left alone', async () => {
  const { document, createExecutionStateView } = await view(),
        { registry, store } = await state();

  const element = document.createElement('div');

  document.body.appendChild(element);
  store.apply(record({ amount: 17 }, {}));
  createExecutionStateView(registry, store).render('PlainTask', 'I1', element);

  const [ amount ] = [ ...element.querySelectorAll('.wb-attribute-value') ];

  // a record for another instance entirely, which shares neither a token entry nor a container
  store.createToken({ node: 'MainProcess', label: 'I2' });
  store.apply({ processId: 'MainProcess', instanceId: 'I2', state: 'BUSY', status: { amount: 99 } });

  assert.equal(amount.textContent, '17');
});
