// The store of the decision tasks waiting for a choice, and the reading of the choices a task states.
//
// The store holds what a run has been asked and what a reader has answered, and it is plain: it obtains no
// options of its own, since only an engine standing at the token can evaluate a condition. So what is
// covered here is what it does with the answers it is given — that a choice is opened and closed, that a
// value entered leaves the answers after it standing until they are asked again, that a later value
// survives a re-answer only while the options still admit it, that answering a position with what it
// already holds is no change, and that a decision is submittable exactly when every choice has a value.
//
// Which choices a task states is no longer read here. It is model knowledge, and `describeModel` reports
// it, the engine having settled it when it built each choice.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import DecisionStore, { keyOf } from '../src/decisions/Store.js';

const KEY = keyOf('Instance_1', 'DecisionTask_1');

/** A store holding one decision task, answered as far as the given values reach. */
function opened() {
  const store = new DecisionStore();

  store.open('Instance_1', 'DecisionTask_1');

  return store;
}

describe('the decision store', () => {

  it('opens a decision once, however often the record is replayed', () => {
    const store = opened();

    assert.equal(store.open('Instance_1', 'DecisionTask_1'), false);
    assert.equal(store.all().length, 1);
    assert.equal(store.get(KEY).nodeId, 'DecisionTask_1');
  });

  it('closes a decision by the token it was opened for', () => {
    const store = opened();

    assert.equal(store.close('Instance_1', 'Other'), false);
    assert.equal(store.close('Instance_1', 'DecisionTask_1'), true);
    assert.equal(store.all().length, 0);
  });

  it('holds what it was answered, and the value entered against it', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] });
    store.setValue(KEY, 0, 'rail');

    assert.deepEqual(store.values(KEY), [ 'rail' ]);
    assert.equal(store.get(KEY).choices[0].attribute, 'mode');
  });

  it('reports the values only as far as they run', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road' ] });
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 1, upperBound: 4 });
    store.setValue(KEY, 1, 2);

    // the first choice has no value, so the prefix is empty however much stands after it
    assert.deepEqual(store.values(KEY), []);
  });

  it('leaves what was answered after a value that changes standing until it is asked again', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] });
    store.setValue(KEY, 0, 'road');
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 4, upperBound: 12 });
    store.setValue(KEY, 1, 8);

    assert.equal(store.get(KEY).choices.length, 2);

    store.setValue(KEY, 0, 'rail');

    // What the second choice may take was answered for a prefix that no longer holds and is asked again.
    // Until the answer arrives the old one stands: taking it away would say the choice cannot be made,
    // which is not so, and would say it for as long as the question takes to answer.
    assert.equal(store.get(KEY).choices.length, 2, 'the choice is still stated');
    assert.equal(store.get(KEY).choices[1].upperBound, 12, 'and what it answered before still stands');
    assert.equal(store.get(KEY).choices[1].value, 8);
    assert.equal(store.get(KEY).complete, false, 'but the decision is not submittable while it is stale');
  });

  it('reports no change where a position is answered with what it already holds', () => {
    const store = opened();

    const answer = { attribute: 'duration', lowerBound: 4, upperBound: 12, lowest: 4, highest: 12,
      multipleOf: 1 };

    assert.equal(store.setOptions(KEY, 0, answer), true);
    assert.equal(store.setOptions(KEY, 0, { ...answer }), false, 'the same answer says nothing new');
    assert.equal(store.setOptions(KEY, 0, { ...answer, highest: 11 }), true, 'a different one does');
  });

  it('reports no change where an enumeration is answered with the same values', () => {
    const store = opened();

    assert.equal(store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] }), true);
    assert.equal(store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] }), false);
    assert.equal(store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road' ] }), true);
  });

  it('keeps a choice not yet made when the one above it is answered', () => {
    const store = opened();

    // as the walk leaves it: the first answered, the second known only by the attribute it is of
    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] });
    store.setOptions(KEY, 1, { attribute: 'duration' });

    store.setValue(KEY, 0, 'road');

    assert.equal(store.get(KEY).choices.length, 2, 'choosing the first must not remove the second');
    assert.equal(store.get(KEY).choices[1].attribute, 'duration');
  });

  it('keeps the later choices when one is cleared as no longer valid', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road' ] });
    store.setValue(KEY, 0, 'road');
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 4, upperBound: 12 });
    store.setValue(KEY, 1, 8);
    store.setOptions(KEY, 2, { attribute: 'lane', lowerBound: 1, upperBound: 3 });

    store.clearFrom(KEY, 1);

    assert.equal(store.get(KEY).choices.length, 3);
    assert.equal(store.get(KEY).choices[1].value, undefined);
    assert.deepEqual(store.get(KEY).choices[2], { attribute: 'lane' });
  });

  it('keeps a later value that a re-answer still admits', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] });
    store.setValue(KEY, 0, 'road');
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 4, upperBound: 12 });
    store.setValue(KEY, 1, 8);

    // answered again for the same prefix: the value it holds is untouched
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 8, upperBound: 24 });

    assert.equal(store.get(KEY).choices[1].value, 8);
    assert.deepEqual(store.values(KEY), [ 'road', 8 ]);
  });

  it('clears a value and everything after it', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road' ] });
    store.setValue(KEY, 0, 'road');
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 4, upperBound: 12 });
    store.setValue(KEY, 1, 8);

    store.clearFrom(KEY, 1);

    assert.equal(store.get(KEY).choices[1].value, undefined);
    assert.deepEqual(store.values(KEY), [ 'road' ]);
  });

  it('is submittable only once every choice has a value', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road' ] });
    assert.equal(store.submittable(KEY), false, 'not told that the choices are complete');

    store.setValue(KEY, 0, 'road');
    assert.equal(store.submittable(KEY), false, 'still not told');

    store.setOptions(KEY, 1, null);
    assert.equal(store.submittable(KEY), true, 'told, and every choice has a value');

    store.await_(KEY);
    assert.equal(store.submittable(KEY), false, 'already with the engine');
  });

  it('is not submittable where a value is missing before the end', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road' ] });
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 1, upperBound: 2 });
    store.setValue(KEY, 1, 2);
    store.setOptions(KEY, 2, null);

    assert.equal(store.submittable(KEY), false);
  });

  it('takes a value entered after it was submitted as a fresh decision', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] });
    store.setValue(KEY, 0, 'road');
    store.setOptions(KEY, 1, null);
    store.await_(KEY);

    store.setValue(KEY, 0, 'rail');

    assert.equal(store.get(KEY).awaited, false, 'no longer waiting on what it submitted');
  });

  it('clears with the run', () => {
    const store = opened();

    assert.equal(store.clear(), true);
    assert.equal(store.clear(), false);
    assert.deepEqual(store.all(), []);
  });
});
