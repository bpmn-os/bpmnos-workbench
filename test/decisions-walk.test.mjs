// Asking what the choices of a decision task may take.
//
// The walk holds two sequences that are easy to confuse: the prefix it asks with, which grows only by a
// value the answer still admits, and the position it is answering. Getting them wrong is not visible in the
// store's own tests, because the store faithfully records whatever it is told — an answer for the second
// choice written against the first looks like an ordinary answer. So the walk is covered here against a
// resolver that records what it was asked, which is the only place the confusion shows.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import DecisionStore, { keyOf } from '../src/decisions/Store.js';
import walkDecision from '../src/decisions/walk.js';

const KEY = keyOf('Instance_1', 'DecisionTask_1');

// a task of two choices: a mode, and a duration whose bounds follow from it
const BY_MODE = {
  road: { attribute: 'duration', lowerBound: 4, upperBound: 12, lowest: 4, highest: 12, multipleOf: 1 },
  rail: { attribute: 'duration', lowerBound: 8, upperBound: 24, lowest: 8, highest: 24, multipleOf: 2 }
};

// what the model states of each choice, as `describeModel` reports it: the attribute it is of and whether
// it is an enumeration or a pair of bounds, both settled when the engine built the model
const DECLARED = [
  { attribute: { id: 'Attribute_1', name: 'mode', type: 'string' }, kind: 'enumeration' },
  { attribute: { id: 'Attribute_2', name: 'duration', type: 'integer' }, kind: 'bounds' }
];

/** The resolver a run would be, and a record of every prefix it was asked with. */
function resolver() {
  const asked = [];

  const ask = async (instanceId, nodeId, selected) => {
    asked.push([ ...selected ]);

    if (selected.length === 0) {
      return { attribute: 'mode', enumeration: [ 'road', 'rail' ] };
    }
    if (selected.length === 1) {
      return BY_MODE[selected[0]];
    }

    return { complete: true };
  };

  return { ask, asked };
}

function opened() {
  const store = new DecisionStore();

  store.open('Instance_1', 'DecisionTask_1');

  return store;
}

describe('walking the choices of a decision task', () => {

  it('asks with the empty prefix first, and shows the choices to come', async () => {
    const store = opened(),
          { ask, asked } = resolver();

    await walkDecision(store, store.get(KEY), ask, DECLARED);

    assert.deepEqual(asked, [ [] ], 'nothing is chosen, so nothing beyond the first can be asked');
    assert.equal(store.get(KEY).choices[0].attribute, 'mode');
    assert.equal(store.get(KEY).choices[1].attribute, 'duration', 'the choice to come is shown');
    assert.equal(store.get(KEY).choices[1].enumeration, undefined, 'without options, so not yet answerable');
    assert.equal(store.get(KEY).choices[1].lowerBound, undefined);
  });

  it('extends the prefix by a value it admits, and answers the next choice against it', async () => {
    const store = opened(),
          { ask, asked } = resolver();

    await walkDecision(store, store.get(KEY), ask, DECLARED);
    store.setValue(KEY, 0, 'rail');
    await walkDecision(store, store.get(KEY), ask, DECLARED);

    assert.deepEqual(asked.slice(1), [ [], [ 'rail' ] ], 'asked with the growing prefix, not with everything');
    assert.equal(store.get(KEY).choices[1].lowest, 8, 'the second choice follows from the first');
    assert.equal(store.get(KEY).choices[1].multipleOf, 2);
  });

  it('records every answer against the choice it belongs to', async () => {
    const store = opened(),
          { ask } = resolver();

    await walkDecision(store, store.get(KEY), ask, DECLARED);
    store.setValue(KEY, 0, 'road');
    await walkDecision(store, store.get(KEY), ask, DECLARED);

    assert.equal(store.get(KEY).choices[0].attribute, 'mode', 'the first is still the mode');
    assert.ok(store.get(KEY).choices[0].enumeration, 'and still an enumeration');
    assert.equal(store.get(KEY).choices[1].attribute, 'duration');
  });

  it('keeps the choices and reports completion once every value is set', async () => {
    const store = opened(),
          { ask, asked } = resolver();

    await walkDecision(store, store.get(KEY), ask, DECLARED);
    store.setValue(KEY, 0, 'road');
    await walkDecision(store, store.get(KEY), ask, DECLARED);
    store.setValue(KEY, 1, 8);
    await walkDecision(store, store.get(KEY), ask, DECLARED);

    assert.deepEqual(asked[asked.length - 1], [ 'road', 8 ], 'the full prefix is asked only at the end');
    assert.equal(store.get(KEY).choices.length, 2, 'the choices are still there');
    assert.equal(store.get(KEY).complete, true);
    assert.equal(store.submittable(KEY), true);
    assert.deepEqual(store.values(KEY), [ 'road', 8 ]);
  });

  it('clears a value the answer no longer admits, and stops there', async () => {
    const store = opened(),
          { ask } = resolver();

    await walkDecision(store, store.get(KEY), ask, DECLARED);
    store.setValue(KEY, 0, 'road');
    await walkDecision(store, store.get(KEY), ask, DECLARED);
    store.setValue(KEY, 1, 5);          // admitted by road, whose range is four to twelve by one
    await walkDecision(store, store.get(KEY), ask, DECLARED);
    assert.equal(store.submittable(KEY), true);

    store.setValue(KEY, 0, 'rail');     // rail admits eight to twenty-four, so five is no longer valid
    await walkDecision(store, store.get(KEY), ask, DECLARED);

    assert.equal(store.get(KEY).choices.length, 2, 'the choice remains');
    assert.equal(store.get(KEY).choices[1].value, undefined, 'its value does not');
    assert.equal(store.submittable(KEY), false);
  });

  it('records nothing where the request has been overtaken', async () => {
    const store = opened();

    await walkDecision(store, store.get(KEY), async () => ({}), DECLARED);

    assert.equal(store.get(KEY).choices.length, 0);
    assert.equal(store.get(KEY).complete, false, 'an overtaken request is not a complete one');
  });
});
