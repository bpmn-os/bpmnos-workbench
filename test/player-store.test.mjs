import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import EngineLogPlayer from '../src/playback/EngineLogPlayer.js';
import { ExecutionState } from '../src/execution-state/index.js';

import { parse, registryOf, attribute } from './support/model.mjs';
import {
  createAnimation, createElementRegistry, createEventBus, createPrimitives
} from './support/animation.mjs';

/**
 * The player is the store's only writer. It walks a log record by record and, for each, updates the store
 * and issues the animation call that record resolves to, in that order, so that a token entry shows what its
 * token held at the step the diagram is showing rather than at the end of a run.
 *
 * The log played here is the earliest-arrival run bundled with the application, produced by the engine
 * itself, over the model it was produced from. Its process declares four status attributes and one data
 * attribute, its sub-process four more, and a token carries all of them.
 */

const MODEL = new URL('../src/examples/earliest-arrival.bpmn', import.meta.url);
const LOG = new URL('../src/examples/earliest-arrival-log.json', import.meta.url);

const CURRENT_LOCATION = 'Attribute_3e02i81';
const NEXT_LOCATION = 'Attribute_219l1cu';

// the player, the stub animation it drives, and, where a registry is given, the store it writes. The store
// is the wired service rather than the bare one, so that a test exercises the identity events it rides as
// well as the values the player writes; without a registry there is no store, which is the host that wants
// the animation without the values.
async function run(registry) {
  const definitions = await parse(MODEL),
        log = JSON.parse(await readFile(fileURLToPath(LOG), 'utf8'));

  const eventBus = createEventBus(),
        elementRegistry = createElementRegistry(definitions),
        animation = createAnimation(eventBus, elementRegistry);

  const store = registry ? new ExecutionState(eventBus, registry) : undefined;

  const injector = { get: (name) => name === 'executionState' ? store : undefined };

  return {
    animation,
    log,
    store,
    player: new EngineLogPlayer(eventBus, animation, createPrimitives(), elementRegistry, injector)
  };
}

// the same, with a reader resolving a value through the declarations at its node
async function replay() {
  const registry = await registryOf(MODEL),
        played = await run(registry);

  return {
    ...played,
    read: (node, label, id) => played.store.getValue(node, label, attribute(registry, node, id))
  };
}

test('nothing is held until the log is played', async () => {
  const { store, log } = await replay();

  assert.ok(log.filter((entry) => entry.token).length > 10, 'the bundled log carries a run');
  assert.equal(store.getState('EarliestArrival_Process', 'Instance1'), null);
});

test('the store holds what the record just replayed carried, and nothing later', async () => {
  const { player, store, log, read } = await replay();

  // through the third token record, which is the child token entering at the start event
  await player.play(log.slice(0, 3));

  assert.equal(store.getState('StartEvent_1', 'Instance1'), 'ENTERED');
  assert.equal(read('StartEvent_1', 'Instance1', CURRENT_LOCATION), 'Origin',
    'the location as it stood at that step, the run having gone no further');
  assert.equal(read('LoopActivity', 'Instance1', NEXT_LOCATION), null,
    'and nothing of the steps still to come');
});

test('a token that hops is held under the node it now rests at', async () => {
  const { player, log, read } = await replay();

  // through the arrival of that token at the sub-process, which the departure before it animated
  await player.play(log.slice(0, 5));

  assert.equal(read('LoopActivity', 'Instance1', CURRENT_LOCATION), 'Origin',
    'the hop carried what the token held to the node it arrived at');
  assert.equal(read('StartEvent_1', 'Instance1', CURRENT_LOCATION), null, 'and left nothing behind');
});

test('values move with the run', async () => {
  const { player, log, read } = await replay();

  const upTo = (state) => log.slice(0, log.findIndex((entry) =>
    entry.token && entry.token.nodeId === 'Travel' && entry.token.state === state) + 1);

  await player.play(upTo('BUSY'));
  const chosen = read('Travel', 'Instance1', NEXT_LOCATION);

  assert.ok(chosen, 'the destination chosen for the first trip is held while the token travels');

  await player.play(upTo('COMPLETED'));
  assert.equal(read('Travel', 'Instance1', CURRENT_LOCATION), chosen,
    'and on completion the current location is the destination it travelled to');
});

test('the parentage the player hands the animation is the one the store records', async () => {
  const { player, store, log, animation } = await replay();

  // through the two births, and no further: a token that has since hopped is held under the node it
  // hopped to, so the keys of the birth calls would no longer be the store's
  await player.play(log.slice(0, 3));

  const births = animation.calls.filter((call) => call.call === 'createToken');

  assert.equal(births.length, 2, 'the instance root and the token at the start event were created');

  births.forEach((call) => {
    assert.deepEqual(store.parentOf(call.node, call.label),
      call.parentNode ? { node: call.parentNode, label: call.parentLabel } : null);
  });

  assert.deepEqual(store.parentOf('StartEvent_1', 'Instance1'),
    { node: 'EarliestArrival_Process', label: 'Instance1' },
    'the token at the start event hangs off the instance root');
  assert.equal(store.parentOf('EarliestArrival_Process', 'Instance1'), null,
    'which hangs off nothing');
});

test('a whole run leaves nothing behind, every token having been consumed', async () => {
  const { player, store, log, animation, read } = await replay();

  await player.play(log);

  assert.ok(animation.calls.some((call) => call.call === 'consumeToken'), 'the run was replayed to its end');

  assert.equal(store.getState('EarliestArrival_Process', 'Instance1'), null);
  assert.equal(read('LoopActivity', 'Instance1', NEXT_LOCATION), null,
    'the sub-process token is gone, and its status with it');
  assert.equal(store.parentOf('StartEvent_1', 'Instance1'), null);
});

test('playback runs unchanged where the host provides no store', async () => {
  const { player, log, animation } = await run(null);

  await player.play(log);

  assert.ok(animation.calls.length > 0);
});
