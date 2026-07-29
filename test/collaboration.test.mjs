import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ExecutionState, processIdOf } from '../src/execution-state/index.js';

import { registryOf, attribute } from './support/model.mjs';
import { createEventBus } from './support/animation.mjs';

/**
 * A process has no shape of its own in a collaboration; its pool has, and `bpmn-js-animation` holds a
 * process-level token under the pool's identifier. The engine reports the process, and so does the registry,
 * naming the process as the element that declares what a process declares. The workbench keeps the engine's
 * vocabulary and maps a canvas identifier back at every edge, which is what these tests pin: a value written
 * from a record naming the process must be read back from a token the animation hands over naming the pool.
 */

// the pool of the job shop's job process, and a flow node, as the element registry reports them
const elementRegistry = {
  get: (id) => ({
    Participant_Job: { id: 'Participant_Job', businessObject: { processRef: { id: 'JobProcess' } } },
    JobProcess: undefined,
    StartEventItem: { id: 'StartEventItem', businessObject: {} }
  })[id]
};

test('a pool names the process it stands for, and anything else names itself', () => {
  assert.equal(processIdOf(elementRegistry, 'Participant_Job'), 'JobProcess');
  assert.equal(processIdOf(elementRegistry, 'StartEventItem'), 'StartEventItem');
  assert.equal(processIdOf(elementRegistry, 'JobProcess'), 'JobProcess',
    'a process the registry does not know as a shape is already what it names');
  assert.equal(processIdOf(undefined, 'JobProcess'), 'JobProcess');
});

test('a process-level token is read back under the process, whichever identifier the canvas uses', async () => {
  const registry = await registryOf('job-shop.bpmn'),
        store = new ExecutionState(createEventBus(), registry, elementRegistry);

  store.createToken({ node: 'JobProcess', label: 'Job1' });

  // the job process declares its machines and durations as data, and the collaboration a global
  store.apply({
    processId: 'JobProcess', instanceId: 'Job1', state: 'BUSY',
    status: { timestamp: 0 },
    data: { instance: 'Job1', machines: [ 'Machine1' ], durations: [ 5 ] },
    globals: { makespan: 12 }
  });

  const machines = attribute(registry, 'JobProcess', 'Machines'),
        pool = processIdOf(elementRegistry, 'Participant_Job');

  assert.deepEqual(store.getValue('JobProcess', 'Job1', machines), [ 'Machine1' ],
    'as the record wrote it');
  assert.deepEqual(store.getValue(pool, 'Job1', machines), [ 'Machine1' ],
    'and as a token entry drawn for the pool reads it');
  assert.deepEqual(store.ownerOf(pool, 'Job1', machines), { node: 'JobProcess', label: 'Job1' },
    'one container, owned by the token at the process');
});

test('a token removed under the pool takes the process entry with it', async () => {
  const eventBus = createEventBus(),
        registry = await registryOf('job-shop.bpmn'),
        store = new ExecutionState(eventBus, registry, elementRegistry);

  store.createToken({ node: 'JobProcess', label: 'Job1' });
  store.apply({ processId: 'JobProcess', instanceId: 'Job1', state: 'BUSY', status: { timestamp: 0 } });

  assert.equal(store.getState('JobProcess', 'Job1'), 'BUSY');

  // the animation announces its own identity, which for a process-level token is the pool
  eventBus.fire('token.removed', { token: { node: 'Participant_Job', label: 'Job1' } });

  assert.equal(store.getState('JobProcess', 'Job1'), null);
});
