import MessageStore from './Store.js';
import MessagesPanel from './Panel.js';

/**
 * Whether a message is one the waiting token accepts, matched as the engine matches it: the message was
 * sent by a node the token accepts, its header holds the keys the token expects, and where both sides state
 * a value the values are equal. An unset value on either side matches anything, which is how a message
 * addressed to no one in particular reaches whoever waits for it.
 */
function accepts(criterion, message) {
  const expected = criterion.recipientHeader || {},
        header = message.header || {};

  return (criterion.senders || []).includes(message.origin)
    && Object.keys(expected).length === Object.keys(header).length
    && Object.entries(expected).every(([ key, value ]) =>
      value === null || value === undefined
        || header[key] === null || header[key] === undefined
        || String(header[key]) === String(value));
}

/**
 * Messages — what a run has sent and not yet disposed of, as a diagram-js service.
 *
 * The store itself is plain and knows nothing of a diagram. Two things tie it to a running one, and both
 * are the run's own doing: the player applies each message record as it replays it, at the step the record
 * is reached, so that what is shown is what waits at the moment the diagram shows it; and the messages go
 * when the tokens go, a message being part of the execution state that a mode switch clears.
 *
 * A change is announced rather than pushed, so that the tab, and anything else reading the store, draws
 * from the store rather than from the record that changed it.
 */
export class Messages extends MessageStore {

  constructor(eventBus) {
    super();

    this._eventBus = eventBus;
    this._waiting = new Map(); // token key -> what that token accepts, as its request stated it

    // The braces matter: a listener returning a value is a listener that has answered the event, and
    // diagram-js stops the event there. Returning whether anything was held would keep `diagram.clear`
    // from reaching the canvas, which then keeps a root that carries no DI.
    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
      this._waiting.clear();
      this.clear();
    });

  }

  /**
   * A token has begun waiting for a message, and the record says what it accepts.
   *
   * @param {Object} record  the message delivery request, as the engine reported it
   */
  awaiting(record) {
    this._waiting.set(`${record.instanceId}|${record.nodeId}`, {
      instanceId: record.instanceId,
      nodeId: record.nodeId,
      senders: record.senders || [],
      recipientHeader: record.recipientHeader || {}
    });

    this._eventBus.fire('messages.changed', {});
  }

  /**
   * A token has stopped waiting, which is what any record of it past that waiting says: it received what it
   * waited for, or it failed, or it was withdrawn. Nothing announces the withdrawal of the request itself,
   * so this is read from the token's own record, and without it a token long gone would go on being offered
   * every message that matched what it once accepted.
   *
   * @param {string} instanceId  the instance the token belongs to
   * @param {string} nodeId      the node it stands at
   */
  settled(instanceId, nodeId) {
    if (!this._waiting.delete(`${instanceId}|${nodeId}`)) {
      return false;
    }

    this._eventBus.fire('messages.changed', {});

    return true;
  }

  /**
   * The tokens that may receive the message: those waiting for one whose criterion it answers. Both sides
   * of the relation come from the records the run produced, so it holds what the diagram holds.
   *
   * @param {string} key  the message's key in the store
   * @returns {Array<{instanceId: string, nodeId: string}>}
   */
  recipients(key) {
    const message = this.get(key);

    if (!message) {
      return [];
    }

    return [ ...this._waiting.values() ]
      .filter((criterion) => accepts(criterion, message))
      .map(({ instanceId, nodeId }) => ({ instanceId, nodeId }));
  }

  apply(record, color) {
    const key = super.apply(record, color);

    this._eventBus.fire('messages.changed', { key });

    return key;
  }

  freeze(instanceId, nodeId, values) {
    const frozen = super.freeze(instanceId, nodeId, values);

    if (frozen) {
      this._eventBus.fire('messages.changed', {});
    }

    return frozen;
  }

  forget(key) {
    const forgotten = super.forget(key);

    if (forgotten) {
      this._eventBus.fire('messages.changed', {});
    }

    return forgotten;
  }

  clear() {
    const held = super.clear();

    if (held) {
      this._eventBus.fire('messages.changed', {});
    }

    return held;
  }
}

Messages.$inject = [ 'eventBus' ];

/**
 * The messages module: the store and the tab that shows it.
 */
export default {
  __init__: [ 'messages', 'messagesPanel' ],
  messages: [ 'type', Messages ],
  messagesPanel: [ 'type', MessagesPanel ]
};

export { default as MessageStore } from './Store.js';
export { default as MessagesPanel } from './Panel.js';
export { default as createMessageEntry } from './MessageEntry.js';
