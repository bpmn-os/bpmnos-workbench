// The engine worker, serving both a greedy run and a manual one.
//
// `Engine.run` is a single blocking call, so the BPMN-OS wasm engine runs here in a Web Worker rather
// than on the page. It assembles an Input in three steps so the page can prompt for a model's lookup
// tables before running: parse a model and report the lookup tables it references (`loadModel` →
// `lookups`), accept each lookup table's CSV (`lookup`), and — once the instance CSV is supplied — build
// an Engine with NO controller (the autonomous greedy run: greedy controller + guided evaluator +
// TimeWarp clock) and run it (`run` → `done`). No controller is attached, so the engine advances its own
// clock (clock ticks included) and runs to completion. The seed comes from the caller (the page owns it,
// so a re-run can be reproducible and "Refresh" can re-roll it); a given seed → a fixed stochastic sample.
// The whole run's monitor entries arrive in one synchronous burst inside `run`, so we collect them here
// and hand the page the complete log in the `done` message.

import createBPMNOS from '@bpmn-os/bpmnos-wasm';

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
// and where its clock stands.
function report() {
  const entries = session.entries;
  session.entries = [];
  self.postMessage({
    type: 'step',
    entries,
    alive: session.engine.isAlive(),
    time: session.engine.getCurrentTime(),
    objective: session.engine.getWeightedObjective()
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
      const engine = new Module.Engine(input, JSON.stringify({ provider: 'stochastic', seed }), monitor, null);
      input.delete();

      const startedAt = performance.now();
      engine.run(0); // controller === null → autonomous greedy run to completion (TimeWarp drives the clock)
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
      monitor.delete();
      self.postMessage(done);
      return;
    }

    if (message.type === 'start') {
      if (!modelXml) {
        self.postMessage({ type: 'error', error: 'no model loaded' });
        return;
      }
      endSession(); // a previous manual run is replaced

      const input = new Module.Input(modelXml);
      for (const [ name, csv ] of Object.entries(lookupTables)) {
        input.addLookupTable(name, csv);
      }
      input.setInstance(message.instances);

      const entries = [];
      const monitor = new Module.Monitor();
      monitor.addObserver((entryJson) => entries.push(JSON.parse(entryJson)));

      // a controller is what makes the run interactive: no time handler is attached, so the engine stops
      // wherever it can fetch no event, and time advances only by what the caller queues
      const controller = new Module.Controller();
      const seed = Number.isFinite(message.seed) ? message.seed : Math.floor(Math.random() * 0x7fffffff);
      const engine = new Module.Engine(input, JSON.stringify({ provider: 'stochastic', seed }), monitor, controller);
      input.delete();

      session = { engine, monitor, controller, entries };
      engine.run(0);
      report();
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

      queued();
      session.engine.resume();
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
