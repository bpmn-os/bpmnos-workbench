import { createCollapsibleEntry } from 'bpmn-js-side-panel';
import { createDecisionTaskSymbol } from 'bpmnos-js/decision-task-symbol';

import { next, shownValue, snap, walkable } from './grid.js';

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
 * @param {boolean} [options.archived]    the run has answered it: a record rather than a question
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

  // A decision the run has answered is a record of what was chosen: faded as a token being conducted is,
  // its choices readable but not answerable, and offering forgetting in place of the submission.
  if (options.archived) {
    entry.element.classList.add('wb-decision-archived');
  }

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
 * A bound the engine cannot offer is said so under the control. The values a choice admits are the multiples
 * of its step, and a step the engine cannot hold exactly puts them slightly beside the values the model
 * states, so the least selectable value may lie above the lower bound and the greatest below the upper. It
 * is said only where a reader could see it, which is where the two differ once both are written to the
 * precision the control shows; a difference that rounds away is not one the reader can act on.
 *
 * @param {Object} choice  `{ attribute: s, enumeration?, lowerBound?, upperBound?, lowest?, highest?,
 *                         multipleOf?, value? }`, or `{ attribute: s }` alone where it cannot yet be made
 * @param {Function} onChange  (value) => void
 */
export function createChoiceRow(choice, onChange, readOnly) {
  const row = el('div', 'wb-choice');

  if (readOnly) {
    row.classList.add('wb-choice-readonly');
  }

  row.appendChild(text('div', 'wb-choice-name', choice.attribute || ''));

  if (kindOf(choice) === 'enumeration') {
    const select = enumerationControl(choice);

    select.className = 'wb-choice-control';
    select.disabled = select.disabled || !!readOnly; // a choice not yet reachable offers nothing either
    select.addEventListener('change', () => onChange(read(select, choice)));

    row.appendChild(select);
  } else {
    const control = spinner(choice, onChange);

    if (readOnly) {
      // what was chosen, not a choice to make: the value reads and copies, and refuses only the edit
      control.querySelectorAll('input').forEach((field) => { field.readOnly = true; });
      control.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    }

    row.appendChild(control);
  }

  notes(choice).forEach((note) => row.appendChild(note));

  return row;
}

/**
 * Which control a choice is made with.
 *
 * The kind is the model's, reported by `describeModel` and carried onto every answer, so a choice is drawn
 * as what it is before a run has said what it may take and does not turn from one control into another as
 * it becomes reachable. Where the model said nothing of it — a host that never asked for a description — it
 * is read from the answer instead, which is right whenever there is an answer to read.
 */
function kindOf(choice) {
  if (choice.kind) {
    return choice.kind;
  }

  return choice.enumeration ? 'enumeration' : 'bounds';
}

/**
 * What the reader is told about a bound that cannot be offered, one note per bound.
 *
 * Each is shown only where the difference survives the precision the control is written to, since a reader
 * comparing what they see cannot act on a difference they cannot see.
 */
function notes(choice) {
  // A choice that admits nothing at all. The engine answers a bounded choice whose grid holds no multiple
  // with an empty enumeration, and an enumerated one whose alternatives all fall away the same way, so the
  // two arrive alike. An empty drop-down would read as a choice not yet answered, which is the opposite of
  // what this is: it is answered, and the answer is that the decision cannot be made.
  if (choice.enumeration && !choice.enumeration.length) {
    return [ text('div', 'wb-choice-note', 'ⓘ No value satisfies this choice.') ];
  }

  if (choice.lowest === undefined) {
    return [];
  }

  const told = [];

  if (shownValue(choice.lowest, choice) > shownValue(choice.lowerBound, choice)) {
    told.push(text('div', 'wb-choice-note', 'ⓘ Numeric imprecision may cause the lower bound to be excluded.'));
  }

  if (shownValue(choice.highest, choice) < shownValue(choice.upperBound, choice)) {
    told.push(text('div', 'wb-choice-note', 'ⓘ Numeric imprecision may cause the upper bound to be excluded.'));
  }

  return told;
}

/**
 * A choice among named values: a drop-down, with nothing chosen until the reader chooses.
 *
 * The first entry is a prompt rather than a value. It is what the control reads before a choice is made,
 * and it is disabled and hidden so that it cannot be chosen and does not stand among the values in the open
 * list: a reader offered it as though it were a value would be offered something the engine would refuse.
 * There is no need for them to reach it by hand either, since a choice is unmade only when an earlier one
 * changes, which clears it.
 *
 * A choice not yet reachable is drawn as the prompt alone, disabled, since what it may take is a question
 * that cannot be asked until the choices before it are made. It reads as the prompt even where a value is
 * held: the store keeps a value while its options are withdrawn, so that a re-answer admitting it can keep
 * it, and a value with no option to stand for cannot be shown by a drop-down at all — telling the control
 * to show it would leave it on no option and render it blank.
 */
function enumerationControl(choice) {
  const select = document.createElement('select'),
        prompt = document.createElement('option'),
        values = choice.enumeration || [];

  // The attribute rather than the property, which is what reflects it: an option's value is the attribute
  // where it carries one and its text where it does not, and setting the attribute says the same thing in
  // every document.
  prompt.setAttribute('value', '');
  prompt.textContent = 'Select value';
  prompt.disabled = true;
  prompt.hidden = true;
  select.appendChild(prompt);

  // The value held, which the control can only read where an option stands for it. The store keeps a value
  // while its options are withdrawn, so that a re-answer admitting it can keep it; a drop-down told to show
  // such a value would be left on no option at all and would read as blank, where the prompt is what it
  // means.
  const chosen = choice.value === undefined ? '' : String(choice.value);

  let selected = prompt;

  values.forEach((value) => {
    const option = document.createElement('option');

    option.setAttribute('value', String(value));
    option.textContent = String(value);

    if (String(value) === chosen) {
      selected = option;
    }

    select.appendChild(option);
  });

  // The option is marked rather than the select assigned: what a select reads is the selectedness of its
  // options, and marking one says it directly.
  selected.selected = true;
  select.disabled = !values.length;

  return select;
}

/**
 * A choice within bounds: a field holding a number, and a pair of arrows walking the values it admits.
 *
 * It is deliberately not an `input` of type number. Such a control has one notion of a value and one grid,
 * declared through `min` and `step` and expressed in the numbers the field itself carries; the grid a choice
 * admits is counted from zero and expressed in the numbers the engine holds, and a reader is shown neither
 * of those but a number rounded to a precision they could have written. Asked to step, the control first
 * moves the value onto its own grid and only then advances, so a press is swallowed where the rounded number
 * lies just below its multiple and a value is skipped where it lies just above, and what it leaves behind is
 * the unrounded number it computed. None of that can be corrected afterwards, the reader having already been
 * shown a value nobody chose. React Aria's number field is a text field with its own arrows for the same
 * reason, and this follows it.
 *
 * So the field is text, marked as a spin button for whoever is not reading it visually, and the walking is
 * done here against the values the choice admits. What the reader types remains theirs to type and is
 * settled only when they are done.
 */
function spinner(choice, onChange) {
  const field = el('div', 'wb-choice-field'),
        control = document.createElement('input'),
        up = arrow('up'),
        down = arrow('down');

  control.type = 'text';
  control.inputMode = 'decimal';
  control.className = 'wb-choice-control';
  control.disabled = choice.lowest === undefined;
  control.setAttribute('role', 'spinbutton');

  if (choice.lowest !== undefined) {
    control.placeholder = `${shownValue(choice.lowest, choice)} … ${shownValue(choice.highest, choice)}`;
    control.setAttribute('aria-valuemin', String(choice.lowest));
    control.setAttribute('aria-valuemax', String(choice.highest));
  }

  // The value the field stands on, which is the one the choice admits rather than the one it reads: what a
  // reader sees is written to the precision they read, and the value itself is held here beside it.
  let held = choice.value;

  const write = (value) => {
    held = value;
    control.value = value === undefined ? '' : String(shownValue(value, choice));
    control.setAttribute('aria-valuenow', value === undefined ? '' : String(value));
    control.setAttribute('aria-valuetext', control.value);

    // An arrow that cannot move is not offered, so a reader at an end of the grid is told they are there
    // rather than left pressing something that does nothing.
    up.disabled = control.disabled || (held !== undefined && held >= choice.highest);
    down.disabled = control.disabled || (held !== undefined && held <= choice.lowest);
  };

  const move = (direction) => {
    write(next(held, direction, choice));
    onChange(held);
    control.focus();
  };

  up.addEventListener('click', () => move(1));
  down.addEventListener('click', () => move(-1));

  control.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return;
    }

    event.preventDefault();
    move(event.key === 'ArrowUp' ? 1 : -1);
  });

  // What the reader wrote is settled when they are done writing it, not while they write: a number is
  // entered a digit at a time, and every prefix of it is a number of its own.
  control.addEventListener('change', () => {
    write(read(control, choice));
    onChange(held);
  });

  write(choice.value);

  field.appendChild(control);

  if (walkable(choice)) {
    field.appendChild(up);
    field.appendChild(down);
    field.classList.add('wb-choice-field-walkable');
  }

  return field;
}

function arrow(direction) {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = `wb-choice-arrow wb-choice-arrow-${direction}`;
  button.tabIndex = -1; // the field is what a reader tabs to, and the arrow keys are what walk it
  button.setAttribute('aria-hidden', 'true');

  return button;
}

/**
 * The value the reader entered, or nothing where the control is empty or holds no number.
 *
 * Whether it is a name or a number is read from the values offered rather than from a declared type: the
 * engine renders each candidate in its attribute's own type, so an enumeration of names arrives as names,
 * and a choice within bounds is a number by construction.
 *
 * A number is settled on the nearest value the choice admits rather than taken as typed. The values admitted
 * are the multiples of the step, and a reader writing to a precision of their own would otherwise enter one
 * lying between two of them: the engine would take it, nothing would refuse it, and the field would go on
 * showing a number that is not the one held. Settling it makes what is shown what is submitted, which is the
 * whole reason the field is written to a reader's precision at all.
 */
function read(control, choice) {
  if (control.value.trim() === '') {
    return undefined;
  }

  const named = (choice.enumeration || []).some((value) => typeof value === 'string');

  if (named) {
    return control.value;
  }

  const entered = Number(control.value);

  return Number.isFinite(entered) ? snap(entered, choice) : undefined;
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
