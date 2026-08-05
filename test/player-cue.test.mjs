import { test } from 'node:test';
import assert from 'node:assert/strict';

import EngineLogPlayer from '../src/playback/EngineLogPlayer.js';
import { parse } from './support/model.mjs';

/**
 * Which resting token wears the pulse.
 *
 * A position says where a token rests; a cue says why it is still there. The rule is that the pulse means
 * the run is waiting for the reader, so it is worn at exactly the three places the decision is theirs — a
 * decision task working through its choices, an activity of a sequential performer waiting to be let in,
 * and a receive task or a message catch event waiting for a delivery — and nowhere else, because every
 * other decision the engine resolves by itself.
 *
 * The rule is read from the model and from the sequential performers the model resolves, so it is decided
 * without a diagram and is tested without one.
 */

/** Every flow node of a parsed model, in the shape the player reads: an id and a business object. */
function nodesOf(definitions) {
  const found = new Map();

  const walk = (scope) => (scope.flowElements || []).forEach((element) => {
    found.set(element.id, { id: element.id, businessObject: element });
    walk(element);
  });

  (definitions.rootElements || []).forEach(walk);

  return found;
}

/** The player's rule, over a stub of the one store it asks. */
function cue(conducted = []) {
  const sequences = { performerOf: (node) => (conducted.includes(node) ? 'AdHocSubProcess' : undefined) };

  return (element, state) => EngineLogPlayer.prototype._waitCue.call({ _sequences: sequences },
    element, state);
}

test('a decision task pulses while it works through its choices', async () => {
  const nodes = nodesOf(await parse(new URL('../src/examples/earliest-arrival.bpmn', import.meta.url)));
  const waits = cue();

  const decision = nodes.get('SelectDestination');

  assert.ok(decision, 'the fixture states a decision task');
  assert.equal(waits(decision, 'BUSY'), 'pulse-pause');

  assert.equal(waits(decision, 'READY'), null,
    'and not while it waits to be entered, which the engine resolves itself');
  assert.equal(waits(decision, 'COMPLETED'), null);
});

test('an activity of a sequential performer pulses while it waits to be let in', async () => {
  const nodes = nodesOf(await parse('job-shop.bpmn'));

  const conducted = nodes.get('ConductTask');

  assert.ok(conducted, 'the fixture states an activity within an ad hoc subprocess');

  assert.equal(cue([ 'ConductTask' ])(conducted, 'READY'), 'pulse-pause');
  assert.equal(cue([])(conducted, 'READY'), null,
    'an activity no performer conducts is entered by the engine and does not wait');
  assert.equal(cue([ 'ConductTask' ])(conducted, 'BUSY'), null,
    'and once it is in, what it does is its own');
});

test('a receive task and a message catch event pulse while they wait for a delivery', async () => {
  const nodes = nodesOf(await parse('job-shop.bpmn'));
  const waits = cue();

  const receive = nodes.get('NoticeTaskCompletion');

  assert.ok(receive, 'the fixture states a receive task');
  assert.equal(waits(receive, 'BUSY'), 'pulse-pause');
  assert.equal(waits(receive, 'READY'), null);

  // a catch event that waits for something other than a message waits on the run, not on the reader
  const conditional = nodes.get('ConditionalEvent');

  assert.ok(conditional, 'the fixture states a catch event of another kind');
  assert.equal(waits(conditional, 'BUSY'), null);
});

test('nothing else wears the cue', async () => {
  const nodes = nodesOf(await parse('job-shop.bpmn'));
  const waits = cue([ 'ConductTask' ]);

  for (const [ id, element ] of nodes) {
    for (const state of [ 'ARRIVED', 'ENTERED', 'COMPLETED', 'EXITING', 'DEPARTED', 'WAITING' ]) {
      assert.equal(waits(element, state), null, `${id} at ${state}`);
    }
  }

  assert.equal(waits(undefined, 'BUSY'), null, 'and a node the diagram does not hold wears nothing');
});
