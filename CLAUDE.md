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
`./playback`, `./engine` and `./input`; `bpmnos-js` must never consume them, the reverse edge being a cycle.

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
`BPMNOSInstances.jl`) is a loadable sample, not auto-loaded, and the tests play that very log. Playback
replays a recorded `-log.json`; greedy and manual simulation are one live run of the wasm engine
(`src/live/`, through `src/engine/` and `src/input/`), differing in which of the controller's dispatchers
answer, so the mode turns over without the run beginning again. Greedy lets every dispatcher speak, so the
run settles each decision and advances its own clock. Manual silences the deciders and the clock, so the
engine goes as far as it can and then stands still, the clock of the canvas display pulses once the diagram
has caught up, and a click on it enqueues a clock tick that lets the engine carry on. What a run produces is played as it
arrives rather than after the run. The decisions a user makes — a message delivery, a choice, a sequential
entry — reach the engine through the same call and need no protocol of their own.

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

  A message the run has finished with says what became of it and, where it was delivered, who took it. That
  token is named by the delivery record, which the engine announces before it carries the delivery out and
  which reports it as a decision where the run decided it and as an event where a caller forced it. It is
  held with the colour it was drawn in, since the record outlives the token, and the row that shows it is
  frozen for the same reason.
- `src/sequences/` — the sequential performers of a run and the order each works through: `Store.js` (plain,
  node-testable, holding what the model resolved and, per performer, the reader's order as one list of keys
  with the divider among them and the token being conducted), `index.js` (the `sequences` service,
  announcing `sequences.changed` and offering the first token above a divider through `manual.decide`),
  `Panel.js` (the "Sequences" tab, one `createOrderedListEntry` per performer holding the conducted token as
  its anchor, the waiting tokens and the divider), `PerformerEntry.js` (the performer drawn as `bpmn-font`'s
  participant, collapsed sub-process or ad hoc sub-process, marked with its token), `performers.js` (the
  performers a model states, read from the model itself, plain and node-testable) and `sequences.css`.

  The store is written by the player, as the execution state and the messages are, so it shows what the
  canvas shows: a performer is opened when the token at a performing node is drawn `BUSY` and closed on
  `COMPLETED`, and a token at one of its activities queues on `READY`, is conducted from `ENTERED`, and is
  archived when it exits. Which activities belong to which performer is what the model resolves, asked of
  `describeModel` once a run begins; which token performs for a given activity token is the climb from it to
  the token standing at the performer node, through the animation's own parentage. Nothing decodes an
  identifier and nothing reads the engine's present, which runs far ahead of the diagram.

  A replayed log has no engine to ask, and the answer is a property of the model rather than of a run, so it
  is read from the model instead, by `performers.js` over the moddle tree, whenever a log is replayed and
  whenever a model is imported under one. What it reads is the engine's own resolution and not a reading of
  what a model usually looks like: every ad hoc sub-process is a sequential one, since `Model` builds each as
  a `SequentialAdHocSubProcess` and that refuses any other ordering; the node performing for it is found by
  climbing its parents for the first activity declaring a `bpmn:performer` named `Sequential`, stopping at an
  enclosing ad hoc sub-process, falling back to the process where the process declares one and to the
  sub-process itself where nothing does; and what it performs is that sub-process's direct child activities.
  The two readings are of one model and must agree, a run being replayable beside the run that produced it,
  and they are checked to agree on the corpus. Where the engine's rules change, this changes with them. A run
  the engine drives asks the engine and is not touched by any of this.

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
  token that could never be performed. A performer that closes is kept on the same terms, with the order it
  worked in and the offer to forget it. It keeps the colour of the token that was performing, which the store
  captured when it opened, that colour being what says whose record it is; the tokens it performed for keep
  none, a row that has left being grey precisely to say that it has. The heading's filter lists a performer
  for its own token, a token of its list, and a token standing at an ad hoc sub-process it performs for, and
  for nothing else in the same process.
- The archive of a run: what Messages, Sequences and Decisions each hold of what the run has finished with —
  a message delivered or withdrawn, a performer that has closed and the tokens that have left one, a decision
  that has been answered. Each such thing is kept by its store as a record, faded and offering the one
  control a record carries, removing it from the archive, and each is a record precisely because the run does
  not hold it any more: what it discloses was frozen as it went.

  What a record discloses of its token is the values that token held as it finished at the node, frozen by
  the player when it draws a record reporting `COMPLETED`, `FAILED` or `WITHDRAWN` there. Those three are
  mutually exclusive and are the one point every route out passes through: a task exits and then departs or
  is done, while an intermediate catching event departs straight from `COMPLETED` and never exits at all. A
  loop activity completes once per loop, so what is kept is what it held the last time. The three archives
  draw those values one way, through `src/frozen-values.js`, in the sections and lines a token entry uses and
  written with that entry's own formatter, a value read in a record and the same value read while it was
  current being one value.

  A control a reader acts with lives in a manual run and nowhere else, which `src/answerable.js` answers for
  all three tabs from the `source.changed` the mode buttons announce. A greedy run answers every delivery,
  order and choice itself and playback is a record of a run answered long ago, so the offer to deliver, the
  arrows of an order and the controls of a choice are absent there, the row being read rather than answered.
  The source is what tells the three apart, `mode.getMode()` saying `playback` of a greedy run and of a
  replayed log alike, and it is the same rule the canvas clock follows in deciding whether it may be clicked.

  "Show archive" stands in each tab's footer, drawn once in `src/archive-toggle.js`, and governs the showing
  and not the keeping. A reader asking to see what a run is still doing is not asking to destroy the record
  of what it did, and turning it on again brings the whole of it back. What is forgotten is forgotten one
  entry at a time, so that every act of forgetting is one the reader aimed at something. The tab's own name
  counts what is shown rather than what is held, being what a reader is looking at.

  A replayed log withholds what only an engine could answer, which `src/replayed.js` answers for the three
  tabs from the same `source.changed`. This is a second question and not the first one again: a greedy run is
  no more the reader's to answer than a replay is, but it is a run in progress and may be asked, where a
  replay has nothing to ask. What a record says stands — a message was sent, a decision task is waiting, a
  performer conducted this and is conducting that — and what an engine standing at the token would have
  answered does not. So a message is listed from the moment it was sent and says nothing of who might take
  it, since which tokens may is the recipient header the engine evaluated as each request was made, and it
  names the token that actually took it when the delivery is drawn. A decision task is listed while it waits
  and its choices are written as a token entry writes an attribute, with no options and no control, since
  what a choice may take is an expression over the status, the data and the globals. A performer is listed
  from the moment its token stands `BUSY`, as in any run, and shows what it has performed and what it is
  conducting but not what is queued behind, an entry being the performer's to grant; the divider goes with
  the queue, having nothing left to divide what is done from.

  Both controls of such a tab are greyed, and a greyed control states what the tab is showing rather than
  asking the reader, so neither goes on narrowing anything from a setting left over elsewhere. The filter
  reads `all`, a selection being a question about a run in progress. "Show archive" reads on, a log being
  read whole rather than followed. Both are fixed rather than taken away, so that a tab keeps the shape it
  has in every run and a reader is not left looking for a setting that is still in force.
- `src/decisions/` — the decision tasks a run waits at and the choices each waits for: `Store.js` (plain,
  node-testable, holding per decision what the engine has answered and what the reader has entered),
  `walk.js` (asking what each choice of one task may take, one at a time and against the values already
  selected, plain and node-testable), `DecisionEntry.js` (the task drawn with
  `bpmnos-js/decision-task-symbol` marked with its token, and a choice as its attribute above the control
  that takes it), `grid.js` (the values a bounded choice admits and the arithmetic of moving among them,
  plain and node-testable), `Panel.js` (the "Decisions" tab) and `decisions.css`.

  Which choices a task states is model knowledge and what each may take is a run's answer, and both are
  asked of the bridge, the first through `describeModel` and the second through the controller. Neither is
  read from the model here, and the first cannot be: a `bpmnos:decision` states an `id` and a `condition`,
  and the attribute a choice decides is named inside that expression, which `Choice::Choice` is what parses.
  A caller reading it again would restate the engine's grammar in another language and would be wrong
  wherever the two readings differed. The two are asked separately because a choice is bounded or
  enumerated by an expression over the status, the data and the globals, so only an engine standing at the
  token can evaluate it, and because a decision task states its choices in order with a later one depending
  on the earlier ones — `DecisionTask::determineAlternatives` writes each chosen value into the status
  before evaluating the next condition. So the bridge answers one choice at a time, against the values
  already selected, and `src/live/index.js` reads them whenever the run is waiting for the reader, which is
  the engine standing still with the diagram caught up: only then is what a choice may take an answer about
  the state the reader is looking at. A decision the run has answered is not asked about, the request no
  longer standing. A value the answer no longer admits is cleared, and everything after it with it. What a later choice answered before
  stands until the new answer replaces it, and a position answered with what it already holds is no change
  and announces none: the question is asked again whenever anything moves and usually has the same answer,
  and a store that reported each of those would redraw a control the reader is working in for nothing. The player opens a decision on a
  `choiceRequest` record and closes it when its token reports any state past `BUSY`, on the same terms as a
  message that stops being awaited. The closed decision keeps the colour its token was drawn in, a record
  outliving its token, and a choice that is read rather than answered — one the run decided, one a record
  holds — is written as a token entry writes an attribute, so that a chosen value and the status it became
  read alike. The control a reader chooses in keeps the engine's own six places, every digit there being one
  they may land on.

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
- `src/canvas-display/` — what a run has reached, at the top right of the canvas: `index.js` (the display,
  which owns the chip both readings wear, the alignment to the mode buttons, being shown outside Model mode
  and the seven-segment font), `clock.js`, `objective.js`, `format.js` (a reading as it is written, plain and
  node-testable) and `canvas-display.css`.

  There are two readings and each is a reading of the same run, so nothing about when a run begins, ends or
  is refreshed belongs to either of them. The clock is the simulated time the player has drawn, and, where
  the reader advances time, the control that advances it: it takes the pointer, wears the pulse while the
  engine waits for a tick, and a click fires `clock.tick`. The objective is what the engine has accumulated,
  written by the live run after every advance. That is honest because the run is paced by what has been
  drawn, one event being taken per announcement, so the engine stands at most one event ahead of the canvas
  and the two readings say the same moment.

  A replayed log reads the objective the same way, the engine now maintaining it as the first global, so
  every token record carries what the run had accumulated when it was written and the player writes it as it
  draws that record. The display is not a module of the diagram but something the application makes once the
  modeller stands, which is after the playback service is instantiated, so it is handed to the player through
  `setDisplay` as it is handed to the live run, rather than declared among what either is injected with. A
  host that has none — a test, the demo page — is served by a player that writes to nothing. Which way the
  value is read is the reader's and not the run's: `SystemState::getObjective`
  accumulates assuming maximisation, which is the model's semantics, so `trending-up` shows the value as the
  engine holds it and `trending-down` shows the same run written as a minimisation, the value multiplied by
  minus one, and clicking the icon says nothing to the engine.
- `src/run-controls.js` — the controls a run is driven by, in the panel's footer. They are
  `bpmn-js-animation`'s own `createControlsEntry`, which the Tokens tab would otherwise draw at the foot of
  its tab; the workbench says `tokenPanel: { controls: false }` and mounts that entry in
  `sidePanel.getSlots().footer` instead, so a run has one set of controls rather than two over one state.
  The element is taken out of the footer in Model mode and put back on the way in, an empty footer being one
  the panel does not draw. `src/app.less` states the slot's height, the side panel's 40px being a default for
  a slot a host fills with what it likes and this one holding the same band the Tokens tab gives the entry.
  The mode buttons say which log control may act, a run that produces its own log having nothing to read.
  Each of the three tabs says in its own name how much it holds — `Messages (2)`, `Sequences (3)`,
  `Decisions (2)` — as the Tokens and Issues tabs do, the name being what a selector shows in one view and a
  column's resizer in the other. The count is dropped when there is nothing, and it is the tab's name alone:
  the heading in the band keeps the plain word.
- `src/panel-filter.js` — the `all` / `selected tokens` filter of a heading, taking the radio group's name,
  since radios of one name are one group and two tabs are alive at once. It is greyed and reads `all` where
  a tab shows records, and narrows nothing while it is.
- `src/answerable.js` — whether what a run shows is the reader's to answer, which is a manual run and nothing
  else, read from `source.changed` and reported to a panel as it changes.
- `src/replayed.js` — whether what a run shows is a record of a run that is over, which is a replayed log and
  nothing else, read from the same announcement and on the same terms. The two are separate questions and
  a greedy run is what tells them apart, being unanswerable and a run in progress at once.
- `src/frozen-values.js` — the values a token held as it finished, drawn as a token entry draws what a token
  holds, which is how every archive of a run discloses them.
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

  What it stands in for is a run in progress, so the tokens it holds are the tokens a run would hold and no
  more: the token that was performed and archived, the performer that closed and the token that took the
  message that was delivered are all absent from it, as they are absent from an animation once they have
  gone. A page that kept them alive would draw every record from a token that a run would not have, and
  would show nothing of what such a record gets wrong. Each record accordingly carries frozen values, as one
  written by the player does, and the run it stands in for is a manual one, that being the only run whose
  controls a reader acts with and therefore the only one in which these tabs show the whole of what they do.
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
  promise-based wrapper the page holds). A step reports the records the engine produced, whether it is alive,
  the time and the objective, and nothing of the engine's present; `describe` answers what the model
  resolves, which no record says and which is the same for every run of that model.

  The worker answers one request at a time, so the wrapper holds a queue and serves them in the order they
  were made. That the channel is single is the worker's own affair: the callers are set off by things that
  know nothing of each other, so none of them is in a position to wait for another, and refusing whoever
  arrived second made every caller answerable for the timing of every other. A channel that fails fails
  everything waiting on it, nothing behind it ever being served. The wrapper takes the worker it speaks to,
  which the application does not give it and a test does, so what it does with a channel is readable without
  a browser.
- `src/live/` — the run the engine performs, in either mode. Greedy and manual are one session made of
  steps, and a step brings a requested mode change into effect and then advances the engine by one fetched
  event, so a reconfiguration falls between two events and never into the middle of one.

  The run is either being advanced or being asked, never both. The engine comes to rest after every advance,
  so it may be asked at almost any moment; what it may not be is asked about a state that moves under the
  question, and an advance is exactly that. A decision task states its choices in order, so reading them is
  several questions and every one is about the state the engine stands in. Whichever is called for while the
  other is under way is remembered and taken up when it ends, both being set off by things that know nothing
  of each other.

  Two facts about a run are held apart and neither implies the other. The engine stalls when it is alive and
  can fetch nothing, which in manual is it waiting for the reader and in greedy never happens. The player
  drains when it has drawn everything it holds, which happens over and over in a greedy run. `drained` is
  therefore the animation's back-pressure on the engine — one step is taken per announcement, so the run is
  paced by what has been drawn rather than by how fast the engine can go — and it is also half of what says
  the run waits for the reader. Only where both hold is what the engine stands in what the reader is looking
  at, which is the condition for inviting them to act, for the clock to pulse, and for asking the engine
  anything on their behalf. Reading the choices is asked of that condition and not of the drain alone.

  What ends a run is the engine failing to carry it forward. A reconfiguration that fails leaves the run
  standing in the mode it was in, and a failure to read the choices leaves it standing with a choice the
  reader cannot yet make, which is what the tab draws in any case; neither is the run failing, and treating
  every error as one turned a collision into a dead run with nothing to show for it.
- `src/input/` — what a run is given: `index.js` builds the instance table and one table per lookup the
  model references, each editable in place, and hands them back one at a time rather than mounting them, so
  the same provider serves any source and any place they are shown; `tabs.js` turns that set into columns of
  the panel, one per table, right of everything a run produces. Each column names its table and, beneath the
  name, the file it was read from: the source the model declares for a lookup, the name of a file the reader
  has loaded, which the table entry reports through `onLoad`, or "No file selected". The set of lookups is a
  property of the model, so the columns of the old model are taken away and the new ones added whenever a
  model is read, and all of them go when the run that mounted them ends. Reading a file into a table is not
  such a change: it alters what that table was read from and nothing else, so the columns stay as they are
  and only the line beneath each name is written again. Taking them away and putting them back would close
  the column the reader had opened and lose its width and where it was scrolled to.

  What a table holds outlives the provider, which lives only as long as a run. A reader going back to
  modelling ends the run, and the instance rows they typed and the files they read into the lookups are
  theirs to come back to, so the text of each table is kept by `src/live/index.js`, which outlives a run, and
  handed to the provider under the key of the table it belongs to. A rebuilt table is filled from it, and
  what the model has made stale is not restored: a lookup the model no longer declares is never asked for
  again, and one whose declared header has changed restores nothing, `setCsv` refusing text that names other
  columns. The instance table is always restored, its columns being fixed by the CSV format the engine reads.

  A table may also be emptied whole, through the table entry's `clearable` control, a trash left of the one
  that reads a file in. What a table was read from is then nothing, the rows a file put there being gone, so
  the line beneath the name falls back to the source the model declares or to "No file selected".
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
