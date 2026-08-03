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
 * the expanded row ends with them, each offering to deliver it. The offer is a paper plane until it is
 * taken and an hourglass thereafter, since a decision is enqueued rather than performed: the engine takes
 * it when it reaches it, and the message goes from the list when the delivery is reported, entry and all.
 *
 * @param {Object} message  `{ name, sender, origin, color, header, content }`
 * @param {Object} [options]
 * @param {boolean} [options.open=false]  whether the row starts expanded
 * @param {Function} [options.onToggle]   (open) => void
 * @param {Array<{instanceId: string, nodeId: string}>} [options.recipients]  tokens that may receive it
 * @param {Function} [options.onDeliver]  (recipient) => void, called when a delivery is asked for
 * @param {Function} [options.isAwaited]  (recipient) => boolean, whether that delivery is already asked for
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

  entry.contentEl.appendChild(line('Origin', message.origin));

  section(entry.contentEl, 'Header', omit(message.header, SHOWN_IN_SUMMARY));
  section(entry.contentEl, 'Content', message.content);

  if (options.recipients && options.recipients.length) {
    recipients(entry.contentEl, options);
  }

  return entry;
}

/**
 * The tokens that may receive the message, each with the offer to deliver it to that one. A token is named
 * as a token entry names it, by the instance and the node it waits at.
 */
function recipients(parent, options) {
  const entry = createCollapsibleEntry({ label: 'Recipients', open: true, caretSide: 'left' });

  options.recipients.forEach((recipient) => {
    const row = el('div', 'wb-attribute wb-recipient'),
          awaited = options.isAwaited ? options.isAwaited(recipient) : false,
          button = el('button', 'wb-deliver');

    row.appendChild(text('span', 'wb-attribute-name', recipient.instanceId));
    row.appendChild(text('span', 'wb-attribute-value', recipient.nodeId));

    button.type = 'button';
    button.title = awaited ? 'Delivery enqueued' : 'Deliver this message here';
    button.innerHTML = awaited ? HOURGLASS : PAPER_PLANE;
    button.disabled = awaited;
    button.addEventListener('click', () => options.onDeliver && options.onDeliver(recipient));

    row.appendChild(button);
    entry.contentEl.appendChild(row);
  });

  parent.appendChild(entry.element);
}

// Font Awesome 6 free, solid: paper-plane (512 wide) offers the delivery, hourglass (384 wide) says it has
// been asked for and is waiting on the engine. Inlined as the mode icons are, so nothing is fetched.
const PAPER_PLANE = '<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480l0-83.6c0-4 1.5-7.8 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/></svg>';

const HOURGLASS = '<svg viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M0 32C0 14.3 14.3 0 32 0L64 0 320 0l32 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l0 11c0 42.4-16.9 83.1-46.9 113.1L237.3 256l67.9 67.9c30 30 46.9 70.7 46.9 113.1l0 11c17.7 0 32 14.3 32 32s-14.3 32-32 32l-32 0L64 512l-32 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l0-11c0-42.4 16.9-83.1 46.9-113.1L146.7 256 78.9 188.1C48.9 158.1 32 117.4 32 75l0-11C14.3 64 0 49.7 0 32zM96 64l0 11c0 25.5 10.1 49.9 28.1 67.9L192 210.7l67.9-67.9c18-18 28.1-42.4 28.1-67.9l0-11L96 64zm0 384l192 0 0-11c0-25.5-10.1-49.9-28.1-67.9L192 301.3l-67.9 67.9c-18 18-28.1 42.4-28.1 67.9l0 11z"/></svg>';

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
