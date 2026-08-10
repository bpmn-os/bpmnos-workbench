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
 * @param {{ setWaiting: (boolean) => void, setObjective: (number?) => void }} display  the canvas display:
 *        the clock, which shows that the engine waits for the reader, and the objective the run has reached
 * @returns {{ activate: (mode: string) => void, deactivate: () => void, setMode: (mode: string) => void,
 *            decide: (event: string, payload?: object) => void }}
 */
export default function createLiveRun(modeler, display) {
  const tokenPanel = modeler.get('tokenPanel', false);
  const playback = modeler.get('playback');
  const eventBus = modeler.get('eventBus');

  const runner = new EngineRunner();

  let input = null;         // the input provider, while active
  let inputTabs = null;     // the columns the input stands in, taken away on deactivate

  // What the tables held, kept here because this outlives a run and the provider does not: a reader going
  // back to modelling ends the run, and the rows they typed and the files they read in are theirs to come
  // back to. The provider puts each back into the table it belongs to, or leaves it where the model has
  // made it stale.
  const keptTables = new Map();
  let greedy = false;       // the mode the controller is configured for
  let wanted = false;       // the mode asked for, which the next step brings into effect
  let seed = newSeed();     // caller-owned engine seed; Refresh re-rolls it
  let running = false;      // a run has begun and has not been ended
  let stalled = false;      // the engine is alive and can fetch no event: it waits for the reader
  let drained = false;      // the diagram shows everything the engine has produced so far
  let decided = [];         // what the reader has decided and the engine has not yet been given
  let deciding = false;     // a decision is with the engine; the rest of `decided` follows it
  let stated = new Map();   // the choices each decision task states, by the node stating them

  // The run is either being advanced or being asked, never both. The engine comes to rest after each
  // advance, so it may be asked at almost any moment; what it may not be is asked about a state that moves
  // under the question, and an advance is exactly that. A decision task states its choices in order, so a
  // walk is several questions and every one of them is about the state the engine stands in.
  //
  // Whichever is called for while the other is under way is remembered rather than refused, and taken up
  // when it ends: both are set off by things that do not know about each other — the player catching up, the
  // reader choosing — so neither is in a position to wait for the other itself.
  let serving = null;       // the promise of what is being done with the engine, so a caller may wait
  let stepWanted = false;   // an advance was called for
  let walkWanted = false;   // the choices were called for

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
    input = createInput(modeler, runner, keptTables);
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
    // What this run was given: the tables are read here and stand as a statement of it while it is on. A
    // change to them gives the run up rather than amending it, so an edit offered now would only destroy
    // the run being watched.
    input.setReadOnly(true);
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

  // Ask for the run to be carried forward. It is asked for rather than done, since the engine may be being
  // asked something at this moment; what is returned is the doing, so a caller that must wait may.
  function step() {
    stepWanted = true;

    return serve();
  }

  /*
   * What is being done with the engine, one thing at a time.
   *
   * The choices are read before the run is advanced, since what they answer is about the state the engine
   * stands in and advancing leaves it. Each is taken up afresh on every turn of the loop rather than once at
   * the start: doing one may call for the other, and a reader may call for either while this is under way.
   *
   * `serving` is cleared before the promise it stands for resolves, so a caller that arrives at that moment
   * begins a turn of its own rather than waiting on work that is already over.
   */
  function serve() {
    if (!serving) {
      serving = drain();
    }

    return serving;
  }

  async function drain() {
    try {
      while (running && (walkWanted || stepWanted)) {
        if (walkWanted) {
          walkWanted = false;
          await walkDecisions();
        } else {
          stepWanted = false;
          await advance();
        }
      }
    } finally {
      serving = null;
    }
  }

  // One step of the run: bring a requested mode change into effect, then advance the engine by one fetched
  // event. It is called only from `drain`, so a reconfiguration always falls between two events and never
  // into the middle of one, and the engine is never advanced while it is being asked something.
  //
  // The player asks for the next step by announcing that it has drawn everything it holds, so ordinarily one
  // event is taken per announcement. An event that produces nothing to draw would leave nobody to announce
  // it — pushing nothing wakes no one — so stepping continues until there is something to hand over or the
  // run can go no further.
  //
  // Where it can go no further, what that means is the mode: a live state with nothing fetchable is the
  // engine waiting for the reader, and a state that is no longer alive is the run over. Greedy never waits,
  // its dispatchers answering everything, so in greedy the first is unreachable.
  async function advance() {
    while (running) {
      if (wanted !== greedy) {
        try {
          await runner.setMode(wanted);
        } catch (err) {
          // The run stands where it stood, in the mode it was in: this is the reconfiguration failing and
          // not the run. The reader asking for the mode again is what tries it again.
          console.error('[live] the mode could not be changed:', err);

          return;
        }
        greedy = wanted;
        // What the reader had not answered is no longer theirs to answer once the run decides for itself.
        if (greedy) {
          decided = [];
          stalled = false;
          display.setWaiting(false);
        }
      }

      let advanced;

      try {
        advanced = await runner.advance();
      } catch (err) {
        // The engine could not be carried forward, so there is no run left to carry: this is the one failure
        // that ends it.
        console.error('[live] the run could not be advanced:', err);
        await abandon();

        return;
      }

      if (advanced.entries.length) {
        drained = false; // there is something to draw, so the diagram is behind the engine again
      }
      playback.push(advanced.entries);

      // What the run has accumulated, written after every advance. The run is paced by what has been drawn,
      // one event being taken per announcement, so the engine stands at most one event ahead of the canvas
      // and the objective and the clock beside it say the same moment.
      display.setObjective(advanced.objective);

      if (!advanced.advanced) {
        if (advanced.alive) {
          stalled = true;
          sayWaiting();
          // The stall is learnt here and nowhere else, and the diagram has usually caught up already, the
          // event that stalled the run having produced nothing to draw. So this is the moment the run
          // becomes one that waits for the reader, and the moment to ask what it is waiting to be told;
          // the drain takes it up on its next turn.
          walkWanted = walkWanted || waitingForReader();
        } else {
          await finish();
        }

        return;
      }
      if (advanced.entries.length) {
        return; // drawn: the player asks for the next step once it has caught up
      }
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
    display.setWaiting(false);
    if (input) {
      input.setReadOnly(false); // the run is over, and what the tables hold now is what the next one is given
    }
    decided = [];
    stepWanted = walkWanted = false;
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
    display.setWaiting(false);
    if (input) {
      input.setReadOnly(false); // the run is over, and what the tables hold now is what the next one is given
    }
    decided = [];
    stepWanted = walkWanted = false;
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

  /*
   * The run is waiting for the reader: the engine is alive and can fetch nothing, and the diagram shows
   * everything it has produced.
   *
   * Both are needed and neither implies the other. The engine comes to rest after every advance, so resting
   * says nothing about how far behind the diagram is; and the player catches up over and over in a greedy
   * run, where the engine is not waiting for anybody. It is only where the two hold together that what the
   * engine stands in is what the reader is looking at, which is the condition for inviting them to act and
   * for asking the engine anything on their behalf.
   */
  function waitingForReader() {
    return running && stalled && drained;
  }

  // The clock says the run waits, and says it only then: inviting a decision over a diagram that is still
  // moving invites it over a state that is not yet shown.
  function sayWaiting() {
    display.setWaiting(waitingForReader());
  }

  /*
   * What each choice of each waiting decision task may take.
   *
   * Only an engine standing at the token can answer it: a choice is bounded or enumerated by an expression
   * over the status, the data and the globals, and no record carries the answer. A decision task states its
   * choices in order and a later one may depend on the earlier ones, so the engine is asked for one choice
   * at a time, against the values already selected, until it says there are no more.
   *
   * It is asked when the run is waiting for the reader, and only then. That the engine is at rest is not
   * enough: the answer must be about the state the reader is looking at, and in a greedy run the diagram is
   * far behind an engine that is deciding everything for itself, where there is nothing for a reader to
   * choose in any case. Where the run does wait, nothing changes without them, so the data and the globals a
   * condition reads move only as a consequence of a clock tick, a delivery, an entry or another choice.
   *
   * A decision the run has answered is a record of what was chosen and is not asked about: the request no
   * longer stands, and the engine would say so of every choice it holds.
   *
   * A value the reader holds that the answer no longer admits is cleared, and everything after it with it,
   * which is the whole of what "a later choice may become invalid" means.
   *
   * Failing to read the choices leaves the run standing: what is not answered is a choice the reader cannot
   * yet make, which is what the tab already draws, and the next thing that moves asks again.
   */
  async function walkDecisions() {
    const decisions = modeler.get('decisions', false);

    if (!decisions || !waitingForReader()) {
      return;
    }

    try {
      for (const decision of decisions.all()) {
        if (!decision.archived) {
          await walkDecision(decisions, decision);
        }
      }
    } catch (err) {
      console.error('[live] the choices could not be read:', err);
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
        display.setWaiting(false);
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

  // The player has played everything it holds, so what the diagram shows is what the engine has done. This
  // is the animation's back-pressure on the engine: a step is taken per announcement, so the run is paced by
  // what has been drawn rather than by how fast the engine can go, which is what keeps it from running ahead
  // of the reader. It is also half of what says the run waits, the other half being the engine's own stall.
  eventBus.on('playback.drained', () => {
    drained = true;
    sayWaiting();
    walkWanted = true;
    step();
  });

  // The reader has chosen, so the values a later choice may take are a different question from the one
  // already answered. Asking again is what opens the choice below the one just made, and what withdraws a
  // value further down that the new prefix no longer admits.
  eventBus.on('decisions.selected', () => {
    walkWanted = true;
    serve();
  });

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
