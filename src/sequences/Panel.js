import { createOrderedListEntry, createSimpleEntry } from 'bpmn-js-side-panel';

import addFilter from '../panel-filter.js';
import { DIVIDER } from './Store.js';
import createPerformerEntry from './PerformerEntry.js';

/** What the divider says it does, which is the whole of what the order means. */
const DIVIDER_LABEL = 'Tokens above enter activity automatically';

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

  // the filter selects by what the reader has selected, so the list follows a change of selection
  eventBus.on('token.selection.changed', () => {
    if (this._filter === 'selected') {
      this._render();
    }
  });
}

SequencesPanel.$inject = [ 'injector', 'eventBus', 'sequences', 'config.sequencesPanel' ];

SequencesPanel.prototype._init = function() {
  const sidePanel = this._injector.get('sidePanel', false);

  if (!sidePanel || this._body) {
    return; // no side panel, or the tab is up already
  }

  const { body } = sidePanel.addTab({
    id: 'sequences',
    label: this._config.label || 'Sequences',
    priority: this._config.priority != null ? this._config.priority : -2
  });

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

  const title = document.createElement('span');

  title.textContent = 'Performers';
  heading.appendChild(title);

  // The filter says which performers are listed and nothing about what a listed one shows. A performer's
  // list is an order, and an order shown in part is no order: an arrow would move a token past neighbours
  // the reader cannot see.
  addFilter(heading, {
    name: 'wb-sequence-filter',
    onChange: (value) => {
      this._filter = value;
      this._render();
    }
  });

  this._inspector = document.createElement('div');
  this._inspector.className = 'bjs-token-inspector';

  root.appendChild(heading);
  root.appendChild(this._inspector);

  this._body.appendChild(root);
};

/**
 * Draw what the tab shows: a row per performer, or, where none is, the sentence the Tokens tab shows of
 * tokens, in the Tokens tab's own words and its own class.
 */
SequencesPanel.prototype._render = function() {
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
    const entry = createPerformerEntry(this._summary(performer), {
      open: this._open.get(performer.key) === true,
      onToggle: (open) => this._open.set(performer.key, open),
      body: this._list(performer)
    });

    this._inspector.appendChild(entry.element);
  });
};

/**
 * Whether a selection concerns this performer, which is what the filter selects on: any token its row
 * shows, its own, the one it conducts and the ones waiting under it. Selecting a performer therefore shows
 * that performer, and selecting a token shows wherever that token is waiting, which is the question a
 * reader of a scheduling model more often has.
 */
SequencesPanel.prototype._concerns = function(performer) {
  const primitives = this._injector.get('primitives', false),
        selected = new Set((primitives ? primitives.getSelectedTokens() : [])
          .map((token) => `${token.label}|${token.node || ''}`));

  return [ performer.performer, ...performer.tokens.values() ]
    .some((identity) => selected.has(`${identity.instanceId}|${identity.nodeId || ''}`));
};

/**
 * What the collapsed row says of a performer: the node it stands at, named as the Tokens tab names it, the
 * instance standing there, and the colour of that token where the animation has drawn one.
 */
SequencesPanel.prototype._summary = function(performer) {
  const identity = performer.performer || {};

  return {
    key: performer.key,
    node: this._displayNode(identity.nodeId) || identity.processId,
    instanceId: identity.instanceId,
    color: this._color(identity),
    kind: this._kind(identity)
  };
};

/**
 * Which of the three a performer is, which is what it is drawn as. A token carrying no node stands at the
 * process, and one carrying a node stands at the sub-process or the ad hoc sub-process it names. Where no
 * registry answers, the ad hoc sub-process is the safe reading, a model without a performer of its own
 * having every ad hoc sub-process perform for itself.
 */
SequencesPanel.prototype._kind = function({ nodeId }) {
  const registry = this._injector.get('elementRegistry', false),
        element = nodeId && registry && registry.get(nodeId),
        type = element && element.businessObject && element.businessObject.$type;

  if (!nodeId || type === 'bpmn:Participant' || type === 'bpmn:Process') {
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

  performer.order.forEach((key) => {
    if (key === DIVIDER) {
      list.add(key, divider());

      return;
    }

    const row = this._row(performer, key);

    if (row) {
      list.add(key, row, undefined, { fixed: key === performer.fixed });
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
SequencesPanel.prototype._row = function(performer, key) {
  const tokenRows = this._injector.get('tokenRows', false),
        identity = performer.tokens.get(key);

  if (!tokenRows || !identity) {
    return null;
  }

  return tokenRows.create(`${performer.key}|${key}`, identity).element;
};

/** The colour the animation draws that token in, where it has drawn it. */
SequencesPanel.prototype._color = function({ instanceId, nodeId }) {
  const primitives = this._injector.get('primitives', false),
        drawn = primitives && primitives.getTokens()
          .find((token) => token.label === instanceId && token.node === (nodeId || token.node));

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
  const entry = createSimpleEntry({ label: DIVIDER_LABEL });

  entry.element.classList.add('wb-performer-divider');

  return entry.element;
}
