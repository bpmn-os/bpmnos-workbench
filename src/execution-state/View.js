import { createCollapsibleEntry } from 'bpmn-js-side-panel';

import sections from './sections.js';

/**
 * The view of what a token holds: the body of a token entry, drawn from a node and a label alone.
 *
 * It is typed on those two strings rather than on an animation token, so a host adapts in one expression,
 * `renderDetail: (token, element) => view.render(token.node, token.label, element)`. That keeps it usable
 * from any list of tokens, the Tokens tab today and the message and sequence panels foreseen after it, and
 * testable without a diagram.
 *
 * Three sections, status, data and globals, each an independently collapsible entry of
 * `bpmn-js-side-panel`, listing one line per attribute with its name and its value. The detail is panel
 * content and is built from the panel's own primitives, so it reads as part of the panel it sits in rather
 * than as a transplanted canvas annotation. What is shown is settled by {@link sections}.
 *
 * **Keeping a shown value current is the view's own work.** A token entry never updates itself, and a panel
 * is told nothing when a value changes, since nothing in a row's summary is derived from one. The view
 * therefore holds one subscription to the store, remembers the bodies it has drawn, and on each
 * announcement writes the new text into the elements carrying the values rather than rebuilding the body
 * around them. Writing in place keeps what lives in that DOM, a selection, the focus, a transition in
 * progress, and costs what the values on show cost rather than what the body costs. A body is rebuilt only
 * when it is drawn afresh, which the panel forces by clearing it before calling the renderer, and which is
 * also the only occasion on which the set of attributes can change, that set being a property of the node.
 *
 * The collapsed state of the sections is held here rather than in the DOM, since a body is cleared and
 * redrawn whenever the panel refreshes a row, for a cue as readily as for a hop, and a section collapsed by
 * hand would otherwise spring open again for reasons that have nothing to do with the reader. It is kept
 * per token and section, so it follows a token as it moves.
 *
 * Styling lives in `execution-state.css`, which a host imports as it imports the side panel's own.
 */
export default function createExecutionStateView(executionData, executionState) {

  // one record per body drawn: the element, what it was drawn for, the elements carrying each value, and
  // the store entries it reads, so that an announcement touching none of them costs nothing
  let bodies = [];

  // collapsed state, by token and section, surviving every redrawing of a body
  const open = new Map();

  const isOpen = (label, category) => {
    const key = label + '|' + category;

    return open.has(key) ? open.get(key) : true; // a section opens the first time it is drawn
  };

  /**
   * Draw the body of a token entry into `element`, which the caller has emptied.
   *
   * @param {String} node     the node the token rests at, or the process for a token carrying no node
   * @param {String} label    the token's label, which is the engine's instance identifier
   * @param {Element} element the body to draw into
   */
  function render(node, label, element) {
    const values = new Map();

    sections(executionData, executionState, node, label).forEach((section) => {
      const entry = createCollapsibleEntry({
        id: 'execution-state-' + section.category,
        label: section.label,
        open: isOpen(label, section.category),
        caretSide: 'left',
        onToggle: (state) => open.set(label + '|' + section.category, state)
      });

      entry.element.classList.add('wb-execution-state-section');

      section.rows.forEach((row) => {
        const line = document.createElement('div');
        const name = document.createElement('span');
        const value = document.createElement('span');

        line.className = 'wb-attribute';
        name.className = 'wb-attribute-name';
        value.className = 'wb-attribute-value';

        name.textContent = row.name;
        name.title = row.name;
        write(value, row.value);

        line.appendChild(name);
        line.appendChild(value);
        entry.contentEl.appendChild(line);

        values.set(row.id, value);
      });

      element.appendChild(entry.element);
    });

    // a body drawn again into the same element replaces what was recorded for it
    bodies = bodies.filter((body) => body.element !== element);
    bodies.push({ element, node, label, values, reads: executionState.dependencies(node, label) });
  }

  // Bring every body up to date that reads an entry the store has just touched, writing values in place.
  // A body no longer in the document is dropped here, which is the whole of the teardown: the library
  // offers none, and a body still shown is recorded afresh by the very call that redraws it.
  function apply(changed) {
    bodies = bodies.filter((body) => body.element.isConnected !== false);

    bodies.forEach((body) => {
      if (!touches(body.reads, changed)) {
        return;
      }

      sections(executionData, executionState, body.node, body.label).forEach((section) =>
        section.rows.forEach((row) => {
          const value = body.values.get(row.id);

          if (value) {
            write(value, row.value);
          }
        }));
    });
  }

  const unsubscribe = executionState.on(apply);

  return {
    render,

    /** Drop every body and stop listening. */
    destroy() {
      unsubscribe();
      bodies = [];
      open.clear();
    }
  };
}

// whether a body reads any of the entries an announcement names
function touches(reads, changed) {
  for (const key of changed) {
    if (reads.has(key)) {
      return true;
    }
  }

  return false;
}

/**
 * Write a value into the element carrying it.
 *
 * A value the store does not hold reads as null, in its own class, and the three ways of not holding one are
 * not distinguished: the reader of a token entry is told the same thing by each. Everything else is shown as
 * the engine reports it, a boolean, a number, a string or a collection, with one liberty taken: a number
 * that is not whole is shown to two decimal places. The engine's decimals are a fixed-point type whose
 * arithmetic leaves a long tail of digits that says nothing about the run and would push everything else out
 * of a panel this narrow. A whole number keeps its own form, so a count reads as a count.
 */
function write(element, value) {
  element.classList.toggle('wb-attribute-null', value === null || value === undefined);
  element.textContent = format(value);
  element.title = element.textContent;
}

const DECIMALS = 2;

function format(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(DECIMALS);
  }

  // a collection is shown as its members, each formatted as it would be on its own
  if (Array.isArray(value)) {
    return '[' + value.map(format).join(', ') + ']';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
