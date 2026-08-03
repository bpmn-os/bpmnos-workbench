import SequenceStore, { DIVIDER } from './Store.js';
import SequencesPanel from './Panel.js';

/**
 * Sequences — the sequential performers of a run and the order each is to work through, as a diagram-js
 * service.
 *
 * The store itself is plain and knows nothing of a diagram. What ties it to a running one is the report the
 * engine gives after every step: the performers ride along with the pending decisions in `manual.decisions`,
 * so the service reads both from one announcement, at one moment, and the performers arrive with the entry
 * requests they are to be read against. The performers go when the tokens go, a performer being part of the
 * execution state that a mode switch clears.
 *
 * The service also answers. A performer that is idle and asking takes the first token above its divider, and
 * that answer is given here rather than in the panel: the order is the decision, and a decision must not
 * wait for a tab to be open. What is enqueued is marked as given to the engine and stands at the head of the
 * list until the engine has answered, whereupon it is the token being conducted. A decision that never takes
 * effect leaves its token where it was, and it is enqueued again the next time the engine asks, this being
 * the same rule applied to the same report rather than a case of its own.
 *
 * A change is announced rather than pushed, so that the tab, and anything else reading the store, draws from
 * the store rather than from the report that changed it.
 */
export class Sequences extends SequenceStore {

  constructor(eventBus) {
    super();

    this._eventBus = eventBus;

    // The braces matter: a listener returning a value is a listener that has answered the event, and
    // diagram-js stops the event there.
    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => {
      this.clear();
    });

    eventBus.on('manual.decisions', ({ decisions, performers }) => {
      this.apply(performers || []);
      this._answer(decisions || []);
      this._eventBus.fire('sequences.changed', {});
    });
  }

  clear() {
    const held = super.clear();

    if (held) {
      this._eventBus.fire('sequences.changed', {});
    }

    return held;
  }

  /**
   * Enqueue the entry of the first token above the divider, for every performer that is idle and asking.
   *
   * Asking is the engine's word rather than the panel's reading of it: while a performer is busy the entry
   * requests of everything waiting under it are withdrawn, and on release a fresh request is made for each,
   * so a token with an entry request pending is a token whose performer will take it.
   *
   * Every such report is answered, including one that repeats. Enqueuing resumes the engine, which
   * dispatches what it has been given before it reports again, so a report that still shows the performer
   * idle and its token asked for is a report that the previous decision did not take effect, and the answer
   * is to give it again. That is the whole of what a void decision needs, and it is why the mark a pinned
   * token carries is a mark rather than a guard.
   *
   * @param {Array} decisions  what the engine is waiting for, as the controller reported it
   */
  _answer(decisions) {
    const asking = new Set(
      decisions
        .filter(({ type }) => type === 'entry')
        .map(({ instanceId, nodeId }) => SequenceStore.keyOf({ instanceId, nodeId }))
    );

    this.all().forEach((held) => {
      if (held.conducting) {
        return; // busy: what it is to take next is asked of it when it is released
      }

      const token = this.next(held.key);

      if (!token || !asking.has(SequenceStore.keyOf(token))) {
        return;
      }

      this.pin(held.key, SequenceStore.keyOf(token));

      this._eventBus.fire('manual.decide', {
        event: 'entry',
        payload: { instanceId: token.instanceId, nodeId: token.nodeId }
      });
    });
  }
}

Sequences.$inject = [ 'eventBus' ];

/**
 * The sequences module: the store of the performers, and the tab that shows them.
 */
export default {
  __init__: [ 'sequences', 'sequencesPanel' ],
  sequences: [ 'type', Sequences ],
  sequencesPanel: [ 'type', SequencesPanel ]
};

export { default as SequenceStore, DIVIDER } from './Store.js';
export { default as SequencesPanel } from './Panel.js';
export { default as createPerformerEntry } from './PerformerEntry.js';
