# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**See [`ROADMAP.md`](ROADMAP.md)** for the authoritative implementation plan — the three animation modes
(manual `fa-hand-pointer` / greedy `fa-microchip` / playback `fa-play`), the transport/timing model, the
side-panel design, the `bpmnos-wasm` API contract, requirements R1–R5, and work packages **W0–W4**.

## Current state

**Playback and greedy simulation are built, and the value store and its view are being added.** The
statements further down that greedy simulation and the wasm engine are "not built yet" are out of date:
`src/engine/EngineRunner.js` runs the engine in a Web Worker and `@bpmn-os/bpmnos-wasm` is a declared
dependency. The repository now has tests, `test/*.test.mjs` under `node --test`, whose fixtures are models
parsed with `bpmn-moddle` and whose registries come from `bpmnos-js/collect-execution-data`, so a module is
testable without a diagram. Everything under `src/` is written so that Node can resolve it: a relative import
names its file with its extension, and a directory is named by its `index.js`.

`src/execution-state/` holds what a run produces. `Store.js` is a plain module taking a registry, holding a
token's state and status under that token, a data container under the token that owns it, and the globals
once; `index.js` wires it as the `executionState` service, following the animation's `token.moved`,
`token.removed` and `tokens.cleared`; `sections.js` resolves what a node declares against the store into the
rows a token entry shows; `View.js` draws those rows as three collapsible sections of `bpmn-js-side-panel`
and keeps a shown value current by writing into the element carrying it. `EngineLogPlayer` is the only
writer: it applies each record as it replays it. Neither keyword is held or shown, `Instance` being a token's
label and `Timestamp` being the clock on the canvas. The Tokens tab is given the body through
`config.tokenPanel.renderTokenDetail`, which `bpmn-js-animation` reads as it builds its lists, so the
renderer is passed at construction and creates its view on the first row it draws. The repository has an
`exports` map on the pattern `bpmn-workbench` uses, offering `./execution-state` and its three pieces,
`./playback`, `./engine`, `./input` and `./greedy`; `bpmnos-js` must never consume them, the reverse edge being a cycle.

The canvas carries `bpmnos-js/annotation`, whose execution data box stays usable while a run is on: the
workbench declares that through `config.mode.exceptions`, which `bpmn-js-animation` reads to decide what a
read-only mode still permits, and `bpmnos-js`'s `annotationRole` says which elements those permissions are
about. The Properties tab shows a note there instead of its fields, through `bpmn-js-side-panel`'s
`setNote`, and a mode switch leaves the reader on the tab they were on.

`EngineLogPlayer` gathers the departures of one token at one node and draws them as one fork, since the
engine copies a token per outgoing flow at every diverging gateway but the exclusive one. Instance
identifiers are the engine's own: a multi-instance copy reports its own until it dies, which the engine was
corrected to do (`MI-activity instance token keep their data until DONE`), so the workbench needs no special
case for it. The design and the reasoning behind it are recorded in
`~/Code/bpmnos/Next sprint.md`, decisions D1 to D7.

A Vite app (`npm run dev` / `build` / `preview`; `node >=22`)
mirroring `bpmn-workbench`: a `BpmnModeler` with the full `bpmnos-js` module (moddle + decision-task +
properties panel, auto-hosted as the side panel's "Properties" tab), `bpmn-workbench`'s
rules/issues/toolbar, and **native playback of BPMN-OS engine execution logs**. It boots on a **blank
diagram** — nothing is hardwired: load a model with the toolbar and an engine `-log.json` with the Tokens
tab's "Load log". `src/examples/earliest-arrival.{bpmn,-log.json}` (the EAP instance from
`BPMNOSInstances.jl`) is a loadable sample, not auto-loaded, and the tests play that very log. Greedy
simulation runs the wasm engine live (`src/greedy/`, through `src/engine/` and `src/input/`) and playback
replays a recorded `-log.json`. Manual simulation (`src/manual/`) drives the same engine step by step: its
controller is composed without a clock, so the engine runs as far as it can and then stands still, the
canvas clock pulses once the diagram has caught up, and a click on it enqueues a clock tick that lets the
engine carry on. What it produces is played as it arrives rather than after the run. The decisions a user
will make — a message delivery, a choice, a sequential entry — reach the engine through the same call and
need no protocol of their own.

**Reuse upstream, don't reinvent.** The playback UI is bpmn-js-animation's own **TokenPanel** (the
"Tokens" side-panel tab: run/pause, speed, Load log); the mode toggle uses bpmn-workbench's mode-button
CSS. The only new UI logic is the resolver.

Key source (this repo):
- `src/playback/EngineLogPlayer.js` — registered as the **`playback`** service (overriding
  bpmn-js-animation's packaged `Playback`), so the **TokenPanel** drives it via the same
  `play(log)`/`pause`/`resume`/`stop`/`getState` + `playback.changed` interface. `play(log)` reads the
  engine's `{token|event|message}` stream and drives the `animation` service **directly** — it does NOT
  translate to the library's 5-action execution log. Per-state → animation-call mapping (R1 positions,
  `pulse` in playback).
- `src/playback/index.js` — `EnginePlaybackModule` (`playback: EngineLogPlayer`; list AFTER
  `TokenPanelModule` in `additionalModules` so the override wins). Depends on `AnimationModule`.
- `src/messages/` — the messages a run has sent and not yet disposed of: `Store.js` (plain, keyed by the
  sending node and the sending instance, node-testable), `index.js` (the `messages` service, announcing
  `messages.changed`, clearing with the tokens), `Panel.js` (the "Messages" tab, built from the Tokens tab's
  own classes so the two lists are one appearance), `MessageEntry.js` (a row: BPMN's own message envelope
  with a bullet in the sending token's colour, over the `wb-attribute` lines a token's attributes use). The
  player is the only writer, applying each record as it replays it and reading the sender's colour then.
  A listener that clears must not *return* the clearance: diagram-js stops an event a listener answers, and
  returning from `diagram.clear` kept the canvas from hearing it, which surfaced as `rootDi is undefined`
  from `saveXML`.
- `src/engine/` — the wasm engine and nothing about who drives it: `engine-worker.js` (the Web Worker that
  assembles an `Input` and runs the engine, `Engine.run` being a blocking call) and `EngineRunner.js` (the
  promise-based wrapper the page holds, one request in flight at a time).
- `src/input/` — what a run is given: the "Input" entry holding the instance table and one table per lookup
  the model references, each editable in place. It hands its element back rather than mounting it, so the
  same provider serves any source and any place it is shown.
- `src/greedy/` — the greedy source: the seed, the cached log, and the log source the transport pulls on
  play. It mounts the input provider and runs through `src/engine/`, and owns neither.
- `src/execution-state/` — the values a run produces: `Store.js` (plain, registry-taking, node-testable),
  `index.js` (the `executionState` service, riding the animation's token events), `sections.js` (the rows a
  token entry shows), `View.js` + `execution-state.css` (the body, kept current in place). Requires
  `bpmnos-js/execution-data` in `additionalModules`, which the full `bpmnos-js` module does not bring.
- `test/` — `node --test`; `support/model.mjs` parses a fixture and collects its registry, and
  `support/animation.mjs` stubs the services the player drives, so a whole log replays without a diagram.
- `src/mode-buttons.js` + `mode-buttons.css` — the on-canvas Playback toggle (`mode.setMode('model'|
  'playback')`); CSS copied verbatim from bpmn-workbench (not exported by that package).
- `src/context-pad-compat.js` — copy of bpmnos-js's context-pad shim (that module is not exported).
- `vite.config.js` — a plugin transforms bpmnos-js's preact-JSX-in-`.js` for the production (rollup)
  build; in dev, `optimizeDeps.include: ['bpmnos-js']` pre-bundles it with the jsx loader (which also
  interop-wraps its CommonJS deps like `inherits`).

The engine token model and the animation token model are the **same shape** (an instance-root scope
token spawns a child at its start event; the child flows node→node; an inner end event bubbles the scope
to completion), so resolution is a per-state mapping, not a reconstruction. Token identity = `(instanceId,
nodeId)`; a process/scope-level token (no `nodeId`) keys on `processId`. Loops / sub-process nesting are
handled by the animation service. Not yet: an **error icon** for `FAILING` (a bpmn-js-animation effect,
TODO), gateways fork/join, multi-instance / event-sub-process children (own `instanceId` via
`parent^node#k`), and message visualisation.

**The engine is already compiled to wasm.** `bpmnos-wasm` (sibling repo, below) now compiles the C++
engine to WebAssembly, exposes an interactive JavaScript API, and publishes the built module to its
`dist` branch, with a live demo on GitHub Pages. So the largest part of the milestone, getting the
engine running in the browser and streaming its token log to JS, is **done upstream**: this repo
**consumes** that module instead of building its own wasm, and its remaining work is the adapter from
the engine's token vocabulary to the animation log.

## Goal

`bpmnos-workbench` is to **`bpmnos-js`** what `bpmn-workbench` is to plain **`bpmn-js`**: an
educational modelling app that also **plays back and simulates** execution. The difference is the
engine: instead of the JS token simulator, execution is driven by the **C++ BPMN-OS engine compiled
to WebAssembly**, so playback/simulation reflect the real BPMNOS extension semantics (status
attributes, operators, restrictions, decisions, objectives) rather than a plain-BPMN approximation.

**First milestone — playback only.** Playback itself is **already a working, reusable feature**:
`bpmn-js-animation` plays a **JSON execution log** — its TokenPanel has a "Load log" button
(`accept: application/json`) and `Playback` replays it (see below). So the milestone is *not* to
build playback; it is to **produce that log from the engine**: compile the engine to wasm, run it in
the browser, hook into the token updates it emits (exactly as the C++ `Recorder` does via the
`Observer` interface), and **adapt** those updates into the JSON execution-log format the existing
player consumes. Interactive simulation (user-driven decisions) comes later.

## The four source repositories (read these; match their conventions)

All are siblings under `~/Code` / `~/Code/bpmnos`. Each has its own `CLAUDE.md` — read it first.

- **`~/Code/bpmn-workbench`** — the **reference application** to mirror. Vite app (`npm run dev`),
  `BpmnModeler` + `bpmn-js-side-panel`, and playback/simulation via **`bpmn-js-animation`** (see
  `src/app.js`: `SimulatorModule, PlaybackModule, TokenPanelModule, ModeModule`). Also owns the
  reusable `rules` / `issues` / `toolbar` modules. This is the app skeleton to copy; swap its
  JS-driven simulation for the wasm engine.
- **`~/Code/bpmnos/bpmnos-js`** — the **BPMNOS bpmn-js modules** this app builds on (moddle
  extension `bpmnos.json`, decision-task renderer, properties panel). Package exports `.` (the
  combined module), `./moddle`, `./decision-task`, `./properties`. Depend on this the way
  bpmn-workbench depends on bpmn-js; it already consumes `bpmn-workbench/{rules,issues}`.
- **`~/Code/bpmnos/engine`** — the **C++23 BPMN-OS engine** (`bpmnos-model` + `bpmnos-execution`
  static libs, CMake, Catch2 tests). This is what gets compiled to wasm. Namespaces
  `BPMNOS::Model` (parsing/data) and `BPMNOS::Execution` (engine/controller/observer).
- **`~/Code/bpmnos/bpmnos-wasm`** — the **engine compiled to WebAssembly** with an interactive
  JavaScript API, and the module this app runs the engine through. Three classes in `BPMNOS::WASM`:
  `Engine` (owns the execution engine and its lifecycle), `Monitor` (a passive `Observer` that records
  the token, event, and message log and, through `onNotice`, streams each entry to JS the moment it is
  recorded), and `Controller` (an `EventDispatcher` supplying caller decisions). Every value crosses
  the boundary as a JSON string. The built module is published to the repo's `dist` branch, consumable
  as a package with `github:bpmn-os/bpmnos-wasm#dist`, and a live demo runs at
  `bpmn-os.github.io/bpmnos-wasm`. Read its `CLAUDE.md` first.

## Key architecture: the playback data contract

Playback already works from a JSON log — what's missing is producing that log from the engine. The
two components speak **different token vocabularies**; adapting one to the other *is* the first
milestone.

**What the engine emits.** `BPMNOS::Execution::Recorder` (`execution/observer/src/Recorder.{h,cpp}`)
is an `Observer` (`execution/engine/src/Observer.h` — one virtual `notice(const Observable*)`).
`engine->addSubscriber(recorder, Observable::Type::{Token,Event,Message})` wires it in; each token
change calls `notice()`, which serialises `Token::jsonify()`. A **token observable** is:

```jsonc
{ "processId": "...", "instanceId": "...", "nodeId": "...", "sequenceFlowId": "...",
  "state": "ARRIVED|READY|ENTERED|BUSY|COMPLETED|EXITING|DEPARTED|...",
  "status": { /* named status attributes */ }, "data": { /* named data attributes */ } }
```

(The lifecycle states are the same ones asserted in the engine's execution tests.)

**What playback consumes (already built).** `bpmn-js-animation` replays a JSON **execution log**
(see that repo's `lib/executionLog.js`): a flat array of `{ action, ...fields }` where `action` is
one of `createToken | advanceToken | forkToken | joinTokens | consumeToken`. Load it via the
TokenPanel's "Load log" button (JSON file) or `tokenPanel.setLog(log)`; `Playback` (`lib/Playback.js`)
owns the play/pause/resume/stop state machine and calls `animator.replay(log)`. Everything visual
(icons, cancels, focus) is *derived* on replay, so only these five semantic operations are logged.
**bpmn-workbench already wires all of this** (`SimulatorModule, PlaybackModule, TokenPanelModule,
ModeModule`) — reuse it as-is; do not rebuild playback.

**The work:** translate the engine's `{nodeId, sequenceFlowId, state, ...}` token stream into that
`{action, node, ...}` animation vocabulary (state transitions → create/advance/fork/join/consume),
producing a log the existing player loads. Do this as a new adapter/module in *this* repo — do not
modify `bpmn-js-animation`'s log format. (An early stab could even skip wasm: feed a `Recorder` JSON
log from a native engine run through the adapter into "Load log" to validate the mapping first.)

## Consuming the compiled engine (bpmnos-wasm)

The engine is already compiled to wasm in `bpmnos-wasm`, so this repo does not build its own. Depend
on the published module (`github:bpmn-os/bpmnos-wasm#dist`; the default export `createBpmnos()` returns
a promise of the module), construct an `Engine` and a `Monitor`, attach the monitor, load the model
and the instance CSV, and run.

- **The JS-facing observer already exists.** It is `bpmnos-wasm`'s `Monitor`, the observer these notes
  once anticipated. It records the same token, event, and message JSON the C++ `Recorder` produces,
  wrapping each entry as `{ "token" | "event" | "message": ... }`, and `Monitor.onNotice(cb)` delivers
  each entry, as a JSON string, the moment it is recorded. Entries arrive in the engine's execution
  order, and that order survives even across a worker, because the engine notifies synchronously on
  one thread and a worker's `postMessage` is ordered. This is the token stream the adapter consumes.
- **Run the engine in a worker.** `Engine.start()` is a single blocking call, so run it in a Web
  Worker, as the `bpmnos-wasm` demo does, and forward each `onNotice` entry to the page; the app stays
  responsive and animates as entries arrive. Because playback is paced by the animation of token
  movement, the cost of serialising the log stays hidden behind the wait for movement.
- **Autonomous playback needs no controller.** With no controller attached the engine runs itself
  under the greedy controller with the guided evaluator, which already produces a full log for
  playback. Attach a `Controller` only for interactive simulation.

## Interactive simulation (later)

Interactive simulation is a later milestone, and its model is settled on the `bpmnos-wasm` side. The
engine runs without a time handler, so it processes what it can and stops when its fetch loop finds no
event. The caller then queues one input on the `Controller`, a decision through `submitDecision` or a
termination through `submitTermination`, and calls `resume()`; the engine dispatches the queued input
at the next fetch and runs on, so a tagged `resume(...)` is unnecessary. The one piece not yet built
in `bpmnos-wasm` is the clock tick that advances simulated time, planned as a `submitClockTick` that
enqueues a clock tick event. The workbench is the source of the clock ticks and the user decisions.

## Expected stack & conventions (once scaffolded)

Follow bpmn-workbench / bpmnos-js: **Vite** (`npm run dev` / `build` / `preview`), **less** for
styles, `node --test test/*.test.mjs` for tests, `"node": ">=22"`, ESM, MIT. Everything on the
bpmn-js side is a **diagram-js DI module** added to `BpmnModeler`'s `additionalModules`; optional
deps resolved via `injector.get(name, false)`. Depend on `bpmnos-js` for the BPMNOS moddle +
properties + decision-task, and reuse `bpmn-workbench/{rules,issues,toolbar}` rather than
re-implementing them.
