/**
 * EngineRunner — a thin, promise-based wrapper around the engine Web Worker (engine-worker.js).
 *
 * The worker answers one request at a time, so this holds a queue and serves them in the order they were
 * made. That the channel is single is the worker's own affair and not something a caller can be expected to
 * work around: the callers here are set off by different things — the player catching up, the reader
 * choosing, the reader deciding — and none of them can know what another is in the middle of. Refusing
 * whoever arrived second would make every caller responsible for the timing of every other, which is a
 * responsibility none of them is in a position to hold.
 *
 * Waiting is not the same as being safe to ask, and this says nothing about the latter. The engine comes to
 * rest after every advance, so it may be asked whenever no advance is under way; whether the answer is
 * about the state the reader is looking at is a question for whoever is driving the run, and `src/live/`
 * answers it there.
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
 * and the same engine driven one event at a time, which is what lets a mode change land where the reader is
 * looking, the engine never being further ahead than what the page has drawn:
 *
 *   initialize(csv, seed, greedy) → Promise<Step>  begin a run without carrying it forward
 *   advance()                     → Promise<Step>  one fetched event; `advanced` says whether to ask again
 *
 * where Step is `{ entries, alive, time, objective }`. The entries are the records the engine produced,
 * and they are all a page learns of what a run does: the engine's present runs far ahead of the diagram,
 * so what the page shows follows the records it has drawn rather than the state the engine is in. What the
 * model resolves rather than what a run does is asked once, through `describe`.
 */
export default class EngineRunner {
  /**
   * @param {Object} [worker]  the worker to speak to, which the application does not give: it is here so
   *                           that what this does with a channel — the order it serves requests in, and what
   *                           it does when the channel fails — can be read without a browser.
   */
  constructor(worker) {
    this._worker = worker
      || new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
    this._pending = null; // { resolve, reject, kind }, the request the worker is answering
    this._queue = [];     // { resolve, reject, kind, message }, those waiting their turn
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
   * Begin a run without carrying it forward, in either mode: one composition, with what only a greedy run
   * adds silenced where `greedy` is false. It answers the run's opening records — the clock tick that
   * states the instant it begins at — and the seed it was given or drew.
   */
  initialize(instances, seed, greedy) {
    return this._request('step', { type: 'initialize', instances, seed, greedy });
  }

  /**
   * Carry the run forward by one fetched event and answer what it produced. The Step's `advanced` says
   * whether it may be asked again: false where nothing was fetched, where the run was told to stop, or
   * where a clock tick left nothing to advance. Asking one event at a time is what keeps the engine from
   * running ahead of what the page has drawn, and therefore what lets a mode change land where the reader
   * is looking.
   */
  advance() {
    return this._request('step', { type: 'advance' });
  }

  /**
   * Change what the run decides for itself, without starting it over. The mode is which of the
   * composition's dispatchers speak, so it turns over between fetches; what was silent has gone on
   * observing and answers from an up-to-date set at the very next advance.
   */
  setMode(greedy) {
    return this._request('step', { type: 'setMode', greedy });
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
      this._queue.push({ resolve, reject, kind, message });
      this._serve();
    });
  }

  /** Hand the worker the next request, where it is not still answering one. */
  _serve() {
    if (this._pending || !this._queue.length) {
      return;
    }

    this._pending = this._queue.shift();
    this._worker.postMessage(this._pending.message);
  }

  /** The worker has answered what it was asked; whoever is next may be asked now. */
  _answer(resolution) {
    const answered = this._pending;

    this._pending = null;
    resolution(answered);
    this._serve();
  }

  _onMessage(msg) {
    if (msg.type === 'ready') {
      return; // module loaded; nothing pending waits on this
    }
    if (msg.type === 'error') {
      this._fail(new Error(msg.error));
      return;
    }
    if (msg.type === 'described' && this._awaiting('described')) {
      this._answer((p) => p.resolve(msg.described));
      return;
    }

    if (msg.type === 'choiceCandidates' && this._awaiting('choiceCandidates')) {
      this._answer((p) => p.resolve(msg.candidates));
      return;
    }

    if (msg.type === 'lookups' && this._awaiting('loadModel')) {
      this._answer((p) => p.resolve(msg.required));
      return;
    }
    if (msg.type === 'done' && this._awaiting('run')) {
      this._answer((p) => p.resolve(msg));
      return;
    }
    if (msg.type === 'step' && this._awaiting('step')) {
      this._answer((p) => p.resolve(msg));
      return;
    }
    if (msg.type === 'stopped' && this._awaiting('stopped')) {
      this._answer((p) => p.resolve());
      return;
    }
  }

  _awaiting(kind) {
    return !!this._pending && this._pending.kind === kind;
  }

  /**
   * The worker has failed. That is the channel itself failing rather than one request going wrong, so
   * everything waiting on it fails with the one being answered: nothing behind it will ever be served.
   */
  _fail(err) {
    const failed = [ ...(this._pending ? [ this._pending ] : []), ...this._queue ];

    this._pending = null;
    this._queue = [];

    if (!failed.length) {
      console.error('[engine]', err);
    }

    failed.forEach((request) => request.reject(err));
  }
}
