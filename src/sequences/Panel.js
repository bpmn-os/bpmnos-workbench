import {
  createCollapsibleEntry, createOrderedListEntry, createSimpleEntry, DELETE_ICON
} from 'bpmn-js-side-panel';

import { processOf, tokenAt } from '../animation-tokens.js';
import addFilter from '../panel-filter.js';
import { selectionFor } from '../token-rows/select.js';
import { DIVIDER } from './Store.js';
import createPerformerEntry from './PerformerEntry.js';

/** What the divider says it does, which is the whole of what the order means. */
const DIVIDER_LABEL = 'Tokens above enter activity automatically';

// The key the keeping stands under in a performer's list. It is no token, so it is named rather than keyed
// by one, and the ordered list holds it fixed at the head where it takes no part in the order.
const KEEP = '\u0000keep';

/**
 * The Sequences tab: the sequential performers of a run, and the order each is to work through.
 *
 * While the workbench is in Model mode the tab says what the Tokens tab says, since a performer is
 * something a run has and in Model mode there is no run: the note is the host's, given as
 * `config.sequencesPanel.modelNote`, so that the tabs a run concerns say the same thing in the same words.
 *
 * A performer is one row, collapsed, and expanding it shows what it holds as one ordered list: the token it
 * is conducting or has been given, fixed at the head and taking no part in the order, then the tokens
 * waiting under it, and the divider among them. The arrows belong to that list rather than to the rows, so
 * what the reader does is move a row and what the panel does is record where it landed.
 *
 * What is listed is what the canvas shows, and the tab needs to do nothing to make it so: the store is
 * written by the player as it draws, so a performer is there from the moment its token stands at its node,
 * at first with nothing under it, and a token appears in its list as it becomes ready.
 */
export default function SequencesPanel(injector, eventBus, sequences, config) {
  this._injector = injector;
  this._eventBus = eventBus;
  this._sequences = sequences;
  this._config = config || {};

  this._body = null;
  this._inspector = null;
  this._open = new Map(); // which performers a reader has expanded, kept as the list is drawn again
  this._filter = 'all';   // which performers are listed: all of them, or those a selected token concerns

  eventBus.on('diagram.init', () => this._init());
  eventBus.on('sequences.changed', () => this._render());
  eventBus.on('mode.changed', () => this._applyNote());

  // A performer row is tinted where its token is selected and the filter selects by what is selected, so
  // the list follows a change of selection whichever the filter is.
  eventBus.on('token.selection.changed', () => this._render());
}

SequencesPanel.$inject = [ 'injector', 'eventBus', 'sequences', 'config.sequencesPanel' ];

SequencesPanel.prototype._init = function() {
  const sidePanel = this._injector.get('sidePanel', false);

  if (!sidePanel || this._body) {
    return; // no side panel, or the tab is up already
  }

  const { header, body } = sidePanel.addTab({
    id: 'sequences',
    label: this._config.label || 'Sequences',
    priority: this._config.priority != null ? this._config.priority : -2
  });

  this._sidePanel = sidePanel;
  this._tabName = this._config.label || 'Sequences';
  this._band = header;
  this._body = body;
  this._build();
  this._render();
  this._applyNote();
};

/**
 * The frame of the tab: a heading naming what is listed, above the region the list scrolls in, built from
 * the classes the Tokens tab is built from so that the two are one appearance.
 */
SequencesPanel.prototype._build = function() {
  const root = document.createElement('div');

  root.className = 'bjs-token';

  const heading = document.createElement('div');

  heading.className = 'bjs-token-list-title bjs-token-filter';

  const name = document.createElement('h1');

  name.className = 'bjs-tab-name';
  name.textContent = this._config.label || 'Sequences';   // the band names the tab

  // The filter says which performers are listed and nothing about what a listed one shows. A performer's
  // list is an order, and an order shown in part is no order: an arrow would move a token past neighbours
  // the reader cannot see. What it selects on is the performer's own token, the tokens of its list, and the
  // ad hoc sub-processes it performs for.
  addFilter(heading, {
    name: 'wb-sequence-filter',
    onChange: (value) => {
      this._filter = value;
      this._render();
    }
  });



  this._inspector = document.createElement('div');
  this._inspector.className = 'bjs-token-inspector';

  this._band.append(name, heading);
  root.appendChild(this._inspector);

  this._body.appendChild(root);
};

/**
 * Draw what the tab shows: a row per performer, or, where none is, the sentence the Tokens tab shows of
 * tokens, in the Tokens tab's own words and its own class.
 */
/**
 * Say in the tab's own name how much it holds, as the Tokens and Issues tabs do: the name is what both views
 * show, a selector in one and a column's resizer in the other, so a run can be followed while another column
 * is open. The count is dropped when there is nothing, a name reading "(0)" being noise rather than news.
 */
SequencesPanel.prototype._updateTabName = function() {
  if (!this._sidePanel) {
    return;
  }

  const held = this._sequences.all().length;

  this._sidePanel.setTabLabel('sequences', held ? this._tabName + ' (' + held + ')' : this._tabName);
};

SequencesPanel.prototype._render = function() {
  this._updateTabName();

  if (!this._inspector) {
    return;
  }

  this._inspector.innerHTML = '';

  const held = this._sequences.all(),
        performers = this._filter === 'selected' ? held.filter((one) => this._concerns(one)) : held;

  if (!performers.length) {
    const hint = document.createElement('div');

    hint.className = 'bjs-token-empty';
    hint.textContent = held.length ? 'No matching performer.' : 'No performers.';

    this._inspector.appendChild(hint);

    return;
  }

  performers.forEach((performer) => {
    // the token standing at the performing node, where the animation has drawn one: a click on the row
    // selects it, and the row is tinted while it is selected
    const selection = selectionFor(this._injector, this._eventBus, {
      instanceId: performer.label,
      nodeId: performer.node
    });

    const entry = createPerformerEntry(this._summary(performer), {
      open: this._open.get(performer.key) === true,
      onToggle: (open) => this._open.set(performer.key, open),
      body: this._list(performer),
      onClick: selection && selection.onClick
    });

    if (selection) {
      entry.element.classList.toggle('bjs-token-selected', selection.selected);
    }

    this._inspector.appendChild(entry.element);
  });
};

/** The animation's token for one the store holds, where it has drawn one. */
SequencesPanel.prototype._token = function({ label, node }) {
  return tokenAt(
    this._injector.get('primitives', false),
    this._injector.get('elementRegistry', false),
    label, node
  );
};

/** The bar that says whether what a performer has done is kept in its list, as the Tokens tab draws one. */
/**
 * Whether this performer keeps what has left it, standing at the head of its list and taking no part in the
 * order.
 *
 * It is a performer's own because a record is: what one performer did is no business of another, and a
 * reader recapping one order has no reason to forget the rest. It stands in the list rather than over the
 * tab for the same reason, and it is drawn as a bar rather than as a row so that it does not read as a token
 * the performer is to work on. What is asked for last is what a performer opened later is born with.
 */
SequencesPanel.prototype._keepArchived = function(performer) {
  const bar = document.createElement('label'),
        toggle = document.createElement('span'),
        box = document.createElement('input'),
        slider = document.createElement('span'),
        label = document.createElement('span');

  bar.className = 'bjs-token-header wb-performer-keep';
  toggle.className = 'bjs-token-toggle';
  slider.className = 'bjs-token-toggle-slider';
  box.type = 'checkbox';
  box.checked = this._sequences.isKeepingArchived(performer.key);
  box.addEventListener('change', () => this._sequences.keepArchived(performer.key, box.checked));
  label.textContent = 'Keep archived tokens';

  toggle.append(box, slider);
  bar.append(toggle, label);

  return bar;
};

/**
 * Whether a selection concerns this performer, which is what the filter selects on: its own token, a token
 * of its list, and a token standing at an ad hoc sub-process it performs for. Selecting a performer shows
 * that performer, selecting an activity token shows where it queues, and selecting the sub-process shows
 * the performer that performs for it. A token elsewhere in the same process is no business of this
 * performer's, whatever it stands under.
 */
SequencesPanel.prototype._concerns = function(performer) {
  const primitives = this._injector.get('primitives', false),
        token = this._token(performer),
        scopes = this._scopes(performer),
        listed = new Set([ ...performer.tokens.values() ].map(({ label, node }) => `${label}|${node}`));

  if (!primitives) {
    return false;
  }

  return primitives.getSelectedTokens().some((selected) => {
    if (token && selected === token) {
      return true; // the performer's own token
    }

    if (listed.has(`${selected.label}|${selected.node}`)) {
      return true; // a token of its list, queued, conducted or archived
    }

    // a token standing at an ad hoc sub-process this performer performs for, which is the scope its list is
    // drawn from. Everything else in the process is no business of this performer's, however near it stands.
    return scopes.has(selected.node) && this._within(selected, token);
  });
};

/** The ad hoc sub-processes a performer performs for: the scopes its sequential activities sit in. */
SequencesPanel.prototype._scopes = function(performer) {
  const registry = this._injector.get('elementRegistry', false),
        scopes = new Set();

  if (!registry) {
    return scopes;
  }

  this._sequences.activitiesOf(performer.node).forEach((activity) => {
    const element = registry.get(activity),
          parent = element && element.parent;

    if (parent && parent.id) {
      scopes.add(parent.id);
    }
  });

  return scopes;
};

/** Whether a token stands beneath another in the run's own token tree. */
SequencesPanel.prototype._within = function(token, ancestor) {
  const animation = this._injector.get('animation', false);

  if (!ancestor || !animation) {
    return false;
  }

  let candidate = animation.getParent(token);

  while (candidate) {
    if (candidate === ancestor) {
      return true;
    }
    candidate = animation.getParent(candidate);
  }

  return false;
};

/**
 * What the collapsed row says of a performer: the node it stands at, named as the Tokens tab names it, the
 * instance standing there, and the colour of that token where the animation has drawn one.
 */
SequencesPanel.prototype._summary = function(performer) {
  return {
    key: performer.key,
    node: this._displayNode(performer.node),
    instanceId: performer.label,
    color: this._color(performer),
    kind: this._kind(performer.node)
  };
};

/**
 * Which of the three a performer is, which is what it is drawn as: the process it stands for where its node
 * is a pool or a process, and otherwise the sub-process or the ad hoc sub-process it names.
 */
SequencesPanel.prototype._kind = function(node) {
  const registry = this._injector.get('elementRegistry', false),
        element = node && registry && registry.get(node),
        type = element && element.businessObject && element.businessObject.$type;

  if (type === 'bpmn:Participant' || type === 'bpmn:Process' || !type) {
    return 'process';
  }

  return type === 'bpmn:SubProcess' ? 'subProcess' : 'adHocSubProcess';
};

/**
 * The performer's list: one ordered list holding the fixed entry, the waiting tokens and the divider, in
 * the order the store holds. What the reader moves is recorded in the store, which is what a later report
 * is read against.
 */
SequencesPanel.prototype._list = function(performer) {
  const list = createOrderedListEntry({
    id: performer.key,
    side: 'left',
    onReorder: (keys) => this._sequences.setOrder(performer.key, keys)
  });

  // What the performer keeps, at the head of its list and fixed there: it governs the list rather than
  // standing in it, so nothing may be moved above it and it moves nowhere itself.
  list.add(KEEP, this._keepArchived(performer), undefined, { fixed: true });

  performer.order.forEach((key) => {
    if (key === DIVIDER) {
      list.add(key, divider());

      return;
    }

    const archived = performer.archived.has(key),
          settled = archived || key === performer.conducting || key === performer.committed,
          row = this._row(performer, key, archived);

    if (row) {
      // A settled row takes no part in the order: what has been offered cannot be taken back, what is being
      // conducted is under way, and what is archived is done. The first is still to come, so it keeps its
      // weight; the other two are greyed, being what the performer is doing or has done.
      row.classList.toggle('wb-performer-fixed', archived || key === performer.conducting);
      list.add(key, row, undefined, { fixed: settled });
    }
  });

  list.element.classList.add('wb-performer-list');

  return list.element;
};

/**
 * One token of a performer's list, drawn as the Tokens tab draws it and kept current by the service that
 * draws it for every panel. The row is held under the performer and the token together, one token standing
 * in the list of one performer while another token of the same instance may stand in another, and one
 * element being unable to stand in two lists.
 */
SequencesPanel.prototype._row = function(performer, key, archived) {
  const tokenRows = this._injector.get('tokenRows', false),
        identity = performer.tokens.get(key);

  if (!tokenRows || !identity) {
    return null;
  }

  // the row is the Tokens tab's row, which names a token by the instance it belongs to and the node it
  // stands at. It is made once and kept, so what it carries is mounted here rather than given at its
  // making: a row becomes archived long after it was drawn, and only an archived row offers to be
  // forgotten, that costing the run nothing.
  // An archived row is a record rather than a token, so it is a row of its own: the run holds nothing of
  // that token any more, and the values it discloses are the ones frozen as it left.
  const row = archived
    ? tokenRows.create(`${performer.key}|${key}|archived`, {
      instanceId: identity.label,
      nodeId: identity.node
    }, {
      frozen: true,
      detail: (token, contentEl) => this._frozen(performer, key, contentEl)
    })
    : tokenRows.create(`${performer.key}|${key}`, {
      instanceId: identity.label,
      nodeId: identity.node
    });

  if (row.controlsEl) {
    row.controlsEl.innerHTML = '';

    if (archived) {
      row.controlsEl.appendChild(this._forget(performer, key));
    }
  }

  return row.element;
};

/**
 * What an archived row discloses: the values the token held as it left, in the sections a token entry shows
 * them in, drawn as the execution state's own view draws them. They are frozen, so nothing is kept current
 * here and nothing needs to be.
 */
SequencesPanel.prototype._frozen = function(performer, key, contentEl) {
  const held = this._sequences.archivedValues(performer.key, key);

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
      valueEl.textContent = unset ? 'undefined' : String(value);
      line.append(nameEl, valueEl);
      entry.contentEl.appendChild(line);
    });

    contentEl.appendChild(entry.element);
  });
};

/** The offer to forget one archived row, which is the only row a reader may take away. */
SequencesPanel.prototype._forget = function(performer, key) {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = 'bjs-collapsible-entry-control wb-forget';
  button.title = 'Forget this token';
  button.innerHTML = DELETE_ICON;
  button.addEventListener('click', () => this._sequences.forget(performer.key, key));

  return button;
};

/** The colour the animation draws that token in, where it has drawn it. */
SequencesPanel.prototype._color = function(identity) {
  const drawn = this._token(identity);

  return drawn ? drawn.color : null;
};

/** A pool shows the process it stands for, as the Tokens tab shows it. */
SequencesPanel.prototype._displayNode = function(id) {
  const registry = this._injector.get('elementRegistry', false),
        element = id && registry && registry.get(id),
        businessObject = element && element.businessObject;

  return (businessObject && businessObject.processRef && businessObject.processRef.id) || id;
};

/**
 * The note shown in place of the tab's content while the workbench is modelling. The mode service is
 * optional, as it is to every part of this application: without one there is no Model mode to be in.
 */
SequencesPanel.prototype._applyNote = function() {
  const sidePanel = this._injector.get('sidePanel', false),
        mode = this._injector.get('mode', false),
        note = this._config.modelNote;

  if (!sidePanel || !note || !this._body) {
    return;
  }

  sidePanel.setNote('sequences', !mode || mode.getMode() === 'model' ? note : null);
};

/** The divider: a row of the list like any other, saying what standing above it means. */
function divider() {
  const entry = createSimpleEntry({ content: DIVIDER_LABEL });

  entry.element.classList.add('wb-performer-divider');

  return entry.element;
}
