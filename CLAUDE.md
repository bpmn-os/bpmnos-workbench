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

The panel is in the side panel's column view, every tab a column with a resizer of its own carrying its
name, and `src/app.js` closes all six when the workbench starts. The application says that and not the
panel: a module registering a tab knows what that tab wants, and only the application knows the whole
arrangement, which is why the six identifiers are named in one place there rather than each module being
told what to ask for. The order is the tabs' priorities, Properties and Issues from upstream and then the
four a run concerns, Tokens, Messages, Sequences and Decisions, the last being the one a reader answers and
therefore the one furthest from the diagram. Which columns a mode hides is not yet decided and nothing
hides one today.

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
  engine's `{token|event|message|messageDeliveryRequest}` stream and drives the `animation` service
  **directly** — it does NOT translate to the library's 5-action execution log. Per-state → animation-call
  mapping (R1 positions, `pulse` in playback).

  A token rests without a cue unless the run is waiting for the reader. The pulse is the animation's
  `pulse-pause`, which that package documents as a decision to pick and which the canvas clock wears while
  the engine waits for a tick, so the two read as one thing; the Tokens tab mirrors it on the row's swatch.
  It is worn at the three places a decision is the reader's and nowhere else: a decision task `BUSY`, an
  activity `READY` where a sequential performer conducts it, and a receive task or an element carrying a
  message event definition `BUSY`. Which activities a performer conducts is asked of the `sequences` store
  rather than derived, so a host without it shows no entry pulse rather than a wrong one, and a
  multi-instance activity needs no case of its own since each instance is a token at the same node.

  It is also the only writer of every store a run fills — the execution state, the messages and the
  sequences — and it writes each record as it draws it. That is what keeps a panel from running ahead of
  the canvas, and it is why a panel must never read the engine's present: a run's records arrive long
  before they are played, so anything derived from a query about the engine would show what the diagram
  has not yet shown.
- `src/playback/index.js` — `EnginePlaybackModule` (`playback: EngineLogPlayer`; list AFTER
  `TokenPanelModule` in `additionalModules` so the override wins). Depends on `AnimationModule`.
- `src/messages/` — the messages a run has sent and not yet disposed of: `Store.js` (plain, keyed by the
  sending node and the sending instance, node-testable), `index.js` (the `messages` service, announcing
  `messages.changed`, clearing with the tokens), `Panel.js` (the "Messages" tab, built from the Tokens tab's
  own classes so the two lists are one appearance), `MessageEntry.js` (a row: BPMN's own message envelope
  with a bullet in the sending token's colour, over the `wb-attribute` lines a token's attributes use),
  `messages.css` (only what the offer to deliver needs, the rest being the Tokens tab's). The player is the
  only writer, applying each record as it replays it and reading the sender's colour then.

  A message a run can still deliver ends in the tokens that may receive it, under "Tokens", each with the
  offer to deliver it there: a paper plane until the delivery is asked for, an hourglass until the record
  reporting it arrives and takes the message from the list. Which tokens those are is derived rather than
  asked for: a `messageDeliveryRequest` record says which senders that token accepts and which header it
  expects, the store keeps that criterion, and a message matches it where its origin is among the senders
  and the values stated on both sides agree. Both sides therefore come from records, so the relation holds
  what the diagram holds. The heading's filter selects on that same relation, so "selected tokens" narrows
  both which messages are listed and which of a message's tokens are shown under it.
- `src/sequences/` — the sequential performers of a run and the order each works through: `Store.js` (plain,
  node-testable, holding what the model resolved and, per performer, the reader's order as one list of keys
  with the divider among them and the token being conducted), `index.js` (the `sequences` service,
  announcing `sequences.changed` and offering the first token above a divider through `manual.decide`),
  `Panel.js` (the "Sequences" tab, one `createOrderedListEntry` per performer holding the conducted token as
  its anchor, the waiting tokens and the divider), `PerformerEntry.js` (the performer drawn as `bpmn-font`'s
  participant, collapsed sub-process or ad hoc sub-process, marked with its token) and `sequences.css`.

  The store is written by the player, as the execution state and the messages are, so it shows what the
  canvas shows: a performer is opened when the token at a performing node is drawn `BUSY` and closed on
  `COMPLETED`, and a token at one of its activities queues on `READY`, is conducted from `ENTERED`, and is
  archived when it exits. Which activities belong to which performer is what the model resolves, asked of
  `describeModel` once a run begins; which token performs for a given activity token is the climb from it to
  the token standing at the performer node, through the animation's own parentage. Nothing decodes an
  identifier and nothing reads the engine's present, which runs far ahead of the diagram.

  A token waiting is where the reader put it. What is offered moves once, to the front of what is still to
  come, and is anchored there, a decision given being one that cannot be taken back; it is greyed when it is
  conducted and stays greyed, archived, once it has left, so the list reads as the order the performer
  worked in. The store holds that invariant itself rather than relying on the panel's arrows. An order is
  offered whenever the store changes or the reader reorders, and only while the transport plays, a paused
  run advancing nothing; an offer the engine has moved past expires and is dropped and is made again when
  the diagram reaches the state that makes it answerable.

  An archived row is frozen: it carries the values the token held as it left, since the execution state
  forgets a token that is gone, and it offers the one control a row of this panel carries, forgetting it. A
  waiting row offers none, the engine queueing a token once and never again, so a row thrown away would be a
  token that could never be performed. "Keep archived tokens", the bar the Tokens tab gives auto-focus,
  governs the keeping rather than the showing: turning it off forgets what is held, and turning it on begins
  the record afresh. The heading's filter lists a performer for its own token, a token of its list, and a
  token standing at an ad hoc sub-process it performs for, and for nothing else in the same process.
- `src/decisions/` — the decision tasks a run waits at and the choices each waits for: `Store.js` (plain,
  node-testable, holding per decision what the engine has answered and what the reader has entered),
  `declarations.js` (the choices a task states, read from `bpmnos:decisions` in the model),
  `DecisionEntry.js` (the task drawn with `bpmnos-js/decision-task-symbol` marked with its token, and a
  choice as its attribute above the control that takes it), `grid.js` (the values a bounded choice admits
  and the arithmetic of moving among them, plain and node-testable), `Panel.js` (the "Decisions" tab) and
  `decisions.css`.

  Which choices a task states is model knowledge and is read from the moddle extension; what each may take
  is a run's answer and is asked of the bridge. The two are separate because a choice is bounded or
  enumerated by an expression over the status, the data and the globals, so only an engine standing at the
  token can evaluate it, and because a decision task states its choices in order with a later one depending
  on the earlier ones — `DecisionTask::determineAlternatives` writes each chosen value into the status
  before evaluating the next condition. So the bridge answers one choice at a time, against the values
  already selected, and `src/manual/index.js` walks it whenever the player announces `playback.drained`,
  which in a manual run is the moment the diagram has caught up and the engine stands still. A value the
  answer no longer admits is cleared, and everything after it with it. What a later choice answered before
  stands until the new answer replaces it, and a position answered with what it already holds is no change
  and announces none: the question is asked again whenever anything moves and usually has the same answer,
  and a store that reported each of those would redraw a control the reader is working in for nothing. The player opens a decision on a
  `choiceRequest` record and closes it when its token reports any state past `BUSY`, on the same terms as a
  message that stops being awaited.

  A bounded choice is answered as two pairs. The bounds the condition states arrive as `lowerBound` and
  `upperBound`, with two corrections already made: a strict bound has been moved inward by the engine's own
  precision, and the bounds of a choice on an attribute that is not a decimal have been raised and lowered
  to whole numbers, which `Choice::getBounds` does because the attribute's type says so and for no other
  reason. The values that may be selected arrive as `lowest` and `highest`, and are the multiples of the
  step within those bounds, counted from zero as `Choice::getEnumeration` counts them. The two pairs differ
  wherever the grid falls beside a bound, whether because the bound is not a multiple or because the engine
  holds a fractional step slightly beside the one written, and where a reader could see that difference at
  the precision shown they are told of it beneath the control.

  A choice within bounds is therefore not an `input` of type number, and this is deliberate. Such a control
  has one notion of a value and one grid, declared through `min` and `step` and expressed in the numbers the
  field carries, where the grid a choice admits is counted from zero and expressed in the numbers the engine
  holds, and a reader is shown neither but a value rounded to a precision they could have written. Asked to
  step, the control moves the value onto its own grid before advancing, so a press is swallowed where the
  rounded number lies just below its multiple and a value is skipped where it lies just above, and what it
  leaves behind is the unrounded number it computed. The field is accordingly a text input marked as a spin
  button, the walking is done in `grid.js` against the values the choice admits, and what the reader types
  is settled on the nearest of them when they are done typing. React Aria's number field is a text field
  with its own arrows for the same reason.

  The list is not redrawn while a control is under a press. It is rebuilt from the store on every change,
  the reader's own entry among them, and an arrow held down is a press on one element: rebuilding takes that
  element away and the walk stops at a value nobody chose. What the store gained meanwhile is drawn when the
  press ends. A choice not yet reachable is drawn all the same, disabled, so the reader sees how many the
  task requires.
- `src/panel-filter.js` — the `all` / `selected tokens` filter of a heading, taking the radio group's name,
  since radios of one name are one group and two tabs are alive at once.
- `src/animation-tokens.js` — the seam between the identities this application speaks and the tokens the
  animation holds. A node is always a process rather than the pool drawn for it, and the animation reports
  that pool, so the two are translated here and nowhere else: the process a node stands for, and the
  animation's token for an identity.
- `demo/panels.html` — the tabs a run concerns over stores fed by hand: no model, no mode, no console. What
  it stands in for is the run — the answers a bridge would give and the description a model would yield —
  and everything else is the application's own, imported from `src/`, the panels and the stores and the walk
  alike. Anything written twice is two things, and the copy on this page would go on agreeing with a panel
  the original had stopped agreeing with, which is the failure this page exists to prevent. It is where a
  panel is designed and reviewed before it is wired to a run.
- `src/token-rows/` — the `tokenRows` service: a token drawn as the Tokens tab draws it, wherever a panel
  asks something of the reader about it. The row is `createTokenEntry` given what the token panel gives its
  own rows, so a token reads the same everywhere; a panel adds a control the row carries and, later, a
  contribution to what the row discloses. A click on a row selects the token as a click in the Tokens tab
  does, reveal and then `token.click`, so a token picked out in one list is picked out everywhere; a token
  the animation has not drawn is inert, and no double click advances anything, the engine advancing tokens
  in this application. The service follows the animation's token events and updates every
  row it handed out, and holds a row under the key its caller gives it — one token is a candidate for many
  messages, and one element cannot stand in two lists.
  A listener that clears must not *return* the clearance: diagram-js stops an event a listener answers, and
  returning from `diagram.clear` kept the canvas from hearing it, which surfaced as `rootDi is undefined`
  from `saveXML`.
- `src/engine/` — the wasm engine and nothing about who drives it: `engine-worker.js` (the Web Worker that
  assembles an `Input` and runs the engine, `Engine.run` being a blocking call) and `EngineRunner.js` (the
  promise-based wrapper the page holds, one request in flight at a time). A step reports the records the
  engine produced, whether it is alive, the time and the objective, and nothing of the engine's present;
  `describe` answers what the model resolves, which no record says and which is the same for every run of
  that model.
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
