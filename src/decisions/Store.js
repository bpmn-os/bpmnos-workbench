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
 * value entered against an earlier choice drops the answers after it, since what those choices may take is
 * now a different question. The value held at a later position is not dropped with them: the caller asks
 * again, and only where the value it holds is no longer among the options is it cleared.
 */
export default class DecisionStore {

  constructor() {
    this._decisions = new Map();
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
   * The decision is gone: the run answered it, or the token carrying it did not survive.
   *
   * It is named by its token rather than by its key, as opening it is, because the player speaks the
   * identities a record carries and holds no key of its own. What the reader does afterwards is keyed,
   * since a panel draws from the store and the key is what it drew.
   */
  close(instanceId, nodeId) {
    return this._decisions.delete(keyOf(instanceId, nodeId));
  }

  /**
   * What was answered for one position: the attribute the choice names and the values it may take, or
   * nothing where there is no choice at that position, which is what says the choices are complete.
   *
   * @param {string} key
   * @param {number} index
   * @param {Object|null} options  `{ attribute: { id, name, type }, enumeration }` or
   *                               `{ attribute, lowerBound, upperBound, multipleOf }`, or null
   */
  setOptions(key, index, options) {
    const held = this._decisions.get(key);

    if (!held || index > held.choices.length) {
      return false; // nothing here, or a position beyond the first unanswered one
    }

    if (!options) {
      held.choices.length = index;
      held.complete = true;

      return true;
    }

    const value = held.choices[index] ? held.choices[index].value : undefined;

    held.choices[index] = { ...options, value };
    held.complete = false;

    return true;
  }

  /**
   * The reader has chosen.
   *
   * Every later choice was answered for a prefix that no longer holds, so what it may take and what was
   * chosen for it are given up. The choice itself is not: that a decision task states it is a property of
   * the model and no answer can withdraw it, and a reader who saw a row vanish as they filled in the one
   * above would be told the task had changed shape. So the later choices are reduced to the attribute they
   * are of, which is what a choice not yet reachable shows in any case, and wait to be answered again.
   */
  setValue(key, index, value) {
    const held = this._decisions.get(key),
          choice = held && held.choices[index];

    if (!choice || choice.value === value) {
      return false;
    }

    choice.value = value;
    held.choices = held.choices.slice(0, index + 1).concat(
      held.choices.slice(index + 1).map((later) => ({ attribute: later.attribute })));
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

    return !!held && held.complete && !held.awaited &&
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
