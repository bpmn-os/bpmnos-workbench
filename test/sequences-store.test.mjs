import { test } from 'node:test';
import assert from 'node:assert/strict';

import SequenceStore, { DIVIDER } from '../src/sequences/Store.js';

/**
 * What a performer holds is the engine's answer read against the order the reader has set. The reports here
 * are of the bridge's own shape, `[ { performer, performing, waiting } ]`, each entry an identity of the
 * keys `Token::jsonify` reports.
 */

const token = (instanceId, nodeId) => ({ processId: 'Process', instanceId, nodeId });

const performer = (instanceId, nodeId, performing, waiting) => ({
  performer: token(instanceId, nodeId),
  performing: performing || null,
  waiting: waiting || []
});

const machine = (performing, waiting) => performer('Instance1', 'Machine', performing, waiting);

const keys = (store, key) => store.get(key).order;

const KEY = 'Instance1|Machine';

test('a performer begins as the divider alone, so nothing is advanced before the reader places it', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, []) ]);

  assert.deepEqual(keys(store, KEY), [ DIVIDER ]);
  assert.equal(store.next(KEY), null);
});

test('the tokens reported are appended below the divider, in the order reported', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);

  assert.deepEqual(keys(store, KEY), [ DIVIDER, 'Job1|Task', 'Job2|Task' ]);
  assert.equal(store.next(KEY), null, 'nothing stands above the divider');
});

test('the order the reader sets is what a later report is read against', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  store.setOrder(KEY, [ 'Job2|Task', DIVIDER, 'Job1|Task' ]);

  assert.deepEqual(store.next(KEY), token('Job2', 'Task'));

  // a token still waiting keeps its place, and one not seen before lands at the end
  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task'), token('Job3', 'Task') ]) ]);

  assert.deepEqual(keys(store, KEY), [ 'Job2|Task', DIVIDER, 'Job1|Task', 'Job3|Task' ]);
});

test('a token that has left the engine leaves the list', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  store.apply([ machine(null, [ token('Job2', 'Task') ]) ]);

  assert.deepEqual(keys(store, KEY), [ DIVIDER, 'Job2|Task' ]);
});

test('a token given to the engine stands at the head and takes no part in the order', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  store.setOrder(KEY, [ 'Job1|Task', DIVIDER, 'Job2|Task' ]);
  store.pin(KEY, 'Job1|Task');

  assert.equal(store.get(KEY).fixed, 'Job1|Task');
  assert.deepEqual(keys(store, KEY), [ 'Job1|Task', DIVIDER, 'Job2|Task' ]);
  assert.deepEqual(store.next(KEY), token('Job1', 'Task'), 'and is still what is to enter next');
});

test('the token being conducted is no candidate, the list beneath it being what is still to come', () => {
  const store = new SequenceStore();

  store.apply([ machine(token('Job1', 'Task'), [ token('Job2', 'Task') ]) ]);
  store.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);

  assert.deepEqual(store.next(KEY), token('Job2', 'Task'));
});

test('the mark is spent once the engine answers, the same row now being conducted', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  store.pin(KEY, 'Job1|Task');
  store.apply([ machine(token('Job1', 'Task'), [ token('Job2', 'Task') ]) ]);

  const held = store.get(KEY);

  assert.equal(held.pinned, null);
  assert.equal(held.conducting, 'Job1|Task');
  assert.equal(held.fixed, 'Job1|Task');
  assert.deepEqual(held.order, [ 'Job1|Task', DIVIDER, 'Job2|Task' ]);
});

test('the mark is spent where its token is gone, and the row goes with it', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  store.pin(KEY, 'Job1|Task');
  store.apply([ machine(null, [ token('Job2', 'Task') ]) ]);

  const held = store.get(KEY);

  assert.equal(held.pinned, null);
  assert.equal(held.fixed, null);
  assert.deepEqual(held.order, [ DIVIDER, 'Job2|Task' ]);
});

test('a decision that is void leaves its token where it was, to be enqueued again', () => {
  const store = new SequenceStore();

  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  store.pin(KEY, 'Job1|Task');

  // the performer is idle and the token still waits: the engine has not answered, or its answer was void
  store.apply([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);

  assert.deepEqual(keys(store, KEY), [ 'Job1|Task', DIVIDER, 'Job2|Task' ]);
  assert.equal(store.get(KEY).pinned, 'Job1|Task', 'still with the engine');
});

test('the performers are held in the order they were first reported', () => {
  const store = new SequenceStore();

  store.apply([ performer('Instance1', 'M1'), performer('Instance1', 'M2') ]);
  store.apply([ performer('Instance1', 'M2'), performer('Instance1', 'M1') ]);

  assert.deepEqual(store.all().map((held) => held.key), [ 'Instance1|M1', 'Instance1|M2' ]);
});

test('a performer no longer reported is no longer held', () => {
  const store = new SequenceStore();

  store.apply([ performer('Instance1', 'M1'), performer('Instance1', 'M2') ]);
  store.apply([ performer('Instance1', 'M2') ]);

  assert.deepEqual(store.all().map((held) => held.key), [ 'Instance1|M2' ]);
});

test('a token standing at a process is told from one standing at a node', () => {
  const store = new SequenceStore();

  store.apply([ performer('Instance1', undefined, null, [ token('Job1', 'Task') ]) ]);

  assert.equal(store.get('Instance1|').order.length, 2);
});

test('what is cleared is everything, and it says whether it held anything', () => {
  const store = new SequenceStore();

  assert.equal(store.clear(), false);

  store.apply([ machine(null, [ token('Job1', 'Task') ]) ]);

  assert.equal(store.clear(), true);
  assert.deepEqual(store.all(), []);
});
