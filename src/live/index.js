import EngineRunner from '../engine/EngineRunner.js';
import createInput from '../input/index.js';
import mountInputTabs from '../input/tabs.js';
import walk from '../decisions/walk.js';

/*
 * createLiveRun — the run the wasm engine performs here, in either mode.
 *
 * Greedy and manual are not two runs but one, differing in which of the controller's dispatchers answer.
 * Greedy lets every one of them speak, so the run settles each decision and advances its own clock; manual
 * silences the deciders and the clock, so the engine goes as far as it can on its own and then stands still
 * until the reader supplies what it is waiting for.
 *
 * A run is therefore one session, made of steps. A step brings a requested mode change into effect and then
 * advances the engine by one fetched event, so everything that reaches the engine goes through one path: a
 * reconfiguration falls between two events and never into the middle of one, and the run is never asked two
 * things at once. `setMode` records what is wanted; the step brings it about. What was silenced kept
 * observing throughout, so it answers from an up-to-date set at the very next event, and what the reader had
 * queued and the engine has since moved past is dropped by the engine as expired.
 *
 * The records are played as they arrive, so the engine is never further ahead than what the diagram has
 * drawn — which is what makes a mode change land where the reader is looking. The player paces it: having
 * drawn everything it holds, it says so, and the next step is taken. The transport's play and pause govern
 * that playing, as they govern a recorded log.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @param {{ setWaiting: (boolean) => void }} clock  the canvas clock, which shows that the engine waits
 * @returns {{ activate: (mode: string) => void, deactivate: () => void, setMode: (mode: string) => void,
 *            decide: (event: string, payload?: object) => void }}
 */
export default function createLiveRun(modeler, clock) {
  const tokenPanel = modeler.get('tokenPanel', false);
  const playback = modeler.get('playback');
  const eventBus = modeler.get('eventBus');

  const runner = new EngineRunner();

  let input = null;         // the input provider, while active
  let inputTabs = null;     // the columns the input stands in, taken away on deactivate
  let greedy = false;       // the mode the controller is configured for
  let wanted = false;       // the mode asked for, which the next step brings into effect
  let seed = newSeed();     // caller-owned engine seed; Refresh re-rolls it
  let running = false;      // a run has begun and has not been ended
  let stepping = false;     // a step is with the engine; the next follows it
  let stalled = false;      // the engine is alive and can fetch no event: it waits for the reader
  let drained = false;      // the diagram shows everything the engine has produced so far
  let decided = [];         // what the reader has decided and the engine has not yet been given
  let deciding = false;     // a decision is with the engine; the rest of `decided` follows it
  let walking = false;      // the choices are being read; the walk writes the store it is walking
  let stated = new Map();   // the choices each decision task states, by the node stating them

  function newSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  function activate(mode) {
    // no run yet, so the mode asked for is the mode the next one is composed in: the two agree and the
    // first step has nothing to reconfigure
    greedy = wanted = (mode === 'greedy');
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

  // The mode of the run rather than of the workbench: which of the composition's dispatchers answer. This
  // records what is wanted and nothing more; the controller is reconfigured by the next step, which is what
  // puts the change between two events rather than into the middle of one. Where there is no run, the mode
  // is simply what the next one begins in.
  function setMode(mode) {
    wanted = (mode === 'greedy');
    if (running) {
      step(); // a run standing still because the reader was to answer is carried on by the mode itself
    }
  }

  // A run is offered to the transport once there is something to run, and withdrawn otherwise. What a run
  // is given cannot change under it, so a change to the input gives up the run rather than amending it, and
  // the next start is a new run.
  async function syncSource() {
    await abandon();
    playback.setLogSource(input && input.ready() ? begin : null);
  }

  // The transport starts a run: the engine is given the input as it now stands, prepared at the instant the
  // run begins at, and then carried forward. What is returned is the log the transport starts playing,
  // which is the stream's own growing array rather than a copy, so everything pushed later is played by the
  // same run.
  async function begin() {
    for (const [ name, csv ] of Object.entries(input.getLookups())) {
      runner.setLookup(name, csv);
    }

    await describe();

    running = true;
    stalled = false;
    drained = false;
    decided = [];
    playback.beginStream();

    try {
      const started = await runner.initialize(input.getInstances(), seed, greedy);
      playback.push(started.entries);
      step();
    } catch (err) {
      console.error('[live] run failed to start:', err);
      await abandon();
      return null;
    }
    return playback.getLog();
  }

  // One step of the run: bring a requested mode change into effect, then advance the engine by one fetched
  // event. Everything that reaches the engine while a run is under way goes through here, so a
  // reconfiguration always falls between two events and never into the middle of one, and the run is never
  // asked two things at once.
  //
  // The player asks for the next step by announcing that it has drawn everything it holds, so ordinarily one
  // event is taken per announcement. An event that produces nothing to draw would leave nobody to announce
  // it — pushing nothing wakes no one — so stepping continues until there is something to hand over or the
  // run can go no further.
  //
  // Where it can go no further, what that means is the mode: a live state with nothing fetchable is the
  // engine waiting for the reader, and a state that is no longer alive is the run over. Greedy never waits,
  // its dispatchers answering everything, so in greedy the first is unreachable.
  async function step() {
    if (stepping || !running) {
      return;
    }
    stepping = true;
    try {
      while (running) {
        if (wanted !== greedy) {
          await runner.setMode(wanted);
          greedy = wanted;
          // What the reader had not answered is no longer theirs to answer once the run decides for itself.
          if (greedy) {
            decided = [];
            stalled = false;
            clock.setWaiting(false);
          }
        }

        const advanced = await runner.advance();
        playback.push(advanced.entries);

        if (!advanced.advanced) {
          if (advanced.alive) {
            stalled = true;
            sayWaiting();
          } else {
            await finish();
          }
          return;
        }
        if (advanced.entries.length) {
          return; // drawn: the player asks for the next step once it has caught up
        }
      }
    } catch (err) {
      console.error('[live] the run could not be stepped:', err);
      await abandon();
    } finally {
      stepping = false;
    }
  }

  // What the model resolves rather than what a run does: which nodes perform sequentially and which
  // activities each performs, and which choices each decision task states. No record says either, and both
  // are the same for every run of the model, so they are asked once a run is about to start, which is when
  // the lookup tables a model references are in and it can be built.
  async function describe() {
    const sequences = modeler.get('sequences', false);

    try {
      const described = await runner.describe();

      if (sequences) {
        sequences.setModel(described.sequentialPerformers || []);
      }

      stated = new Map((described.decisions || []).map((task) => [ task.node, task.choices || [] ]));
    } catch (err) {
      console.error('[live] the model could not be described:', err);
    }
  }

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
      console.error('[live] run failed to end:', err);
    }
  }

  // The engine waits for the reader, and the clock says so only once the diagram has caught up: inviting a
  // decision over a diagram that is still moving invites it over a state that is not yet shown.
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
   * It is asked when the player says it has drawn everything the engine has done, which while the reader
   * drives is the moment before they can act: nothing changes without them, so the data and the globals a
   * condition reads move only as a consequence of a clock tick, a delivery, an entry or another choice.
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
      console.error('[live] the choices could not be read:', err);
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

  // Everything the reader decides reaches the engine here, named rather than typed: a clock tick, a message
  // delivery, a choice or a sequential entry, each one queued and the run carried on. A decision may be made
  // at any moment, including while the engine is still answering the previous one, so what the reader
  // decides is held here and sent in turn rather than refused. Nothing guarantees that a decision is still
  // valid when it is reached: the engine drops what has expired, and any later decision that is still valid
  // is taken.
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
        // queued and no more: the engine is carried forward by a step, as it is at every other moment
        await runner.enqueue(event, payload);
        await step();
      }
    } catch (err) {
      console.error('[live] step failed:', err);
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
    step();
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

  // Refresh gives up the run and re-rolls the seed, so the next start is a fresh trajectory rather than the
  // one just played. A run cannot be resumed from where it stood in any case, the reader having carried it
  // there in manual and the seed determining it in greedy. The panel has stopped playback and cleared the
  // canvas before firing, and the clock blanks its readout on the same event.
  eventBus.on('tokenPanel.refresh', () => {
    if (input) {
      seed = newSeed();
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

  return { activate, deactivate, setMode, decide };
}
