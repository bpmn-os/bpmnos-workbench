/**
 * A reading as it is written: a whole number as itself, and anything else to two decimal places, which is
 * the precision a value is read at wherever this application shows one. A run that holds no such reading —
 * before it begins, and after a refresh — reads as two dashes rather than as a number it does not have.
 *
 * Nothing here touches a document, so it is testable without one.
 */
export default function format(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '––';
  }

  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
