import EngineRunner from '../engine/EngineRunner.js';
import createInput from '../input/index.js';

/*
 * createGreedy — the greedy-simulation source. It owns a Web Worker running the BPMN-OS wasm engine
 * (EngineRunner) and, while active, shows the input provider in the Tokens tab, where the instance data and
 * each referenced lookup table are edited in place.
 *
 * What it adds to the input is the run: the engine is run ONLY when playback starts, through the panel's
 * log-source hook (`playback.setLogSource`), so the footer's play button runs greedy and pause and resume
 * merely pause and resume the replay. The run is seeded, so a replay is reproducible; the footer's
 * **Refresh** re-rolls the seed and drops the cache, so the next play runs a fresh greedy trajectory.
 *
 * Where the input is shown is not this module's business beyond mounting it: the provider hands back an
 * element and would be mounted elsewhere unchanged.
 *
 * @param {import('bpmn-js/lib/Modeler').default} modeler
 * @returns {{ activate: () => void, deactivate: () => void }}
 */
export default function createGreedy(modeler) {
  const tokenPanel = modeler.get('tokenPanel', false); // hosts the input control + footer transport
  const playback = modeler.get('playback'); // our EngineLogPlayer (registered as `playback`)
  const eventBus = modeler.get('eventBus');

  const runner = new EngineRunner();

  let input = null;         // the input provider, while active
  let controlHandle = null; // handle from tokenPanel.addControl (removes the entry on deactivate)
  let seed = newSeed();     // caller-owned engine seed; Refresh re-rolls it
  let cachedLog = null;     // the current run's log (reproducible replay until Refresh / inputs change)

  function newSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  function activate() {
    if (!tokenPanel || input) {
      return;
    }
    input = createInput(modeler, runner);
    input.onChange(syncSource);
    controlHandle = tokenPanel.addControl(input.element); // below auto-focus, in the controls region
    input.load();
  }

  function deactivate() {
    playback.stop();
    playback.setLogSource(null); // stop offering greedy runs to the transport
    cachedLog = null;
    if (controlHandle) {
      controlHandle.remove();
      controlHandle = null;
    }
    if (input) {
      input.destroy();
      input = null;
    }
  }

  // (Re)register the log source with the transport: offered once the input is ready, withdrawn otherwise.
  // Any prior run is now stale, so drop the cache — the next play runs the engine afresh.
  function syncSource() {
    cachedLog = null;
    playback.setLogSource(input && input.ready() ? produceLog : null);
  }

  // The log source: yields the current run's log, running the engine (with the current seed) on first
  // demand and caching it, so play/pause/resume/stop replay one deterministic run. The input is read on
  // demand, so the engine always sees what is currently typed in. Consulted only on an idle→start.
  async function produceLog() {
    if (cachedLog) {
      return cachedLog;
    }
    try {
      for (const [ name, csv ] of Object.entries(input.getLookups())) {
        runner.setLookup(name, csv);
      }
      const result = await runner.run(input.getInstances(), seed);
      cachedLog = result.log;
      return cachedLog;
    } catch (err) {
      console.error('[greedy] run failed:', err);
      return []; // empty → the play button no-ops; the next play retries
    }
  }

  // Refresh (footer) re-rolls the seed and drops the current run, so the next play runs greedy again with
  // a different trajectory. The panel has already stopped playback + cleared the canvas before firing.
  eventBus.on('tokenPanel.refresh', () => {
    if (!input) {
      return; // only while greedy is active
    }
    seed = newSeed();
    cachedLog = null;
  });

  // a new model was imported (toolbar "Open") — if greedy is active, re-derive its inputs from it
  eventBus.on('import.done', () => {
    if (input) {
      input.load();
    }
  });

  eventBus.on([ 'diagram.destroy' ], () => runner.destroy());

  return { activate, deactivate };
}
