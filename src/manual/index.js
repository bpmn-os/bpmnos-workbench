import EngineRunner from '../engine/EngineRunner.js';
import createInput from '../input/index.js';
import mountInputTabs from '../input/tabs.js';
import walk from '../decisions/walk.js';

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
  let inputTabs = null;     // the columns the input stands in, taken away on deactivate
  let running = false;      // a run has begun and has not been ended
  let stalled = false;      // the engine is alive and can fetch no event: it waits for the user
  let drained = false;      // the diagram shows everything the engine has produced so far
  let decided = [];         // what the user has decided and the engine has not yet been given
  let deciding = false;     // a decision is with the engine; the rest of `decided` follows it
  let walking = false;      // the choices are being read; the walk writes the store it is walking

  function activate() {
    if (!tokenPanel || input) {
      return;
    }
    input = createInput(modeler, runner);
    input.onChange(syncSource);
    // what the run is given stands in columns of its own, right of what a run produces
    inputTabs = mountInputTabs(modeler, input);
    input.load();
  }

  function deactivate() {
    abandon();
    if (inputTabs) {
      inputTabs.remove();
      inputTabs = null;
    }
    if (input) {
      input.destroy();
      input = null;
    }
  }

  // A run is offered to the transport once there is something to run, and withdrawn otherwise. What a run
  // is given cannot change under it, so a change to the input gives up the run rather than amending it, and
  // the next start is a new run.
  async function syncSource() {
    await abandon();
    playback.setLogSource(input && input.ready() ? begin : null);
  }

  // The transport starts a run: the engine is given the input as it now stands and runs as far as it can,
  // and what it produces is played as it arrives rather than after the run. What is returned is the log the
  // transport starts playing, which is the stream's own growing array rather than a copy, so everything
  // pushed later is played by the same run.
  async function begin() {
    for (const [ name, csv ] of Object.entries(input.getLookups())) {
      runner.setLookup(name, csv);
    }

    await describe();

    running = true;
    stalled = false;
    drained = false;
    playback.beginStream();

    try {
      apply(await runner.start(input.getInstances()));
    } catch (err) {
      console.error('[manual] run failed to start:', err);
      await abandon();
      return null;
    }
    return playback.getLog();
  }

  // What the model resolves rather than what a run does: which nodes perform sequentially and which
  // activities each performs, and which choices each decision task states. No record says either, and both
  // are the same for every run of the model, so they are asked once a run is about to start, which is when
  // the lookup tables a model references are in and it can be built. A panel that reads it holds it; a host
  // without one is told nothing.
  async function describe() {
    const sequences = modeler.get('sequences', false);

    try {
      const described = await runner.describe();

      if (sequences) {
        sequences.setModel(described.sequentialPerformers || []);
      }

      stated = new Map((described.decisions || []).map((task) => [ task.node, task.choices || [] ]));
    } catch (err) {
      console.error('[manual] the model could not be described:', err);
    }
  }

  // The choices each decision task states, by the node stating them, as the model resolved them.
  let stated = new Map();

  // The engine has run itself out. What it produced last is still being played, so the stream is closed
  // rather than stopped: the player finishes what it holds and ends by itself, and the diagram shows the
  // whole run rather than as much of it as had been drawn when the engine finished.
  async function finish() {
    if (!running) {
      return;
    }
    running = false;
    stalled = false;
    clock.setWaiting(false);
    decided = [];
    playback.endStream();
    await release();
  }

  // The run is given up rather than finished — the input changed, the source was left, a step failed — so
  // what is unplayed is discarded with it.
  async function abandon() {
    if (!running) {
      return;
    }
    running = false;
    stalled = false;
    clock.setWaiting(false);
    decided = [];
    playback.endStream();
    await playback.stop();
    await release();
  }

  async function release() {
    try {
      await runner.stop();
    } catch (err) {
      console.error('[manual] run failed to end:', err);
    }
  }

  // What the engine produced since it was last let go, and where it now stands. Alive with nothing further
  // to fetch is the engine waiting for the user; the clock says so only once the diagram has caught up,
  // since inviting a decision over a diagram that is still moving invites it over a state that is not yet
  // shown.
  function apply(step) {
    if (!running || !step) {
      return;
    }
    drained = false;
    playback.push(step.entries);

    if (step.alive) {
      stalled = true;
    } else {
      finish();
    }
  }

  function sayWaiting() {
    clock.setWaiting(running && stalled && drained);
  }

  /*
   * What each choice of each waiting decision task may take.
   *
   * Only an engine standing at the token can answer it: a choice is bounded or enumerated by an expression
   * over the status, the data and the globals, and no record carries the answer. A decision task states its
   * choices in order and a later one may depend on the earlier ones, so the engine is asked for one choice
   * at a time, against the values already selected, until it says there are no more.
   *
   * It is asked when the player says it has drawn everything the engine has done, which in a manual
   * simulation is the moment before the reader can act: nothing changes without them, so the data and the
   * globals a condition reads move only as a consequence of a clock tick, a delivery, an entry or another
   * choice, and each of those returns a step. Between such a change and this walk the options shown may be
   * out of date, and it does not matter, because the reader cannot answer them until the engine has stalled.
   *
   * A value the reader holds that the answer no longer admits is cleared, and everything after it with it,
   * which is the whole of what "a later choice may become invalid" means.
   */
  async function walkDecisions() {
    const decisions = modeler.get('decisions', false);

    if (!decisions || !running || walking) {
      return;
    }

    walking = true;

    try {
      for (const decision of decisions.all()) {
        await walkDecision(decisions, decision);
      }
    } catch (err) {
      console.error('[manual] the choices could not be read:', err);
    } finally {
      walking = false;
    }
  }

  async function walkDecision(decisions, decision) {
    return walk(
      decisions,
      decision,
      (instanceId, nodeId, selected) => runner.choiceCandidates(instanceId, nodeId, selected),
      stated.get(decision.nodeId) || []
    );
  }

  // Everything the user decides reaches the engine here, named rather than typed: a clock tick, a message
  // delivery, and a choice or a sequential entry when those are built, each one queued and the engine let
  // go. A decision may be made at any moment, including while the engine is still answering the previous
  // one, so what the user decides is held here and sent in turn rather than refused. Nothing guarantees
  // that a decision is still valid when it is reached: the engine drops what has expired, and any later
  // decision that is still valid is taken.
  function decide(event, payload) {
    if (!running) {
      return;
    }
    decided.push({ event, payload });
    if (!deciding) {
      send();
    }
  }

  async function send() {
    deciding = true;
    try {
      while (running && decided.length) {
        const { event, payload } = decided.shift();
        stalled = false;
        clock.setWaiting(false);
        apply(await runner.enqueue(event, payload));
      }
    } catch (err) {
      console.error('[manual] step failed:', err);
      await abandon();
    } finally {
      deciding = false;
    }
  }

  // the player has played everything it holds, so what the diagram shows is what the engine has done
  eventBus.on('playback.drained', () => {
    drained = true;
    sayWaiting();
    walkDecisions();
  });

  // The reader has chosen, so the values a later choice may take are a different question from the one
  // already answered. Asking again is what opens the choice below the one just made, and what withdraws a
  // value further down that the new prefix no longer admits.
  eventBus.on('decisions.selected', () => walkDecisions());

  // whatever panel offers a decision announces it here rather than reaching for the engine, so a panel
  // knows what was decided and nothing else
  eventBus.on('manual.decide', ({ event, payload }) => {
    decide(event, payload);
  });

  // the clock is the control that advances time, and it says only that it was clicked
  eventBus.on('clock.tick', () => {
    decide('clockTick');
  });

  // Refresh gives up the run rather than merely clearing what is drawn: a manual run cannot be resumed from
  // where it stood, the engine having been carried there by the user, so the next start is a new run. The
  // panel has stopped playback and cleared the canvas before firing, and the clock blanks its readout on
  // the same event.
  eventBus.on('tokenPanel.refresh', () => {
    if (input) {
      syncSource();
    }
  });

  // a new model was imported: the input is derived from it afresh, which withdraws the run source
  eventBus.on('import.done', () => {
    if (input) {
      input.load();
    }
  });

  eventBus.on([ 'diagram.destroy' ], () => runner.destroy());

  return { activate, deactivate, decide };
}
