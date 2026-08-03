// The engine worker.
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
// What a run decides for itself is the controller's composition rather than a mode of the engine, so a
// greedy run is composed of every deciding dispatcher and a clock, and a run the user drives leaves out
// what it is to be asked about.

import createBPMNOS from '@bpmn-os/bpmnos-wasm';

// Every decision settles itself and the clock advances on its own, so a run needs nothing from the page.
// `EnqueuedEvents` precedes `TimeWarp` because a clock answers every fetch: behind it, nothing the page
// enqueues — a termination, say — would ever be dispatched.
const GREEDY = [
  'FirstFeasibleExit', 'FirstFeasibleEntry', 'InstantDirectMessage',
  'FirstEnumeratedChoice', 'CompetingCandidates', 'EnqueuedEvents', 'TimeWarp'
];

const ready = createBPMNOS();
ready.then(() => self.postMessage({ type: 'ready' })).catch(err =>
  self.postMessage({ type: 'error', error: 'engine module failed to load: ' + String(err) }));

let Module = null;
let modelXml = null;
let lookupTables = {};

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
      const controller = new Module.Controller(JSON.stringify({ dispatchers: GREEDY }));
      const engine = new Module.Engine(input, JSON.stringify({ provider: 'stochastic', seed }), controller, monitor);
      input.delete();

      const startedAt = performance.now();
      engine.run(0); // the greedy composition decides everything itself and TimeWarp advances its clock
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
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.message) || err) });
  }
};
