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
 * A value is written to the engine's own precision, which is what a reader may write and what the engine
 * may hold, the two being the same thing. `BPMNOS::number` is a decimal fixed-point value with six places,
 * so every value the engine holds is an exact multiple of a millionth and every such number can be written
 * exactly. A step of a tenth is a tenth and a third is 0.333333, and the multiples of a step are the round
 * numbers a reader expects rather than something slightly beside them.
 *
 * What remains is that the least and the greatest multiple need not be the bounds, the grid being counted
 * from zero: a choice bounded by one and ten in thirds begins at 1.333332. That is a real difference and
 * not a rounding, and it is what `lowest` and `highest` say.
 *
 * A number carried through JavaScript is a double and is not exact, so a millionth written as one is
 * arithmetic away from one, and the values are compared with a tolerance far below what is ever shown.
 *
 * Nothing here touches a document, so a grid is walked under `node --test` without one.
 */

/**
 * The engine's own precision: `BPMNOS::number` is a decimal fixed-point value with six places, so this is
 * both as fine as it can hold and as fine as it is worth writing.
 */
export const PRECISION = 6;

/**
 * A value as it is written.
 *
 * It is written to the engine's precision and no coarser, so that what a reader reads is what the engine
 * holds. Trailing zeros go, a value being a number rather than a field of six decimals: five is written as
 * five and a third of ten as 3.333333.
 */
export function shownValue(value) {
  return Number(value.toFixed(PRECISION));
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
