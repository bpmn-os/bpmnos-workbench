import { DELETE_ICON } from 'bpmn-js-side-panel';

import createArchiveToggle from '../archive-toggle.js';
import addFilter from '../panel-filter.js';
import { selectionFor } from '../token-rows/select.js';
import createDecisionEntry, { createChoiceRow } from './DecisionEntry.js';

// Font Awesome 6 free, solid, as the Messages tab uses them: the paper plane offers the decision, the
// hourglass says it is with the engine.
const PAPER_PLANE = '<svg viewBox="0 0 512 512" fill="currentColor" aria-hidden="true"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480l0-83.6c0-4 1.5-7.8 4.2-10.8L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/></svg>';

const HOURGLASS = '<svg viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M0 32C0 14.3 14.3 0 32 0L64 0 320 0l32 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l0 11c0 42.4-16.9 83.1-46.9 113.1L237.3 256l67.9 67.9c30 30 46.9 70.7 46.9 113.1l0 11c17.7 0 32 14.3 32 32s-14.3 32-32 32l-32 0L64 512l-32 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l0-11c0-42.4 16.9-83.1 46.9-113.1L146.7 256 78.9 188.1C48.9 158.1 32 117.4 32 75l0-11C14.3 64 0 49.7 0 32zM96 64l0 11c0 25.5 10.1 49.9 28.1 67.9L192 210.7l67.9-67.9c18-18 28.1-42.4 28.1-67.9l0-11L96 64zm0 384l192 0 0-11c0-25.5-10.1-49.9-28.1-67.9L192 301.3l-67.9 67.9c-18 18-28.1 42.4-28.1 67.9l0 11z"/></svg>';

/**
 * The Decisions tab: the decision tasks a run is waiting at, and the choices each is waiting for.
 *
 * While the workbench is modelling the tab says what the Tokens tab says, since a decision is something a
 * run asks for and in Model mode there is no run. While a run is on it shows one entry per decision task
 * waiting, and says that there are none as plainly as the Tokens tab says it of tokens.
 *
 * The panel draws what the store holds and answers what the reader does; obtaining the options of a choice
 * belongs to whoever drives the run, since only an engine standing at the token can evaluate a condition.
 */
export default function DecisionsPanel(injector, eventBus, decisions, config) {
  this._injector = injector;
  this._eventBus = eventBus;
  this._decisions = decisions;
  this._config = config || {};

  this._body = null;
  this._inspector = null;
  this._open = new Map(); // which rows a reader has expanded, kept as the list is drawn again
  this._filter = 'all';
  this._showArchived = true; // whether what the run has answered is listed with what it is still asking
  this._pressed = false;  // a control is under a press, so the list is left alone until it ends
  this._deferred = false; // the store changed while it was, and is to be drawn once it does

  eventBus.on('diagram.init', () => this._init());
  eventBus.on('decisions.changed', () => this._render());
  eventBus.on('mode.changed', () => this._applyNote());

  // A decision row is tinted where its token is selected and the filter selects by what is selected, so
  // the list follows a change of selection whichever the filter is.
  eventBus.on('token.selection.changed', () => this._render());
}

DecisionsPanel.$inject = [ 'injector', 'eventBus', 'decisions', 'config.decisionsPanel' ];

DecisionsPanel.prototype._init = function() {
  const sidePanel = this._injector.get('sidePanel', false);

  if (!sidePanel || this._body) {
    return;
  }

  const { header, body, footer } = sidePanel.addTab({
    id: 'decisions',
    label: this._config.label || 'Decisions',
    // last of the tabs a run concerns: Tokens, then Messages, then Sequences, then this
    priority: this._config.priority != null ? this._config.priority : -3
  });

  this._sidePanel = sidePanel;
  this._tabName = this._config.label || 'Decisions';
  this._band = header;
  this._body = body;

  // What the tab shows of what the run has finished with, at its foot, as the other tabs of a run show it.
  footer.appendChild(createArchiveToggle(
    'the decisions, with the values that were chosen',
    () => this._showArchived,
    (on) => {
      this._showArchived = on;
      this._render();
    }
  ).element);

  this._build();
  this._render();
  this._applyNote();
};

/**
 * The frame of the tab: a heading naming what is listed, above the region the list scrolls in, built from
 * the classes the Tokens tab is built from so that the tabs are one appearance.
 *
 * The filter selects on the token a decision is asked of, which is the one relation the tab holds.
 */
DecisionsPanel.prototype._build = function() {
  const root = document.createElement('div');

  root.className = 'bjs-token';

  const heading = document.createElement('div');

  heading.className = 'bjs-token-list-title bjs-token-filter';

  const name = document.createElement('h1');

  name.className = 'bjs-tab-name';
  name.textContent = this._config.label || 'Decisions';   // the band names the tab

  addFilter(heading, {
    name: 'wb-decision-filter',
    onChange: (value) => {
      this._filter = value;
      this._render();
    }
  });

  this._inspector = document.createElement('div');
  this._inspector.className = 'bjs-token-inspector';

  // While a control is under a press — a spinner held down, an arrow key held down — the list is left
  // alone, and what the store gained is drawn when the press ends. The listeners are on the region rather
  // than on a control, since a control does not survive a redraw and this region does.
  const press = (pressed) => {
    this._pressed = pressed;

    if (!pressed && this._deferred) {
      this._render();
    }
  };

  this._inspector.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.wb-choice-control')) {
      press(true);
    }
  });

  this._inspector.addEventListener('keydown', (event) => {
    if (event.target.closest('.wb-choice-control') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      press(true);
    }
  });

  this._inspector.addEventListener('keyup', () => press(false));
  window.addEventListener('pointerup', () => press(false));

  this._band.append(name, heading);
  root.appendChild(this._inspector);

  this._body.appendChild(root);
};

/** The tokens the reader has selected, as the animation names them: the label carried, the node stood at. */
DecisionsPanel.prototype._selected = function() {
  const primitives = this._injector.get('primitives', false);

  return new Set(primitives ? primitives.getSelectedTokens().map((token) => `${token.label}|${token.node}`) : []);
};

/** The colour of the token standing at the decision, where the animation has drawn one. */
DecisionsPanel.prototype._colorOf = function(decision) {
  const primitives = this._injector.get('primitives', false),
        drawn = primitives && primitives.getTokens()
          .find((token) => token.label === decision.instanceId && token.node === decision.nodeId);

  return drawn && drawn.color;
};

/**
 * Where the reader was writing, so that a redraw can put them back.
 *
 * This tab is the only one whose rows are written into rather than only read, and it is redrawn whenever
 * the store changes — which includes the reader's own entry, and the walk that answers what the choices may
 * take once the diagram has caught up. A redraw that dropped the caret would take the reader's place in a
 * number they were half way through typing.
 *
 * A control is identified by the decision and the choice it belongs to rather than by the element, since
 * the element itself does not survive the redraw.
 */
DecisionsPanel.prototype._writing = function() {
  const active = document.activeElement,
        row = active && active.closest && active.closest('.wb-choice'),
        entry = row && row.closest('[data-entry-id]');

  if (!row || !entry || !this._inspector.contains(row)) {
    return null;
  }

  return {
    key: entry.getAttribute('data-entry-id'),
    index: [ ...entry.querySelectorAll('.wb-choice') ].indexOf(row),
    start: active.selectionStart,
    end: active.selectionEnd
  };
};

/** Put the reader back where they were writing, where that control is still drawn. */
DecisionsPanel.prototype._restore = function(writing) {
  if (!writing) {
    return;
  }

  const entry = this._inspector.querySelector(`[data-entry-id="${CSS.escape(writing.key)}"]`),
        row = entry && entry.querySelectorAll('.wb-choice')[writing.index],
        control = row && row.querySelector('.wb-choice-control');

  if (!control || control.disabled) {
    return; // the choice is gone, or is no longer one the reader may make
  }

  control.focus();

  if (writing.start !== null && writing.start !== undefined && control.setSelectionRange) {
    try {
      control.setSelectionRange(writing.start, writing.end);
    } catch (err) {
      // a number input refuses a selection in some browsers; the focus is what matters
    }
  }
};

/**
 * Say in the tab's own name how much it holds, as the Tokens and Issues tabs do: the name is what both views
 * show, a selector in one and a column's resizer in the other, so a run can be followed while another column
 * is open. The count is dropped when there is nothing, a name reading "(0)" being noise rather than news.
 */
DecisionsPanel.prototype._updateTabName = function(shown) {
  if (!this._sidePanel) {
    return;
  }

  this._sidePanel.setTabLabel('decisions', shown ? this._tabName + ' (' + shown + ')' : this._tabName);
};

DecisionsPanel.prototype._render = function() {
  if (!this._inspector) {
    return;
  }

  // A control the reader is operating is not drawn again while they operate it. The list is rebuilt from
  // the store on every change, the reader's own entry among them, and a spinner held down is a press on one
  // element: rebuilding takes that element away mid-press, so the arrow stops wherever the rebuild caught
  // it and the value stands somewhere between the one the reader started from and the one they were going
  // to. What the store gained in the meantime is drawn once the press ends, which is the first moment the
  // reader can read it in any case.
  if (this._pressed) {
    this._deferred = true;

    return;
  }

  this._deferred = false;

  const writing = this._writing();

  this._inspector.innerHTML = '';

  // A decision the run has answered is held whether or not it is listed, so what is dropped here is dropped
  // from the showing alone.
  const held = this._decisions.all().filter((decision) => this._showArchived || !decision.archived),
        selected = this._selected(),
        shown = this._filter === 'selected'
          ? held.filter((decision) => selected.has(decision.key))
          : held;

  this._updateTabName(shown.length);

  if (!shown.length) {
    const hint = document.createElement('div');

    hint.className = 'bjs-token-empty';
    hint.textContent = held.length ? 'No matching decisions.' : 'No decisions.';

    this._inspector.appendChild(hint);
    this._restore(writing);

    return;
  }

  shown.forEach((decision) => {

    // the token standing at the decision task, where the animation has drawn one: a click on the row
    // selects it, and the row is tinted while it is selected
    const selection = selectionFor(this._injector, this._eventBus, decision);

    const entry = createDecisionEntry({
      key: decision.key,
      nodeId: decision.nodeId,
      instanceId: decision.instanceId,
      color: this._colorOf(decision)
    }, {
      open: this._open.get(decision.key) === true,
      onToggle: (open) => this._open.set(decision.key, open),
      control: decision.archived ? this._forget(decision) : this._offer(decision),
      body: this._body_(decision),
      onClick: selection && selection.onClick,
      archived: !!decision.archived
    });

    if (selection) {
      entry.element.classList.toggle('bjs-token-selected', selection.selected);
    }

    this._inspector.appendChild(entry.element);
  });

  this._restore(writing);
};

/**
 * What the expanded row shows: what the token holds, drawn by the host so that a token reads the same
 * wherever it is shown, and beneath it one pair of rows per choice.
 */
DecisionsPanel.prototype._body_ = function(decision) {
  const body = document.createElement('div'),
        host = (this._injector.get('config.tokenPanel', false) || {}).renderTokenDetail;

  if (host) {
    host({ label: decision.instanceId, node: decision.nodeId }, body);
  }

  const choices = document.createElement('div');

  choices.className = 'wb-choices';
  choices.appendChild(title(decision.choices.length ? 'Choices' : 'No choices'));

  decision.choices.forEach((choice, index) => {
    choices.appendChild(createChoiceRow(choice, (value) => {
      this._decisions.setValue(decision.key, index, value);
    }, !!decision.archived));
  });

  body.appendChild(choices);

  return body;
};

/** The offer to forget one archived decision, which is the only decision a reader may take away. */
DecisionsPanel.prototype._forget = function(decision) {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = 'bjs-collapsible-entry-control wb-forget';
  button.title = 'Forget this decision';
  button.innerHTML = DELETE_ICON;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    this._decisions.forget(decision.key);
  });

  return button;
};

/**
 * The offer: a paper plane while every choice has been made, an hourglass once it is with the engine, and
 * neither while a choice is still to be made — an offer that cannot be taken is not made.
 */
DecisionsPanel.prototype._offer = function(decision) {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = 'bjs-collapsible-entry-control wb-submit';

  if (decision.awaited) {
    button.title = 'Decision pending';
    button.innerHTML = HOURGLASS;
    button.disabled = true;

    return button;
  }

  button.title = 'Submit choices';
  button.innerHTML = PAPER_PLANE;
  button.disabled = !this._decisions.submittable(decision.key);
  button.addEventListener('click', () => this._submit(decision));

  return button;
};

/**
 * Asks the run to take these choices. The decision is announced rather than performed: the source driving
 * the engine listens, enqueues it, and the engine takes it when it reaches it.
 */
DecisionsPanel.prototype._submit = function(decision) {
  this._decisions.await_(decision.key);

  this._eventBus.fire('manual.decide', {
    event: 'choice',
    payload: {
      instanceId: decision.instanceId,
      nodeId: decision.nodeId,
      choices: this._decisions.values(decision.key)
    }
  });
};

DecisionsPanel.prototype._applyNote = function() {
  const sidePanel = this._injector.get('sidePanel', false),
        mode = this._injector.get('mode', false),
        note = this._config.modelNote;

  if (!sidePanel || !note || !this._body) {
    return;
  }

  sidePanel.setNote('decisions', !mode || mode.getMode() === 'model' ? note : null);
};

function title(string) {
  const node = document.createElement('div');

  node.className = 'bjs-token-list-title';
  node.textContent = string;

  return node;
}
