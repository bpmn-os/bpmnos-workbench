/**
 * Whether two answers say the same thing. They are compared by what they hold rather than by identity,
 * since each is built afresh from a reply that crossed the bridge as text and is never the same object
 * twice.
 */
function same(held, answered) {
  if (!held) {
    return false;
  }

  const keys = new Set([ ...Object.keys(held), ...Object.keys(answered) ]);

  for (const key of keys) {
    const a = held[key],
          b = answered[key];

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length
          || a.some((value, at) => value !== b[at])) {
        return false;
      }
    } else if (a !== b) {
      return false;
    }
  }

  return true;
}

/** What identifies a decision here: the instance the token belongs to and the node it stands at. */
export function keyOf(instanceId, nodeId) {
  return `${instanceId}|${nodeId}`;
}

/**
 * The decision tasks a run is waiting at, and the choices the reader has made at each.
 *
 * A decision task states its choices in order, and what a choice may take depends on the choices before it:
 * the engine writes each chosen value into the status before it evaluates the condition of the next one. So
 * the options of a choice are not a property of the model but an answer given for a prefix of values, and
 * this store holds the answers it has been given together with the values it has been told.
 *
 * It does not obtain those answers. Only an engine standing at the token can evaluate a condition, so the
 * caller asks and writes the answer back through `setOptions`, position by position, until it is told there
 * is no further choice. That keeps the store plain and free of the run, which is what lets `node --test`
 * cover it, and it keeps the asking, which is asynchronous, out of a structure that is not.
 *
 * Choices are made in order. A choice whose options are unknown is one the reader cannot yet make, and a
 * value entered against an earlier choice makes what the later ones may take a different question, which
 * the caller asks again. Neither the answers nor the values held after it are given up in the meantime:
 * they stand until the new answer replaces them, and only where a value is no longer among the options is
 * it cleared. The decision is not submittable while any of it is stale, a value entered marking it so.
 */
export default class DecisionStore {

  constructor() {
    this._decisions = new Map();
  }

  /**
   * Forget one archived decision, which the reader may ask for one at a time. Only an archived decision may
   * be forgotten: one still open is what the run is waiting on.
   */
  forget(key) {
    const held = this._decisions.get(key);

    if (!held || !held.archived) {
      return false;
    }

    return this._decisions.delete(key);
  }

  /**
   * A decision task is waiting. Opening it twice is not an error and changes nothing, a request being
   * announced once and the store outliving whatever redraws it.
   */
  open(instanceId, nodeId) {
    const key = keyOf(instanceId, nodeId);

    if (this._decisions.has(key)) {
      return false;
    }

    this._decisions.set(key, {
      key,
      instanceId,
      nodeId,
      choices: [],    // what has been answered, in order
      complete: false, // told that there is no further choice
      awaited: false   // submitted, and the run has not yet reported it
    });

    return true;
  }

  /**
   * The decision is settled: the run answered it, or the token carrying it did not survive. It stays, with
   * the values that were chosen, as a record of what was decided rather than a question the reader may
   * answer. Whether such a record is listed is a tab's question and not the store's.
   *
   * It is named by its token rather than by its key, as opening it is, because the player speaks the
   * identities a record carries and holds no key of its own. What the reader does afterwards is keyed,
   * since a panel draws from the store and the key is what it drew.
   */
  close(instanceId, nodeId) {
    const key = keyOf(instanceId, nodeId),
          held = this._decisions.get(key);

    if (!held) {
      return false;
    }

    held.archived = true;
    held.awaited = false;

    return true;
  }

  /** Whether a decision has been settled, and is therefore a record rather than a question. */
  isArchived(key) {
    const held = this._decisions.get(key);

    return !!held && !!held.archived;
  }

  /**
   * What was answered for one position: the attribute the choice names and the values it may take, or
   * nothing where there is no choice at that position, which is what says the choices are complete.
   *
   * @param {string} key
   * @param {number} index
   * Answering a position with what it already holds is not a change and is reported as none. The same
   * question is asked again whenever anything about the decision moves, and most of the time it has the
   * same answer; a caller that redrew on each of those would redraw a control the reader is working in for
   * no reason.
   *
   * @param {string} key
   * @param {number} index
   * @param {Object|null} options  `{ attribute, enumeration }` or `{ attribute, lowerBound, upperBound,
   *                               lowest, highest, multipleOf }`, or null where there is no such choice
   */
  setOptions(key, index, options) {
    const held = this._decisions.get(key);

    if (!held || index > held.choices.length) {
      return false; // nothing here, or a position beyond the first unanswered one
    }

    if (!options) {
      if (held.choices.length === index && held.complete) {
        return false;
      }

      held.choices.length = index;
      held.complete = true;

      return true;
    }

    const value = held.choices[index] ? held.choices[index].value : undefined,
          answered = { ...options, value };

    if (!held.complete && same(held.choices[index], answered)) {
      return false;
    }

    held.choices[index] = answered;
    held.complete = false;

    return true;
  }

  /**
   * The reader has chosen.
   *
   * Every later choice was answered for a prefix that no longer holds, so what it may take is now a
   * different question and is asked again. What it answered before is left standing until the new answer
   * arrives. Taking it away first would say something that is not so — that the choice cannot be made —
   * and would say it for exactly as long as the question takes to answer, which is a redraw the reader
   * sees and cannot act on. An answer that is stale for a frame is the lesser claim, and a value it no
   * longer admits is cleared by the caller when it asks.
   *
   * The choices are not shortened either. That a decision task states a choice is a property of the model
   * and no answer withdraws it, and a reader who saw a row vanish as they filled in the one above would be
   * told the task had changed shape.
   */
  setValue(key, index, value) {
    const held = this._decisions.get(key),
          choice = held && held.choices[index];

    if (!choice || choice.value === value) {
      return false;
    }

    choice.value = value;
    held.complete = false;
    held.awaited = false;

    return true;
  }

  /**
   * Drop the value at a position and everything after it, which is what an invalidated choice means. The
   * later choices are reduced rather than removed, for the reason `setValue` is.
   */
  clearFrom(key, index) {
    const held = this._decisions.get(key);

    if (!held || index >= held.choices.length) {
      return false;
    }

    held.choices[index].value = undefined;
    held.choices = held.choices.slice(0, index + 1).concat(
      held.choices.slice(index + 1).map((later) => ({ attribute: later.attribute })));
    held.complete = false;
    held.awaited = false;

    return true;
  }

  /** The values entered so far, in order, up to the first that is not set. */
  values(key) {
    const held = this._decisions.get(key),
          values = [];

    if (!held) {
      return values;
    }

    for (const choice of held.choices) {
      if (choice.value === undefined) {
        break;
      }
      values.push(choice.value);
    }

    return values;
  }

  /** Whether every choice has been answered and given a value, so the decision may be submitted. */
  submittable(key) {
    const held = this._decisions.get(key);

    return !!held && !held.archived && held.complete && !held.awaited &&
      held.choices.length > 0 && this.values(key).length === held.choices.length;
  }

  /** The decision has been submitted and the run has not yet reported it. */
  await_(key) {
    const held = this._decisions.get(key);

    if (!held || held.awaited) {
      return false;
    }

    held.awaited = true;

    return true;
  }

  all() {
    return [ ...this._decisions.values() ];
  }

  get(key) {
    return this._decisions.get(key);
  }

  /** Drops every decision, and returns whether any was held. */
  clear() {
    const held = this._decisions.size > 0;

    this._decisions.clear();

    return held;
  }
}
