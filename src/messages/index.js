import MessageStore from './Store.js';
import MessagesPanel from './Panel.js';

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
    this._recipients = new Map(); // message key -> the tokens that may receive it

    // The braces matter: a listener returning a value is a listener that has answered the event, and
    // diagram-js stops the event there. Returning whether anything was held would keep `diagram.clear`
    // from reaching the canvas, which then keeps a root that carries no DI.
    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
      this.clear();
    });

    // What a run is waiting for, as the engine reports it: a message delivery request names the token that
    // waits and the messages it may receive, which read here as the tokens that may receive each message.
    // Only an engine standing at the step can say this, so it is held while it is true and dropped with the
    // run, and it is not part of the store itself, which holds what was sent rather than what may happen.
    eventBus.on('manual.decisions', ({ decisions }) => {
      this._recipients = invert(decisions);
      this._eventBus.fire('messages.changed', {});
    });
  }

  /**
   * The tokens that may receive the message, as the engine last reported them.
   *
   * @param {string} key  the message's key in the store
   * @returns {Array<{instanceId: string, nodeId: string}>}
   */
  recipients(key) {
    return this._recipients.get(key) || [];
  }

  apply(record, color) {
    const key = super.apply(record, color);

    this._eventBus.fire('messages.changed', { key });

    return key;
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
 * Reads the pending decisions the other way round: the engine says which messages a waiting token may
 * receive, and a panel showing messages needs which tokens may receive each message. A message is named
 * there by its origin and its sender, which is the key the store holds it under.
 *
 * @param {Array} decisions  what the engine is waiting for
 * @returns {Map<string, Array<{instanceId: string, nodeId: string}>>}
 */
function invert(decisions) {
  const recipients = new Map();

  (decisions || []).forEach(({ type, instanceId, nodeId, candidates }) => {
    if (type !== 'messageDelivery') {
      return;
    }
    (candidates || []).forEach(({ origin, sender }) => {
      const key = `${origin}|${sender}`;

      if (!recipients.has(key)) {
        recipients.set(key, []);
      }
      recipients.get(key).push({ instanceId, nodeId });
    });
  });

  return recipients;
}

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
