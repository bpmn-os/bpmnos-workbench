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
 * where Step is `{ entries, alive, time, objective }`. The entries are the records the engine produced,
 * and they are all a page learns of what a run does: the engine's present runs far ahead of the diagram,
 * so what the page shows follows the records it has drawn rather than the state the engine is in. What the
 * model resolves rather than what a run does is asked once, through `describe`.
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

  /**
   * What the model resolves, which no record says: the sequential performers and the activities each
   * performs. It is asked of the model rather than of a run, so it holds before a run, during one and
   * while a recorded log is replayed, and it is asked once the lookup tables are in, a model referencing
   * them being unbuildable without their content.
   */
  describe() {
    return this._request('described', { type: 'describe' });
  }

  run(instances, seed) {
    return this._request('run', { type: 'run', instances, seed });
  }

  start(instances, seed) {
    return this._request('step', { type: 'start', instances, seed });
  }

  /**
   * What the next choice of a decision task may take, given the values already selected for the choices
   * before it. The engine is asked and not advanced, so a run stands exactly where it stood.
   *
   * It is the one question a run answers that no record does: a choice may be bounded or enumerated by an
   * expression over the status, the data and the globals, and only an engine standing at the token can
   * evaluate one. The answer is `{}` where the request no longer stands, `{ complete: true }` where every
   * choice has a value, and otherwise the attribute and either an enumeration or bounds with a step.
   */
  choiceCandidates(instanceId, nodeId, selectedValues) {
    return this._request('choiceCandidates', {
      type: 'choiceCandidates', instanceId, nodeId, selectedValues
    });
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
    if (msg.type === 'described' && this._pending && this._pending.kind === 'described') {
      const p = this._pending; this._pending = null; p.resolve(msg.described);
      return;
    }

    if (msg.type === 'choiceCandidates' && this._pending && this._pending.kind === 'choiceCandidates') {
      const p = this._pending; this._pending = null; p.resolve(msg.candidates);
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
