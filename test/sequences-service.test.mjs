import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Sequences } from '../src/sequences/index.js';
import { DIVIDER } from '../src/sequences/Store.js';

import { createEventBus } from './support/animation.mjs';

/**
 * The service reads the performers and the pending decisions from one announcement, `manual.decisions`, and
 * answers for a performer that is idle and asking: the first token above its divider is enqueued through
 * `manual.decide`, which is where every decision of this application goes.
 */

const token = (instanceId, nodeId) => ({ processId: 'Process', instanceId, nodeId });

const machine = (performing, waiting) => ({
  performer: token('Instance1', 'Machine'),
  performing: performing || null,
  waiting: waiting || []
});

const entryRequest = (instanceId, nodeId) => ({ type: 'entry', instanceId, nodeId });

const KEY = 'Instance1|Machine';

function setup() {
  const eventBus = createEventBus(),
        decided = [],
        changes = [];

  const sequences = new Sequences(eventBus);

  eventBus.on('manual.decide', (payload) => decided.push(payload));
  eventBus.on('sequences.changed', () => changes.push(true));

  const report = (performers, decisions) =>
    eventBus.fire('manual.decisions', { performers, decisions: decisions || [] });

  return { eventBus, sequences, decided, changes, report };
}

test('a report is applied and announced', () => {
  const { sequences, changes, report } = setup();

  report([ machine(null, [ token('Job1', 'Task') ]) ]);

  assert.deepEqual(sequences.get(KEY).order, [ DIVIDER, 'Job1|Task' ]);
  assert.equal(changes.length, 1);
});

test('nothing is enqueued while every token stands below the divider', () => {
  const { decided, report } = setup();

  report(
    [ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ],
    [ entryRequest('Job1', 'Task'), entryRequest('Job2', 'Task') ]
  );

  assert.deepEqual(decided, []);
});

test('the first token above the divider is enqueued where its performer is idle and asking', () => {
  const { sequences, decided, report } = setup();

  report(
    [ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ],
    [ entryRequest('Job1', 'Task'), entryRequest('Job2', 'Task') ]
  );

  sequences.setOrder(KEY, [ 'Job2|Task', 'Job1|Task', DIVIDER ]);

  report(
    [ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ],
    [ entryRequest('Job1', 'Task'), entryRequest('Job2', 'Task') ]
  );

  assert.deepEqual(decided, [ {
    event: 'entry',
    payload: { instanceId: 'Job2', nodeId: 'Task' }
  } ]);

  assert.equal(sequences.get(KEY).fixed, 'Job2|Task', 'and is marked as given to the engine');
});

test('a token the engine is not asking for is not enqueued, whatever the order says', () => {
  const { decided, report } = setup();

  report([ machine(null, [ token('Job1', 'Task') ]) ], []);
  report([ machine(null, [ token('Job1', 'Task') ]) ], []);

  assert.deepEqual(decided, []);
});

test('a performer that is conducting is asked for nothing', () => {
  const { sequences, decided, report } = setup();

  report([ machine(null, [ token('Job1', 'Task'), token('Job2', 'Task') ]) ]);
  sequences.setOrder(KEY, [ 'Job2|Task', DIVIDER, 'Job1|Task' ]);

  report(
    [ machine(token('Job1', 'Task'), [ token('Job2', 'Task') ]) ],
    [ entryRequest('Job2', 'Task') ]
  );

  assert.deepEqual(decided, [], 'the performer is busy, whatever a stale request may say');
});

test('a decision that did not take effect is given again, the report saying so by repeating itself', () => {
  const { sequences, decided, report } = setup();

  report([ machine(null, [ token('Job1', 'Task') ]) ]);
  sequences.setOrder(KEY, [ 'Job1|Task', DIVIDER ]);

  // enqueuing resumes the engine, so a second report showing the performer idle and the token asked for is
  // a report that the first decision was void
  report([ machine(null, [ token('Job1', 'Task') ]) ], [ entryRequest('Job1', 'Task') ]);
  report([ machine(null, [ token('Job1', 'Task') ]) ], [ entryRequest('Job1', 'Task') ]);

  assert.equal(decided.length, 2);
  assert.equal(sequences.get(KEY).pinned, 'Job1|Task', 'and stands with the engine again');
});

test('a token that left and came back is a token the reader has not placed', () => {
  const { sequences, decided, report } = setup();

  report([ machine(null, [ token('Job1', 'Task') ]) ]);
  sequences.setOrder(KEY, [ 'Job1|Task', DIVIDER ]);
  report([ machine(null, [ token('Job1', 'Task') ]) ], [ entryRequest('Job1', 'Task') ]);

  report([ machine(null, []) ], []);
  report([ machine(null, [ token('Job1', 'Task') ]) ], [ entryRequest('Job1', 'Task') ]);

  assert.equal(decided.length, 1, 'it is appended below the divider, and nothing below it is advanced');
  assert.deepEqual(sequences.get(KEY).order, [ DIVIDER, 'Job1|Task' ]);
});

test('the performers go when the tokens go', () => {
  const { eventBus, sequences, changes, report } = setup();

  report([ machine(null, [ token('Job1', 'Task') ]) ]);
  eventBus.fire('tokens.cleared', {});

  assert.deepEqual(sequences.all(), []);
  assert.equal(changes.length, 2, 'the clearing is announced as the report was');
});
