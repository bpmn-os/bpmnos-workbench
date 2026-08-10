import DecisionStore, { keyOf } from './Store.js';
import DecisionsPanel from './Panel.js';

/**
 * Decisions — the decision tasks a run is waiting at, as a diagram-js service.
 *
 * The store itself is plain and knows nothing of a diagram. The player writes it as it replays a choice
 * request, so a decision appears at the moment the diagram shows the token standing at the task, and goes
 * when the record answering it is reached.
 *
 * What a choice may take is the one thing the records do not say, since only an engine standing at the
 * token can evaluate a condition against the status, the data and the globals it then holds. That answer is
 * obtained through whatever drives the run, and written back here position by position. In a manual
 * simulation nothing changes without the reader, so the answers are asked for again when the player says it
 * has drawn everything the engine has done, which is the moment before the reader can act.
 *
 * A change is announced rather than pushed, so that the tab, and anything else reading the store, draws
 * from the store rather than from the record that changed it.
 */
export class Decisions extends DecisionStore {

  constructor(eventBus) {
    super();

    this._eventBus = eventBus;

    // The braces matter: a listener returning a value is a listener that has answered the event, and
    // diagram-js stops the event there.
    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
      this.clear();
    });
  }

  open(instanceId, nodeId) {
    return this._announce(super.open(instanceId, nodeId));
  }

  close(instanceId, nodeId) {
    return this._announce(super.close(instanceId, nodeId));
  }

  setOptions(key, index, options) {
    return this._announce(super.setOptions(key, index, options));
  }

  /**
   * A value the reader entered, announced twice over.
   *
   * `decisions.changed` says the store holds something else, which is what a panel draws from.
   * `decisions.selected` says the reader chose, which is a different fact and the one that matters to
   * whoever answers what the choices may take: the values selected are that answer's input, so choosing is
   * exactly the moment to ask again. It is announced separately so that the asking, which writes the
   * options back into this store, does not set itself off.
   */
  setValue(key, index, value) {
    const changed = this._announce(super.setValue(key, index, value));

    if (changed) {
      this._eventBus.fire('decisions.selected', { key, index });
    }

    return changed;
  }

  clearFrom(key, index) {
    return this._announce(super.clearFrom(key, index));
  }

  await_(key) {
    return this._announce(super.await_(key));
  }

  forget(key) {
    return this._announce(super.forget(key));
  }

  clear() {
    return this._announce(super.clear());
  }

  _announce(changed) {
    if (changed) {
      this._eventBus.fire('decisions.changed', {});
    }

    return changed;
  }
}

Decisions.$inject = [ 'eventBus' ];

/**
 * The decisions module: the store of the decision tasks waiting, and the tab that shows them.
 */
export default {
  __init__: [ 'decisions', 'decisionsPanel' ],
  decisions: [ 'type', Decisions ],
  decisionsPanel: [ 'type', DecisionsPanel ]
};

export { default as DecisionStore, keyOf } from './Store.js';
export { default as DecisionsPanel } from './Panel.js';
export { default as createDecisionEntry, createChoiceRow } from './DecisionEntry.js';
