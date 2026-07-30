import { test } from 'node:test';
import assert from 'node:assert/strict';

import EngineLogPlayer from '../src/playback/EngineLogPlayer.js';
import { ExecutionState } from '../src/execution-state/index.js';

import { parse, registryOf } from './support/model.mjs';
import {
  createAnimation, createElementRegistry, createEventBus, createPrimitives
} from './support/animation.mjs';

/**
 * A token leaving a node by several flows at once is reported as one departure per flow, one after the
 * other: the engine copies the token per outgoing flow and advances each, which is how every diverging
 * gateway but the exclusive one departs. Drawn one departure at a time, the first would carry the token away
 * and every later one would find nothing left at the gateway, which is what a knapsack playback showed at
 * its event-based gateway. They are one fork and are drawn as one.
 */

const FIXTURE = 'parallel-fork.bpmn';

// what the engine reports for one instance up to and including the fork
const log = [
  { token: { processId: 'ForkProcess', instanceId: 'I1', state: 'ENTERED', status: { timestamp: 0 } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', state: 'BUSY', status: { timestamp: 0 } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'Start', state: 'ENTERED',
    status: { timestamp: 0 } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'Start', sequenceFlowId: 'Flow_start',
    state: 'DEPARTED', status: { timestamp: 0 } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'Fork', sequenceFlowId: 'Flow_start',
    state: 'ARRIVED', status: { timestamp: 0 } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'Fork', state: 'ENTERED',
    status: { timestamp: 0 } } },

  // the fork: one departure per outgoing flow, from the same token at the same node
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'Fork', sequenceFlowId: 'Flow_a',
    state: 'DEPARTED', status: { timestamp: 0, note: 'a' } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'Fork', sequenceFlowId: 'Flow_b',
    state: 'DEPARTED', status: { timestamp: 0, note: 'b' } } },

  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'TaskA', sequenceFlowId: 'Flow_a',
    state: 'ARRIVED', status: { timestamp: 0, note: 'a' } } },
  { token: { processId: 'ForkProcess', instanceId: 'I1', nodeId: 'TaskB', sequenceFlowId: 'Flow_b',
    state: 'ARRIVED', status: { timestamp: 0, note: 'b' } } }
];

async function replay() {
  const definitions = await parse(FIXTURE),
        registry = await registryOf(FIXTURE);

  const eventBus = createEventBus(),
        elementRegistry = createElementRegistry(definitions),
        animation = createAnimation(eventBus, elementRegistry),
        store = new ExecutionState(eventBus, registry, elementRegistry);

  const injector = { get: (name) => name === 'executionState' ? store : undefined };

  const player = new EngineLogPlayer(eventBus, animation, createPrimitives(), elementRegistry, injector);

  await player.play(log);

  return { animation, store };
}

test('a token departing by several flows is forked once, not moved twice', async () => {
  const { animation } = await replay();

  const forks = animation.calls.filter((call) => call.call === 'forkToken');

  assert.deepEqual(forks.map((call) => call.sequenceFlow), [ 'Flow_a', 'Flow_b' ],
    'a branch is placed on each outflow, in the order the departures were reported');
  assert.ok(forks.every((call) => call.node === 'Fork' && call.label === 'I1'));
});

test('every branch then travels its own flow', async () => {
  const { animation } = await replay();

  // the gateway also anchors the token at its centre when it is entered, which carries no flow
  const travelled = animation.calls
    .filter((call) => call.call === 'advanceToken' && call.node === 'Fork' && call.sequenceFlow)
    .map((call) => call.sequenceFlow);

  assert.deepEqual(travelled, [ 'Flow_a', 'Flow_b' ]);

  assert.ok(animation.getToken('TaskA', 'I1'), 'one branch arrived at the first task');
  assert.ok(animation.getToken('TaskB', 'I1'), 'the other at the second');
  assert.ok(!animation.getToken('Fork', 'I1'), 'and nothing was left at the gateway');
});

test('a departure by one flow is a hop, as before', async () => {
  const { animation } = await replay();

  const fromStart = animation.calls.filter((call) => call.call === 'advanceToken' && call.node === 'Start');

  assert.deepEqual(fromStart.map((call) => call.sequenceFlow), [ 'Flow_start' ]);
  assert.ok(!animation.calls.some((call) => call.call === 'forkToken' && call.node === 'Start'));
});
