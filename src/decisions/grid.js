/**
 * The values a bounded choice admits, and the arithmetic of moving among them.
 *
 * A bounded choice admits the multiples of its step within its bounds. The engine counts those multiples
 * from zero rather than from the lower bound — `Choice::getEnumeration` walks upward from
 * `step * ceil(lowerBound / step)` — so the grid is a property of the step alone and the bounds only say
 * where it starts and stops. This differs from the grid an HTML number input walks, which is counted from
 * the control's minimum, and is one of the reasons the control cannot be left to walk it.
 *
 * Two corrections have already been made by the time a choice reaches here, and neither is repeated. A
 * strict bound is moved inward by the engine's own precision, and the bounds of a choice on an attribute
 * that is not a decimal are raised and lowered to whole numbers, which `Choice::getBounds` does because the
 * attribute's type says so and not because of any grid. Both are carried in `lowerBound` and `upperBound`
 * as they arrive. What this module concerns is only the third thing, the multiples of the step, which are
 * `lowest` and `highest`; no rounding here stands for a type, and none stands for a bound.
 *
 * The engine holds every number as a binary fixed-point value, so a step written as a tenth or a third is
 * held slightly beside the number written. The multiples therefore fall slightly beside the round numbers a
 * reader would expect, and the least and the greatest of them need not be the bounds at all. A reader is
 * shown the grid rounded to a precision they could have written; what is submitted is the value itself.
 * Everything here works in the values, and only `precisionOf` concerns what is shown.
 *
 * Nothing here touches a document, so a grid is walked under `node --test` without one.
 */

/**
 * How many decimals a value of this choice is written to.
 *
 * A reader is shown a number they could have written, not the one the engine holds: 1.01 rather than
 * 1.0099945068359375. Two decimals are enough for that, and are the most that is shown. Where the step is
 * finer than that, more are needed, since two adjacent values would otherwise be written alike and the
 * reader could neither tell them apart nor reach one of them.
 */
export function precisionOf(choice) {
  const step = choice.multipleOf;

  if (step === undefined || step >= 0.01) {
    return 2;
  }

  return Math.min(MAX_PRECISION, Math.ceil(-Math.log10(step)));
}

/** As far as a value is ever written, beyond which the engine's own precision runs out in any case. */
const MAX_PRECISION = 6;

/** A value as it is written for a reader of this choice. */
export function shownValue(value, choice) {
  return Number(value.toFixed(precisionOf(choice)));
}

/** Whether a choice has a grid to walk, which is what makes a step, and an arrow, mean anything. */
export function walkable(choice) {
  return !choice.enumeration
    && choice.lowest !== undefined
    && choice.multipleOf !== undefined
    && choice.multipleOf > 0;
}

/**
 * The value a choice admits that lies nearest the one given.
 *
 * The multiples are counted from zero, as the engine counts them, and the ends are held to what may be
 * selected: a value just inside a bound must not settle on a multiple just outside it.
 */
export function snap(value, choice) {
  if (choice.lowest === undefined || !Number.isFinite(value)) {
    return value;
  }

  if (!walkable(choice)) {
    return clamp(value, choice);
  }

  return clamp(Math.round(value / choice.multipleOf) * choice.multipleOf, choice);
}

/**
 * The value one press of an arrow moves to, from the value given, in the direction given.
 *
 * A value need not lie on the grid: it may be one the reader typed, or one carried over from an answer that
 * has since changed. Settling it is itself a move, so where settling already goes the way the reader asked,
 * that is the whole of the press; only where it does not, or where it moves the other way, is a step added.
 * Stepping in both cases would skip a value, and settling in both would leave the arrow pressing against a
 * value it has already reached. This is the rule React Aria's number field arrived at, for the same reason.
 *
 * From nothing at all the move is to the near end of the grid, so a reader who presses an arrow on an empty
 * field is given the first value rather than nothing.
 */
export function next(value, direction, choice) {
  if (!walkable(choice)) {
    return value;
  }

  if (value === undefined || !Number.isFinite(value)) {
    return direction > 0 ? choice.lowest : choice.highest;
  }

  const settled = snap(value, choice);

  if (direction > 0 ? settled > value : settled < value) {
    return settled;
  }

  return snap(value + direction * choice.multipleOf, choice);
}

/**
 * Whether an answer still admits a value the reader holds.
 *
 * The test is made against `snap` rather than beside it, so that the value a control settles on and the
 * value a walk accepts cannot disagree. A value is admitted where settling it leaves it where it is, within
 * a fraction of a step: the engine's own numbers are exact multiples, and what the control produces has
 * settled already, so anything further off is a value from elsewhere.
 */
export function admits(answer, value) {
  if (answer.enumeration) {
    return answer.enumeration.includes(value);
  }

  if (answer.lowest === undefined || !Number.isFinite(value)) {
    return false; // a choice that cannot yet be made admits nothing
  }

  if (value < answer.lowest || value > answer.highest) {
    return false;
  }

  if (!walkable(answer)) {
    return true; // no grid: every value between the two is admitted
  }

  return Math.abs(value - snap(value, answer)) <= answer.multipleOf * TOLERANCE;
}

/**
 * How far off a multiple a value may lie and still be one. It is a fraction of the step rather than a fixed
 * amount, since the error in a multiple grows with the multiple, and it is far below the precision any
 * reader writes to.
 */
const TOLERANCE = 1e-9;

function clamp(value, choice) {
  return Math.min(Math.max(value, choice.lowest), choice.highest);
}
