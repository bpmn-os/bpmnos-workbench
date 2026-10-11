// The engine worker, serving both a greedy run and a manual one.
//
// A run of the BPMN-OS wasm engine continues until it is terminated, so it runs here in a Web Worker rather
// than on the page; `run`, `resume` and `advance` return promises, the run being suspended while the engine
// waits. It assembles an Input in three steps so the page can prompt for a model's inputs before running:
// parse a model and report the sources of the inputs it declares (`loadModel` → `inputs`), accept the
// content of each input, the CSV of a lookup table or a matrix or the JSON of an object (`input`), and —
// once the instance CSV is supplied — build an Engine and run it (`run` → `done`). The seed comes from the caller (the page owns it, so a re-run can
// be reproducible and "Refresh" can re-roll it); a given seed → a fixed stochastic sample. The whole run's
// monitor entries arrive while `run` proceeds, so we collect them here and hand the page the complete log in
// the `done` message.
//
// What a run decides for itself is which of its controller's dispatchers answer and whether the engine
// advances time, rather than a mode of the engine. Both modes are therefore one composition and one data
// provider holding time: a greedy run lets every dispatcher of it speak and the engine advance time whenever
// it waits, and a manual run silences the two that decide and holds time, so that what the reader is to be
// asked about reaches the page and time advances only when the reader says so.

import createBPMNOS from '@bpmn-os/bpmnos-wasm';

// One composition serves both modes. A run is greedy or manual by which of its dispatchers answer, and that
// is a property the controller turns over between fetches, so nothing is rebuilt when the mode changes and
// a run survives it.
//
// A position is a precedence, and `EnqueuedEvents` comes first because it is what the page says while
// everything behind it is what the run settles for itself: ahead of the deciders, a termination ends the run
// when it is given rather than at the first fetch where none of them has anything to say, and what the
// reader answers is dispatched before anything automatic settles something else. It costs nothing at the
// fetches where it is empty. No dispatcher advances time.
const COMPOSITION = [
  'EnqueuedEvents',
  'FirstFeasibleExit', 'FirstFeasibleEntry', 'InstantDirectMessage',
  'FirstEnumeratedChoice', 'CompetingCandidates'
];

// The data provider holds time, so that the engine advances it only where a greedy run lets it and a manual
// run advances it only by the clock ticks the reader enqueues.
const PROVIDER = (seed) => JSON.stringify({ provider: 'stochastic', seed, clockTickDuration: 'hold' });

// The dispatchers only a greedy run lets speak: the two that decide, because in a manual run the reader
// decides.
// `SequentialEntries` is in neither, the Sequences tab answering the entry of a child of a sequential ad hoc
// subprocess from the order it holds, and `InstantDirectMessage` speaks in both, an addressed delivery being
// no decision. Each dispatcher joins this list as its panel arrives.
//
// The positions are read from the composition rather than written down, so reordering it moves them too.
const GREEDY_ONLY = [ 'FirstEnumeratedChoice', 'CompetingCandidates' ]
  .map(name => COMPOSITION.indexOf(name));

const ready = createBPMNOS();
ready.then(() => self.postMessage({ type: 'ready' })).catch(err =>
  self.postMessage({ type: 'error', error: 'engine module failed to load: ' + String(err) }));

let Module = null;
let modelXml = null;
let inputContents = {};

// A manual run keeps its engine alive between the page's inputs: the page asks for one round at a time, and
// a round in which the engine waits, producing no record, is where the run stands until the caller queues
// what is to happen next on the controller. The entries the monitor collects in between are handed over with
// each answer.
let session = null; // { engine, monitor, controller, entries }

// Builds what a session drives: one composition, with what only a greedy run adds silenced where the mode is
// manual. The engine is left as constructed and is not carried forward here, since how far it runs is the
// caller's business — `start` runs it as far as it goes, `initialize` leaves it standing at its first
// instant. A previous session is replaced.
function beginSession(instances, seed, greedy) {
  endSession();

  const input = new Module.Input(modelXml);
  for (const [ source, content ] of Object.entries(inputContents)) {
    input.addInputContent(source, content);
  }
  input.setInstance(instances);

  const entries = [];
  const monitor = new Module.Monitor();
  monitor.addObserver((entryJson) => entries.push(JSON.parse(entryJson)));

  // Silencing withholds nothing but dispatching, so what is silent goes on observing and is correct the
  // moment the mode turns over. A manual run therefore stands wherever the engine waits, and time advances
  // only by what the page queues.
  const controller = new Module.Controller(JSON.stringify({ dispatchers: COMPOSITION }));
  if (!greedy) {
    for (const index of GREEDY_ONLY) {
      controller.deactivate(index);
    }
  }

  // the caller owns the seed (Refresh re-rolls it); fall back to a random one if none was supplied
  const chosenSeed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 0x7fffffff);
  const engine = new Module.Engine(input, PROVIDER(chosenSeed), controller, monitor);
  input.delete();
  if (greedy) {
    engine.advanceTime(0);
  }

  session = { engine, monitor, controller, entries, seed: chosenSeed };
}

// One step of a session: one round, or as many as it takes to process an event where the engine advances
// time, since the round in which the engine enqueues a clock tick processes none. It answers whether an
// event was processed, which is false once the engine waits for the caller or the run is terminated.
async function step() {
  for (;;) {
    const before = session.entries.length;
    const continuing = await session.engine.advance();
    if (session.entries.length > before) {
      return true;
    }
    if (!continuing || !session.engine.isAdvancingTime()) {
      return false;
    }
  }
}

function endSession() {
  if (!session) {
    return;
  }
  session.engine.delete();
  session.monitor.delete();
  session.controller.delete();
  session = null;
}

// What the page is told after every step: the records the engine produced, whether it is still running,
// and where its clock stands. What a run does reaches the page as records and as nothing else: the engine's
// present is far ahead of the diagram, so a page that drew from it would show what it has not yet played.
function report(extra) {
  const entries = session.entries.splice(0); // in place: the monitor's observer holds this array
  self.postMessage({
    type: 'step',
    entries,
    alive: session.engine.isAlive(),
    time: session.engine.getCurrentTime(),
    ...extra
  });
}

self.onmessage = async (event) => {
  const message = event.data;
  try {
    Module = Module || await ready;
  } catch (err) {
    self.postMessage({ type: 'error', error: 'engine module failed to load: ' + String(err) });
    return;
  }

  try {
    if (message.type === 'loadModel') {
      // a new model starts fresh: report exactly the sources of the inputs it declares so the page can prompt
      modelXml = message.model;
      inputContents = {};
      const probe = new Module.Input(modelXml);
      const required = JSON.parse(probe.getInputSources());
      probe.delete();
      self.postMessage({ type: 'inputs', required });
      return;
    }

    if (message.type === 'describe') {
      // What the model resolves, which the records cannot say: which nodes perform sequentially and which
      // activities each performs. It is asked of the model rather than of a run, so it is the same answer
      // before a run, during one and while a recorded log is replayed. A model declaring inputs cannot be
      // built without their content, so this is asked once the contents are in.
      self.postMessage({
        type: 'described',
        described: JSON.parse(Module.describeModel(JSON.stringify({ model: modelXml, inputs: inputContents })))
      });
      return;
    }

    if (message.type === 'input') {
      inputContents[message.source] = message.content;
      return;
    }

    if (message.type === 'run') {
      if (!modelXml) {
        self.postMessage({ type: 'error', error: 'no model loaded' });
        return;
      }
      // one Input per Engine (consumed by construction)
      const input = new Module.Input(modelXml);
      for (const [ source, content ] of Object.entries(inputContents)) {
        input.addInputContent(source, content);
      }
      input.setInstance(message.instances);

      const log = [];
      const monitor = new Module.Monitor();
      monitor.addObserver((entryJson) => log.push(JSON.parse(entryJson)));

      // the caller owns the seed (Refresh re-rolls it); fall back to a random one if none was supplied
      const seed = Number.isFinite(message.seed) ? message.seed : Math.floor(Math.random() * 0x7fffffff);
      // greedy: every dispatcher of the composition speaks, so the run settles everything itself
      const controller = new Module.Controller(JSON.stringify({ dispatchers: COMPOSITION }));
      const engine = new Module.Engine(input, PROVIDER(seed), controller, monitor);
      input.delete();
      engine.advanceTime(0);

      const startedAt = performance.now();
      await engine.run(0); // the deciders settle every decision and the engine advances time
      const engineMs = performance.now() - startedAt;

      const done = {
        type: 'done',
        log,
        seed,
        time: engine.getCurrentTime(),
        objective: engine.getObjective(),
        count: log.length,
        engineMs
      };
      engine.delete();
      controller.delete();
      monitor.delete();
      self.postMessage(done);
      return;
    }

    if (message.type === 'start') {
      if (!modelXml) {
        self.postMessage({ type: 'error', error: 'no model loaded' });
        return;
      }
      beginSession(message.instances, message.seed, false);
      // the run is carried forward as far as it goes, which is where the engine first waits for the reader
      session.engine.initialize(0);
      while (await step()) {
      }
      report();
      return;
    }

    if (message.type === 'initialize') {
      if (!modelXml) {
        self.postMessage({ type: 'error', error: 'no model loaded' });
        return;
      }
      // The run is prepared and not carried forward: its opening clock tick is reported and the page then
      // asks for one advance at a time, so the engine is never further ahead than what the page has drawn.
      beginSession(message.instances, message.seed, message.greedy);
      session.engine.initialize(0);
      report({ seed: session.seed });
      return;
    }

    if (message.type === 'setMode') {
      if (!session) {
        self.postMessage({ type: 'error', error: 'no run to change the mode of' });
        return;
      }
      // The mode is which dispatchers speak, so it turns over between fetches and the run survives it.
      // Silencing withholds nothing but dispatching, so what was silent has kept observing and answers
      // from an up-to-date set at the very next advance.
      for (const index of GREEDY_ONLY) {
        if (message.greedy) {
          session.controller.activate(index);
        } else {
          session.controller.deactivate(index);
        }
      }
      // A greedy run lets the engine advance time, a manual one holds it, which also turns over at once.
      if (message.greedy) {
        session.engine.advanceTime(0);
      } else {
        session.engine.holdTime();
      }
      report();
      return;
    }

    if (message.type === 'advance') {
      if (!session) {
        self.postMessage({ type: 'error', error: 'no run to advance' });
        return;
      }
      // one event; `advanced` is false once the engine waits for the caller or the run is terminated, which
      // `alive` tells apart
      const advanced = await step();
      report({ advanced });
      return;
    }

    if (message.type === 'choiceCandidates') {
      // What a choice may take, which no record says: only an engine standing at the token can evaluate a
      // condition against the status, the data and the globals it then holds. A decision task states its
      // choices in order and a later one may depend on the earlier ones, so this is asked for one choice at
      // a time, against the values already selected. It asks and does not advance: the run stands exactly
      // where it stood.
      self.postMessage({
        type: 'choiceCandidates',
        candidates: session
          ? JSON.parse(session.controller.getChoiceCandidates(
            message.instanceId, message.nodeId, JSON.stringify(message.selectedValues || [])))
          : {}
      });
      return;
    }

    if (message.type === 'enqueue') {
      if (!session) {
        self.postMessage({ type: 'error', error: 'no run to continue' });
        return;
      }
      // One channel for everything the user decides. The kinds a controller offers are named here and
      // nowhere else, so a decision this application does not yet make needs no protocol of its own.
      const controller = session.controller;
      const payload = message.payload ? JSON.stringify(message.payload) : null;
      const queued = {
        clockTick: () => controller.enqueueClockTickEvent(),
        termination: () => controller.enqueueTerminationEvent(),
        entry: () => controller.enqueueEntryDecision(payload),
        exit: () => controller.enqueueExitDecision(payload),
        choice: () => controller.enqueueChoiceDecision(payload),
        messageDelivery: () => controller.enqueueMessageDeliveryDecision(payload)
      }[message.event];

      if (!queued) {
        self.postMessage({ type: 'error', error: 'unknown event: ' + message.event });
        return;
      }

      // Queued and no more: what the caller decided is dispatched at the next fetch, and the caller asks
      // for that fetch itself, so the engine never runs further than what the page has drawn.
      queued();
      report();
      return;
    }

    if (message.type === 'stop') {
      endSession();
      self.postMessage({ type: 'stopped' });
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.message) || err) });
  }
};
