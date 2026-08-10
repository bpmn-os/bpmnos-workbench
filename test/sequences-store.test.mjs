import { test } from 'node:test';
import assert from 'node:assert/strict';

import SequenceStore, { DIVIDER } from '../src/sequences/Store.js';

/**
 * What a performer holds is written from the records a run produces, as they are replayed: a performer is
 * opened when the token standing at its node becomes busy, a token joins its list when it becomes ready, is
 * conducted when it is entered, and is dropped when it leaves. What the model resolves — which activities
 * belong to which performer — is given to the store and never changes.
 */

const MODEL = [ { performer: 'Machine', activities: [ 'Task', 'Other' ] } ];

const KEY = 'Instance1|Machine';

function machine() {
  const store = new SequenceStore(MODEL);

  store.open('Instance1', 'Machine');

  return store;
}

const token = (label, node = 'Task') => ({ label, node });

test('the model says which node performs and which activities it performs', () => {
  const store = new SequenceStore(MODEL);

  assert.equal(store.performsSequentially('Machine'), true);
  assert.equal(store.performsSequentially('Task'), false);
  assert.equal(store.performerOf('Task'), 'Machine');
  assert.equal(store.performerOf('Elsewhere'), undefined);
});

test('a performer is opened with the divider alone, so nothing is advanced before the reader places it', () => {
  const store = machine();

  assert.deepEqual(store.get(KEY).order, [ DIVIDER ]);
  assert.equal(store.next(KEY), null);
  assert.equal(store.open('Instance1', 'Machine'), false, 'and is opened once');
});

test('a token joining is appended below the divider', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));

  assert.deepEqual(store.get(KEY).order, [ DIVIDER, 'Job1|Task', 'Job2|Task' ]);
  assert.equal(store.next(KEY), null, 'nothing stands above the divider');
  assert.equal(store.queue(KEY, token('Job1')), false, 'and joins once');
});

test('the order the reader sets is what the next token to enter is read from', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));
  store.setOrder(KEY, [ 'Job2|Task', DIVIDER, 'Job1|Task' ]);

  assert.deepEqual(store.next(KEY), token('Job2'));
});

test('a token taken on goes to the front of what is still to come', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));
  store.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);

  // the order is changed while the decision for Job1 is in flight, so Job2 stands above it when the record
  // saying Job1 was taken arrives
  store.setOrder(KEY, [ 'Job2|Task', 'Job1|Task', DIVIDER ]);
  store.conduct(KEY, token('Job1'));

  assert.deepEqual(store.get(KEY).order, [ 'Job1|Task', 'Job2|Task', DIVIDER ],
    'what ran first is shown first');
});

test('a token archived takes its place at the end of the record', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));
  store.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
  store.conduct(KEY, token('Job1'));
  store.archive(KEY, token('Job1'));

  // a token withdrawn while waiting never ran, so it goes behind what did rather than staying where it sat
  store.archive(KEY, token('Job2'));

  assert.deepEqual(store.get(KEY).order, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
});

test('a token conducted keeps its place and is no candidate', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));
  store.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
  store.conduct(KEY, token('Job1'));

  assert.equal(store.get(KEY).conducting, 'Job1|Task');
  assert.deepEqual(store.get(KEY).order, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
  assert.deepEqual(store.next(KEY), token('Job2'), 'the one beneath it is what enters next');
});

test('a token that has left is archived where it stood, and passed over thereafter', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));
  store.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
  store.conduct(KEY, token('Job1'));
  store.archive(KEY, token('Job1'));

  assert.equal(store.get(KEY).conducting, null);
  assert.deepEqual(store.get(KEY).order, [ 'Job1|Task', 'Job2|Task', DIVIDER ], 'the record stays in place');
  assert.equal(store.isArchived(KEY, 'Job1|Task'), true);
  assert.deepEqual(store.next(KEY), token('Job2'), 'and what is done is no candidate');
  assert.equal(store.archive(KEY, token('Job1')), false, 'and is archived once');
});

test('an archived row may be forgotten, and a waiting one may not', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));
  store.queue(KEY, token('Job2'));
  store.conduct(KEY, token('Job1'));
  store.archive(KEY, token('Job1'));

  assert.equal(store.forget(KEY, 'Job2|Task'), false, 'a token still waiting is the engine\'s, not the view\'s');
  assert.equal(store.forget(KEY, 'Job1|Task'), true);
  assert.deepEqual(store.get(KEY).order, [ DIVIDER, 'Job2|Task' ]);
});

test('a performer that closes is kept as a record, and only a closed one may be forgotten', () => {
  const store = machine();

  store.queue(KEY, token('Job1'));

  assert.equal(store.forgetPerformer(KEY), false, 'an open one is a list the run is still working through');

  assert.equal(store.close('Instance1', 'Machine'), true);
  assert.equal(store.isClosed(KEY), true, 'it stays, as a record of what it did');
  assert.deepEqual(store.get(KEY).order, [ DIVIDER, 'Job1|Task' ], 'with the order it worked in');

  assert.equal(store.forgetPerformer(KEY), true, 'and the reader may take it away');
  assert.deepEqual(store.all(), []);
});

test('a performer holds the colour its token was drawn in, which outlives the token', () => {
  const store = new SequenceStore(MODEL);

  store.open('Instance1', 'Machine', '#3c8');
  store.close('Instance1', 'Machine');

  assert.equal(store.get(KEY).color, '#3c8', 'a closed performer is known by the colour it performed in');

  const uncoloured = new SequenceStore(MODEL);

  uncoloured.open('Instance1', 'Machine');
  assert.equal(uncoloured.get(KEY).color, null, 'and a host that draws nothing says nothing');
});

test('performers of one node in several instances are told apart', () => {
  const store = new SequenceStore(MODEL);

  store.open('Instance1', 'Machine');
  store.open('Instance2', 'Machine');
  store.queue('Instance2|Machine', token('Job1'));

  assert.deepEqual(store.all().map((held) => held.key), [ 'Instance1|Machine', 'Instance2|Machine' ]);
  assert.deepEqual(store.get('Instance1|Machine').order, [ DIVIDER ]);
  assert.deepEqual(store.get('Instance2|Machine').order, [ DIVIDER, 'Job1|Task' ]);
});

test('what is cleared is everything, and it says whether it held anything', () => {
  const store = new SequenceStore(MODEL);

  assert.equal(store.clear(), false);
  store.open('Instance1', 'Machine');
  assert.equal(store.clear(), true);
  assert.deepEqual(store.all(), []);
});
