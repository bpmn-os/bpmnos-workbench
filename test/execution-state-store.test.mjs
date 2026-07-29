import { test } from 'node:test';
import assert from 'node:assert/strict';

import ExecutionStateStore from '../src/execution-state/Store.js';

import { registryOf, attribute } from './support/model.mjs';

/**
 * The store holds values by entry: a token for status, the token owning a container for data, the run for
 * globals. Every test below applies engine records and reads them back through the declarations the fixture
 * makes, which is the only way a value can be reached.
 */

// the token hierarchy the player records as it creates each token: the instance root, the token that
// entered the plain sub-process, and a token at the task within it
function instance(store) {
  store.createToken({ node: 'MainProcess', label: 'I1' });
  store.createToken({ node: 'PlainSub', label: 'I1', parentNode: 'MainProcess', parentLabel: 'I1' });
  store.createToken({ node: 'PlainTask', label: 'I1', parentNode: 'PlainSub', parentLabel: 'I1' });
}

async function store() {
  return new ExecutionStateStore(await registryOf('nested-data.bpmn'));
}

test('a record is read back through the declarations at its node', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess',
    instanceId: 'I1',
    status: { timestamp: 3, amount: 7 },
    data: { instance: 'I1', main_data: 'held' }
  });

  const read = (id) => state.getValue('MainProcess', 'I1', attribute(registry, 'MainProcess', id));

  assert.equal(read('Status_Amount'), 7, 'a declaration carrying an initialisation is named by its target');
  assert.equal(read('Data_Main'), 'held');
});

test('neither keyword is held, both being on the screen already', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess',
    instanceId: 'I1',
    status: { timestamp: 3, amount: 7 },
    data: { instance: 'I1', main_data: 'held' }
  });

  const read = (id) => state.getValue('MainProcess', 'I1', attribute(registry, 'MainProcess', id));

  assert.equal(read('Timestamp'), null, 'the clock on the canvas reads it');
  assert.equal(read('Instance'), null, 'the token\'s label carries it');
});

test('a record reports the state its token is in', async () => {
  const state = await store();

  instance(state);

  state.apply({ processId: 'MainProcess', instanceId: 'I1', state: 'ENTERED', status: { timestamp: 0 } });
  assert.equal(state.getState('MainProcess', 'I1'), 'ENTERED');

  state.apply({ processId: 'MainProcess', instanceId: 'I1', state: 'BUSY', status: { timestamp: 1 } });
  assert.equal(state.getState('MainProcess', 'I1'), 'BUSY');

  assert.equal(state.getState('PlainTask', 'I1'), null, 'a token no record has named is in no state');

  state.removeToken({ node: 'MainProcess', label: 'I1' });
  assert.equal(state.getState('MainProcess', 'I1'), null, 'and the state dies with its token');
});

test('an attribute the node declares and no record supplied reads as null', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess',
    instanceId: 'I1',
    nodeId: 'PlainTask',
    status: { timestamp: 3 },
    data: { instance: 'I1' }
  });

  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Status_Note')), null,
    'a status attribute the record omits');
  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Data_Plain')), null,
    'a data attribute never reported');
  assert.equal(state.getValue('PlainEnd', 'I1', attribute(registry, 'PlainEnd', 'Status_Amount')), null,
    'every attribute of a token no record has ever named');
});

test('a record states the whole of a token\'s status, so what it omits is dropped', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  const record = (status) => state.apply({
    processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainTask', status
  });

  record({ timestamp: 1, amount: 7, note: 'first' });
  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Status_Note')), 'first');

  record({ timestamp: 2, amount: 7 });
  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Status_Note')), null);
});

test('globals are held once and read alike at every node', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainTask',
    status: { timestamp: 1 }, globals: { budget: 120 }
  });

  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Global_Budget')), 120);
  assert.equal(state.getValue('MainProcess', 'I1', attribute(registry, 'MainProcess', 'Global_Budget')), 120,
    'a token that never reported them reads the same values');
});

test('a token that hops keeps what it holds', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainStart', state: 'DEPARTED',
    status: { timestamp: 0, amount: 4 }
  });

  state.moveToken({ label: 'I1', from: 'PlainStart', to: 'PlainTask' });

  assert.equal(state.getState('PlainTask', 'I1'), 'DEPARTED');
  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Status_Amount')), 4);
  assert.equal(state.getValue('PlainStart', 'I1', attribute(registry, 'PlainStart', 'Status_Amount')), null,
    'and holds it under the node it now rests at alone');
});

test('a token\'s status and the container it owns die with it, what it inherited does not', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainTask',
    status: { timestamp: 5, note: 'held' },
    data: { instance: 'I1', main_data: 'outer', plain_data: 'inner' }
  });

  state.removeToken({ node: 'PlainSub', label: 'I1' });

  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Data_Plain')), null,
    'the container the removed token owned is gone');
  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Data_Main')), 'outer',
    'the container its ancestor owns is untouched');
  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Status_Note')), 'held',
    'as is the status of every other token');

  state.removeToken({ node: 'PlainTask', label: 'I1' });

  assert.equal(state.getValue('PlainTask', 'I1', attribute(registry, 'PlainTask', 'Status_Note')), null);
});

test('a clear drops everything, globals included', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  state.apply({
    processId: 'MainProcess', instanceId: 'I1', state: 'BUSY',
    status: { amount: 1 }, data: { main_data: 'held' }, globals: { budget: 3 }
  });

  state.clear();

  const read = (id) => state.getValue('MainProcess', 'I1', attribute(registry, 'MainProcess', id));

  assert.equal(read('Status_Amount'), null);
  assert.equal(read('Data_Main'), null);
  assert.equal(read('Global_Budget'), null);
  assert.equal(state.getState('MainProcess', 'I1'), null);
});

test('a record is announced once, naming the entries it touched', async () => {
  const registry = await registryOf('nested-data.bpmn'),
        state = new ExecutionStateStore(registry);

  instance(state);

  const announced = [];
  const unsubscribe = state.on((changed) => announced.push(changed));

  state.apply({
    processId: 'MainProcess', instanceId: 'I1', nodeId: 'PlainTask',
    status: { timestamp: 1 }, data: { plain_data: 'inner' }, globals: { budget: 3 }
  });

  assert.equal(announced.length, 1, 'one announcement per record');

  const changed = announced[0],
        reads = state.dependencies('PlainTask', 'I1');

  assert.ok(changed.size > 0);
  [ ...changed ].forEach((key) =>
    assert.ok(reads.has(key), 'an entry a token entry at that node reads: ' + key));

  unsubscribe();
  state.apply({ processId: 'MainProcess', instanceId: 'I1', status: { timestamp: 2 } });

  assert.equal(announced.length, 1, 'a listener that unsubscribed hears nothing further');
});

test('a body at a node reads its own status, the containers it sees and the globals', async () => {
  const state = await store();

  instance(state);

  assert.deepEqual([ ...state.dependencies('PlainTask', 'I1') ].sort(), [
    'data:MainProcess|I1',
    'data:PlainSub|I1',
    'globals',
    'token:PlainTask|I1'
  ]);
});
