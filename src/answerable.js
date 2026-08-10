/**
 * Whether what a run shows is the reader's to answer.
 *
 * A run has a source, and only one of them asks anything of the reader. A manual run silences the engine's
 * deciders, so a delivery, an order and a choice are all the reader's; a greedy run answers every one of
 * them itself, and playback is a record of a run that was answered long ago. A control offered in either
 * would be a control the run has already moved past, and a reader pressing it would be told nothing.
 *
 * The source is announced as `source.changed` by the mode buttons, which own it, and it is the only thing
 * that tells the three apart: `mode.getMode()` says `playback` of a greedy run and of a replayed log alike.
 *
 * @param {Object} eventBus  the event bus the source is announced on
 * @param {Function} onChange  called whenever the answer changes
 * @return {Function} () => boolean, the answer at the moment it is asked
 */
export default function answerable(eventBus, onChange) {
  let source = null;

  eventBus.on('source.changed', ({ source: current }) => {
    const was = source === 'manual';

    source = current;

    if (was !== (source === 'manual')) {
      onChange();
    }
  });

  return () => source === 'manual';
}
