/**
 * Whether what a run shows is a record of a run that is over.
 *
 * A run has a source, and one of them is not a run at all: playback replays a log, so nothing in it is
 * still being decided and nothing in it can be. A greedy run is no more the reader's to answer than a
 * replayed log is, which is what [[answerable]] says, but it is a run in progress: it has messages in
 * flight, tokens queued at a performer and decisions it has not reached, and those are true statements
 * about the instant the diagram is showing. A replayed log has them too, and cannot show them, because
 * what a pending thing offers is what an engine standing at the token would answer and there is no engine.
 *
 * So the two questions are separate and are asked separately: whether the reader may act, and whether
 * there is anything but the record to show. This is the second.
 *
 * The source is announced as `source.changed` by the mode buttons, which own it, and it is the only thing
 * that tells the three apart: `mode.getMode()` says `playback` of a greedy run and of a replayed log alike.
 *
 * @param {Object} eventBus  the event bus the source is announced on
 * @param {Function} onChange  called whenever the answer changes
 * @return {Function} () => boolean, the answer at the moment it is asked
 */
export default function replayed(eventBus, onChange) {
  let source = null;

  eventBus.on('source.changed', ({ source: current }) => {
    const was = source === 'playback';

    source = current;

    if (was !== (source === 'playback')) {
      onChange();
    }
  });

  return () => source === 'playback';
}
