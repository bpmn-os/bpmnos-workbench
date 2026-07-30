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
  this._open = new Map(); // which rows a reader has expanded, kept as the list is drawn again

  eventBus.on('diagram.init', () => this._init());
  eventBus.on('messages.changed', () => this._render());
  eventBus.on('mode.changed', () => this._applyNote());
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
 * The frame of the tab: a heading naming what is listed and how it is filtered, above the region the list
 * scrolls in.
 *
 * It is built from the classes the Tokens tab is built from, `bjs-token-filter` over `bjs-token-inspector`
 * within `bjs-token`, so that the two tabs are one appearance rather than two that resemble each other.
 * The filter is drawn and does nothing yet; what it will select is which messages are shown, and that
 * follows the token list it is named after.
 */
MessagesPanel.prototype._build = function() {
  const root = document.createElement('div');

  root.className = 'bjs-token';

  const heading = document.createElement('div');

  heading.className = 'bjs-token-list-title bjs-token-filter';

  const title = document.createElement('span');

  title.textContent = 'Messages';
  heading.appendChild(title);

  [ [ 'all', 'all' ], [ 'recipients', 'selected recipients' ] ].forEach(([ value, label ], index) => {
    const option = document.createElement('label'),
          radio = document.createElement('input');

    radio.type = 'radio';
    radio.name = 'wb-message-filter';
    radio.value = value;
    radio.checked = index === 0;

    option.appendChild(radio);
    option.appendChild(document.createTextNode(' ' + label));
    heading.appendChild(option);
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

  const messages = this._messages.all();

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
      onToggle: (open) => this._open.set(message.key, open)
    });

    this._inspector.appendChild(entry.element);
  });
};

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
