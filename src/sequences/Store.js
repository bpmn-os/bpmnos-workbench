/**
 * The key of the divider, the one entry of a performer's list that is no token. It is held in the order
 * like any other entry, so that moving it is the same act as moving a token past it.
 */
export const DIVIDER = 'divider';

/**
 * The sequential performers of a run, and the order in which each is to take on what waits for it.
 *
 * The engine reports a performer as the token standing at the performer node, the activity token it is
 * conducting, and the tokens awaiting entry under it, the last in the order in which they became ready. What
 * the reader decides is a different order, and it is this store that holds it: a list per performer, of the
 * tokens waiting and of the divider among them, with everything above the divider being what the performer
 * may take and everything below it being what it is to leave alone.
 *
 * Applying a report reconciles the engine's answer against that order rather than replacing it. A token
 * still waiting keeps its place, a token that has been entered, withdrawn or has failed is dropped, and a
 * token not seen before is appended at the end, which is below the divider, in the order reported. So
 * nothing is advanced that the reader has not placed above the divider. The performers themselves are held
 * in the order they were first reported, so that no row changes place on its own.
 *
 * One entry of the list is fixed: the token being conducted, or, before the engine has answered, the token
 * whose entry has been enqueued. It stands at the head and takes no part in the order. Enqueuing is not
 * entering, so such a token is still reported as waiting, and it is held here as `fixed` rather than taken
 * out of the list, since a decision that never takes effect leaves the token where it was.
 *
 * The store knows nothing of a diagram and is written and read as a plain object, which is what makes it
 * testable without one.
 */
export default class SequenceStore {

  constructor() {
    this._performers = new Map();
  }

  /** The key a token or a performer is held under: the instance it belongs to and the node it stands at. */
  static keyOf(identity) {
    return identity ? `${identity.instanceId}|${identity.nodeId || ''}` : null;
  }

  /**
   * Apply the performers of one report, and return whether anything the reader sees has changed.
   *
   * @param {Array} performers  `[ { performer, performing, waiting } ]`, each an identity of the engine's
   *                            own keys, `performing` empty where the performer is idle
   */
  apply(performers = []) {
    const reported = new Set();
    let changed = false;

    performers.forEach((entry) => {
      const key = SequenceStore.keyOf(entry.performer);

      reported.add(key);

      const held = this._performers.get(key) || this._add(key, entry.performer);

      changed = this._reconcile(held, entry) || changed;
    });

    // a performer whose token is no longer busy is no longer reported, and goes with what it held
    [ ...this._performers.keys() ].forEach((key) => {
      if (!reported.has(key)) {
        this._performers.delete(key);
        changed = true;
      }
    });

    return changed;
  }

  /** Every performer, in the order they were first reported. */
  all() {
    return [ ...this._performers.values() ];
  }

  /** The performer held under a key, or nothing. */
  get(key) {
    return this._performers.get(key);
  }

  /**
   * Record the order the reader has set, as the list announces it: every key it holds, the fixed entry and
   * the divider among them. Keys the store does not know are ignored, and keys it knows that the list does
   * not hold keep their place at the end, so a panel drawing part of a performer cannot lose the rest of it.
   */
  setOrder(key, orderedKeys) {
    const held = this._performers.get(key);

    if (!held) {
      return false;
    }

    const known = orderedKeys.filter((entry) => held.order.includes(entry)),
          rest = held.order.filter((entry) => !known.includes(entry));

    held.order = [ ...known, ...rest ];
    this._hoist(held);

    return true;
  }

  /**
   * Mark a token as given to the engine. It is the entry of the first token above the divider that is
   * enqueued, so the token is at the head already; it is hoisted regardless, the head being where a fixed
   * entry stands.
   */
  pin(key, tokenKey) {
    const held = this._performers.get(key);

    if (!held || !held.order.includes(tokenKey)) {
      return false;
    }

    held.pinned = tokenKey;
    this._hoist(held);

    return true;
  }

  /**
   * The token that is to enter next: the first above the divider, or nothing where none stands there. The
   * token being conducted is no candidate, standing at the head as the anchor of the list; a token merely
   * given to the engine is one still, since a decision that did not take effect is given again.
   */
  next(key) {
    const held = this._performers.get(key);

    if (!held) {
      return null;
    }

    const above = held.order.slice(0, held.order.indexOf(DIVIDER))
      .filter((entry) => entry !== held.conducting);

    return above.length ? held.tokens.get(above[0]) : null;
  }

  /** Drops every performer, and returns whether any was held. */
  clear() {
    const held = this._performers.size > 0;

    this._performers.clear();

    return held;
  }

  /**
   * A performer not seen before. Its list begins as the divider alone, so that everything reported for it
   * is appended below the divider and nothing is advanced until the reader has placed it above.
   */
  _add(key, identity) {
    const held = {
      key,
      performer: identity,
      conducting: null,
      pinned: null,
      fixed: null,
      order: [ DIVIDER ],
      tokens: new Map()
    };

    this._performers.set(key, held);

    return held;
  }

  /** Reconcile one performer against what was reported of it. */
  _reconcile(held, entry) {
    const waiting = entry.waiting || [],
          conducting = entry.performing ? SequenceStore.keyOf(entry.performing) : null,
          present = new Map();

    waiting.forEach((identity) => present.set(SequenceStore.keyOf(identity), identity));

    if (conducting) {
      present.set(conducting, entry.performing);
    }

    const before = held.order.join('|') + '/' + held.fixed;

    // a token that has left the engine's list leaves this one
    held.order = held.order.filter((key) => key === DIVIDER || present.has(key));

    // and one not seen before is appended at the end, which is below the divider
    present.forEach((identity, key) => {
      if (!held.order.includes(key)) {
        held.order.push(key);
      }
    });

    held.tokens = present;
    held.conducting = conducting;

    // the decision has been answered, or its token is gone: either way the mark is spent
    if (held.pinned && (held.pinned === conducting || !present.has(held.pinned))) {
      held.pinned = null;
    }

    this._hoist(held);

    return before !== held.order.join('|') + '/' + held.fixed;
  }

  /** The fixed entry stands at the head, whether it is conducted or merely given to the engine. */
  _hoist(held) {
    held.fixed = held.conducting || held.pinned || null;

    if (held.fixed) {
      held.order = [ held.fixed, ...held.order.filter((key) => key !== held.fixed) ];
    }
  }
}
