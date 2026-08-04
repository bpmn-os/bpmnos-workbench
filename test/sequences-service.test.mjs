import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Sequences } from '../src/sequences/index.js';
import { DIVIDER } from '../src/sequences/Store.js';

import { createEventBus } from './support/animation.mjs';

/**
 * The service is the store with a diagram around it: what the player writes into it is announced, and a
 * performer conducting nothing offers the first token above its divider through `manual.decide`, which is
 * where every decision of this application goes. It holds no pacing of its own, the store being written as
 * the diagram is drawn.
 */

const MODEL = [ { performer: 'Machine', activities: [ 'Task' ] } ];

const KEY = 'Instance1|Machine';

const token = (label) => ({ label, node: 'Task' });

function setup(state = 'playing') {
  const eventBus = createEventBus(),
        decided = [],
        changes = [];

  const transport = { getState: () => transport.state, state };
  const injector = { get: (name) => (name === 'playback' ? transport : null) };

  const sequences = new Sequences(eventBus, injector);

  sequences.setModel(MODEL);

  eventBus.on('manual.decide', (payload) => decided.push(payload));
  eventBus.on('sequences.changed', () => changes.push(true));

  return { eventBus, sequences, decided, changes, transport };
}

test('what the player writes is announced', () => {
  const { sequences, changes } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));

  assert.deepEqual(sequences.get(KEY).order, [ DIVIDER, 'Job1|Task' ]);
  assert.equal(changes.length, 2);
});

test('nothing is offered while every token stands below the divider', () => {
  const { sequences, decided } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.queue(KEY, token('Job2'));

  assert.deepEqual(decided, []);
});

test('an order set while a performer conducts nothing is offered at once', () => {
  const { sequences, decided } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.queue(KEY, token('Job2'));
  sequences.setOrder(KEY, [ 'Job2|Task', DIVIDER, 'Job1|Task' ]);

  assert.deepEqual(decided, [ {
    event: 'entry',
    payload: { instanceId: 'Job2', nodeId: 'Task' }
  } ]);
});

test('what is offered is settled: it goes to the front and stays there', () => {
  const { sequences, decided } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.queue(KEY, token('Job2'));
  sequences.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);

  assert.deepEqual(decided, [ { event: 'entry', payload: { instanceId: 'Job1', nodeId: 'Task' } } ]);
  assert.equal(sequences.isCommitted(KEY, 'Job1|Task'), true);

  // the reader changes their mind, but a decision given cannot be taken back
  sequences.setOrder(KEY, [ 'Job2|Task', 'Job1|Task', DIVIDER ]);

  assert.deepEqual(sequences.get(KEY).order, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
});

test('a performer that is conducting is offered nothing', () => {
  const { sequences, decided } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.queue(KEY, token('Job2'));
  sequences.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
  decided.length = 0;

  sequences.conduct(KEY, token('Job1'));

  assert.deepEqual(decided, [], 'what it takes next is decided when it is seen to be released');
});

test('the token beneath is offered once the one conducted is seen to leave', () => {
  const { sequences, decided } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.queue(KEY, token('Job2'));
  sequences.setOrder(KEY, [ 'Job1|Task', 'Job2|Task', DIVIDER ]);
  sequences.conduct(KEY, token('Job1'));
  decided.length = 0;

  sequences.archive(KEY, token('Job1'));

  assert.deepEqual(decided, [ {
    event: 'entry',
    payload: { instanceId: 'Job2', nodeId: 'Task' }
  } ]);
});

test('an archived row is a record: forgetting one announces the change and offers nothing', () => {
  const { sequences, decided, changes } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.setOrder(KEY, [ 'Job1|Task', DIVIDER ]);
  sequences.conduct(KEY, token('Job1'));
  sequences.archive(KEY, token('Job1'));

  const before = changes.length;

  decided.length = 0;
  sequences.forget(KEY, 'Job1|Task');

  assert.equal(changes.length, before + 1);
  assert.deepEqual(decided, []);
  assert.deepEqual(sequences.get(KEY).order, [ DIVIDER ]);
});

test('a token joining below the divider offers nothing of its own', () => {
  const { sequences, decided } = setup();

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.setOrder(KEY, [ 'Job1|Task', DIVIDER ]);
  decided.length = 0;

  sequences.queue(KEY, token('Job2'));

  assert.deepEqual(decided, [ {
    event: 'entry',
    payload: { instanceId: 'Job1', nodeId: 'Task' }
  } ], 'the one above the divider is offered again, the one below it is not');
});

test('a paused run is offered nothing, and what became offerable is offered when it plays', () => {
  const { eventBus, sequences, decided, transport } = setup('paused');

  sequences.open('Instance1', 'Machine');
  sequences.queue(KEY, token('Job1'));
  sequences.setOrder(KEY, [ 'Job1|Task', DIVIDER ]);

  assert.deepEqual(decided, [], 'a paused run advances nothing');
  assert.equal(sequences.isCommitted(KEY, 'Job1|Task'), false, 'and nothing is settled');

  transport.state = 'playing';
  eventBus.fire('playback.changed', { state: 'playing' });

  assert.deepEqual(decided, [ { event: 'entry', payload: { instanceId: 'Job1', nodeId: 'Task' } } ]);
});

test('the performers go when the tokens go', () => {
  const { eventBus, sequences, changes } = setup();

  sequences.open('Instance1', 'Machine');
  eventBus.fire('tokens.cleared', {});

  assert.deepEqual(sequences.all(), []);
  assert.equal(changes.length, 2, 'the clearing is announced as the opening was');
});
