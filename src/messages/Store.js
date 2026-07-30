/**
 * The messages a run has sent and not yet disposed of.
 *
 * The engine reports a message twice, once when it is created and once when it is delivered or withdrawn,
 * and what it reports is `{ origin, state, header, content }`: the node that sent it, what has become of
 * it, its header by key and its contents by key. A message is held between those two records, which is the
 * span in which it waits for a recipient, and that is what a list of current messages shows.
 *
 * A message is identified by the node that sent it together with the instance identifier of the token that
 * did so, which the engine writes into the header as `sender`. The pair is unique because a token is: one
 * token is at one node at one time, and every message is sent by a token.
 *
 * The store knows nothing of a diagram and is written and read as a plain object, which is what makes it
 * testable without one. What a reader is shown beyond the record itself, the colour of the token that sent
 * the message, is given when the message is applied, since it is known then and that token may be gone by
 * the time the message is read.
 */
export default class MessageStore {

  constructor() {
    this._messages = new Map();
  }

  /** The key a message is held under: the node that sent it and the instance that did. */
  static keyOf(record) {
    return `${record.origin}|${(record.header || {}).sender}`;
  }

  /**
   * Apply one message record, and return the key it concerns.
   *
   * A created message is held, replacing whatever was held under its key, since a node that sent one
   * message to completion may send another. A delivered or a withdrawn message is dropped, no longer being
   * one that waits.
   *
   * @param {Object} record  a message record of the engine's log
   * @param {String} [color] the colour of the token that sent it
   */
  apply(record, color) {
    const key = MessageStore.keyOf(record),
          header = record.header || {};

    if (record.state === 'CREATED') {
      this._messages.set(key, {
        key,
        origin: record.origin,
        sender: header.sender,
        recipient: header.recipient,
        name: header.name,
        header,
        content: record.content || {},
        color: color || null
      });
    } else {
      this._messages.delete(key);
    }

    return key;
  }

  /** The message held under a key, or nothing. */
  get(key) {
    return this._messages.get(key);
  }

  /** Every message waiting, in the order the messages were sent. */
  all() {
    return [ ...this._messages.values() ];
  }

  /** Drops every message, and returns whether any was held. */
  clear() {
    const held = this._messages.size > 0;

    this._messages.clear();

    return held;
  }
}
