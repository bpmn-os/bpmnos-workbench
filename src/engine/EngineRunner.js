/**
 * EngineRunner — a thin, promise-based wrapper around the engine Web Worker (engine-worker.js). One request
 * is in flight at a time (the flow is sequential: load a model, then run, then step).
 *
 *   loadModel(xml)         → Promise<string[]>  the lookup-table names the model references
 *   setLookup(name,csv)                         supply one lookup table
 *   run(instanceCsv, seed) → Promise<{ log, seed, time, objective, count }>  one greedy run's token stream
 *                                               (the caller owns the seed, so a re-run can be reproducible)
 *
 * A manual run is the same engine driven step by step. It answers with what the engine produced since the
 * last step, so the caller learns of a stall by the engine being alive with nothing more to fetch:
 *
 *   start(instanceCsv, seed) → Promise<Step>    begin a run and let it advance as far as it can
 *   enqueue(event, payload)  → Promise<Step>    queue what the user decided, then let it advance again
 *   stop()                   → Promise<void>    end the run and free the engine
 *
 * where Step is `{ entries, decisions, alive, time, objective }`. The decisions are what the engine is
 * waiting for — `{ type, instanceId, nodeId }`, and for a message delivery the `candidates` it may receive,
 * each `{ origin, sender }` — since only the engine, standing where it stands, can say.
 */
export default class EngineRunner {
  constructor() {
    this._worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
    this._pending = null; // { resolve, reject, kind }
    this._worker.onmessage = (e) => this._onMessage(e.data);
    this._worker.onerror = (e) => this._fail(new Error('engine worker error: ' + (e.message || e.type || e)));
  }

  loadModel(xml) {
    return this._request('loadModel', { type: 'loadModel', model: xml });
  }

  setLookup(name, csv) {
    this._worker.postMessage({ type: 'lookup', name, csv });
  }

  run(instances, seed) {
    return this._request('run', { type: 'run', instances, seed });
  }

  start(instances, seed) {
    return this._request('step', { type: 'start', instances, seed });
  }

  /**
   * Queue one thing the user decided and let the engine carry on. The event names what the controller is
   * asked to queue — `clockTick`, `termination`, `entry`, `exit`, `choice` or `messageDelivery` — so a
   * decision this application does not yet make needs no change here.
   */
  enqueue(event, payload) {
    return this._request('step', { type: 'enqueue', event, payload });
  }

  stop() {
    return this._request('stopped', { type: 'stop' });
  }

  destroy() {
    this._worker.terminate();
  }

  _request(kind, message) {
    return new Promise((resolve, reject) => {
      if (this._pending) {
        reject(new Error('engine busy'));
        return;
      }
      this._pending = { resolve, reject, kind };
      this._worker.postMessage(message);
    });
  }

  _onMessage(msg) {
    if (msg.type === 'ready') {
      return; // module loaded; nothing pending waits on this
    }
    if (msg.type === 'error') {
      this._fail(new Error(msg.error));
      return;
    }
    if (msg.type === 'lookups' && this._pending && this._pending.kind === 'loadModel') {
      const p = this._pending; this._pending = null; p.resolve(msg.required);
      return;
    }
    if (msg.type === 'done' && this._pending && this._pending.kind === 'run') {
      const p = this._pending; this._pending = null; p.resolve(msg);
      return;
    }
    if (msg.type === 'step' && this._pending && this._pending.kind === 'step') {
      const p = this._pending; this._pending = null; p.resolve(msg);
      return;
    }
    if (msg.type === 'stopped' && this._pending && this._pending.kind === 'stopped') {
      const p = this._pending; this._pending = null; p.resolve();
      return;
    }
  }

  _fail(err) {
    if (this._pending) {
      const p = this._pending; this._pending = null; p.reject(err);
    } else {
      console.error('[greedy]', err);
    }
  }
}
