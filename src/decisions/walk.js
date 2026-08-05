/**
 * Asking what the choices of one decision task may take, and recording the answers.
 *
 * A decision task states its choices in order and a later one may depend on the earlier ones: the engine
 * writes each chosen value into the status before it evaluates the next condition. So what a choice admits
 * is not a property of the model but an answer for the values selected before it, and the only way to learn
 * all of them is to ask for one at a time, extending the prefix by each value that survives.
 *
 * The walk therefore holds two sequences and must not confuse them. `selected` is the prefix it asks with,
 * which grows only by a value the answer still admits. `index` is the position it is answering, which grows
 * with it. Asking with everything the reader has entered rather than with the prefix would answer a later
 * choice and record it against an earlier one.
 *
 * A value the answer no longer admits is cleared, and the walk stops there: what follows an unmade choice
 * cannot be asked, since the prefix stops with it. The choices beyond are shown all the same, by the
 * attribute the model names them of, so that a decision task says how many choices it requires rather than
 * only the next one.
 *
 * Nothing here knows of an engine, a diagram or a worker. The answers come from whatever the caller gives
 * as `ask`, which lets `node --test` walk a decision without any of them.
 */

/** Whether an answer still admits a value the reader holds. */
export function admits(answer, value) {
  if (answer.enumeration) {
    return answer.enumeration.includes(value);
  }

  if (answer.lowerBound === undefined) {
    return false; // a choice that cannot yet be made admits nothing
  }

  return value >= answer.lowerBound && value <= answer.upperBound;
}

/**
 * Ask for each choice of one decision task in turn and write the answers into the store.
 *
 * @param {Object} decisions  the store
 * @param {Object} decision   what it holds for this decision task
 * @param {Function} ask      (instanceId, nodeId, selected) => Promise<answer>
 * @param {Array<string>} declared  the attributes the model states the choices of, in order
 */
export default async function walkDecision(decisions, decision, ask, declared = []) {
  const held = decision.choices.map((choice) => choice.value),
        selected = [];

  let index = 0;

  for (;;) {
    const answer = await ask(decision.instanceId, decision.nodeId, selected);

    if (!answer || !answer.attribute) {
      // Either every choice has a value, or the request has been overtaken and the record withdrawing it is
      // on its way. Only the first is recorded; the second is the run's to say through its records.
      if (answer && answer.complete) {
        decisions.setOptions(decision.key, index, null);
      }

      return;
    }

    decisions.setOptions(decision.key, index, answer);

    const value = held[index];

    if (value === undefined) {
      break; // the reader has not chosen here, so nothing beyond can be asked
    }

    if (!admits(answer, value)) {
      decisions.clearFrom(decision.key, index);
      break;
    }

    selected.push(value);
    index++;
  }

  // the choices the reader cannot yet make, named by what the model states them of
  declared.slice(index + 1).forEach((attribute, offset) => {
    decisions.setOptions(decision.key, index + 1 + offset, { attribute });
  });
}
