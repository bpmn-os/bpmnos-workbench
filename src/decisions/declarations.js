/**
 * The choices a decision task states, read from the model.
 *
 * Which choices a decision task requires, in what order, and of which attribute, is a property of the model
 * and not of a run: `bpmnos:decisions` holds one `decision` per choice, in the order they are made, and the
 * moddle extension of `bpmnos-js` parses it. So a panel knows how many choices there are before a run has
 * said anything, and asks a run only what each may take, which is the part that depends on runtime.
 *
 * That is what lets a choice not yet reachable be shown at all. The engine answers the options of one
 * choice at a time, against the values already selected, so a panel drawing only what it has been answered
 * would show one choice and never say how many are to come.
 *
 * The attribute a choice is of is the term its condition states the choice of, and reading it needs no
 * expression parser: it is what precedes the membership sign of an enumeration, or what stands between the
 * two inequalities of a pair of bounds. Nothing else of the condition is read here, since what the choice
 * admits is the engine's answer and not the model's.
 */

/**
 * The choices of a node, in the order they are made.
 *
 * @param {Object} businessObject  the node's business object
 * @returns {Array<{id: string, name: string}>}  empty where the node states no decisions
 */
export default function choicesOf(businessObject) {
  const extensionElements = businessObject && businessObject.extensionElements,
        values = (extensionElements && extensionElements.values) || [];

  return values
    .filter((element) => element.$type === 'bpmnos:Status')
    .flatMap((status) => status.decisions || [])
    .flatMap((decisions) => decisions.decision || [])
    .map((decision) => ({ id: decision.id, name: attributeOf(decision.condition) }))
    .filter((choice) => !!choice.name);
}

/**
 * The attribute a condition states its choice of.
 *
 * An enumeration names it before the membership sign, which a model may write as `∈` or as `in`. A pair of
 * bounds names it between the two inequalities, where a leading `=` belongs to the inequality rather than
 * to the name. Anything else states no choice this can read, and is reported as none rather than guessed.
 *
 * @param {string} condition
 * @returns {string|null}
 */
export function attributeOf(condition) {
  const text = String(condition || '');

  const membership = text.search(/∈|\bin\b/);

  if (membership >= 0) {
    return text.slice(0, membership).trim() || null;
  }

  const parts = text.split('<');

  if (parts.length !== 3) {
    return null; // neither an enumeration nor a pair of bounds, so the engine will not build it either
  }

  return parts[1].replace(/^\s*=/, '').trim() || null;
}
