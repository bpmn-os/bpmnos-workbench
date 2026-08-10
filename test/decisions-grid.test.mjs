import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { admits, next, PRECISION, shownValue, snap, walkable } from '../src/decisions/grid.js';

// A third, as the engine holds it: every number is a decimal fixed-point value with six places, so a third
// is 0.333333 exactly and three of them fall just short of one. The values here are the engine's own, and
// the model they answer is the one the probe of `1 <= x <= 10, 1/3 | x` reported.
const THIRD = 0.333333;

/** `0 <= x <= 1, 1/3 | x`, as the bridge answers it. */
const SHARE = {
  attribute: 'share',
  lowerBound: 0,
  upperBound: 1,
  lowest: 0,
  highest: 3 * THIRD,
  multipleOf: THIRD
};

/** `1 <= x <= 10, 1/3 | x`. Neither bound is a multiple, so neither is selectable. */
const RANGE = {
  attribute: 'x',
  lowerBound: 1,
  upperBound: 10,
  lowest: 4 * THIRD,
  highest: 30 * THIRD,
  multipleOf: THIRD
};

/** A choice on a decimal stating no discretizer: bounded, but with no grid to walk. */
const FREE = { attribute: 'share', lowerBound: 0, upperBound: 1, lowest: 0, highest: 1 };

describe('what a choice offers to walk', () => {

  it('is a grid where it states a step', () => {
    assert.equal(walkable(SHARE), true);
    assert.equal(walkable(RANGE), true);
  });

  it('is nothing where it states none, or where the choice cannot yet be made', () => {
    assert.equal(walkable(FREE), false);
    assert.equal(walkable({ attribute: 'x' }), false);
    assert.equal(walkable({ enumeration: [ 1, 2 ] }), false);
  });
});

describe('the precision a value is written to', () => {

  it('is the engine\'s own, so that what is read is what is held', () => {
    assert.equal(PRECISION, 6, 'a decimal fixed-point value with six places');
    assert.equal(shownValue(4 * THIRD), 1.333332);
    assert.equal(shownValue(30 * THIRD), 9.99999);
  });

  it('loses the arithmetic a double carries, and nothing a reader could write', () => {
    assert.equal(shownValue(9.999998999999999), 9.999999);
    assert.equal(shownValue(5), 5, 'a value is a number rather than a field of six decimals');
    assert.equal(shownValue(0.1 + 0.2), 0.3);
  });
});

describe('settling a value on the grid', () => {

  it('takes the nearest multiple, counted from zero', () => {
    assert.equal(snap(0, SHARE), 0);
    assert.equal(snap(0.33, SHARE), THIRD);
    assert.equal(snap(0.34, SHARE), THIRD);
    assert.equal(snap(0.5, SHARE), 2 * THIRD, 'half is nearer the second multiple than the first');
    assert.equal(snap(0.66, SHARE), 2 * THIRD);
  });

  it('holds a value to what may be selected rather than to the bounds', () => {
    assert.equal(snap(1, SHARE), 3 * THIRD, 'one is not a multiple, and the greatest below it is taken');
    assert.equal(snap(1, RANGE), 4 * THIRD, 'the lower bound is below the first multiple');
    assert.equal(snap(99, RANGE), 30 * THIRD);
    assert.equal(snap(-99, RANGE), 4 * THIRD);
  });

  it('holds a value between the bounds where there is no grid', () => {
    assert.equal(snap(0.317, FREE), 0.317);
    assert.equal(snap(2, FREE), 1);
  });
});

describe('walking the grid', () => {

  it('reaches every value from one end to the other and back', () => {
    const up = [];

    for (let value = next(undefined, 1, SHARE); ; value = next(value, 1, SHARE)) {
      up.push(value);

      if (value >= SHARE.highest) {
        break;
      }
    }

    assert.deepEqual(up, [ 0, THIRD, 2 * THIRD, 3 * THIRD ]);

    const down = [];

    for (let value = next(undefined, -1, SHARE); ; value = next(value, -1, SHARE)) {
      down.push(value);

      if (value <= SHARE.lowest) {
        break;
      }
    }

    assert.deepEqual(down, [ ...up ].reverse());
  });

  it('advances by one multiple from a value already on the grid', () => {
    assert.equal(next(THIRD, 1, SHARE), 2 * THIRD);
    assert.equal(next(2 * THIRD, -1, SHARE), THIRD);
  });

  // The rule that keeps a press from being swallowed: settling is itself a move, and counts as the press
  // only where it goes the way the reader asked.
  it('settles a value that lies between two multiples, and does not also step', () => {
    assert.equal(next(0.5, 1, SHARE), 2 * THIRD, 'settling upward is the whole of the press');
    assert.equal(next(0.5, -1, SHARE), THIRD, 'and settling downward, going the other way, is not');
  });

  it('stands still at an end rather than leaving the grid', () => {
    assert.equal(next(SHARE.highest, 1, SHARE), SHARE.highest);
    assert.equal(next(SHARE.lowest, -1, SHARE), SHARE.lowest);
  });

  it('starts at the near end from nothing at all', () => {
    assert.equal(next(undefined, 1, RANGE), RANGE.lowest);
    assert.equal(next(undefined, -1, RANGE), RANGE.highest);
  });

  it('moves nothing where there is no grid to walk', () => {
    assert.equal(next(0.317, 1, FREE), 0.317);
  });
});

describe('what a reader is shown', () => {

  // Base ten is what makes these the same list: the engine holds a third as 0.333333, so every value it
  // admits can be written exactly, and a reader who writes what they read writes a value the engine holds.
  it('is the grid itself, the engine holding no value a reader could not write', () => {
    assert.deepEqual(
      [ 0, THIRD, 2 * THIRD, 3 * THIRD ].map((value) => shownValue(value)),
      [ 0, 0.333333, 0.666666, 0.999999 ]);
  });

  it('settles back on the value behind it when they write it', () => {
    assert.equal(snap(0.333333, SHARE), THIRD);
    assert.equal(snap(0.666666, SHARE), 2 * THIRD);
    assert.equal(snap(0.999999, SHARE), 3 * THIRD);
  });
});

describe('whether an answer admits a value', () => {

  it('admits every multiple it offers, however far along', () => {
    for (let k = 4; k <= 30; k++) {
      assert.equal(admits(RANGE, k * THIRD), true, `${k} multiples`);
    }
  });

  it('refuses a value between two multiples, and one beyond an end', () => {
    assert.equal(admits(SHARE, 0.5), false);
    assert.equal(admits(SHARE, 1), false, 'one lies above the greatest multiple');
    assert.equal(admits(RANGE, 1), false, 'the lower bound lies below the least');
  });

  it('admits a member of an enumeration and nothing else', () => {
    assert.equal(admits({ enumeration: [ 2, 5 ] }, 5), true);
    assert.equal(admits({ enumeration: [ 2, 5 ] }, 3), false);
  });

  it('admits anything between the bounds where there is no grid', () => {
    assert.equal(admits(FREE, 0.317), true);
    assert.equal(admits(FREE, 1.5), false);
  });

  it('admits nothing where the choice cannot yet be made', () => {
    assert.equal(admits({ attribute: 'x' }, 3), false);
  });
});
