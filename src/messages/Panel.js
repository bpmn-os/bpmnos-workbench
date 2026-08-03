import createMessageEntry from './MessageEntry.js';

/**
 * The Messages tab: what a run has sent and not yet delivered.
 *
 * While the workbench is in Model mode the tab says what the Tokens tab says, since a message is something
 * a run produces and in Model mode there is no run: the note is the host's, given as
 * `config.messagesPanel.modelNote`, so that the two tabs say the same thing in the same words without
 * either knowing about the other. While a run is on, the tab shows the messages waiting, and says that
 * there are none as plainly as the Tokens tab says it of tokens.
 *
 * The tab is added when the diagram is initialised, as the Tokens tab is, and what it shows is drawn then
 * and whenever the mode changes.
 */
export default function MessagesPanel(injector, eventBus, messages, config) {
  this._injector = injector;
  this._eventBus = eventBus;
  this._messages = messages;
  this._config = config || {};

  this._body = null;
  this._inspector = null;
  this._open = new Map();   // which rows a reader has expanded, kept as the list is drawn again
  this._awaited = new Set(); // deliveries asked for and not yet reported, so the offer reads as waiting
  this._filter = 'all';      // which messages are listed: all of them, or those for the selected tokens

  eventBus.on('diagram.init', () => this._init());
  eventBus.on('messages.changed', () => this._render());
  eventBus.on('mode.changed', () => this._applyNote());

  // the filter selects by what the reader has selected, so the list follows a change of selection
  eventBus.on('token.selection.changed', () => {
    if (this._filter === 'recipients') {
      this._render();
    }
  });

  // A run that ends takes its offers with it: what was asked for of an engine that is gone is not awaited.
  eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
    this._awaited.clear();
  });
}

/**
 * Whether one of the tokens that may receive this message is a token the reader has selected. A selected
 * token is named by the animation as the label it carries and the node it stands at, which is the instance
 * and the node a recipient is named by.
 */
MessagesPanel.prototype._forSelected = function(message) {
  const primitives = this._injector.get('primitives', false),
        recipients = this._messages.recipients ? this._messages.recipients(message.key) : [];

  if (!primitives || !recipients.length) {
    return false;
  }

  const selected = primitives.getSelectedTokens()
    .map((token) => `${token.label}|${token.node && token.node.id}`);

  return recipients.some((recipient) => selected.includes(`${recipient.instanceId}|${recipient.nodeId}`));
};

/**
 * Asks the run to deliver this message to that token. The decision is announced rather than performed: the
 * source driving the engine listens, enqueues it, and the engine takes it when it reaches it — which is why
 * the offer becomes an hourglass here and stays one until the message goes.
 */
MessagesPanel.prototype._deliver = function(message, recipient) {
  this._awaited.add(asked(message.key, recipient));
  this._eventBus.fire('manual.decide', {
    event: 'messageDelivery',
    payload: {
      instanceId: recipient.instanceId,
      nodeId: recipient.nodeId,
      origin: message.origin,
      sender: message.sender
    }
  });
  this._render();
};

/** What identifies one offer: the message, and the token it was offered to. */
function asked(key, recipient) {
  return `${key}|${recipient.instanceId}|${recipient.nodeId}`;
}

MessagesPanel.$inject = [ 'injector', 'eventBus', 'messages', 'config.messagesPanel' ];

MessagesPanel.prototype._init = function() {
  const sidePanel = this._injector.get('sidePanel', false);

  if (!sidePanel || this._body) {
    return; // no side panel, or the tab is up already
  }

  const { body } = sidePanel.addTab({
    id: 'messages',
    label: this._config.label || 'Messages',
    priority: this._config.priority != null ? this._config.priority : -1
  });

  this._body = body;
  this._build();
  this._render();
  this._applyNote();
};

/**
 * The frame of the tab: a heading naming what is listed, above the region the list scrolls in.
 *
 * It is built from the classes the Tokens tab is built from, `bjs-token-filter` over `bjs-token-inspector`
 * within `bjs-token`, so that the two tabs are one appearance rather than two that resemble each other.
 *
 * The heading carries the filter over the same relation the rows offer: which tokens may receive a message,
 * which only an engine standing at the step being shown can say, and which therefore selects nothing while
 * no such engine stands there.
 */
MessagesPanel.prototype._build = function() {
  const root = document.createElement('div');

  root.className = 'bjs-token';

  const heading = document.createElement('div');

  heading.className = 'bjs-token-list-title bjs-token-filter';

  const title = document.createElement('span');

  title.textContent = 'Messages';
  heading.appendChild(title);

  // The filter selects by the same relation the rows offer: a message is "for the selected recipients" when
  // one of the tokens that may receive it is a token the reader has selected.
  addFilter(heading, (value) => {
    this._filter = value;
    this._render();
  });

  this._inspector = document.createElement('div');
  this._inspector.className = 'bjs-token-inspector';

  root.appendChild(heading);
  root.appendChild(this._inspector);

  this._body.appendChild(root);
};

/**
 * Draw what the tab shows: a row per message waiting, or, where none is, the sentence the Tokens tab shows
 * of tokens, in the Tokens tab's own words and its own class.
 *
 * The list is drawn afresh whenever the store announces a change. A message is static once sent, so there
 * is nothing within a row to keep current and nothing is gained by writing into one in place, as a token
 * entry does for values that change under it; what changes is which messages there are.
 */
MessagesPanel.prototype._render = function() {
  if (!this._inspector) {
    return;
  }

  this._inspector.innerHTML = '';

  const messages = this._filter === 'recipients'
    ? this._messages.all().filter((message) => this._forSelected(message))
    : this._messages.all();

  if (!messages.length) {
    const hint = document.createElement('div');

    hint.className = 'bjs-token-empty';
    hint.textContent = 'No messages.';

    this._inspector.appendChild(hint);

    return;
  }

  messages.forEach((message) => {
    const entry = createMessageEntry(message, {
      open: this._open.get(message.key) === true,
      onToggle: (open) => this._open.set(message.key, open),
      // a store that holds no relation offers no delivery: the relation is a running engine's answer, and
      // the panel draws over a store that may be nothing more than what was sent
      recipients: this._messages.recipients ? this._messages.recipients(message.key) : [],
      isAwaited: (recipient) => this._awaited.has(asked(message.key, recipient)),
      onDeliver: (recipient) => this._deliver(message, recipient)
    });

    this._inspector.appendChild(entry.element);
  });
};

/**
 * Adds the filter to a heading: which messages are listed, all of them or those the selected tokens may
 * receive.
 *
 * @param {Element} heading  the heading built by {@link MessagesPanel#_build}
 * @param {Function} onChange  (value) => void, called with 'all' or 'recipients'
 */
export function addFilter(heading, onChange) {
  [ [ 'all', 'all' ], [ 'recipients', 'selected recipients' ] ].forEach(([ value, label ], index) => {
    const option = document.createElement('label'),
          radio = document.createElement('input');

    radio.type = 'radio';
    radio.name = 'wb-message-filter';
    radio.value = value;
    radio.checked = index === 0;
    radio.addEventListener('change', () => radio.checked && onChange(value));

    option.appendChild(radio);
    option.appendChild(document.createTextNode(' ' + label));
    heading.appendChild(option);
  });
}

/**
 * The note shown in place of the tab's content while the workbench is modelling. The mode service is
 * optional, as it is to every part of this application: without one there is no Model mode to be in.
 */
MessagesPanel.prototype._applyNote = function() {
  const sidePanel = this._injector.get('sidePanel', false),
        mode = this._injector.get('mode', false),
        note = this._config.modelNote;

  if (!sidePanel || !note || !this._body) {
    return;
  }

  sidePanel.setNote('messages', !mode || mode.getMode() === 'model' ? note : null);
};
