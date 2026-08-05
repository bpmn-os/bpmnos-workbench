import { is, isAny } from 'bpmn-js/lib/util/ModelUtil.js';

import { processOf } from '../animation-tokens.js';
import sections from '../execution-state/sections.js';
import { keyOf } from '../sequences/Store.js';

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

export default function EngineLogPlayer(eventBus, animation, primitives, elementRegistry, injector) {
  this._eventBus = eventBus;
  this._animation = animation;
  this._primitives = primitives;
  this._elementRegistry = elementRegistry;

  // The value store, where a host provides one. The player is the only writer: it is the component that
  // walks the log record by record, so it is the only one that knows which record the diagram is showing.
  this._executionState = injector.get('executionState', false);

  // The store of the messages waiting, where a host provides one, on the same terms and for the same reason.
  this._messages = injector.get('messages', false);

  // The store of the sequential performers, on the same terms again: a performer is opened, a token queued,
  // conducted and archived as the records saying so are replayed, so what it holds is what the canvas shows.
  this._sequences = injector.get('sequences', false);

  // The store of the decision tasks waiting for a choice, on the same terms again: a decision appears when
  // the record announcing the request is replayed, and goes when the token carrying it moves on.
  this._decisions = injector.get('decisions', false);

  // What a token declares, which the archive reads to freeze a token's values as it leaves.
  this._executionData = injector.get('executionData', false);

  this._log = null;
  this._state = 'idle'; // 'idle' | 'playing' | 'paused'
  this._paused = false;
  this._aborted = false;
  this._resumers = [];
  this._run = Promise.resolve();
  this._time = null;
  this._logSource = null; // optional consumer hook: yields a log on demand (see setLogSource)
  this._streaming = false; // a run is arriving as it happens (see startStream)
  this._arrival = null;    // resolver awaited by the loop when it has caught up with what has arrived

  // abort a run if the diagram is swapped out from under it
  eventBus.on([ 'diagram.clear', 'diagram.destroy' ], () => {
    this._aborted = true;
    this._paused = false;
    this._drainResumers();
  });
}

EngineLogPlayer.$inject = [ 'eventBus', 'animation', 'primitives', 'elementRegistry', 'injector' ];

// --- log + transport ---------------------------------------------------------

/** Load an engine `-log.json` (the parsed array of `{ token | event | message }` entries). */
EngineLogPlayer.prototype.setLog = function(log) {
  this._log = Array.isArray(log) ? log : null;
  this._eventBus.fire('playback.log', { log: this._log });
};

EngineLogPlayer.prototype.hasLog = function() {
  return this._streaming || !!(this._log && this._log.length);
};

/** The log currently loaded/playing (loaded file or a greedy run), for the panel's "Save log". */
EngineLogPlayer.prototype.getLog = function() {
  return this._log;
};

/**
 * Begin playing a run that is still being produced. The player holds a log that grows: `push` adds what has
 * just arrived and `endStream` says that no more will. Everything else — the transport, the pacing, the
 * store, the messages — is as it is for a recorded log, since a record is a record however it got here.
 */
EngineLogPlayer.prototype.startStream = function() {
  this.beginStream();
  return this.play();
};

/**
 * Declare that records will be pushed, without playing yet. A caller whose run is started by the transport
 * rather than by itself opens the stream here and lets the transport call `play`, which then finds a log
 * that grows rather than one that is complete.
 */
EngineLogPlayer.prototype.beginStream = function() {
  this._streaming = true;
  this._log = [];
};

/** Append records of a run in progress, waking the player if it has caught up. */
EngineLogPlayer.prototype.push = function(entries) {
  if (!entries || !entries.length) {
    return;
  }
  // appended in place: the loop holds this very array, so a fresh one would never reach it
  this._log.push(...entries);
  this._wake();
};

/**
 * No more records are coming: the player finishes what it holds and stops of its own accord. A caller that
 * wants the run abandoned rather than finished calls `stop`, which discards whatever is unplayed.
 */
EngineLogPlayer.prototype.endStream = function() {
  this._streaming = false;
  this._wake();
};

EngineLogPlayer.prototype.isStreaming = function() {
  return this._streaming;
};

EngineLogPlayer.prototype._wake = function() {
  const arrival = this._arrival;

  this._arrival = null;

  if (arrival) {
    arrival();
  }
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

/** The latest simulated time from the stream's clock-tick events (the monotonic global clock), or null. */
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
  if (time === undefined || time === this._time) {
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
  this._time = 0; // the simulation starts at time 0; the clock reads 0 until the first clock tick (1)
  this._animation.clear();
  this._setState('playing'); // fires playback.changed → the clock picks up the 0

  const entries = this._log;
  this._run = (async () => {
    try {
      for (let index = 0; ; index++) {
        // A stream is played as it arrives: having caught up is not the end of it, so the loop waits for
        // the next records and ends only when the run says there are no more.
        while (index >= entries.length) {
          if (!this._streaming) {
            return;
          }
          // the diagram now shows everything that has happened
          this._eventBus.fire('playback.drained', {});
          await new Promise(resolve => { this._arrival = resolve; });
          await this._gate();
        }

        const entry = entries[index];

        await this._gate();
        if (entry.token) {
          // A token leaving a node by several flows at once is reported as one departure per flow, one
          // after the other: the engine makes a copy of the token per outgoing flow and advances each
          // (`StateMachine::createTokenCopies`), which is how every diverging gateway but the exclusive
          // one departs. Taken one at a time the first would carry the token away and the rest would find
          // nothing left, so the departures of one token at one node are gathered here and drawn as the
          // one fork they are.
          const flows = departures(entries, index);

          await this._applyToken(entry.token, flows);
          index += Math.max(flows.length - 1, 0);
        } else if (entry.event) {
          await this._applyEvent(entry.event);
        } else if (entry.message) {
          this._applyMessage(entry.message);
        } else if (entry.messageDeliveryRequest) {
          this._applyDeliveryRequest(entry.messageDeliveryRequest);
        } else if (entry.choiceRequest) {
          this._applyChoiceRequest(entry.choiceRequest);
        }
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
  this._wake(); // a stream parked on records that will never come is released here
  try {
    await this._run;
  } catch (err) {
    // an abort surfaces as a rejected run on some paths — swallow it
  }
  this._setTime(null); // the run is given up, so its time is the time of nothing
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

// The flows one token departs a node by, taken from the departure at `index` and every departure
// immediately following it for the same token at the same node. Empty for anything that is not a
// departure along a flow, in which case the record is drawn as itself.
function departures(entries, index) {
  const first = entries[index].token;

  if (first.state !== 'DEPARTED' || !first.sequenceFlowId) {
    return [];
  }

  const flows = [ first.sequenceFlowId ];

  for (let next = index + 1; next < entries.length; next++) {
    const token = entries[next].token;

    if (!token || token.state !== 'DEPARTED' || !token.sequenceFlowId ||
        token.instanceId !== first.instanceId || token.nodeId !== first.nodeId) {
      break;
    }

    flows.push(token.sequenceFlowId);
  }

  return flows;
}

EngineLogPlayer.prototype._applyToken = async function(token, flows) {
  try {
    // Serialise behind the stack/auto-focus reveal arc (600ms): settle any in-flight arc BEFORE this
    // step (so a createToken doesn't add a dot mid-arc — createToken, unlike advanceToken, doesn't wait
    // on its own), then let this step's own arc settle before the next entry runs.
    await this._animation.whenFocused();
    await this._resolve(token, flows);
    await this._animation.whenFocused();
  } catch (err) {
    // a single mis-resolved entry must not tear down the whole run — report it and carry on
    console.warn('[enginePlayback] could not apply token entry', token, err);
  }
  // NOTE: the clock is driven ONLY by clock-tick events (the monotonic global simulated time). A token's
  // status.timestamp is its own per-instance local time and legitimately moves backward across instances,
  // so feeding it to the clock would reset the readout mid-run — do not use it here.
};

EngineLogPlayer.prototype._resolve = async function(token, flows) {
  const { instanceId, nodeId, sequenceFlowId, state } = token;
  const label = instanceId;
  const node = nodeId || token.processId; // a process/scope-level token keys on the process id
  const anim = this._animation;

  const element = this._elementRegistry.get(node);

  // EVENT SUB-PROCESSES — no record ever names one. A state machine created for a scope puts its tokens on
  // that scope's START NODES (`StateMachine::run`), and a token rests at a sub-process node only by having
  // flowed into it, which an event sub-process is never the target of. A firing is reported as a token at
  // its start event, under the derived instance id "<enclosing>^<evtsp>#<k>" (which `_parentOf` decodes
  // back to the enclosing instance), and as tokens at the nodes within it. So there is nothing to skip
  // here, and the token at the start event is what represents the firing throughout.

  // a process/scope-level token (no nodeId) is always container-like; otherwise classify the node
  const containerLike = !nodeId || (element && isAny(element, [ 'bpmn:Activity', 'bpmn:Process', 'bpmn:Participant' ]));

  // BIRTH — a token that first appears at a node WITHOUT arriving via a flow must be created. This is:
  //  - a process/scope root, or a scope's (inner) start-event child   → first logged as ENTERED
  //  - a multi-instance sub-instance awaiting its entry decision       → first logged as READY (^node#k)
  //  - an ad-hoc sub-process's no-incoming child activity              → first logged as CREATED
  // createToken dispatches by node kind (process / start event / MI activity / activity / boundary); a
  // token reached along a flow already exists here, and a node createToken can't make throws → skipped.
  const birth = !sequenceFlowId && (state === 'CREATED' || state === 'READY' || state === 'ENTERED') &&
    !anim.getToken(node, label);

  if (birth && !this._birth(node, label, element)) {
    return; // couldn't create it (e.g. a gateway / plain event with no token) — nothing to draw
  }

  // THE STORE — one record, one store update, then the animation call it resolves to. The engine runs
  // ahead of the animation, a greedy run producing its whole log before a single dot has moved, so the
  // values are applied here, as the record is replayed, rather than as it arrives. A birth has recorded
  // its parentage just above, which is the relation an attribute's owner is resolved through, so by now
  // the store can place every value this record carries.
  this._apply(token);

  if (birth) {
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
        // the main thread ends: with no outgoing flow it is DONE where it stands, and an interruption
        // withdraws or fails it. Either way it rests on its inflow, which `_consume` accounts for.
        this._forget(node, label);
        return this._consume(node, label);
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
      if (flows && flows.length > 1) {
        return this._departAll(node, label, flows);
      }
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
      // the token leaves the model — flip + fade out (consumeToken's standard exit). What it held goes with
      // it, its status and the container it owns; what it merely read lives on in the entry of the token
      // owning that. The record itself was applied above, so a value it wrote through to an ancestor's
      // container stands. Evicting here rather than leaving it to `token.removed` also covers a token the
      // animation never held, which fires no such event.
      this._forget(node, label);
      return this._consume(node, label);

    case 'FAILING':
      // a failing scope, unwinding its children — flash the error effect (R1: emit error icon)
      this._error(node, label);
      return;

    default:
      return;
  }
};

/**
 * Depart a node by several flows at once, which is what a diverging gateway other than an exclusive one
 * does: the engine copies the token per outgoing flow, so the animation forks.
 *
 * `forkToken` places a branch on an outflow without travelling it, the first one moving the token that was
 * resting at the gateway and each later one cloning a sibling, so the placing is sequential; the travelling
 * is not, the branches leaving together as they do in the engine, where the copies are advanced in one
 * step. Nothing is left at the gateway, which is the engine's own behaviour for a parallel gateway and
 * differs for an event-based one only in that the engine keeps its token there until a branch is triggered
 * and then completes it; that record then finds nothing to consume, which a death already tolerates.
 *
 * It is keyed on the departures rather than on the kind of gateway, so an inclusive gateway is drawn the
 * same way on the day the engine advances one.
 */
EngineLogPlayer.prototype._departAll = async function(node, label, flows) {
  const anim = this._animation;

  for (const sequenceFlow of flows) {
    await anim.forkToken({ node, label, sequenceFlow });
  }

  return Promise.all(flows.map(sequenceFlow => anim.advanceToken({ node, label, sequenceFlow })));
};

// Create a token that appears at a node without arriving via a flow. Only the process/scope instance
// root is created without a parent; every other token is handed its parent explicitly (the animation
// lib infers nothing — it takes what it is given). Throws for a node the lib can't create → "not a birth".
EngineLogPlayer.prototype._birth = function(node, label, element) {
  try {
    const parent = this._parentOf(node, label, element); // { parentNode, parentLabel } or undefined
    this._animation.createToken({ node, label, ...(parent || {}) });

    // the store records the same relation, since resolving which token owns a data container walks it
    if (this._executionState) {
      this._executionState.createToken({ node, label, ...(parent || {}) });
    }
    return true;
  } catch (err) {
    console.warn('[enginePlayback] birth createToken failed', node, label, err);
    return false;
  }
};

/**
 * Consume the token at a node, wherever it rests.
 *
 * A token anchored at the node is consumed by naming the node alone, while one resting on a sequence flow —
 * a token that has arrived and not yet entered, or the main thread of a multi-instance activity parked on
 * its inflow — has to name that flow, the animation refusing to consume a resting token by the node alone
 * so that a caller cannot take away the wrong one. A token the animation does not hold is nothing to
 * consume, which is the case for every node it draws no token at.
 */
EngineLogPlayer.prototype._consume = function(node, label) {
  const token = this._animation.getToken(node, label);

  if (!token) {
    return undefined;
  }

  const sequenceFlow = token.state && token.state.sequenceFlow;

  return this._animation.consumeToken(sequenceFlow ? { node, label, sequenceFlow } : { node, label });
};

// --- the value store ---------------------------------------------------------
//
// Three calls, each guarded, so playback works unchanged in a host that provides no store.

// Apply a record's state, status, data and globals. Every record is applied, whatever state it reports and
// whether or not it moves anything, since the values it carries are the reporting token's either way.
EngineLogPlayer.prototype._apply = function(record) {
  if (this._executionState) {
    this._executionState.apply(record);
  }
  this._applySequence(record);

  // A token waiting for a message stops waiting the moment it reports anything past that waiting, whether
  // it received what it waited for or left without it. The engine withdraws the request and says nothing,
  // so its own record is what says so.
  if (this._messages && record.nodeId && record.state !== 'BUSY') {
    this._messages.settled(record.instanceId, record.nodeId);
  }

  // A decision task waiting for its choices stops waiting on the same terms and for the same reason: the
  // request stands while the token is busy at the task, and any state past that is the run having moved on,
  // whether the choices were made or the token did not survive to make them.
  if (this._decisions && record.nodeId && record.state !== 'BUSY') {
    this._decisions.close(record.instanceId, record.nodeId);
  }
};

// --- the sequential performers ----------------------------------------------
//
// A performer is the token standing at a node that performs, and it performs for as long as that token is
// busy, which is for as long as the scope it stands in runs. A token at one of its activities queues on
// READY, is the one being conducted from ENTERED, and is archived once it exits, staying where it stood as
// a record of what the performer did. Which activities belong to
// which performer is what the model resolved and what the store was given; which token performs for this
// one is the token tree, climbed here because the animation holds it.
EngineLogPlayer.prototype._applySequence = function(record) {
  if (!this._sequences) {
    return;
  }

  const node = record.nodeId || record.processId,
        label = record.instanceId,
        state = record.state;

  if (this._sequences.performsSequentially(node)) {
    if (state === 'BUSY') {
      this._sequences.open(label, node);
    } else if (state === 'COMPLETED' || state === 'FAILED' || state === 'WITHDRAWN') {
      this._sequences.close(label, node);
    }

    return;
  }

  const performerNode = this._sequences.performerOf(node);

  if (!performerNode) {
    return; // no sequential activity, so no performer to place it under
  }

  const performer = this._performerOf(node, label, performerNode);

  if (!performer) {
    return; // the token stands where nothing has been drawn to perform for it
  }

  // the performer is keyed by the node the model named, not by the element the animation drew its token at:
  // a process-level token is drawn at its pool, and this application speaks process ids
  const key = keyOf(performer.label, performerNode),
        token = { label, node };

  if (state === 'READY') {
    this._sequences.queue(key, token);
  } else if (state === 'ENTERED') {
    this._sequences.conduct(key, token);
  } else if (state === 'EXITING' || state === 'DEPARTED' || state === 'DONE' ||
             state === 'FAILED' || state === 'WITHDRAWN') {
    // An archived row is a record rather than a token: what it holds is frozen here, as the token leaves,
    // since the execution state forgets a token that is gone and the row would otherwise disclose nothing.
    this._sequences.archive(key, token, this._valuesOf(node, label));
  }
};

// What a token holds at this moment, in the sections a token entry shows it in, as plain values: a record
// of what was, kept by whoever wants it after the token is gone.
EngineLogPlayer.prototype._valuesOf = function(node, label) {
  if (!this._executionState || !this._executionData || !this._executionData.get(node)) {
    return null; // a host without the stores, or a node that declares nothing
  }

  return sections(this._executionData, this._executionState, node, label);
};

// The token performing for the token at `(node, label)`: the climb from it to the token standing at the
// performer node, which is the walk the engine makes from a child of a sequential ad hoc subprocess. A
// process-level token stands at its pool, so a performer named by a process is matched through it.
EngineLogPlayer.prototype._performerOf = function(node, label, performerNode) {
  let token = this._animation.getToken(node, label);

  while (token) {
    if (token.node === performerNode || processOf(this._elementRegistry, token.node) === performerNode) {
      return token;
    }
    token = this._animation.getParent(token);
  }

  return null;
};

// Apply a message delivery request: a token has begun waiting for a message, and the record says what it
// accepts. Which messages those are is not asked of the engine, since the answer changes with every message
// created while the request stands and the request is not raised again; the criterion does not change, so
// the store keeps it and matches the messages it holds against it.
EngineLogPlayer.prototype._applyDeliveryRequest = function(record) {
  if (this._messages) {
    this._messages.awaiting(record);
  }
};

// Apply a choice request: a decision task waits for its choices to be made. The record says which token
// waits, and nothing more; which choices the task states is read from the model, and what each may take is
// asked of the engine when it is shown, since only an engine standing at the token can evaluate a condition.
EngineLogPlayer.prototype._applyChoiceRequest = function(record) {
  if (this._decisions) {
    this._decisions.open(record.instanceId, record.nodeId);
  }
};

// Apply a message record: a message is held from the record creating it to the one delivering or
// withdrawing it. The colour is read here rather than where the message is shown, because it is the colour
// of the token that sent it and that token has moved on by the time a reader opens the message.
EngineLogPlayer.prototype._applyMessage = function(record) {
  if (this._messages) {
    this._messages.apply(record, this._colorOf((record.header || {}).sender));
  }
};

// The colour an instance's tokens wear, taken from any token of that instance.
EngineLogPlayer.prototype._colorOf = function(label) {
  const token = label && this._primitives.getTokens(token => token.label === label)[0];

  return token ? token.color : null;
};

// Drop what dies with a token.
EngineLogPlayer.prototype._forget = function(node, label) {
  if (this._executionState) {
    this._executionState.removeToken({ node, label });
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
    return enclosing ? { parentNode: scopeId(enclosing), parentLabel: enclosingLabel } : undefined;
  }
  return { parentNode: scopeId(scope), parentLabel: label };
};

// The identifier of an enclosing scope: a pool stands for a process, and the process is what the engine
// reports and what the workbench keys a process-level token by, so a pool is named by its process. The
// animation takes either, mapping a process to its pool itself, so one identifier serves both.
function scopeId(scope) {
  const processRef = scope.businessObject && scope.businessObject.processRef;

  return processRef ? processRef.id : scope.id;
}

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
