import collectPerformers from './performers.js';
import SequenceStore, { DIVIDER, keyOf } from './Store.js';
import SequencesPanel from './Panel.js';

/**
 * Sequences — the sequential performers of a run and the order each is to work through, as a diagram-js
 * service.
 *
 * The store itself is plain and knows nothing of a diagram. Two things tie it to a running one, and both
 * are the run's own doing: the player applies each token record as it replays it, so a performer is opened,
 * a token queued, conducted and archived at the moment the diagram shows it; and what the model resolves,
 * which activities belong to which performer, is given by whichever source drives the run, that being an
 * answer only the engine can give and the same one for every run of that model.
 *
 * The service also answers. A performer conducting nothing takes the first token above its divider, and
 * that answer is given here rather than in the panel: the order is the decision, and a decision must not
 * wait for a tab to be open. It is offered whenever the store changes and whenever the reader reorders,
 * since either can make an order answerable, and only while the transport plays, a paused run advancing
 * nothing and an offer being what would advance it. Otherwise it needs no pacing of its own: the store is
 * in step with the diagram, so an order cannot reach the engine before the diagram is ready for it. A
 * decision the engine has moved past expires and is dropped, and the order is offered again when the
 * diagram reaches the state that makes it answerable.
 *
 * A change is announced rather than pushed, so that the tab, and anything else reading the store, draws
 * from the store rather than from the record that changed it.
 */
export class Sequences extends SequenceStore {

  constructor(eventBus, injector) {
    super();

    this._eventBus = eventBus;
    this._injector = injector;
    this._source = null; // which run is on, since only one of them resolves the model here

    // The braces matter: a listener returning a value is a listener that has answered the event, and
    // diagram-js stops the event there.
    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
      this.clear();
    });

    // A run that is paused advances nothing, and an offer would advance it: the engine would take the entry,
    // run on, and pile up records the canvas has not shown. What has become offerable is offered when the
    // transport plays again.
    eventBus.on('playback.changed', () => {
      if (this._playing()) {
        this._answer();
      }
    });

    // A replayed log has no engine to resolve the model, so the model is read where it is. A run the engine
    // drives says it itself, through `describeModel`, and is left to: the two readings are of one model and
    // the engine's is the authority, so the one made here stands only where there is no engine to ask.
    eventBus.on('source.changed', ({ source }) => {
      this._source = source;

      if (source === 'playback') {
        this.readModel();
      }
    });

    // and again when the model changes under a reader who is replaying logs against it. A run the engine
    // drives is left alone here too: it reads the new model itself when it begins.
    eventBus.on('import.done', () => {
      if (this._source === 'playback') {
        this.readModel();
      }
    });
  }

  /**
   * Read the sequential performers from the diagram, for a run that has no engine to ask.
   *
   * What is read is the engine's own resolution, restated in `performers.js` against the moddle. It replaces
   * what the store held, a model being one thing at a time.
   */
  readModel() {
    const bpmnjs = this._injector.get('bpmnjs', false),
          definitions = bpmnjs && bpmnjs.getDefinitions && bpmnjs.getDefinitions();

    this.setModel(definitions ? collectPerformers(definitions) : []);
  }

  open(label, node, color) {
    return this._announce(super.open(label, node, color));
  }

  close(label, node) {
    return this._announce(super.close(label, node));
  }

  queue(key, token) {
    return this._announce(super.queue(key, token));
  }

  conduct(key, token) {
    return this._announce(super.conduct(key, token));
  }

  archive(key, token, values) {
    return this._announce(super.archive(key, token, values));
  }

  forget(key, tokenKey) {
    return this._announce(super.forget(key, tokenKey));
  }

  forgetPerformer(key) {
    return this._announce(super.forgetPerformer(key));
  }

  clear() {
    return this._announce(super.clear());
  }

  /**
   * Record the order the reader has set, and answer with it. Nothing is announced: the panel has drawn what
   * the reader did, and what the engine makes of it arrives as records.
   */
  setOrder(key, orderedKeys) {
    const changed = super.setOrder(key, orderedKeys);

    if (changed && !this._answer()) {
      return changed; // the panel has drawn what the reader did, and nothing else moved
    }

    if (changed) {
      this._eventBus.fire('sequences.changed', {});
    }

    return changed;
  }

  _announce(changed) {
    if (changed) {
      this._answer();
      this._eventBus.fire('sequences.changed', {});
    }

    return changed;
  }

  commit(key, tokenKey) {
    return this._announce(super.commit(key, tokenKey));
  }

  /**
   * Offer the first token above the divider of every performer that is conducting nothing.
   *
   * The engine is not asked whether it wants one. A decision is accepted only while the request it answers
   * stands, so an offer the engine has moved past expires and is dropped, and the same order is offered
   * again when the diagram reaches the state that makes it answerable.
   *
   * @returns {boolean} whether a token was committed, which the caller announces
   */
  _answer() {
    let committed = false;

    if (!this._playing()) {
      return false; // a paused run advances nothing, and an offer would advance it
    }

    if (this._source === 'playback') {
      // A replayed log is answered: the order it worked in is in the records, and an offer made here would
      // reach no engine and would anchor a token as though the reader had placed it there.
      return false;
    }

    this.all().forEach((held) => {
      if (held.closed) {
        return; // a record of what was done, not a list the run is still working through
      }
      if (held.conducting) {
        return; // busy: what it takes next is decided when it is seen to be released
      }

      const token = this.next(held.key);

      if (!token) {
        return;
      }

      // What has been offered is settled: it goes to the front of what is still to come and stays there,
      // whatever the reader does with the rest, since a decision given cannot be taken back. Committing
      // through the store rather than through this class keeps the announcement to one.
      committed = super.commit(held.key, keyOf(token.label, token.node)) || committed;

      this._eventBus.fire('manual.decide', {
        event: 'entry',
        payload: { instanceId: token.label, nodeId: token.node }
      });
    });

    return committed;
  }
}

/** Whether the transport is playing, which is when the run may be advanced at all. */
Sequences.prototype._playing = function() {
  const playback = this._injector && this._injector.get('playback', false);

  return !playback || playback.getState() === 'playing';
};

Sequences.$inject = [ 'eventBus', 'injector' ];

/**
 * The sequences module: the store of the performers, and the tab that shows them.
 */
export default {
  __init__: [ 'sequences', 'sequencesPanel' ],
  sequences: [ 'type', Sequences ],
  sequencesPanel: [ 'type', SequencesPanel ]
};

export { default as SequenceStore, DIVIDER, keyOf } from './Store.js';
export { default as SequencesPanel } from './Panel.js';
export { default as createPerformerEntry } from './PerformerEntry.js';
