// The engine worker, serving both a greedy run and a manual one.
//
// `Engine.run` is a single blocking call, so the BPMN-OS wasm engine runs here in a Web Worker rather
// than on the page. It assembles an Input in three steps so the page can prompt for a model's lookup
// tables before running: parse a model and report the lookup tables it references (`loadModel` →
// `lookups`), accept each lookup table's CSV (`lookup`), and — once the instance CSV is supplied — build
// an Engine and run it (`run` → `done`). The seed comes from the caller (the page owns it, so a re-run can
// be reproducible and "Refresh" can re-roll it); a given seed → a fixed stochastic sample. The whole run's
// monitor entries arrive in one synchronous burst inside `run`, so we collect them here and hand the page
// the complete log in the `done` message.
//
// What a run decides for itself is which of its controller's dispatchers answer, rather than a mode of the
// engine. Both modes are therefore one composition: a greedy run lets every dispatcher of it speak, and a
// manual run silences the two that decide and the clock, so that what the reader is to be asked about
// reaches the page and time advances only when the reader says so.

import createBPMNOS from '@bpmn-os/bpmnos-wasm';

// One composition serves both modes. A run is greedy or manual by which of its dispatchers answer, and that
// is a property the controller turns over between fetches, so nothing is rebuilt when the mode changes and
// a run survives it.
//
// A position is a precedence, and `EnqueuedEvents` comes first because it is what the page says while
// everything behind it is what the run settles for itself: ahead of the deciders, a termination ends the run
// when it is given rather than at the first fetch where none of them has anything to say, and what the
// reader answers is dispatched before anything automatic settles something else. It costs nothing at the
// fetches where it is empty. `TimeWarp` is last because a clock answers every fetch, so nothing behind it
// would ever be reached.
const COMPOSITION = [
  'EnqueuedEvents',
  'FirstFeasibleExit', 'FirstFeasibleEntry', 'InstantDirectMessage',
  'FirstEnumeratedChoice', 'CompetingCandidates', 'TimeWarp'
];

// The dispatchers only a greedy run lets speak: the two that decide, because in a manual run the reader
// decides, and the clock, because the reader ticks it and the engine is to stand still until they do.
// `SequentialEntries` is in neither, the Sequences tab answering the entry of a child of a sequential ad hoc
// subprocess from the order it holds, and `InstantDirectMessage` speaks in both, an addressed delivery being
// no decision. Each dispatcher joins this list as its panel arrives.
//
// The positions are read from the composition rather than written down, so reordering it moves them too.
const GREEDY_ONLY = [ 'FirstEnumeratedChoice', 'CompetingCandidates', 'TimeWarp' ]
  .map(name => COMPOSITION.indexOf(name));

const ready = createBPMNOS();
ready.then(() => self.postMessage({ type: 'ready' })).catch(err =>
  self.postMessage({ type: 'error', error: 'engine module failed to load: ' + String(err) }));

let Module = null;
let modelXml = null;
let lookupTables = {};

// A manual run keeps its engine alive between the page's inputs: the engine returns from `run` and from
// `resume` when it can fetch no further event, the caller queues what is to happen next on the controller,
// and the next `resume` carries on. The entries the monitor collects in between are handed over with each
// answer, since the engine notifies synchronously while it runs and nothing can be posted meanwhile.
let session = null; // { engine, monitor, controller, entries }

// Builds what a session drives: one composition, with what only a greedy run adds silenced where the mode is
// manual. The engine is left as constructed and is not carried forward here, since how far it runs is the
// caller's business — `start` runs it as far as it goes, `initialize` leaves it standing at its first
// instant. A previous session is replaced.
function beginSession(instances, seed, greedy) {
  endSession();

  const input = new Module.Input(modelXml);
  for (const [ name, csv ] of Object.entries(lookupTables)) {
    input.addLookupTable(name, csv);
  }
  input.setInstance(instances);

  const entries = [];
  const monitor = new Module.Monitor();
  monitor.addObserver((entryJson) => entries.push(JSON.parse(entryJson)));

  // Silencing withholds nothing but dispatching, so what is silent goes on observing and is correct the
  // moment the mode turns over. A manual run therefore stops wherever it can fetch no event, and time
  // advances only by what the page queues.
  const controller = new Module.Controller(JSON.stringify({ dispatchers: COMPOSITION }));
  if (!greedy) {
    for (const index of GREEDY_ONLY) {
      controller.deactivate(index);
    }
  }

  // the caller owns the seed (Refresh re-rolls it); fall back to a random one if none was supplied
  const chosenSeed = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 0x7fffffff);
  const engine = new Module.Engine(input, JSON.stringify({ provider: 'stochastic', seed: chosenSeed }), controller, monitor);
  input.delete();

  session = { engine, monitor, controller, entries, seed: chosenSeed };
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
    objective: session.engine.getWeightedObjective(),
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
      // a new model starts fresh: report exactly the lookup tables it references so the page can prompt
      modelXml = message.model;
      lookupTables = {};
      const probe = new Module.Input(modelXml);
      const required = JSON.parse(probe.getLookupTableNames());
      probe.delete();
      self.postMessage({ type: 'lookups', required });
      return;
    }

    if (message.type === 'describe') {
      // What the model resolves, which the records cannot say: which nodes perform sequentially and which
      // activities each performs. It is asked of the model rather than of a run, so it is the same answer
      // before a run, during one and while a recorded log is replayed. A model referencing lookup tables
      // cannot be built without their content, so this is asked once the tables are in.
      self.postMessage({
        type: 'described',
        described: JSON.parse(Module.describeModel(JSON.stringify({ model: modelXml, lookupTables })))
      });
      return;
    }

    if (message.type === 'lookup') {
      lookupTables[message.name] = message.csv;
      return;
    }

    if (message.type === 'run') {
      if (!modelXml) {
        self.postMessage({ type: 'error', error: 'no model loaded' });
        return;
      }
      // one Input per Engine (consumed by construction)
      const input = new Module.Input(modelXml);
      for (const [ name, csv ] of Object.entries(lookupTables)) {
        input.addLookupTable(name, csv);
      }
      input.setInstance(message.instances);

      const log = [];
      const monitor = new Module.Monitor();
      monitor.addObserver((entryJson) => log.push(JSON.parse(entryJson)));

      // the caller owns the seed (Refresh re-rolls it); fall back to a random one if none was supplied
      const seed = Number.isFinite(message.seed) ? message.seed : Math.floor(Math.random() * 0x7fffffff);
      // greedy: every dispatcher of the composition speaks, so the run settles everything itself
      const controller = new Module.Controller(JSON.stringify({ dispatchers: COMPOSITION }));
      const engine = new Module.Engine(input, JSON.stringify({ provider: 'stochastic', seed }), controller, monitor);
      input.delete();

      const startedAt = performance.now();
      engine.run(0); // the deciders settle every decision and TimeWarp advances the clock
      const engineMs = performance.now() - startedAt;

      const done = {
        type: 'done',
        log,
        seed,
        time: engine.getCurrentTime(),
        objective: engine.getWeightedObjective(),
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
      session.engine.run(0);
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
      report();
      return;
    }

    if (message.type === 'advance') {
      if (!session) {
        self.postMessage({ type: 'error', error: 'no run to advance' });
        return;
      }
      // one fetch and the event it returned; `advanced` says whether the run may be asked again
      const advanced = session.engine.advance();
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
