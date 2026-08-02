import EngineRunner from '../engine/EngineRunner.js';
import createInput from '../input/index.js';

/*
 * createManual — the manual-simulation source: the engine runs, the user decides.
 *
 * The engine is driven with a controller, so no time handler is attached and it advances only as far as it
 * can on its own. Where it can go no further it stands still, and what it is waiting for is the user: at
 * present that is time, which the canvas clock advances, and later a message delivery, a choice or a
 * sequential entry, which reach the engine through the same call.
 *
 * The records the engine produces are played as they arrive rather than after the run, so the diagram shows
 * what has happened while the engine waits for what happens next. The transport's play and pause govern
 * that playing, as they govern a recorded log; they do not govern the engine, which is the user's to
 * advance.
 *
 * The input is the provider both sources use, mounted here where greedy mounts it.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {{ setWaiting: (boolean) => void }} clock  the canvas clock, which shows that the engine waits
 * @returns {{ activate: () => void, deactivate: () => void }}
 */
export default function createManual(modeler, clock) {
  const tokenPanel = modeler.get('tokenPanel', false);
  const playback = modeler.get('playback');
  const eventBus = modeler.get('eventBus');

  const runner = new EngineRunner();

  let input = null;         // the input provider, while active
  let controlHandle = null; // handle from tokenPanel.addControl
  let running = false;      // a run has begun and has not been ended

  function activate() {
    if (!tokenPanel || input) {
      return;
    }
    input = createInput(modeler, runner);
    input.onChange(restart);
    controlHandle = tokenPanel.addControl(input.element);
    input.load();
  }

  function deactivate() {
    end();
    if (controlHandle) {
      controlHandle.remove();
      controlHandle = null;
    }
    if (input) {
      input.destroy();
      input = null;
    }
  }

  // The run begins as soon as there is something to run, and begins again whenever the input changes:
  // what a run is given cannot change under it, so a change is a new run rather than an amendment.
  async function restart() {
    await end();

    if (!input || !input.ready()) {
      return;
    }

    for (const [ name, csv ] of Object.entries(input.getLookups())) {
      runner.setLookup(name, csv);
    }

    running = true;
    playback.startStream();

    try {
      apply(await runner.start(input.getInstances()));
    } catch (err) {
      console.error('[manual] run failed to start:', err);
      await end();
    }
  }

  async function end() {
    if (!running) {
      return;
    }
    running = false;
    clock.setWaiting(false);
    playback.endStream();
    await playback.stop();
    try {
      await runner.stop();
    } catch (err) {
      console.error('[manual] run failed to end:', err);
    }
  }

  // What the engine produced since it was last let go, and where it now stands: alive with nothing further
  // to fetch is the engine waiting for the user, which the clock says by pulsing.
  function apply(step) {
    if (!running || !step) {
      return;
    }
    playback.push(step.entries);

    if (step.alive) {
      clock.setWaiting(true);
    } else {
      end();
    }
  }

  // Everything the user decides reaches the engine here, named rather than typed: a clock tick today, a
  // message delivery, a choice or an entry when those are built, each one queued and the engine let go.
  async function decide(event, payload) {
    if (!running) {
      return;
    }
    clock.setWaiting(false);
    try {
      apply(await runner.enqueue(event, payload));
    } catch (err) {
      console.error('[manual] step failed:', err);
      await end();
    }
  }

  // the clock is the control that advances time, and it says only that it was clicked
  eventBus.on('clock.tick', () => decide('clockTick'));

  // a new model was imported — if manual is active, the input is derived from it afresh, which restarts
  eventBus.on('import.done', () => input && input.load());

  eventBus.on([ 'diagram.destroy' ], () => runner.destroy());

  return { activate, deactivate, decide };
}
