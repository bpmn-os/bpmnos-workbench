import { createCollapsibleEntry } from 'bpmn-js-side-panel';
import { createDecisionTaskSymbol } from 'bpmnos-js/decision-task-symbol';

/**
 * One decision task rendered as a side-panel entry, on the pattern of the performer entry and the message
 * entry, and in the Tokens tab's classes, so that the lists of this application are one appearance rather
 * than several that resemble each other.
 *
 * The summary says which decision this is: the symbol of a decision task marked with the token standing at
 * it, the name of the node, and the instance. The symbol is `bpmnos-js`'s own, which states the branching
 * arrow once and draws it both on the canvas and here, so a reader recognises the task from the diagram
 * rather than learning a second vocabulary.
 *
 * Expanding the row shows what the caller gives it: what the token holds, drawn by the host as it is drawn
 * everywhere, and beneath it the choices. The row carries the offer to submit them, which sits in the
 * controls slot where its clicks do not toggle the row.
 *
 * @param {Object} decision  `{ key, nodeId, instanceId, color }`
 * @param {Object} [options]
 * @param {boolean} [options.open=false]  whether the row starts expanded
 * @param {Function} [options.onToggle]   (open) => void
 * @param {Element} [options.control]     the offer to submit, held right of the label
 * @param {Element} [options.body]        what the expanded row shows
 * @param {Function} [options.onClick]    (originalEvent) => void, a click on the row rather than the caret
 */
export default function createDecisionEntry(decision, options = {}) {
  const summary = el('span', 'bjs-token-summary'),
        info = el('span', 'bjs-token-info');

  info.appendChild(labelEl(decision.nodeId || ''));
  info.appendChild(text('span', 'bjs-token-node', decision.instanceId || ''));

  summary.appendChild(createDecisionTaskSymbol({
    width: LANE,
    height: HEIGHT,
    color: decision.color || '#888',
    className: 'wb-decision-symbol'
  }));
  summary.appendChild(info);

  const entry = createCollapsibleEntry({
    id: decision.key,
    label: summary,
    open: !!options.open,
    toggleOn: 'caret',
    controls: options.control,
    onToggle: options.onToggle
  });

  entry.element.classList.add('bjs-token-entry');

  if (options.body) {
    entry.contentEl.appendChild(options.body);
  }

  // A click on the row selects the token standing at the decision task, as a click on a token row does,
  // which is what `toggleOn: 'caret'` leaves free. The click is not given to the entry itself: that would
  // bind it to the whole entry, body included, and what the body holds acts on itself rather than on the
  // token — a section opened there, a value read there or a choice made there is not an act of selection.
  // So a click that starts inside the body is left to the body, exactly as the token entry leaves it.
  if (options.onClick) {
    entry.element.classList.add('bjs-token-clickable');
    entry.element.addEventListener('click', (event) => {
      if (entry.contentEl && entry.contentEl.contains(event.target)) {
        return;
      }
      options.onClick(event);
    });
  }

  return entry;
}

/**
 * One choice: the attribute it names, and beneath it the control that takes its value.
 *
 * The name stands above the control rather than beside it, as an attribute's value stands beside its name,
 * because a control is not a reading. A drop-down holding a location or a number input carrying three
 * digits and a pair of arrows needs the width of the panel, and the panel is narrow.
 *
 * A choice whose options are not yet known is drawn all the same, disabled. Which choices a decision task
 * requires is a property of the model, and a reader who is shown only the choice they may make now cannot
 * tell how many are still to come.
 *
 * The attribute is the name the engine reports it by, which is a name and not a structure: what the choice
 * is of is all a reader needs, and the panel resolves nothing against it.
 *
 * @param {Object} choice  `{ attribute: s, enumeration?, lowerBound?, upperBound?, multipleOf?, value? }`,
 *                         or `{ attribute: s }` alone where the choice cannot yet be made
 * @param {Function} onChange  (value) => void
 */
export function createChoiceRow(choice, onChange) {
  const row = el('div', 'wb-choice');

  row.appendChild(text('div', 'wb-choice-name', choice.attribute || ''));

  const control = choice.enumeration
    ? enumerationControl(choice)
    : numberControl(choice);

  control.className = 'wb-choice-control';
  control.disabled = !choice.enumeration && choice.lowerBound === undefined;
  control.addEventListener('change', () => onChange(read(control, choice)));

  row.appendChild(control);

  return row;
}

/** A choice among named values: a drop-down, with nothing chosen until the reader chooses. */
function enumerationControl(choice) {
  const select = document.createElement('select'),
        empty = document.createElement('option');

  empty.value = '';
  empty.textContent = '—';
  select.appendChild(empty);

  choice.enumeration.forEach((value) => {
    const option = document.createElement('option');

    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  });

  select.value = choice.value === undefined ? '' : String(choice.value);

  return select;
}

/**
 * A choice within bounds: a number input carrying the bounds and the discretizer, so that the control
 * itself refuses what the condition refuses and the reader is not told afterwards.
 */
function numberControl(choice) {
  const input = document.createElement('input');

  input.type = 'number';

  if (choice.lowerBound !== undefined) {
    input.min = String(choice.lowerBound);
    input.max = String(choice.upperBound);
    input.step = choice.multipleOf === undefined ? 'any' : String(choice.multipleOf);
    input.placeholder = `${choice.lowerBound} … ${choice.upperBound}`;
  }

  input.value = choice.value === undefined ? '' : String(choice.value);

  return input;
}

/**
 * The value the reader entered, or nothing where the control is empty.
 *
 * Whether it is a name or a number is read from the values offered rather than from a declared type: the
 * engine renders each candidate in its attribute's own type, so an enumeration of names arrives as names,
 * and a choice within bounds is a number by construction.
 */
function read(control, choice) {
  if (control.value === '') {
    return undefined;
  }

  const named = (choice.enumeration || []).some((value) => typeof value === 'string');

  return named ? control.value : Number(control.value);
}

/** The lane a symbol is drawn in and the height it is drawn at, which are the performer symbols' own. */
const LANE = 28;
const HEIGHT = 24;

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
