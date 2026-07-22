import { is, isAny } from 'bpmn-js/lib/util/ModelUtil';

/**
 * EngineLogPlayer — plays back a BPMN-OS engine execution log (`-log.json`) as animated token flow.
 *
 * It is registered as the `playback` service, so bpmn-js-animation's **TokenPanel** (the "Tokens" side
 * tab: Load log / run / pause / speed) drives it exactly as it drives the packaged `Playback` — same
 * `play(log)` / `pause` / `resume` / `stop` / `getState` interface and `playback.changed` event. The
 * difference is only what `play(log)` does: it **resolves the engine's own token vocabulary natively**,
 * it does NOT translate the log into bpmn-js-animation's five-action execution log. It reads each
 * token-state change and drives the `animation` service directly, so the full engine semantics
 * (states, status/data/globals) stay intact.
 *
 * The engine's token model and the animation's token model are the same shape — an instance-root scope
 * token spawns a child at the scope's start event, the child flows node→node, and an inner end event
 * bubbles the scope to completion — so resolution is a per-state mapping, not a reconstruction:
 *
 *   identity           label = instanceId; a process/scope-level token (no nodeId) keys on the processId
 *   birth              process/scope ENTERED, or a scope start event ENTERED  → createToken
 *   flow hop           DEPARTED(source, flow) → advanceToken travel to the far node (arrival rides the flow)
 *   activity dwell     READY → entry/pulse · ENTERED → entry · BUSY → busy/pulse · COMPLETED → completion/pulse
 *   event/gateway      ENTERED → anchor centre · BUSY → pulse in place (e.g. a timer waiting)
 *   death              DONE / WITHDRAWN / FAILED → consumeToken (flip + fade out)
 *
 * In playback the manual "bounce" wait cue is replaced by a calmer "pulse" at the same position.
 * Transport (play / pause / resume / stop, speed) mirrors bpmn-js-animation's `Playback`.
 */

const ENTRY = 'entry';
const BUSY = 'busy';
const COMPLETION = 'completion';

// playback shows a resting/working token as a pulse (manual simulation would bounce at the same spot)
const CUE = 'pulse';

function abortError() {
  const err = new Error('playback aborted');
  err.aborted = true;
  return err;
}

// True for a multi-instance activity node (its token spawns per-instance sub-tokens).
function isMultiInstanceNode(element) {
  const lc = element && element.businessObject && element.businessObject.loopCharacteristics;
  return !!(lc && lc.$type === 'bpmn:MultiInstanceLoopCharacteristics');
}

export default function EngineLogPlayer(eventBus, animation, primitives, elementRegistry) {
  this._eventBus = eventBus;
  this._animation = animation;
  this._primitives = primitives;
  this._elementRegistry = elementRegistry;

  this._log = null;
  this._state = 'idle'; // 'idle' | 'playing' | 'paused'
  this._paused = false;
  this._aborted = false;
  this._resumers = [];
  this._run = Promise.resolve();
  this._time = null;
  this._logSource = null; // optional consumer hook: yields a log on demand (see setLogSource)

  // abort a run if the diagram is swapped out from under it
  eventBus.on([ 'diagram.clear', 'diagram.destroy' ], () => {
    this._aborted = true;
    this._paused = false;
    this._drainResumers();
  });
}

EngineLogPlayer.$inject = [ 'eventBus', 'animation', 'primitives', 'elementRegistry' ];

// --- log + transport ---------------------------------------------------------

/** Load an engine `-log.json` (the parsed array of `{ token | event | message }` entries). */
EngineLogPlayer.prototype.setLog = function(log) {
  this._log = Array.isArray(log) ? log : null;
  this._eventBus.fire('playback.log', { log: this._log });
};

EngineLogPlayer.prototype.hasLog = function() {
  return !!(this._log && this._log.length);
};

EngineLogPlayer.prototype.getState = function() {
  return this._state;
};

/**
 * Register (or clear, with `null`) a log source — a function returning `log | Promise<log>` that yields the
 * log lazily when playback starts (here: a greedy engine run). Mirrors bpmn-js-animation's `Playback`, so
 * the TokenPanel's run button drives it identically: the source is consulted only on an idle→start, never
 * on resume. Firing `playback.changed` lets the panel re-enable its run button when a source appears.
 */
EngineLogPlayer.prototype.setLogSource = function(source) {
  this._logSource = source || null;
  this._eventBus.fire('playback.changed', { state: this._state });
};

EngineLogPlayer.prototype.getLogSource = function() {
  return this._logSource;
};

/** The latest simulated time seen in the stream (clock ticks / token timestamps), or null. */
EngineLogPlayer.prototype.getTime = function() {
  return this._time;
};

/** Animation duration per step, in ms (shared with the animation service). */
EngineLogPlayer.prototype.setSpeed = function(durationMs) {
  this._primitives.setAnimationDuration(durationMs);
};
EngineLogPlayer.prototype.getSpeed = function() {
  return this._primitives.getAnimationDuration();
};

EngineLogPlayer.prototype._setState = function(state) {
  if (state === this._state) {
    return;
  }
  this._state = state;
  this._eventBus.fire('playback.changed', { state });
};

EngineLogPlayer.prototype._setTime = function(time) {
  if (time == null || time === this._time) {
    return;
  }
  this._time = time;
  this._eventBus.fire('playback.time', { time });
};

EngineLogPlayer.prototype._drainResumers = function() {
  const rs = this._resumers;
  this._resumers = [];
  rs.forEach(r => r());
};

// awaited before each entry: holds while paused, throws to abort
EngineLogPlayer.prototype._gate = async function() {
  if (this._aborted) {
    throw abortError();
  }
  if (this._paused) {
    await new Promise(resolve => this._resumers.push(resolve));
  }
  if (this._aborted) {
    throw abortError();
  }
};

/**
 * (Re)start playback from a clean diagram. `log` is the execution log to play (the TokenPanel passes the
 * one loaded via "Load log"); it falls back to a previously `setLog`'d log.
 */
EngineLogPlayer.prototype.play = async function(log) {
  if (log && log.length) {
    this._log = log;
  }
  if (!this.hasLog()) {
    return;
  }
  if (this._state !== 'idle') {
    await this.stop();
  }
  this._aborted = false;
  this._paused = false;
  this._time = null;
  this._animation.clear();
  this._setState('playing');

  const entries = this._log;
  this._run = (async () => {
    try {
      for (const entry of entries) {
        await this._gate();
        if (entry.token) {
          await this._applyToken(entry.token);
        } else if (entry.event) {
          await this._applyEvent(entry.event);
        }
        // message entries are not visualised yet
      }
    } catch (err) {
      if (!(err && err.aborted)) {
        throw err;
      }
    } finally {
      this._paused = false;
      this._resumers = [];
      this._setState('idle');
    }
  })();

  return this._run;
};

EngineLogPlayer.prototype.pause = function() {
  if (this._state === 'playing') {
    this._paused = true;
    this._setState('paused');
  }
};

EngineLogPlayer.prototype.resume = function() {
  if (this._state === 'paused') {
    this._paused = false;
    this._drainResumers();
    this._setState('playing');
  }
};

EngineLogPlayer.prototype.stop = async function() {
  if (this._state === 'idle') {
    return;
  }
  this._aborted = true;
  this._paused = false;
  this._drainResumers();
  try {
    await this._run;
  } catch (err) {
    // an abort surfaces as a rejected run on some paths — swallow it
  }
};

/** One run/pause button: idle→play, playing→pause, paused→resume. */
EngineLogPlayer.prototype.toggle = function(log) {
  if (this._state === 'playing') {
    this.pause();
  } else if (this._state === 'paused') {
    this.resume();
  } else {
    this.play(log);
  }
};

// --- resolution --------------------------------------------------------------

EngineLogPlayer.prototype._applyEvent = async function(event) {
  // the stream interleaves engine events; the clock tick is the one that advances simulated time. The
  // engine carries the tick time in `time` (older logs used `timestamp`).
  if (event.event === 'clocktick') {
    const t = typeof event.time === 'number' ? event.time : event.timestamp;
    if (typeof t === 'number') {
      this._setTime(t);
      // real-time pause per tick — a quarter of the animation-step duration (~250ms at the 1000ms
      // default → ~4 ticks/s), so the on-canvas clock is seen counting up while simulated time advances
      // with no token movement (e.g. a task running its duration).
      const ms = this._primitives.getAnimationDuration() / 4;
      if (ms) {
        await new Promise(resolve => setTimeout(resolve, ms));
      }
    }
  }
};

EngineLogPlayer.prototype._applyToken = async function(token) {
  try {
    // Serialise behind the stack/auto-focus reveal arc (600ms): settle any in-flight arc BEFORE this
    // step (so a createToken doesn't add a dot mid-arc — createToken, unlike advanceToken, doesn't wait
    // on its own), then let this step's own arc settle before the next entry runs.
    await this._animation.whenFocused();
    await this._resolve(token);
    await this._animation.whenFocused();
  } catch (err) {
    // a single mis-resolved entry must not tear down the whole run — report it and carry on
    console.warn('[enginePlayback] could not apply token entry', token, err);
  }
  const ts = token.status && token.status.timestamp;
  if (typeof ts === 'number') {
    this._setTime(ts);
  }
};

EngineLogPlayer.prototype._resolve = async function(token) {
  const { instanceId, nodeId, sequenceFlowId, state } = token;
  const label = instanceId;
  const node = nodeId || token.processId; // a process/scope-level token keys on the process id
  const anim = this._animation;

  const element = this._elementRegistry.get(node);

  // EVENT-SUB-PROCESS SCOPE TOKEN — the engine emits a scope token at the event-sub-process node itself
  // for every firing ("<enclosing>^<evtsp>#<k>"). The animation already represents a firing by the token
  // at its START EVENT (which stacks the firing at the event-sub node), so this scope token is redundant —
  // and its "^<evtsp>#<k>" id even collides with the MI-sub id shape (`_miParent`), double-stacking the
  // event-sub node. Skip it: the start-event token owns the firing's stack key and drops it on consume.
  if (nodeId && element && is(element, 'bpmn:SubProcess') &&
      element.businessObject && element.businessObject.triggeredByEvent) {
    return;
  }

  // a process/scope-level token (no nodeId) is always container-like; otherwise classify the node
  const containerLike = !nodeId || (element && isAny(element, [ 'bpmn:Activity', 'bpmn:Process', 'bpmn:Participant' ]));

  // BIRTH — a token that first appears at a node WITHOUT arriving via a flow must be created. This is:
  //  - a process/scope root, or a scope's (inner) start-event child   → first logged as ENTERED
  //  - a multi-instance sub-instance awaiting its entry decision       → first logged as READY (^node#k)
  //  - an ad-hoc sub-process's no-incoming child activity              → first logged as CREATED
  // createToken dispatches by node kind (process / start event / MI activity / activity / boundary); a
  // token reached along a flow already exists here, and a node createToken can't make throws → skipped.
  if (!sequenceFlowId && (state === 'CREATED' || state === 'READY' || state === 'ENTERED') &&
      !anim.getToken(node, label)) {
    if (!this._birth(node, label, element)) {
      return; // couldn't create it (e.g. a gateway / plain event with no token) — nothing to draw
    }
    await anim.whenEntered(node, label); // let the entrance flip play (and be seen) before any next step
    await anim.whenFocused();
    // CREATED flips in and continues; ENTERED sits at its birth position (no anim). Only READY still
    // adds the wait pulse below (it is waiting for the entry decision).
    if (state !== 'READY') {
      return;
    }
  }

  // MULTI-INSTANCE MAIN — the token at an MI activity whose label is NOT a sub-instance ("…^node#k") is
  // the outer/main thread. In the animation model it stays resting on the incoming flow (the spawn point)
  // and NEVER enters: the lib hides it (`_parkMIParent`) once a sub starts running and reveals it onto the
  // outflow on the last sub's consume. So we skip the container sweeps for it — advancing it to entry/busy
  // would wrongly park it and show it stacked among the sub-instances. Only its flow hop / death act here.
  if (nodeId && isMultiInstanceNode(element) && !this._miParent(node, label)) {
    switch (state) {
      case 'ARRIVED':
        this._cue(node, label, CUE, sequenceFlowId); // pulse-pause on the inflow while it can still spawn
        return;
      case 'DEPARTED':
        // released onto the outflow by the last sub's consume — travel it onward
        return sequenceFlowId ? anim.advanceToken({ node, label, sequenceFlow: sequenceFlowId }) : undefined;
      case 'DONE':
      case 'WITHDRAWN':
      case 'FAILED':
        return anim.getToken(node, label) ? anim.consumeToken({ node, label }) : undefined;
      case 'FAILING':
        this._error(node, label);
        return;
      default:
        return; // READY / ENTERED / BUSY / COMPLETED / EXITING / WAITING: stay put; the lib parks it
    }
  }

  // REVEAL-THEN-ACT — mirror the Animator's replay: when following instances (auto-focus on), bring this
  // token's plane + instance to the front and let the stack scroll SETTLE **before** its step animates,
  // so a back-stacked token is seen scrolling in and THEN moving (not already moved).
  //
  // Only when the step actually MOVES the token, though: a cue-only state — arrival / wait pulse, an
  // event's busy/completed, exiting — changes nothing positional, so it must NOT scroll the stack, else a
  // back instance is yanked to the front just to change a pulse. Moves are the advanceToken/travel steps:
  // READY/ENTERED (→ entry or centre), DEPARTED (→ flow), and — for a container only — BUSY/COMPLETED.
  const moves = state === 'READY' || state === 'ENTERED' || state === 'DEPARTED' ||
    (containerLike && (state === 'BUSY' || state === 'COMPLETED'));
  if (moves && anim.isAutoFocus && anim.isAutoFocus()) {
    const current = anim.getToken(node, label);
    if (current) {
      if (typeof this._primitives.drillTo === 'function') {
        this._primitives.drillTo(node); // follow across planes (a collapsed sub-process body)
      }
      anim.focusToken(current);
      await anim.whenFocused();
    }
  }

  switch (state) {

    case 'CREATED':
      return; // handled by the birth above

    case 'READY':
      // an activity / MI instance awaiting its entry decision — ready (entry) position, pulsating
      return anim.advanceToken({ node, label, position: ENTRY, animate: CUE });

    case 'ENTERED':
      if (containerLike) {
        // admitted — settle at the ready (entry) position, no wait cue (about to proceed).
        // A standard-loop re-entry sweeps backward from completion, which advanceToken permits.
        return anim.advanceToken({ node, label, position: ENTRY, animate: null });
      }
      // an event/gateway reached along a flow — anchor at its centre (a throw/end flies its symbol here)
      return anim.advanceToken({ node, label });

    case 'BUSY':
      if (containerLike) {
        return anim.advanceToken({ node, label, position: BUSY, animate: CUE });
      }
      // a catch event doing its work (e.g. a timer counting down) — pulse in place. A cue-only change
      // (no position change) does not wait: the pulse persists on the token until the next state.
      this._cue(node, label, CUE);
      return;

    case 'COMPLETED':
      if (containerLike) {
        return anim.advanceToken({ node, label, position: COMPLETION, animate: CUE });
      }
      this._cue(node, label, null);
      return;

    case 'EXITING':
      // about to leave the activity — clear the wait cue, still resting at completion
      if (containerLike) {
        this._cue(node, label, null);
      }
      return;

    case 'DEPARTED':
      // a flow hop: travel along the sequence flow to the far node (departure/arrival ride the flow)
      if (sequenceFlowId) {
        return anim.advanceToken({ node, label, sequenceFlow: sequenceFlowId });
      }
      return;

    case 'ARRIVED':
      // the DEPARTED travel already moved it here; it now rests on the incoming flow — pulsate while it
      // awaits the ready event (R1: arrival position, pulsating)
      this._cue(node, label, CUE, sequenceFlowId);
      return;

    case 'WAITING':
      // an MI main token, or a token parked at a converging gateway — pulse in place. Cue-only, so no wait.
      this._cue(node, label, CUE);
      return;

    case 'DONE':
    case 'WITHDRAWN':
    case 'FAILED':
      // the token leaves the model — flip + fade out (consumeToken's standard exit)
      if (anim.getToken(node, label)) {
        return anim.consumeToken({ node, label });
      }
      return;

    case 'FAILING':
      // a failing scope, unwinding its children — flash the error effect (R1: emit error icon)
      this._error(node, label);
      return;

    default:
      return;
  }
};

// Create a token that appears at a node without arriving via a flow. Only the process/scope instance
// root is created without a parent; every other token is handed its parent explicitly (the animation
// lib infers nothing — it takes what it is given). Throws for a node the lib can't create → "not a birth".
EngineLogPlayer.prototype._birth = function(node, label, element) {
  try {
    const parent = this._parentOf(node, label, element); // { parentNode, parentLabel } or undefined
    this._animation.createToken({ node, label, ...(parent || {}) });
    return true;
  } catch (err) {
    console.warn('[enginePlayback] birth createToken failed', node, label, err);
    return false;
  }
};

// The parent reference a birth hangs off as { parentNode, parentLabel } — undefined only for the
// process/scope instance root. The workbench owns the token hierarchy; the animation lib keeps no naming
// convention, so the workbench decodes the engine's instance ids here:
//   MI sub-instance ("<parent>^<node>#<k>")   → the main token at the SAME node
//   boundary event                            → the attached activity's token (same label)
//   event-sub-process start ("…^<esp>#<k>")   → the event-subprocess's ENCLOSING scope instance
//   otherwise (start event, ad-hoc child, MI main, catch) → the enclosing scope token (same label)
EngineLogPlayer.prototype._parentOf = function(node, label, element) {
  if (!element) {
    return undefined;
  }
  const mi = this._miParent(node, label);
  if (mi) {
    return mi;
  }
  if (is(element, 'bpmn:BoundaryEvent')) {
    const host = element.businessObject && element.businessObject.attachedToRef;
    return host ? { parentNode: host.id, parentLabel: label } : undefined;
  }
  const scope = element.parent;
  if (!scope) {
    return undefined;
  }
  const scopeBo = scope.businessObject;
  if (scopeBo && scopeBo.triggeredByEvent && is(scope, 'bpmn:SubProcess')) {
    // an event-sub-process firing hangs off the event-subprocess's enclosing scope instance; the engine
    // ids the firing "<enclosing>^<esp>#<k>", so its enclosing instance is the id minus "^<esp>#<k>".
    const enclosing = scope.parent;
    const s = String(label);
    const slot = '^' + scope.id + '#';
    const at = s.lastIndexOf(slot);
    const enclosingLabel = at > -1 ? s.slice(0, at) : s;
    return enclosing ? { parentNode: enclosing.id, parentLabel: enclosingLabel } : undefined;
  }
  return { parentNode: scope.id, parentLabel: label };
};

// The MI main a sub-instance spawns from as { parentNode, parentLabel }, or undefined for anything else.
// The engine ids an MI sub "<parent>^<miNode>#<k>" (a convention the workbench owns, not the lib), so its
// main is at (node, "<parent>") — the id with the "^<node>#<k>" slot for THIS node removed. Gated on the
// node actually being a multi-instance activity, since a NON-interrupting event-sub firing shares the very
// same "<enclosing>^<node>#<k>" id shape — without this, an event-sub token would be mis-read as an MI sub.
EngineLogPlayer.prototype._miParent = function(node, label) {
  if (!isMultiInstanceNode(this._elementRegistry.get(node))) {
    return undefined;
  }
  const s = String(label);
  const slot = '^' + node + '#';
  const at = s.lastIndexOf(slot);
  if (at > -1 && /^\d+$/.test(s.slice(at + slot.length))) {
    return { parentNode: node, parentLabel: s.slice(0, at) };
  }
  return undefined;
};

// Set a resting token's motion cue, tolerating a token that is not (yet) there. `sequenceFlow` targets a
// token resting on that flow (e.g. one that just arrived), otherwise the anchored token at the node.
EngineLogPlayer.prototype._cue = function(node, label, animate, sequenceFlow) {
  try {
    if (this._animation.getToken(node, label, sequenceFlow)) {
      this._animation.setCue(node, label, animate, sequenceFlow ? { sequenceFlow } : undefined);
    }
  } catch (err) {
    console.warn('[enginePlayback] setCue failed', node, label, err);
  }
};

// Flash the one-shot error effect on a token (R1: FAILING emits an error icon). The `.bts-once-error`
// class is styled in app.less.
EngineLogPlayer.prototype._error = function(node, label) {
  try {
    const token = this._animation.getToken(node, label);
    if (token) {
      this._primitives.playTokenEffect(node, label, 'error', { stackIndices: token.stackIndices });
    }
  } catch (err) {
    console.warn('[enginePlayback] error effect failed', node, label, err);
  }
};
