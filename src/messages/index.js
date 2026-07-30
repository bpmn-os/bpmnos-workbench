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

    // The braces matter: a listener returning a value is a listener that has answered the event, and
    // diagram-js stops the event there. Returning whether anything was held would keep `diagram.clear`
    // from reaching the canvas, which then keeps a root that carries no DI.
    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
      this.clear();
    });
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
