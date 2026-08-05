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
 * attribute the model names them of and as the kind of control the model says they are, so that a decision
 * task says how many choices it requires rather than only the next one, and so that a row does not turn
 * from one control into another as it becomes reachable.
 *
 * The kind is carried onto every answer, not only onto the choices out of reach. Which of the two a choice
 * is was settled when the model was built and is reported by `describeModel`; an answer says only what the
 * choice may take, and a caller inferring the kind from that would read an empty enumeration — which is
 * what a bounded choice whose grid holds nothing is answered with — as a choice of a different kind.
 *
 * Nothing here knows of an engine, a diagram or a worker. The answers come from whatever the caller gives
 * as `ask`, which lets `node --test` walk a decision without any of them.
 */

import { admits } from './grid.js';

/**
 * Ask for each choice of one decision task in turn and write the answers into the store.
 *
 * @param {Object} decisions  the store
 * @param {Object} decision   what it holds for this decision task
 * @param {Function} ask      (instanceId, nodeId, selected) => Promise<answer>
 * @param {Array<Object>} declared  what the model states of each choice, in order, as `describeModel`
 *                                   reports it: `{ attribute: { id, name, type }, kind, discretized }`
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

    decisions.setOptions(decision.key, index, { ...answer, kind: kindAt(declared, index) });

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

  // the choices the reader cannot yet make, named by what the model states them of and drawn as the control
  // the model says they are
  declared.slice(index + 1).forEach((choice, offset) => {
    decisions.setOptions(decision.key, index + 1 + offset, {
      attribute: choice.attribute ? choice.attribute.name : undefined,
      kind: choice.kind
    });
  });
}

/** The kind the model states the choice at a position is, or nothing where the model said nothing of it. */
function kindAt(declared, index) {
  return declared[index] ? declared[index].kind : undefined;
}
