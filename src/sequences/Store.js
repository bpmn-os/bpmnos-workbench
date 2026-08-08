/**
 * The key of the divider, the one entry of a performer's list that is no token. It is held in the order
 * like any other entry, so that moving it is the same act as moving a token past it.
 */
export const DIVIDER = 'divider';

/** What identifies a token here: the instance it belongs to and the node it stands at. */
export function keyOf(label, node) {
  return `${label}|${node || ''}`;
}

/**
 * The sequential performers of a run, and the order in which each is to take on what waits for it.
 *
 * A sequential ad hoc subprocess performs its children one at a time, and what the reader decides is the
 * order in which they go: a list per performer, of the tokens waiting and of the divider among them, with
 * everything above the divider being what the performer may take and everything below it being what it is
 * to leave alone.
 *
 * The store is written from the records a run produces, as they are replayed, so it shows what the canvas
 * shows and can neither run ahead of it nor lag behind. A performer is opened when the token standing at
 * its node becomes `BUSY`, which is before its scope runs, and closed when that token is `COMPLETED`. A
 * token at one of its activities joins its list on `READY`, is the token being conducted from `ENTERED`
 * until `EXITING` releases the performer, and is archived thereafter. Which activities belong to which
 * performer is what the model resolves and what the store is given; which token of that node performs for a
 * given activity token is the caller's to say, since it is the caller that holds the token hierarchy.
 *
 * A token waiting is where the reader put it, and nothing moves it there. What is taken on moves once, to
 * the front of what is still to come, so that the list reads as the order the performer worked in: what it
 * has done, what it is doing, what it may take next, the divider, and what it is to leave alone. That one
 * move matters only where an order was changed while a decision was in flight, and it says what happened
 * rather than what was asked for. An archived token is kept only where the archive is kept, and is
 * forgotten as it leaves otherwise.
 *
 * The store knows nothing of a diagram and is written and read as a plain object, which is what makes it
 * testable without one.
 */
export default class SequenceStore {

  /**
   * @param {Array} performers  `[{ performer: nodeId, activities: [nodeId] }]`, as the model resolves it
   */
  constructor(performers = []) {
    this._nodes = new Map();      // activity node -> the node performing it
    this._performing = new Set(); // the nodes that perform
    this._performers = new Map(); // key -> what one performer holds

    // Whether a token that leaves is kept as a record of what was done. It is a performer's own, one
    // performer's record being no business of another's, and this is what a performer opened later is born
    // with: the last thing the reader asked for, since a run opens performers as it goes and a reader who
    // turned the record off would otherwise find it back on at the next performer.
    this._archiving = true;

    this.setModel(performers);
  }

  /**
   * Whether a token that leaves this performer is kept. What is governed is the keeping: turning it off
   * forgets what that performer holds and what leaves it thereafter, and turning it on begins its record
   * afresh rather than restoring what was not kept. Another performer's record is untouched, each keeping
   * its own.
   *
   * What is asked for last is also what a performer opened later is born with, a run opening performers as
   * it goes.
   *
   * @param {string} key  the performer
   * @param {boolean} keep
   * @returns {boolean} whether anything the reader sees has changed
   */
  keepArchived(key, keep) {
    const held = this._performers.get(key);

    this._archiving = !!keep;

    if (!held || held.archiving === !!keep) {
      return false;
    }

    held.archiving = !!keep;

    if (held.archiving) {
      return true;
    }

    let changed = false;

    held.order.filter((archived) => held.archived.has(archived)).forEach((archived) => {
      this._forget(held, archived);
      changed = true;
    });

    return changed;
  }

  /** Whether a token that leaves this performer is kept, or what a performer opened now would be born with. */
  isKeepingArchived(key) {
    const held = key === undefined ? null : this._performers.get(key);

    return held ? held.archiving : this._archiving;
  }

  /** What the model resolves, which a fresh model replaces. */
  setModel(performers = []) {
    this._nodes.clear();
    this._performing.clear();

    performers.forEach(({ performer, activities }) => {
      this._performing.add(performer);
      (activities || []).forEach((activity) => this._nodes.set(activity, performer));
    });
  }

  /** Whether a token standing at this node performs for a sequential ad hoc subprocess. */
  performsSequentially(node) {
    return this._performing.has(node);
  }

  /** The node performing the activity at this node, or nothing where the node is no sequential activity. */
  performerOf(node) {
    return this._nodes.get(node);
  }

  /** The activities a node performs, as the model resolves it. */
  activitiesOf(node) {
    return [ ...this._nodes.entries() ]
      .filter(([ , performer ]) => performer === node)
      .map(([ activity ]) => activity);
  }

  /**
   * Open a performer, which is what a token standing at a performer node becoming busy means.
   *
   * @param {string} label  the instance of the token standing there
   * @param {string} node   the node it stands at
   */
  open(label, node) {
    const key = keyOf(label, node);

    if (this._performers.has(key)) {
      return false;
    }

    // the divider alone, so that everything joining lands below it and nothing is advanced before the
    // reader has placed it
    this._performers.set(key, {
      key,
      label,
      node,
      conducting: null,
      committed: null,       // the token whose entry has been offered and cannot be taken back
      archiving: this._archiving, // whether what leaves it is kept, born as the reader last asked
      archived: new Map(),   // token key -> what it held as it left
      order: [ DIVIDER ],
      tokens: new Map()
    });

    return true;
  }

  /** Close a performer, which is what its token completing means. */
  close(label, node) {
    return this._performers.delete(keyOf(label, node));
  }

  /**
   * A token joins the list of the performer it was placed under, below the divider, where it is not held
   * already.
   *
   * @param {string} key    the performer's key, as the caller resolved it
   * @param {{label: string, node: string}} token  the token that has become ready
   */
  queue(key, token) {
    const held = this._performers.get(key),
          tokenKey = keyOf(token.label, token.node);

    if (!held || held.tokens.has(tokenKey)) {
      return false;
    }

    held.tokens.set(tokenKey, token);
    held.order.push(tokenKey);

    return true;
  }

  /**
   * The token whose entry has been offered to the engine. It goes to the front of what is still to come and
   * stays there, since a decision given cannot be taken back: the reader may reorder everything behind it,
   * and the list keeps saying what was settled.
   */
  commit(key, tokenKey) {
    const held = this._performers.get(key);

    if (!held || !held.tokens.has(tokenKey) || held.committed === tokenKey) {
      return false;
    }

    held.committed = tokenKey;
    this._front(held, tokenKey);

    return true;
  }

  /** Whether this token's entry has been offered and not yet answered. */
  isCommitted(key, tokenKey) {
    const held = this._performers.get(key);

    return !!held && held.committed === tokenKey;
  }

  /**
   * The token a performer has taken on. It is at the front of what is still to come, having been offered
   * from there, and what was offered is settled by its arrival.
   */
  conduct(key, token) {
    const held = this._performers.get(key),
          tokenKey = keyOf(token.label, token.node);

    if (!held || !held.tokens.has(tokenKey) || held.conducting === tokenKey) {
      return false;
    }

    held.conducting = tokenKey;
    held.committed = null;
    this._front(held, tokenKey);

    return true;
  }

  /**
   * A token that has left. It is archived where the archive is kept, taking its place at the end of the
   * record, and forgotten otherwise.
   *
   * @param {string} key    the performer's key
   * @param {{label: string, node: string}} token  the token that has left
   * @param {Array} [values]  what it held as it left, in the sections a token entry shows, frozen here
   *                          because the run forgets a token that is gone
   */
  archive(key, token, values) {
    const held = this._performers.get(key),
          tokenKey = keyOf(token.label, token.node);

    if (!held || !held.tokens.has(tokenKey) || held.archived.has(tokenKey)) {
      return false;
    }

    if (held.conducting === tokenKey) {
      held.conducting = null;
    }

    if (held.committed === tokenKey) {
      held.committed = null;
    }

    if (held.archiving) {
      held.archived.set(tokenKey, values || null);
      // it left when it left, so it takes its place at the end of the record rather than wherever it stood:
      // a token withdrawn while waiting has no place among what was performed
      this._front(held, tokenKey);
    } else {
      this._forget(held, tokenKey);
    }

    return true;
  }

  /** What an archived token held as it left, in the sections a token entry shows, or nothing. */
  archivedValues(key, tokenKey) {
    const held = this._performers.get(key);

    return (held && held.archived.get(tokenKey)) || null;
  }

  /**
   * Forget one archived token, which the reader may ask for a row at a time. Only an archived row may be
   * forgotten: the run holds nothing of it any more, whereas a token still waiting is queued by the engine
   * once and never again, so a row thrown away would be a token that could never be performed.
   */
  forget(key, tokenKey) {
    const held = this._performers.get(key);

    if (!held || !held.archived.has(tokenKey)) {
      return false;
    }

    this._forget(held, tokenKey);

    return true;
  }

  /** Whether this token of that performer has been performed and kept. */
  isArchived(key, tokenKey) {
    const held = this._performers.get(key);

    return !!held && held.archived.has(tokenKey);
  }

  /**
   * Put a token at the front of what is still to come: after everything archived, which is the record of
   * what has been done, and before everything still waiting, which is what the reader orders.
   */
  _front(held, tokenKey) {
    const rest = held.order.filter((entry) => entry !== tokenKey);

    let at = 0;

    while (at < rest.length && held.archived.has(rest[at])) {
      at++;
    }

    rest.splice(at, 0, tokenKey);
    held.order = rest;
  }

  _forget(held, tokenKey) {
    held.tokens.delete(tokenKey);
    held.archived.delete(tokenKey);
    held.order = held.order.filter((entry) => entry !== tokenKey);

    if (held.committed === tokenKey) {
      held.committed = null;
    }
  }

  /** Every performer, in the order they were opened. */
  all() {
    return [ ...this._performers.values() ];
  }

  /** The performer held under a key, or nothing. */
  get(key) {
    return this._performers.get(key);
  }

  /**
   * Record the order the reader has set, as the list announces it: every key it holds, the conducted and
   * archived rows among them. Keys the store does not know are ignored, and keys it knows that the list
   * does not hold keep their place at the end, so a panel drawing part of a performer cannot lose the rest
   * of it. A conducted or archived row is an anchor of that list, so what the reader can reorder is what is
   * still waiting.
   */
  setOrder(key, orderedKeys) {
    const held = this._performers.get(key);

    if (!held) {
      return false;
    }

    const known = orderedKeys.filter((entry) => held.order.includes(entry)),
          rest = held.order.filter((entry) => !known.includes(entry));

    held.order = [ ...known, ...rest ];

    // What is settled stays settled, whatever the order says of it: the record of what has been done, and
    // then the token being conducted or the one whose entry has been offered, which cannot be taken back.
    // The panel refuses such a move at its arrows, and the store does not depend on that.
    const settled = held.order.filter((entry) => held.archived.has(entry)),
          front = held.conducting || held.committed;

    if (front) {
      settled.push(front);
    }

    held.order = [ ...settled, ...held.order.filter((entry) => !settled.includes(entry)) ];

    return true;
  }

  /**
   * The token that is to enter next: the first above the divider that is still waiting. What has been
   * conducted or archived is passed over, being what this performer is doing or has done.
   */
  next(key) {
    const held = this._performers.get(key);

    if (!held) {
      return null;
    }

    const waiting = held.order.slice(0, held.order.indexOf(DIVIDER))
      .filter((entry) => entry !== held.conducting && !held.archived.has(entry));

    return waiting.length ? held.tokens.get(waiting[0]) : null;
  }

  /** Drops every performer, and returns whether any was held. */
  clear() {
    const held = this._performers.size > 0;

    this._performers.clear();

    return held;
  }
}
