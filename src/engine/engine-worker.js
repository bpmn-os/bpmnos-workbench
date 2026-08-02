// The greedy-simulation engine worker.
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
  } catch (err) {
    self.postMessage({ type: 'error', error: String((err && err.message) || err) });
  }
};
