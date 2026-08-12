import { createCollapsibleEntry } from 'bpmn-js-side-panel';

/**
 * One message rendered as a side-panel entry, on the pattern of `bpmn-js-animation`'s token entry and in
 * its classes, so that the two lists are one appearance rather than two that resemble each other.
 *
 * The summary is the envelope marking what the row is, in the colour of the token that sent the message,
 * the name of the message, and the instance that sent it. Expanding the row shows the node the message was
 * sent from, then the header and the contents, each as a line of a key and its value, in the lines a token
 * entry shows its attributes in. The header omits the name and the sender, which the summary states.
 *
 * Styling of the offer lives in `messages.css`, which a host imports as it imports the side panel's own; the
 * rest of the row needs none, being drawn in the Tokens tab's classes.
 *
 * Where a run can say which tokens may receive the message — which only an engine standing at the step can —
 * the expanded row ends with those tokens, drawn by the caller as token rows are drawn anywhere and each
 * carrying the offer to deliver this message to that token.
 *
 * @param {Object} message  `{ name, sender, origin, color, header, content }`
 * @param {Object} [options]
 * @param {boolean} [options.open=false]  whether the row starts expanded
 * @param {Function} [options.onToggle]   (open) => void
 * @param {Element[]} [options.recipients]  rows of the tokens that may receive it, ready to be shown
 * @param {boolean} [options.archived]    the run has finished with it: a record rather than an offer
 * @param {Element} [options.onForget]    the control that takes an archived message away
 */
export default function createMessageEntry(message, options = {}) {
  const summary = el('span', 'bjs-token-summary');

  const info = el('span', 'bjs-token-info');

  info.appendChild(labelEl(message.name || ''));
  info.appendChild(text('span', 'bjs-token-node', message.sender || ''));

  summary.appendChild(envelopeEl(message));
  summary.appendChild(info);

  const entry = createCollapsibleEntry({
    id: message.key,
    label: summary,
    open: !!options.open,
    toggleOn: 'caret',
    onToggle: options.onToggle
  });

  entry.element.classList.add('bjs-token-entry');

  // A message the run has finished with is a record of what became of it: faded as a token being conducted
  // is, offering no delivery, and carrying the one control such a record has, forgetting it.
  if (options.archived) {
    entry.element.classList.add('wb-message-archived');
  }
  if (options.onForget) {
    entry.controlsEl.appendChild(options.onForget);
  }

  entry.contentEl.appendChild(line('Origin', message.origin));

  section(entry.contentEl, 'Header', omit(message.header, SHOWN_IN_SUMMARY));
  section(entry.contentEl, 'Content', message.content);

  // `null` is not the same as none: none is a message nobody may take, which the section says, and null is a
  // row with nothing to say about who may take it — a replayed log, where the answer is the engine's and
  // arrives only with the record of the delivery. Then the section is left out rather than filled with a
  // denial.
  if (options.recipients !== null) {
    recipients(entry.contentEl, options.recipients || [], options.archived ? archivedTitle(message) : undefined);
  }

  return entry;
}

/**
 * What became of a message the run has finished with, which is what stands where the offer stood. A message
 * that was delivered says who took it, above the row of that token; one that was withdrawn says so and has
 * no such token, having gone undelivered.
 */
function archivedTitle(message) {
  return message.state === 'WITHDRAWN' ? 'Withdrawn' : 'Delivered to';
}

/**
 * The tokens that may receive the message, in the order the engine gave them, under a title and nothing
 * else: which tokens these are is what the row is there to decide, so there is nothing to fold away and no
 * caret to leave room for. The title says whether there are any, in the words the panel says it in.
 *
 * A caller with nothing to say of them says so by passing `null`, and this is not drawn at all.
 */
function recipients(parent, rows, title) {
  const section = el('div', 'wb-message-tokens');

  section.appendChild(text('div', 'bjs-token-list-title',
    title || (rows.length ? 'Tokens' : 'No tokens')));
  rows.forEach((row) => section.appendChild(row));

  parent.appendChild(section);
}


// what the collapsed row already says, and which the header therefore does not repeat
const SHOWN_IN_SUMMARY = [ 'name', 'sender' ];

/**
 * One section of the expanded row. A key the run left without a value is shown as such rather than left
 * out, an unset header entry being what a message is matched on by any value.
 */
function section(parent, label, values) {
  const entry = createCollapsibleEntry({ label, open: true, caretSide: 'left' }),
        keys = Object.keys(values || {});

  if (!keys.length) {
    entry.contentEl.appendChild(text('div', 'wb-attribute', 'None.'));
  }

  keys.forEach((key) => entry.contentEl.appendChild(line(key, values[key])));

  parent.appendChild(entry.element);
}

/** One line of a name and its value, as a token entry shows an attribute. */
function line(name, value) {
  const row = el('div', 'wb-attribute'),
        unset = value === null || value === undefined;

  row.appendChild(text('span', 'wb-attribute-name', name));
  row.appendChild(text('span', 'wb-attribute-value' + (unset ? ' wb-attribute-null' : ''),
    unset ? 'undefined' : String(value)));

  return row;
}

function omit(values, keys) {
  return Object.fromEntries(Object.entries(values || {}).filter(([ key ]) => !keys.includes(key)));
}

/**
 * The message itself: BPMN's envelope, carrying a bullet in the colour of the token that sent it.
 *
 * The envelope is the path BPMN draws a message with, `MESSAGE_FLOW_MARKER` of bpmn-js's `PathMap`, which
 * is an envelope of 21 by 14 about its own centre, so that a message reads here as it reads on a diagram.
 * The bullet sits at that centre, and both are one drawing rather than an icon with something placed over
 * it, which is what keeps them together at any size and needs nothing of a stylesheet.
 */
function envelopeEl(message) {
  const svg = document.createElementNS(SVG, 'svg');

  // the box holds the envelope and the bullet overlapping its lower right corner, and the drawing keeps
  // the size the envelope alone had, so a row's height is unchanged
  svg.setAttribute('viewBox', '-11 -7.5 27 20');
  svg.setAttribute('width', '23');
  svg.setAttribute('height', '17');
  svg.setAttribute('aria-hidden', 'true');

  const envelope = document.createElementNS(SVG, 'path');

  envelope.setAttribute('d', 'M -10.5,-7 l 0,14 l 21,0 l 0,-14 z m 0,0 l 10.5,6 l 10.5,-6');
  envelope.setAttribute('fill', 'none');
  envelope.setAttribute('stroke', 'currentColor');
  envelope.setAttribute('stroke-width', '1');

  const bullet = document.createElementNS(SVG, 'circle');

  bullet.setAttribute('cx', '10.5');
  bullet.setAttribute('cy', '7');
  bullet.setAttribute('r', '5');
  bullet.setAttribute('fill', message.color || '#888');
  bullet.setAttribute('stroke', 'rgba(0, 0, 0, 0.2)');
  bullet.setAttribute('stroke-width', '1');

  svg.appendChild(envelope);
  svg.appendChild(bullet);

  return svg;
}

const SVG = 'http://www.w3.org/2000/svg';

function el(tag, className) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  return node;
}

function text(tag, className, string) {
  const node = el(tag, className);

  node.textContent = string;

  return node;
}

// the name truncates in the middle, as a token's label does, so that its head and its tail both stay
// visible however narrow the panel is
function labelEl(label) {
  const wrap = el('span', 'bjs-token-label'),
        tail = Math.min(6, Math.floor(label.length / 2));

  wrap.title = label;
  wrap.appendChild(text('span', 'bjs-token-label-head', label.slice(0, label.length - tail)));
  wrap.appendChild(text('span', 'bjs-token-label-tail', label.slice(label.length - tail)));

  return wrap;
}
