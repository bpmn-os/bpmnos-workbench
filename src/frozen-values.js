/**
 * The values a token held as it left, drawn as a token entry draws what a token holds.
 *
 * Every archive of a run discloses this: the token a performer performed for, the token that took a message,
 * and the token that made a decision are all gone by the time a reader reads the record, and the execution
 * state forgets a token that is gone. What each kept as the token left is therefore drawn here, in the
 * sections and the lines the execution state's own view uses, and written with that view's own formatter, so
 * that a value read in a record and the same value read while it was current are one value written one way.
 *
 * Nothing is kept current here and nothing needs to be: what is drawn is frozen.
 */

import { createCollapsibleEntry } from 'bpmn-js-side-panel';

import { format } from './execution-state/View.js';

/**
 * @param {Array} held  the sections as `sections(...)` yields them, `{ label, rows: [{ name, value }] }`
 * @param {Element} contentEl  what the sections are drawn into
 */
export default function renderFrozenValues(held, contentEl) {
  if (!held) {
    return;
  }

  held.forEach((section) => {
    const entry = createCollapsibleEntry({ label: section.label, open: true, caretSide: 'left' });

    section.rows.forEach(({ name, value }) => {
      const line = document.createElement('div'),
            nameEl = document.createElement('span'),
            valueEl = document.createElement('span'),
            unset = value === null || value === undefined;

      line.className = 'wb-attribute';
      nameEl.className = 'wb-attribute-name';
      valueEl.className = 'wb-attribute-value' + (unset ? ' wb-attribute-null' : '');
      nameEl.textContent = name;
      valueEl.textContent = unset ? 'undefined' : format(value);
      line.append(nameEl, valueEl);
      entry.contentEl.appendChild(line);
    });

    contentEl.appendChild(entry.element);
  });
}
