import { test } from 'node:test';
import assert from 'node:assert/strict';

import ExecutionStateStore from '../src/execution-state/Store.js';

import { registryOf, attribute } from './support/model.mjs';

/**
 * Data belongs to the token that owns its container, which is in general not the token reporting the value.
 * The three shapes below are what distinguish the two clauses of the rule: a plain sub-process, where the
 * owner carries the reading token's own label; a multi-instance sub-process, where two tokens rest at one
 * node and only the child owns the container; and an event sub-process, where the workbench animates no
 * token at the scope at all and the token at its start event is the outermost within it.
 */

// the ancestry the player records for every token of one firing of each shape
function tokens(store) {
  store.createToken({ node: 'MainProcess', label: 'I1' });

  store.createToken({ node: 'PlainSub', label: 'I1', parentNode: 'MainProcess', parentLabel: 'I1' });
  store.createToken({ node: 'PlainTask', label: 'I1', parentNode: 'PlainSub', parentLabel: 'I1' });

  // the multi-instance main thread rests at the activity, and each child spawns from it under a derived
  // instance identifier, so both rest at the same node
  store.createToken({ node: 'MultiSub', label: 'I1', parentNode: 'MainProcess', parentLabel: 'I1' });
  store.createToken({ node: 'MultiSub', label: 'I1^MultiSub#1', parentNode: 'MultiSub', parentLabel: 'I1' });
  store.createToken({ node: 'MultiTask', label: 'I1^MultiSub#1',
    parentNode: 'MultiSub', parentLabel: 'I1^MultiSub#1' });

  // an event sub-process firing hangs off the enclosing scope instance: the workbench draws no token at the
  // sub-process itself, the firing being represented by the token at its start event
  store.createToken({ node: 'EventStart', label: 'I1^EventSub#1',
    parentNode: 'MainProcess', parentLabel: 'I1' });
  store.createToken({ node: 'EventTask', label: 'I1^EventSub#1',
    parentNode: 'EventStart', parentLabel: 'I1^EventSub#1' });
}

async function state() {
  const registry = await registryOf('nested-data.bpmn'),
        store = new ExecutionStateStore(registry);

  tokens(store);

  return { registry, store, owner: (node, label, id) =>
    store.ownerOf(node, label, attribute(registry, node, id)) };
}

test('a plain sub-process is owned by the token that entered it', async () => {
  const { owner } = await state();

  assert.deepEqual(owner('PlainTask', 'I1', 'Data_Plain'), { node: 'PlainSub', label: 'I1' });
  assert.deepEqual(owner('PlainTask', 'I1', 'Data_Main'), { node: 'MainProcess', label: 'I1' });
});

test('a multi-instance container is owned by the child, not by the main thread', async () => {
  const { owner } = await state();

  assert.deepEqual(owner('MultiTask', 'I1^MultiSub#1', 'Data_Multi'),
    { node: 'MultiSub', label: 'I1^MultiSub#1' },
    'the innermost ancestor at the declaring element, which is the child');
});

test('a token under a derived instance identifier reads the container of the token that owns it', async () => {
  const { owner } = await state();

  assert.deepEqual(owner('MultiTask', 'I1^MultiSub#1', 'Data_Main'),
    { node: 'MainProcess', label: 'I1' },
    'the process container is owned by the root token, whatever label the reader carries');
});

test('two multi-instance children hold their own containers and share what encloses them', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        store = new ExecutionStateStore(registry);

  tokens(store);

  store.createToken({ node: 'MultiSub', label: 'I1^MultiSub#2', parentNode: 'MultiSub', parentLabel: 'I1' });
  store.createToken({ node: 'MultiTask', label: 'I1^MultiSub#2',
    parentNode: 'MultiSub', parentLabel: 'I1^MultiSub#2' });

  const record = (label, multi, main) => store.apply({
    processId: 'MainProcess', instanceId: label, nodeId: 'MultiTask',
    status: { timestamp: 1 }, data: { instance: label, multi_data: multi, main_data: main }
  });

  record('I1^MultiSub#1', 'first', 'shared');
  record('I1^MultiSub#2', 'second', 'rewritten');

  const read = (label, id) =>
    store.getValue('MultiTask', label, attribute(registry, 'MultiTask', id));

  assert.equal(read('I1^MultiSub#1', 'Data_Multi'), 'first');
  assert.equal(read('I1^MultiSub#2', 'Data_Multi'), 'second');
  assert.equal(read('I1^MultiSub#1', 'Data_Main'), 'rewritten',
    'the enclosing container is one entry, so the later record is what both children read');
});

test('an event sub-process is owned by the token at its start event', async () => {
  const { owner } = await state();

  assert.deepEqual(owner('EventTask', 'I1^EventSub#1', 'Data_Event'),
    { node: 'EventStart', label: 'I1^EventSub#1' },
    'the outermost ancestor still seeing the attribute, no token resting at the scope');

  assert.deepEqual(owner('EventTask', 'I1^EventSub#1', 'Data_Main'),
    { node: 'MainProcess', label: 'I1' });
});

test('the instance attribute is never resolved to an owner', async () => {
  const { registry, store, owner } = await state();

  [
    [ 'MainProcess', 'I1' ],
    [ 'PlainTask', 'I1' ],
    [ 'MultiTask', 'I1^MultiSub#1' ],
    [ 'EventTask', 'I1^EventSub#1' ]
  ].forEach(([ node, label ]) => {
    assert.equal(owner(node, label, 'Instance'), null);
    assert.equal(store.getValue(node, label, attribute(registry, node, 'Instance')), null,
      'and it is not held at all, the token\'s label being what the engine reports it as');
  });
});

test('a record from a token inside a scope writes through to the owner', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        store = new ExecutionStateStore(registry);

  tokens(store);

  store.apply({
    processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainTask',
    status: { timestamp: 1 }, data: { instance: 'I1', main_data: 'written', plain_data: 'inner' }
  });

  assert.equal(store.getValue('MainProcess', 'I1', attribute(registry, 'MainProcess', 'Data_Main')),
    'written', 'the root token reads what a token within the process wrote');
  assert.equal(store.getValue('PlainSub', 'I1', attribute(registry, 'PlainSub', 'Data_Plain')),
    'inner', 'and the scope token reads its own container');
});

test('a token whose parentage is unrecorded owns what it reads', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        store = new ExecutionStateStore(registry);

  assert.deepEqual(store.ownerOf('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Data_Main')),
    { node: 'PlainTask', label: 'I1' },
    'with no ancestry to walk the reader is the only candidate, which is what a root token is');
});
