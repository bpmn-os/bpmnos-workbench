/**
 * EngineRunner — a thin, promise-based wrapper around the greedy engine Web Worker (engine-worker.js).
 * One request is in flight at a time (the UI flow is sequential: load a model, then run).
 *
 *   loadModel(xml)         → Promise<string[]>  the lookup-table names the model references
 *   setLookup(name,csv)                         supply one lookup table
 *   run(instanceCsv, seed) → Promise<{ log, seed, time, objective, count }>  one greedy run's token stream
 *                                               (the caller owns the seed, so a re-run can be reproducible)
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
  }

  _fail(err) {
    if (this._pending) {
      const p = this._pending; this._pending = null; p.reject(err);
    } else {
      console.error('[greedy]', err);
    }
  }
}
