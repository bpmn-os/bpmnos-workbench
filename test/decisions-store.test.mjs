// The store of the decision tasks waiting for a choice, and the reading of the choices a task states.
//
// The store holds what a run has been asked and what a reader has answered, and it is plain: it obtains no
// options of its own, since only an engine standing at the token can evaluate a condition. So what is
// covered here is what it does with the answers it is given — that a choice is opened and closed, that a
// value entered drops what was answered after it, that a later value survives a re-answer only while the
// options still admit it, and that a decision is submittable exactly when every choice has a value.

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import DecisionStore, { keyOf } from '../src/decisions/Store.js';
import choicesOf, { attributeOf } from '../src/decisions/declarations.js';

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

  it('drops what was answered after a value that changes, but keeps the choice', () => {
    const store = opened();

    store.setOptions(KEY, 0, { attribute: 'mode', enumeration: [ 'road', 'rail' ] });
    store.setValue(KEY, 0, 'road');
    store.setOptions(KEY, 1, { attribute: 'duration', lowerBound: 4, upperBound: 12 });
    store.setValue(KEY, 1, 8);

    assert.equal(store.get(KEY).choices.length, 2);

    store.setValue(KEY, 0, 'rail');

    // what the second choice may take was answered for a prefix that no longer holds, so its options and
    // its value are given up — but the task still states it, so the choice itself remains
    assert.equal(store.get(KEY).choices.length, 2, 'the choice is still stated');
    assert.deepEqual(store.get(KEY).choices[1], { attribute: 'duration' }, 'reduced to what it is of');
    assert.deepEqual(store.values(KEY), [ 'rail' ]);
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

describe('the choices a decision task states', () => {

  it('reads the attribute of an enumeration, written either way', () => {
    assert.equal(attributeOf('choice ∈ [-4, 3, x, 5]'), 'choice');
    assert.equal(attributeOf('wait_type in ["wait", "break"]'), 'wait_type');
  });

  it('reads the attribute of a pair of bounds, strict or not', () => {
    assert.equal(attributeOf('1 <= index <= count(destinations)'), 'index');
    assert.equal(attributeOf('min < choice <= max'), 'choice');
    assert.equal(attributeOf('base <= level <= base + 4, 2 | level'), 'level');
  });

  it('reads nothing where the condition states neither', () => {
    assert.equal(attributeOf('x > 3'), null, 'the engine supports no such condition either');
    assert.equal(attributeOf('x < 10'), null, 'one-sided bounds are refused by the engine');
    assert.equal(attributeOf(''), null);
    assert.equal(attributeOf(undefined), null);
  });

  it('reads the choices of a node in the order they are made', () => {
    const businessObject = {
      extensionElements: {
        values: [
          { $type: 'bpmnos:Status', decisions: [ { decision: [
            { id: 'Decision_1', condition: 'base ∈ [2, 5]' },
            { id: 'Decision_2', condition: 'base <= level <= base + 4, 2 | level' }
          ] } ] }
        ]
      }
    };

    assert.deepEqual(choicesOf(businessObject), [
      { id: 'Decision_1', name: 'base' },
      { id: 'Decision_2', name: 'level' }
    ]);
  });

  it('reads no choices from a node that states none', () => {
    assert.deepEqual(choicesOf({}), []);
    assert.deepEqual(choicesOf({ extensionElements: { values: [] } }), []);
    assert.deepEqual(choicesOf(null), []);
  });
});
