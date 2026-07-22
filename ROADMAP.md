# ROADMAP — bpmnos-workbench: use the wasm engine for playback & simulation

## Context

The infrastructure is **built**. `bpmnos-wasm` (sibling repo) already compiles the C++ BPMN-OS engine
to WebAssembly and exposes a tested interactive JS API (`Engine`/`Monitor`/`Controller` in
`BPMNOS::WASM`; all four decision kinds implemented). So the entire engine↔wasm bridge is **done
upstream and owned there**; `bpmnos-wasm` has its own ROADMAP.

This roadmap covers only the **`bpmnos-workbench`**. Its job: a production web app that **consumes the
wasm module** to play back and simulate real BPMN-OS processes. The cross-repo interface is the engine's
own `jsonify` stream; the animation translation is internal to the workbench (both CLAUDE.mds fix this
boundary).

## Status (2026-07-21)

**Playback and greedy simulation are built and working.** The app scaffold, the engine-token → animation
mapping, and the live wasm greedy run are done; the **clock/transport for the live manual clock**, the
**observation panels** (Tokens/Messages richer views), and **interactive (manual) simulation** remain.

Mapped onto the work packages below:

- **Done:** A.1 (scaffold), A.2 (engine in a worker), B.2 (token→animation mapping — activities *and*, in
  practice, gateways/events/sub-processes/**multi-instance**/**event-sub-processes** natively), B.3
  (greedy playback on the diagram), C.3 (Input — a collapsible entry, lookup pickers via
  `getLookupTableNames` labelled by each table's `source` filename, stochastic provider, fresh random seed
  per run).
- **Partial:** C.2 (mode bar — **greedy** `microchip` + **playback** `play` toggles exist; **manual**
  `hand-pointer` not yet), C.4 (transport — reuses the TokenPanel play/pause/speed; the **on-canvas time
  chip is built** — a top-right seven-segment LCD clock + the bpmn-js timer icon, paced by clock-tick
  events; the live manual clock, E.2, is not), C.5 (Load log works via the TokenPanel; save-log not wired).
- **Not started:** work packages **D** (observation panels beyond the packaged Tokens tab), **E**
  (interactive/manual simulation — the `Controller` loop, clock, decision panels), **F** (F.2/F.3
  extensions; F.1 largely subsumed since the mapping already covers most node types).

**Deviations from the original plan (intentional):**
- **B.1 was not needed as written.** Rather than adding new *positions* (arrival/ready/departure) to
  `bpmn-js-animation`, the R1 states map onto the **existing** positions natively — `ARRIVED`/`DEPARTED`
  rest on / travel the sequence flow, `READY` is entry+pulse — so no new position primitives were added.
  What the lib *did* gain is a **hosting/transport API** (not in the original plan): `playback.setLogSource`,
  `tokenPanel.addControl`, the `tokenPanel.refresh` event, `animation.isAutoFocus`/`whenEntered`, plus
  token-creation ordering (born-hidden + deferred entrance = scroll→create→flip) and **per-context stacks**
  (stacked children keyed by their own instance's ancestor context — required for MI/event-sub under
  several enclosing instances, e.g. many process instances).
- **C.1 was not done** — the workbench carries its **own** on-canvas `mode-buttons` (copied from
  bpmn-workbench, converted to inline SVG) rather than generalising bpmn-workbench's `Mode` for N modes.
  Greedy is a **source** (not a 4th animation mode): it rides the `playback` mode and drives the shared
  TokenPanel transport via `setLogSource`.
- **Greedy runs as a burst.** `Engine.run` blocks and its `Monitor` entries arrive all at once in the
  worker; the whole log is collected and then replayed through the player (rather than streamed
  entry-by-entry). Matches the transport table below (greedy = animation replay of a completed log).
- **The engine's MI token logic was revised upstream** (each instance emits `CREATED` up front + its own
  `READY` + a terminal `DONE`; the main emits neither) so sequential and parallel MI both fall onto the
  animation lib's existing parallel-spawn + fan-in model — no workbench-side MI special-casing.

The remaining work (below) is the app's clock/transport polish, the observation panels, and interactive
(manual) simulation.

## The bpmnos-wasm API the workbench consumes (contract)

**Authoritative source: `bpmnos-wasm/API.md` + `types/bpmnos.d.ts` — re-check these against the pinned
commit before coding; the API has changed before.** ESM module, default export **`createBPMNOS()`** →
`Promise<Module>`; `Module.{Input, Engine, Monitor, Controller}` are embind classes (call `.delete()` on
each when done). Structured values cross as **JSON strings**; scalars/ids/CSV cross as native
numbers/strings.

- **Input** (assembles one run's inputs; consumed when the Engine is built — one Input → one Engine):
  `new Input(bpmnXml)`; `getLookupTableNames()` → JSON array of the referenced lookup source names;
  `addLookupTable(name, csv)`; `setInstance(csv)`. *(Model/instances/lookups go through `Input`.)*
- **Engine:** `new Engine(input, configJson, monitor, controller|null)` — `configJson` =
  `{provider:"static"|"expected"|"dynamic"|"stochastic", seed?}`; **null controller ⇒ autonomous greedy
  run** (playback source). `run(scenarioId)` (draw scenario + run from start; repeatable — a stochastic
  id is a new sample); `resume()` (continue); `isAlive()` (run done once false); `getCurrentTime()`;
  `getWeightedObjective()` (live running objective, valid at any pause). **`run`/`resume` block** → run
  the Engine in a Web Worker. **There is no `snapshot()`** — poll `getCurrentTime`/`isAlive`/
  `getWeightedObjective`; the log arrives via the Monitor; pending decisions via the Controller.
- **Monitor:** `new Monitor()`; **`addObserver(cb)`** — `cb(entryJson)` for **every** entry, in engine
  execution order, the moment it's recorded. **Keeps no history / no `drainLog`** — attach before the
  run, observe only (never advance the engine). Each entry is one single-keyed object:
  `{"token"|"event"|"message": …}` or a **decision request**
  `{"entryRequest"|"exitRequest"|"choiceRequest"|"messageDeliveryRequest": …deciding token…}`. The token
  payload carries `processId, instanceId, nodeId, sequenceFlowId, state, status, data, globals`
  (timestamps live in `status`).
- **Controller** (attach ⇒ interactive; auto-resolves first-feasible exit, first-feasible non-sequential
  entry, and directly-addressed delivery — leaves **choice**, **sequential ad-hoc entry**, and
  **ambiguous delivery** to the caller):
  - `getPendingDecisions()` → `[{type:"entry"|"exit"|"choice"|"messageDelivery", instanceId, nodeId}]`.
  - `getChoiceCandidates(instanceId, nodeId)` → per choice `{attribute, enumeration:[…]}` **or**
    `{attribute, lowerBound, upperBound, multipleOf?}`.
  - `getMessageCandidates(instanceId, nodeId)` → `[{origin, sender, message:{…}}]`.
  - `enqueueEntryDecision(json)` / `enqueueExitDecision(json)` — `{instanceId, nodeId, status?}`;
    `enqueueChoiceDecision(json)` — `{instanceId, nodeId, choices:[…]}`;
    `enqueueMessageDeliveryDecision(json)` — `{instanceId, nodeId, origin, sender}`;
    `enqueueClockTickEvent()`; `enqueueTerminationEvent()`. Each `enqueue…` → `{queued:true}` /
    `{rejected:reason}`, dispatched at the next `resume()`; an expired token/request is silently dropped.
- **Driving loop:** build `Input` → `Monitor` (`addObserver`) → `Controller` → `new Engine(...)`;
  `run(0)`; then loop `getPendingDecisions()` → query candidates → `enqueue…Decision(...)` → `resume()`
  until nothing pending. A static single-instance model stays `isAlive()` until time passes its last
  instantiation, so terminating needs `enqueueClockTickEvent()`. Autonomous (null controller): `run(0)`
  proceeds to completion on its own.

**Consumption caveats (resolved in A.2):**
- **`dist` is published and consumed** as `@bpmn-os/bpmnos-wasm` (`github:bpmn-os/bpmnos-wasm#dist`); the
  branch is CI-rebuilt against the engine, so `npm install` refreshes it. (Reinstall after an engine
  revision — e.g. the MI token-logic change.)
- **Vite serves `bpmnos.wasm` as a separate asset** — the worker resolves it via
  `new URL('bpmnos.wasm', import.meta.url)`, and `@bpmn-os/bpmnos-wasm` is **excluded from `optimizeDeps`**
  in `vite.config.js` so the glue's relative wasm URL survives (do not inline).
- **The Engine runs in a Web Worker** (`src/greedy/engine-worker.js`; `run`/`resume` block). Greedy is
  autonomous (null controller) and its `Monitor` entries arrive in one burst, collected and replayed.

## Modes & toggles (three animation modes)

Three on-canvas mode toggles (mirroring `bpmn-workbench/src/mode-buttons.js`; each a composite mark —
`far fa-circle` ring + inner `fas` glyph), beyond `model`:

| Mode | Toggle icon | Engine path | Animation `Mode` |
|---|---|---|---|
| a) Manual simulation | `fa-hand-pointer` (as bpmn-workbench) | wasm `Engine` **+ `Controller`** (user decides) | `simulate` |
| b) Greedy simulation | **`fa-microchip`** (locked) | wasm `Engine`, **no controller** (autonomous greedy) | `playback` (log = greedy run) |
| c) Playback | `fa-play` (as bpmn-workbench) | no engine — replay a loaded log | `playback` (log = loaded) |

b) is an **independent toggle** (decided), but rides the `playback` animation mode (greedy run → same
adapter → same player) — so no 4th upstream `Mode` state is added. Because b) and c) share `playback`,
the workbench tracks the **active source** to highlight the correct button (`mode-buttons.js` `render()`
currently keys only off `mode.getMode()`; extend it). FontAwesome: `fa-microchip` and `fa-hand-pointer`
/`fa-play` all exist in 5.6.3 — no version bump needed.

## Transport, timing & panels

**Transport per mode (play·pause·speed·time).** One transport widget, mode-bound:

| Mode | play/pause controls | speed slider | time readout source |
|---|---|---|---|
| a) Manual | **simulated time** — advance/hold the live clock | tick **dwell** (min real-time per tick) | `getCurrentTime()` (live) |
| b) Greedy | **animation replay** of the completed log | animation duration (`setAnimationDuration`) | log timestamps as they animate |
| c) Playback | **animation replay** of the loaded log | animation duration | log timestamps as they animate |

b) **runs to completion instantly** in the worker → whole log → replayed exactly like c) (decided);
only the animation speed differs. So b) and c) reuse `bpmn-js-animation`'s existing slider (100–2000 ms,
`primitives.setAnimationDuration`) + `Playback` play/pause **as-is**. Only **a)** is a live clock.

**"Animation longer than a tick" (only affects a).** For b/c it can't happen — playback is already
**animation-gated** (`Animator.replay` drains outstanding animations before each settle; the log is
untimed). For a) the live-clock loop is **animation-gated too**: after `enqueueClockTickEvent()` + `resume()`,
animate the batch of new entries (drain, like the Animator), then fire the next tick after
`max(slider-dwell, animations-drained)` — so simulated time never outruns animation; at max speed it is
purely animation-gated. The slider sets the **minimum** real-time per tick.

**Current-time readout is net-new** — the animation model has no clock and the log is untimed, so the
readout is sourced from the engine (`getCurrentTime()` for a; token `status` timestamps for b/c). *Default:*
a small **on-canvas time chip** (top-right, mirroring the mode-buttons mount into `canvas.getContainer()`).

**Panels** (side-panel tabs via `sidePanel.addTab({id,label,priority})`, DI module like `IssuesPanel`) —
**decomposed by concern**, each shown per mode:
- **Properties** (bpmnos-js) + **Issues** (bpmn-workbench) — **model** mode, as today.
- **Input** (engine-run setup) — **manual + greedy**: instance CSV; **model-driven lookup pickers** (via
  the wasm `Input.getLookupTableNames()`); provider + seed. The **model is not here** — it's the current
  canvas diagram (exported to XML at run time), and opening/saving a `.bpmn` is already the **toolbar**'s
  job (`bpmn-workbench/toolbar`). Playback needs no Input — just a **Load log** affordance.
- **Tokens** (R2) — all run/playback modes: token list; each entry expands to `status` + the token's
  **hierarchy-visible `data`** + `globals`, shown in-context; filter ( ) all ( ) selected.
- **Messages** (R3) — all run/playback modes: message observation (content/state).
- **Choices** (R8) — **manual only**: decision-task tokens (BUSY) with enumeration dropdowns / number inputs.
- **Message Deliveries** (R7) — **manual only**: deliverable messages + candidate recipient tokens.
- **Performers** (R6) — **manual only**: per-performer sequential-entry ordering + auto-advance.
- **Transport** (play·pause·speed·time) — its own control, decoupled from the setup panel (on-canvas time
  chip + transport), shared across modes with mode-bound behavior.

The **( ) all / ( ) selected filter** recurs across the Tokens, Performers, and Message-Deliveries panels
— a shared control (reuse the Tokens-panel filter).

*Defaults chosen (revisable):* on-canvas time chip + transport; **dedicated Input / Tokens / Messages /
Decisions tabs** (not one mode-aware tab). Separation of concerns over minimal tab count; easy to revisit.

## Directional requirements (shape the design; not all implemented immediately)

**Design principle (governs all of the below).** The workbench's key dependencies are **all
bpmn-os-owned and repinnable by commit** (`github:bpmn-os/…#<sha>`): `bpmn-js-animation`, **`bpmnos-js`**,
`bpmn-workbench`, `bpmn-js-side-panel`. So **prefer a modest upstream change to the relevant repo over a
complicated workaround in the workbench.** When a requirement doesn't fit a dependency's current model —
`bpmn-js-animation` (extra token positions, effects, a state-driven render entry, a mode), `bpmnos-js`
(moddle extension, decision-task renderer, properties provider), `bpmn-workbench` (rules/issues/toolbar,
and **generalizing/exporting `mode-buttons` + the `Mode` handling for N modes** rather than forking it
for the third toggle + shared-`playback` active-state), `bpmn-js-side-panel` (a reusable
**expandable-entry list** — collapsed summary + optional expandable content — **reused by Issues, Tokens,
and Messages**, see R2/R3) — the default is a small PR upstream + repin, not a contortion here. Component
separation follows: generic mechanics live in the owning dependency; only BPMNOS-workbench-specific
glue/mapping/config lives here.

### R1 · Token lifecycle → animation, for **activities** (drives B.1/B.2)

Confirmed against `engine/docs/md/logic/token_flow_logic_tasks.md` + `Token.h` `State`. Each engine token
`state` maps to a **position** and an **effect**. This is a **richer model than `bpmn-js-animation`**
(5 positions vs its 3; extra effects) — per the design principle, **add the extra positions/effects to
`bpmn-js-animation`** (generic mechanics) and keep only the BPMNOS state→position/effect *mapping* in the
workbench, rather than working the extra positions around the lib's current API.

| Engine state | Position | Effect | Note |
|---|---|---|---|
| `CREATED` | ready | flip once → continue | activity with no incoming flow (ad-hoc / start) |
| `ARRIVED` | arrival | pulsating | arrived via incoming flow; awaiting ready event |
| `READY` | ready | bouncing | **waiting for entry decision** |
| `ENTERED` | ready | none | proceeds immediately |
| `BUSY` | busy | **bouncing** (receive task, decision task) / **pulsating** (others) | awaiting message/choice/completion |
| `COMPLETED` | completion | pulsating | **waiting for exit decision** |
| `EXITING` | completion | none | proceeds immediately |
| `DEPARTED` | departure (on outgoing sequence flow) | token starts travelling | moves to next node |
| `DONE` / `WITHDRAWN` / `FAILED` | — | flip once → fade out | |
| `FAILING` | — | emit error icon | |

Positions needed: **arrival · ready · busy · completion · departure** (superset of the animation lib's
entry/busy/completion). **Bouncing is manual-mode only** — it signals *your input is needed*; in
**greedy/playback (b/c)** every bounce is replaced by **pulsating** (nothing waits on the user). So the
effect column above is manual (a); for b/c substitute pulse for bounce. The same state stream underlies
both modes — in **manual (a)** a token *dwells* at READY (bounce) / COMPLETED (pulse) until the user
submits the decision; in **greedy/playback (b/c)** the log already carries the decisions so it flows
straight through. Other node types (gateways, events, `WAITING` catch events, processes, subprocesses,
multi-instance, boundary/compensation) have their own lifecycles in the sibling `token_flow_logic_*.md`
docs — to be specified as further requirements.

### R2 · Expandable token list — hierarchy-visible data + globals, shown in-context

The side-panel token list has **expandable/collapsible token rows**; expanding a token reveals the **full
context that token needs for a decision, in one place** — its `status`, its **hierarchy-visible `data`**,
and the `globals` — so the user never has to collect information across panels/elements.

- **Data model (verified: `Token.h`, `StateMachine.cpp`).** Three scopes of state, distributed across the
  BPMN scope hierarchy:
  - **`status`** — per **token** (`Token.h:94`); changes **only when the token advances**.
  - **`data`** — lives on **StateMachines (scopes)**, not tokens. Each scope has `ownedData` (the
    attributes it introduces) and `SharedValues data` = **its parent scope's visible data ++ its own
    `ownedData`** (`StateMachine.cpp:27-28` root process, `:41-42` child scope). A token's
    `SharedValues* data` (`Token.h:95`) is therefore the **accumulated set visible at its scope** — its
    scope + every ancestor up to the process. Tokens at different depths see different (nested) sets.
  - **`globals`** — system-wide; dynamic.
  - `SharedValues` holds shared **references**, so one attribute is a single value referenced at every
    scope that sees it — the engine's own "one value, many references."
- **Show it in-context, per entry (locality principle).** Because the engine defines a token's relevant
  data *as* its accumulated visible set, the token/decision entry shows **`status` + that token's visible
  `data` + `globals`** — everything a decision needs, together. **No dedicated globals/data element the
  user must go find.** Redundancy across tokens (e.g. process-level data appears in every token's view) is
  inherent to the hierarchy and fine: shared-by-reference ⇒ always consistent.
- **Store mirrors `SharedValues`.** The workbench keeps a **reactive value store** — the JS analog of the
  engine's shared references (globals; per-scope `data`; per-token `status`) — and each entry subscribes
  to its slice, re-rendering **in place** (R10). One value, many subscribers, exactly like the engine.
- **Update cadence — `status` advance-tied, `data`/`globals` dynamic.** `status` refreshes with each token
  stream entry; `data` and `globals` change **dynamically** (`DataUpdate`) while tokens are stationary, so
  their store slices — and every entry showing them — update in place (R10). *Dependency — not trivial
  (checked):* `DataUpdate` (`execution/engine/src/DataUpdate.h`) carries **only `instanceId` (−1 = global)
  + a reference to the changed `Attribute*` list — no values, no `jsonify()`**. So live updates need one
  of: (a) a bridge-side `DataUpdate` serialization that reads current values from state; (b) a
  `getData(instanceId)`/`getGlobals()` query JS calls on the signal; or (c) token re-notification (values
  only on advance). **Decision deferred**; none is a passthrough.
- **Separation — the expandable-entry primitive goes in `bpmn-js-side-panel`.** Not `bpmn-js-animation`
  (it has no side panel) and not `bpmn-workbench`. The side panel owns tabs, so it should also provide a
  reusable **expandable-entry list**: entries with a **collapsed summary + optional expandable custom
  content**, made expandable **only when extra content is supplied** (plain rows otherwise). This is a
  single modest upstream capability **reused by Issues, Tokens, and Messages** (see R3). The BPMNOS
  `status`/`data`/`globals` renderer + the reactive store are workbench-side, filling the entry's content
  slot.
- **Look/feel AND API — match `@bpmn-io/properties-panel`'s collapsible entry** (as far as possible).
  - *Look/feel:* it ships **`bio-properties-panel-collapsible-entry`** (`…-header` + `…-header-title`,
    disclosure `bio-properties-panel-arrow-right`/`-arrow-down`, `…-entries` body), and its CSS is already
    loaded (bpmnos-js imports `@bpmn-io/properties-panel/dist/assets/properties-panel.css`). Mirror that
    structure/classes/CSS variables so Tokens/Messages/Issues match the Properties tab.
  - *API:* mirror the exported **`CollapsibleEntry`** shape (and related `Group` / `ListGroup` /
    `ListEntry`) — an entry keyed by `{ id, label, entries/content, open }` — so it feels familiar and is
    near-interchangeable. Exact props are minified in `dist`; confirm against the package types/docs at
    implementation. (Rendering can stay plain-DOM in `bpmn-js-side-panel` even though properties-panel is
    preact — parity is of the config shape, not the framework.)
- **Migration impact on existing Issues/Tokens (low, but a scoped step).** Both **already emulate the
  properties-panel look** — Issues' header is a "properties-panel-style header bar" using `--bjs-grey-*`
  tokens with an existing expand caret (`bpmn-workbench/src/modules/issues/issues.css:23,126,132`); the
  Tokens panel header "mirrors the host's properties-panel header" (`bpmn-js-animation/assets/token-panel.css:99`).
  So adopting the primitive is **convergent, not a restyle** — but it must preserve their bespoke bits
  (Issues: severity icons, per-element grouping, "Show issues" toggle; Tokens: all/selected filter,
  selection, incremental row updates) via the custom summary/content slots. **Sequence safely:** land the
  primitive and use it for the **new** Messages panel + token status/data expansion first (zero risk to
  existing panels); migrate Issues/Tokens as a **separate scoped step with before/after visual checks**.

### R3 · Messages side panel (the third stream type)

A side panel listing **messages** (the `{message: …}` stream entries), styled like the token list, with
**expandable/collapsible rows**. Collapsed row shows **message name, sender, origin**; expanded shows
**content**.

- **Source (verified in code).** `Message::jsonify()` (`engine/execution/engine/src/Message.cpp`) emits
  top-level **`origin`** (throwing node id) + **`state`** (`CREATED`/`DELIVERED`/`WITHDRAWN`), a
  **`header`** map, and a **`content`** map. **Name and sender live inside `header`** (`header.name`,
  `header.sender`) — not top-level; origin is top-level. So collapsed = `origin` + `header.name` +
  `header.sender` (consider showing `state` as a status pill); expanded = `content` (+ full header /
  recipient / state). No engine change needed.
- **Separation.** Messages are BPMNOS-specific, so this panel is workbench-provided — but it **reuses
  the `bpmn-js-side-panel` expandable-entry primitive** (R2), the same one Issues and Tokens use, filling
  the content slot with message `content`.

### R4 · Message visualisation on canvas — a fixed envelope tray (not flow-based) · **OPTIONAL / later**

**Scope: optional extension, not a main task.** The messages panel (R3) is the core deliverable for
messages; this on-canvas tray is a nice-to-have layered on later — do not fold it into the main work packages.

**Message flows are not a usable anchor.** They are usually **incomplete/absent** in real models, and
even when drawn a *node-to-node* flow **can't express instance-to-instance correctness** once tokens
stack (messages are instance→instance; flows and nodes aggregate across stacked instances). So **do not**
travel envelopes along message flows or anchor them to sender/recipient nodes — either would make false
spatial/instance claims. (For the record, `bpmn-js-animation` doesn't traverse message flows anyway —
`lib/Simulator.js:60`.)

- **On canvas = a fixed stacked-envelope tray** (next to the mode toggles) with a **+k marker** — a
  lightweight "k messages in flight" **indicator** that makes no spatial claim. Optionally color/segment
  by `state` (`CREATED`/`DELIVERED`/`WITHDRAWN`). This is the primary (and only) on-canvas message view.
- **Instance-correct detail lives in the messages panel (R3)** — origin, sender, recipient, content,
  read straight from `Message::jsonify()`. Canvas = glanceable count; panel = accurate per-message truth.
- Optional interaction: selecting a message (tray or panel) highlights the related sender/recipient
  **tokens** (which carry `instanceId`) — the only instance-correct anchor.
- **Separation.** The envelope-stack/+k widget is generic (candidate for `bpmn-js-animation` or a small
  shared canvas widget); the message data + selection wiring is workbench-side.

### R5 · Decisions panel for manual simulation (drives E.3–E.5)

Manual simulation is the **highest-requirement** work and comes **last** — it needs the live Controller
loop plus the user-made **contested** decisions (non-sequential entries/exits and direct messages
auto-resolve upstream). The `getPendingDecisions()` entries the user acts on group into a **dedicated
Decisions panel** with three sections:

- **Choices** — decision-task choices (`type: choice`), presented in a **dedicated Choices panel (R8)**.
- **Message Deliveries** — ambiguous deliveries (`type: messageDelivery`; pick from `candidates`).
- **Performer Sequence** — sequential entry order, presented in a **dedicated Performers panel (R6)**
  (not a section here).

The Choices and Message Deliveries sections list `getPendingDecisions()` items; acting on one calls the
matching `enqueue…Decision(...)` then `resume()`. GUI detail is workbench-side; the panel reuses the
`bpmn-js-side-panel` expandable-entry primitive (the bpmn-js-side-panel entry, R2). Verify the exact sequential-entry/
performer semantics against the engine (`token_flow_logic_*` + `SequentialPerformerUpdate`) when building
E.5.

### R6 · Performers panel — the Performer-Sequence decision UI (refines R5; drives the bpmn-js-side-panel entry’s features)

A dedicated **Performers** panel (manual mode) for sequential-entry decisions. It shows a **collapsible
group per performer** that currently holds a token in **BUSY** (actively performing):

- **Collapsed** view = identical to the performer token's collapsed view (reuse the token summary).
- **Expanded** view = an **ordered token list** of all tokens awaiting entry at an activity performed by
  this performer; each token is an **expandable entry** (status/data), followed by a special
  **non-expandable "auto-advance" marker** entry — *"Tokens above will automatically be advanced in the
  given order"* — with a **trash icon** that removes it.
- **Reorder:** each token **and** the marker have **up/down toggles** to move within the list; token
  entries update automatically as tokens enter/advance.
- **Auto-advance semantics:** the marker is a **cutoff** — `enqueueEntryDecision(...)` for the **first
  token above the marker** is issued **automatically** (then the next, in order, as the performer frees); tokens
  **below** the marker wait. **Trash the marker → all tokens auto-advance.** Moving the marker sets how
  many/which tokens auto-advance and in what order; the user promotes a held token by reordering / moving
  the marker past it.
- **Filter** like the Tokens panel: show performers ( ) all ( ) selected.
- **Extension direction — programmatic sort by evaluation value (once available, R10).** When per-candidate
  evaluation values exist, the workbench may **auto-sort** a performer's token order by that value (with
  manual up/down still available). This fits the decided reorder boundary — the consumer owns the order,
  so a programmatic sort is just another way it sets it; **no new side-panel requirement**. Out of scope until R10
  lands.

**Impact on the side-panel primitive (the bpmn-js-side-panel entry).** The collapsible-entry primitive must support, beyond basic
expand/collapse: (1) a **per-entry controls slot** — action icons (trash) + **up/down reorder toggles**
(with a reorder callback; reorder logic stays consumer-side); (2) **non-expandable entries that still
carry controls** (the marker); (3) **nesting** — a collapsible group whose expanded content is itself a
list of collapsible entries plus the marker; (4) a shareable **collapsed-summary renderer** (a
performer's collapsed view *is* a token's). Mirror properties-panel's `ListGroup`/`ListEntry` (which have
add/remove) where possible; **up/down reorder is the net-new bit**. Design the bpmn-js-side-panel entry to this richer shape
from the start.

### R7 · Message Deliveries panel — the message-delivery decision UI (refines R5)

A dedicated **Message Deliveries** panel (manual mode) for `messageDelivery` decisions — distinct from
the R3 *observation* Messages panel:

- **Filter:** show **all messages**, or **only messages deliverable to the selected token(s)**.
- **One entry per message**, rendered as a **message envelope with a small bullet on top in the color of
  the sending token** (the sender's instance color) — the collapsed summary.
- Message entries are **collapsible groups** whose expanded content lists **all tokens that may receive
  the message** (candidate recipients). Each token entry is **identical to a Tokens-panel entry** (reuse
  the shared token-entry renderer).
- Acting: choosing a recipient token calls `enqueueMessageDeliveryDecision({instanceId, nodeId, origin,
  sender})` (candidates from `getMessageCandidates(...)`) then `resume()`.
- **Extension direction — sort candidates by evaluation value (once available, R10).** Unlike Performers
  (R6), message delivery is a *selection*, not a sequence, so **no up/down toggles**; but once
  per-candidate evaluation exists, the workbench may **auto-sort** the recipient list by that value to
  surface the best options. Consumer-owned order; **no new side-panel requirement**. Out of scope until R10.
- **Impact on the side-panel primitive:** reinforces **nesting** (message group → recipient token entries), **custom collapsed
  summaries** (envelope + instance-colored bullet), and **reuse of the token-entry renderer** as sub-
  entries — already in scope via R6; add the instance-color bullet as a summary decoration.

### R8 · Choices panel — the decision-task choice UI (refines R5)

A dedicated **Choices** panel (manual mode) for `choice` decisions. It shows a **collapsible entry per
token at a decision task in BUSY state**:

- **Collapsed** = the token summary (like a Tokens-panel entry).
- **Expanded** = status/data **plus one input per declared choice** (a decision task may declare several):
  - **enumeration** choice → a **dropdown** of the allowed values (`choice->getEnumeration(...)`).
  - **bounded** choice → **`<input type="number">`** with `min`/`max` = the evaluated bounds and
    **`step` = `multipleOf`** when given.
- **`multipleOf` is available — no engine/wasm change** (verified): engine `Choice.multipleOf`
  (`Choice.h:29`); the wasm `Controller.getChoiceCandidates(instanceId,nodeId)` returns, per bounded
  choice, `{attribute, lowerBound, upperBound, multipleOf?}` (bounds from `getBounds()`).
- **Honor `min`/`max` exactly — strict/inclusive is already baked in.** `BPMNOS::number` is fixed-point
  (`cnl::scaled_integer<int64_t, power<-16>>`, precision `BPMNOS_NUMBER_PRECISION = 1/65536`,
  `Number.h:20-21,40`), so there are no continuous reals: adjacent values are one epsilon apart, and `<`
  vs `<=` differ by exactly one representable step **for DECIMAL just as for INTEGER** (only the grid
  spacing differs — `1` vs `1/65536`). `getBounds()` resolves strictness into the returned bounds
  (`Choice.cpp:164-172`: `strictLB → min += PRECISION`, `strictUB → max -= PRECISION`; then `ceil`/`floor`
  snaps the *integer* grid — DECIMAL is already grid-aligned by the epsilon). The workbench must use the
  `getChoiceCandidates` `lowerBound`/`upperBound` **as-is** — do **not** round the epsilon away or
  re-derive strictness client-side (that would drop the strict semantics).
- **The UI's only job is to keep the value within the inclusive bounds** (and, when `multipleOf` is set,
  on the multiple via the input's `step`). `min`/`max` from `getBounds` are inclusive (HTML `min`/`max`
  are inclusive; strictness is already baked into the values). **The grid is automatic — the engine casts
  the submitted double to cnl fixed-point, so no `1/65536` snapping in the UI.** Type just tunes the
  widget:
  - **INTEGER/BOOLEAN:** bounds are already integers (`ceil`/`floor`); `step = multipleOf ?? 1`;
    align `min` to the first valid multiple.
  - **DECIMAL:** `min`/`max` from the bounds; if `multipleOf`, `step = multipleOf` and `min` = the first
    valid multiple (`DELTA·ceil(LB/DELTA)`, cf. `getEnumeration`, `Choice.cpp:210-212`) — a non-multiple
    would be infeasible; else free entry (`step="any"`), any value in `[min,max]`.
- **Note — the bridge casts every submitted double to cnl** (verified): `enqueueChoiceDecision`'s
  `choices` doubles run through `toChoiceValues` → `toNumber` → `static_cast<BPMNOS::number>(double)`
  (`bpmnos-wasm/src/Convert.h:28-30,67-71`), landing on the `1/65536` fixed-point grid. So the UI passes
  plain JS numbers and never needs to grid-align them itself — it only guarantees the value is within
  bounds (and a valid multiple when `multipleOf` is set).
- **Needs the choice attribute's *type*.** `getChoiceCandidates` currently emits the attribute *name* +
  `{enumeration}` or `{lowerBound,upperBound,multipleOf?}` — **not the type** (`Controller.cpp:67-84`).
  Either a **modest bridge addition** (include `"type"` in the candidate JSON — the engine has
  `choice->attribute->type`) or read the type from the moddle model. Prefer the bridge addition.
- On submit: collect one value per choice (in order) → `enqueueChoiceDecision({instanceId, nodeId,
  choices:[…]})` → `resume()` (matches `ChoiceEvent(vector<number> choices)`).
- **Extension direction — show the evaluation of the *selected* value before committing (R10).** Unlike
  R6/R7 (a fixed per-candidate rank), a choice's evaluation is a **function of the chosen value**. So the
  entry could display the evaluation of the current selection, updating **live** as the user adjusts the
  dropdown/number input (R10 in-place update), letting them compare before clicking **check**. This needs
  a **preview / what-if evaluation** — evaluate a candidate `choices[…]` **without committing** — a
  *distinct* bridge capability (e.g. `evaluateChoice(instanceId, nodeId, choices)` → value), beyond R6/R7's
  per-candidate value. Out of scope until R10 / this query lands.
- **Side-panel reuse:** the choice inputs live in the entry's **custom expandable-content slot** (dropdown /
  number input are just content) — no new side-panel feature; reuses the collapsible entry + token-entry renderer.

### R9 · Double-click a token → route to its decision (cross-panel navigation + confirm)

In BPMNOS manual simulation a token doesn't "advance" on double-click (the current `bpmn-js-animation`
TokenPanel behaviour) — advancing may require a decision. Instead, **double-clicking a token — in the
Tokens panel *or on the canvas* — routes to the relevant decision panel, focused on that token**:

- Token at a **decision task** (BUSY, awaiting choice) → open the **Choices** panel (R8), expand that
  token's entry, **focus its input field**; the user enters a value and clicks a **"check" (confirm)
  icon** to submit (`enqueueChoiceDecision(...)`).
- Token at a **message catch event / receive task** (awaiting delivery) → open the **Message Deliveries**
  panel (R7), **filtered to messages deliverable to that node**; the user selects a message → in that
  message's candidate-recipient list the **"selected" filter shows only this token** → the user clicks the
  **"check" icon** on the token to commit the delivery (`enqueueMessageDeliveryDecision(...)`).
- (Entry decisions route to the **Performers** panel (R6) similarly — the token appears in its performer's
  list.)

Implications:
- **A "check"/confirm action icon** on decision entries (Choices token entry, Message-Deliveries recipient
  token entry) commits the decision — another action in **the side-panel controls slot (bpmn-js-side-panel)** (alongside trash, up/down).
- **Cross-panel routing** = select the token + `sidePanel.activate(<decisionPanel>)` + set that panel's
  **"selected" filter** + focus the input. The routing target is BPMNOS-specific → workbench-side.
- **Double-click hook:** if the Tokens panel reuses `bpmn-js-animation`'s TokenPanel, its double-click
  action (currently hard-wired to advance) must become **configurable/overridable upstream** (modest
  change per the design principle). If the BPMNOS Tokens panel is workbench-built on the side-panel primitive, the routing is
  entirely workbench-side.
- **Canvas token double-click** = the same routing, triggered from a token on the diagram. Tokens are
  rendered by `bpmn-js-animation`, so expose a **token double-click event/hook upstream** (modest change)
  for the workbench to route on. Stacking nuance: pick the front/visible token, or the node's
  decision-relevant token when the decision is node-scoped.

### R10 · Dynamic decision info (e.g. heuristic value) — entries are not static · extension direction

Extension direction: decisions may carry **dynamic information** — e.g. a **heuristic evaluation of the
decision's value** — that changes as state evolves. So **decision entries must not be assumed static**;
their summary/content can update live.

- **Design implication for the side-panel primitive (bpmn-js-side-panel entry):** the collapsible-entry primitive must support
  **in-place updates** of an entry's summary and content (re-render on data change) **without losing
  expand/collapse state, focus, scroll position, or an input in progress**. Design the API for update, not
  render-once — the bpmn-js-side-panel entry must not lock in a static structure.
- **Source (future bridge):** the heuristic/value would come from the engine's `Evaluator` (e.g.
  `GuidedEvaluator` reward), not currently exposed by `getPendingDecisions`/`getChoiceCandidates` — a
  future modest bridge addition (per-candidate score). Out of scope for the core work packages.

## Work packages and tasks

The work is organised into **work packages** (A–G), each broken into small **tasks** (A.1, A.2, …). A task
is numbered within its work package, so one can be added, merged, or reordered without renumbering the
rest. Each task is small and testable and leaves the app (or an upstream library) in a runnable,
visually-checkable state, so functionality grows in vertical slices rather than internal-only plumbing.
Each task is described by these fields:
- **Goal** — what it achieves, in plain language.
- **Prerequisites** — the tasks that must be built first.
- **Open decisions** — design choices that still need to be made while building it.
- **Temporary assumptions** — shortcuts it deliberately takes to ship early, each replaced by a named later task.
- **Details** — the technical scope: what to build and how.
- **Validation** — the on-screen check that confirms it works.

The italic tag after each task's title names the repo it lands in: *bpmnos-workbench* (the app itself),
*bpmn-js-side-panel*, *bpmn-js-animation*, *bpmn-workbench*, or *bpmnos-wasm*. Anything outside
*bpmnos-workbench* is an upstream change that ends with a commit and a version re-pin.

Where it speeds up design, a task may build and visually validate its UI against **mock data** before the
real data handler or wasm interface exists — listed as a temporary assumption naming the task that
replaces it. This lets a UI task land and be checked before its data source, so a data-source
prerequisite is "soft": needed for live data, not for the UI shell. For example, the decision panels
(E.3–E.5), the Tokens and Messages panels (D.3, D.4), and the evaluation display (F.3) can be prototyped
on mock candidates, tokens, and values first.

### Work package A — the app runs and the engine streams

**A.1 · App scaffold** — *bpmnos-workbench*
- **Goal:** Get a working BPMNOS diagram editor on screen: open the app and edit a process.
- **Status:** Done.
- **Prerequisites:** None.
- **Temporary assumptions:** There is no mode bar yet, only model (editing) mode; it is added in C.2. The wasm module is not consumed yet; that is A.2.
- **Details:** Stand up the Vite app that mirrors bpmn-workbench and bpmnos-js — the bpmn-js modeller with the BPMNOS extension, the side panel, the Issues panel, and the toolbar — so a model can be edited.
- **Validation:** Open the app, edit a BPMNOS diagram, and see the Properties and Issues tabs render.

**A.2 · Run the engine in the browser** — *bpmnos-workbench*
- **Goal:** Prove the wasm engine runs in the browser: click Run and watch its execution log stream in.
- **Status:** Done (greedy worker streams the `Monitor` log; consumed as a **burst** and replayed, not shown as raw JSON).
- **Prerequisites:** A.1.
- **Temporary assumptions:** The instance data and provider are hardcoded, replaced by the Input panel in C.3; and the stream is shown as raw JSON with no animation, added in B.3. The app consumes the locally built wasm module as a path dependency until the `dist` branch is published.
- **Details:** In a Web Worker, load `createBPMNOS()`, build an `Input`, a `Monitor`, and an `Engine` with no controller (a greedy run), call `run(0)`, and forward every `Monitor` entry to the page as raw text. Serve `bpmnos.wasm` as a separate Vite asset, since the JavaScript glue fetches it at runtime.
- **Validation:** Click Run and see the engine's token, event, and message entries stream into a list.

### Work package B — playback on the diagram (the core visual)

**B.1 · Animation positions and effects** — *bpmn-js-animation* (upstream)
- **Goal:** Give the animation library the token positions and effects that BPMNOS needs.
- **Status:** Not done as written — the R1 states map onto the lib's existing positions natively; the lib instead gained a hosting/transport API + per-context stacks (see top Status deviations).
- **Prerequisites:** None.
- **Details:** Add the arrival, ready, and departure positions (beyond the existing entry, busy, and completion) and the flip, pulse, bounce, fade, and error effects to bpmn-js-animation, exactly as the token lifecycle in R1 specifies (R1 fixes each position and effect).
- **Validation:** The library's own demo shows a token at each new position and performing each effect.

**B.2 · Map token states to animation (activities)** — *bpmnos-workbench*
- **Goal:** Turn the engine's token log into on-diagram animation instructions, starting with activities.
- **Status:** Done in `src/playback/EngineLogPlayer.js` — activities and, natively, gateways/events/sub-processes/multi-instance/event-sub-processes.
- **Prerequisites:** B.1.
- **Temporary assumptions:** Only activities are mapped; other node types are handled naively until F.1.
- **Details:** Write a pure function that maps the engine's token stream to animation instructions per R1 for activities, handling forks and joins, token creation and consumption, and keying each token by its instance id (with the `#k` and `^EventSub` sub-scope conventions).
- **Validation:** A `node --test` suite maps recorded engine fixtures to the expected instructions (and it is seen on the canvas via B.3).

**B.3 · Greedy playback on the diagram** — *bpmnos-workbench*
- **Goal:** See a greedy run animate on the diagram — the first real playback.
- **Status:** Done.
- **Prerequisites:** A.2, B.2.
- **Temporary assumptions:** Only greedy runs at default speed; loading a log comes in C.5, manual simulation in E.1, and the transport in C.4.
- **Details:** Feed the greedy run's stream (A.2) through the mapping (B.2) into bpmn-js-animation's existing `Playback`.
- **Validation:** Click Run and watch tokens animate through a greedy run on the diagram.

### Work package C — modes, inputs, and transport (usable playback)

**C.1 · N configurable modes in bpmn-workbench** — *bpmn-workbench* (upstream)
- **Goal:** Let the app show three mode toggles instead of the built-in two, without forking bpmn-workbench.
- **Status:** Not done — the workbench carries its own inline-SVG `mode-buttons`; greedy is a *source* on the shared `playback` mode, not a 4th mode.
- **Prerequisites:** None.
- **Details:** Generalise bpmn-workbench's mode buttons and `Mode` service so the set of modes is configurable, so a third toggle needs no fork. (Greedy is not a new mode — it shares the playback mode, with the bar tracking the active source, as decided in "Modes & toggles".)
- **Validation:** The bpmn-workbench demo shows a configurable mode bar.

**C.2 · The three-mode toggle bar** — *bpmnos-workbench*
- **Goal:** Put the Manual, Greedy, and Playback toggles on the canvas and switch between them.
- **Status:** Partial — greedy (`microchip`) + playback (`play`) toggles exist; manual (`hand-pointer`) not yet.
- **Prerequisites:** A.1, C.1.
- **Temporary assumptions:** The Manual toggle is inert until E.1, and Playback replays the greedy stream until loading a log arrives in C.5.
- **Details:** Add the on-canvas toggle bar (hand-pointer, microchip, and play icons) using C.1, and highlight the active source when greedy and playback share a mode.
- **Validation:** Three toggles appear on the canvas; switching to Greedy runs a playback (B.3) and the others are stubbed.

**C.3 · Input panel** — *bpmnos-workbench*
- **Goal:** Let the user supply a run's inputs — instance data, lookup tables, and provider/seed — from a panel.
- **Status:** Done (as a collapsible **Input** entry in the Tokens tab; lookup pickers labelled by each table's `source` filename; provider fixed to stochastic; fresh random seed per run, re-rolled by the footer Refresh).
- **Prerequisites:** A.1, A.2.
- **Temporary assumptions:** Replaces A.2's hardcoded inputs; saving a log comes later, in C.5.
- **Details:** Add an Input tab with a field for the instance CSV, file pickers for exactly the lookup tables the model references (discovered via `getLookupTableNames`), and provider and seed controls, feeding the run in A.2.
- **Validation:** Enter instance data and a provider in the panel and see the run use them.

**C.4 · Transport control** — *bpmnos-workbench*
- **Goal:** Give playback a play/pause and speed control, plus an on-canvas simulation-time readout.
- **Status:** Partial — reuses the TokenPanel play/pause/speed; the **on-canvas time chip is built**
  (`src/clock.js`/`clock.css`): a fixed top-right seven-segment LCD readout (bundled DSEG7 font) + the
  bpmn-js timer-event clock face, aligned to the mode toggles, showing the engine's clock-tick time.
  Playback pauses ~animationDuration/4 per `clocktick` (`{event:"clocktick", time}`) so it counts up.
  Still missing: the **live manual clock** (E.2).
- **Prerequisites:** B.3.
- **Temporary assumptions:** Paces animation only; the live manual clock comes in E.2.
- **Details:** Reuse bpmn-js-animation's speed slider and `Playback` for play, pause, and speed, and add an on-canvas time chip fed by the engine's current time and the log's timestamps.
- **Validation:** Play, pause, and change the speed of a greedy playback, and watch the time chip update.

**C.5 · Load and save logs** — *bpmnos-workbench*
- **Goal:** Load a saved execution log to replay it, and save a run's log.
- **Status:** Partial — Load log works via the TokenPanel; save-log not wired.
- **Prerequisites:** B.3, C.2.
- **Details:** Play a loaded engine log through the B.3 pipeline, and save a run's log to a file. The log file is the engine's native array of token, event, and message entries.
- **Validation:** Load a log and watch tokens animate; save a greedy run and reload it.

### Work package D — the observation panels

**D.1 · Adopt the side-panel collapsible entry (and migrate bpmn-workbench Issues)** — *bpmnos-workbench* + *bpmn-workbench*
- **Goal:** Use the shared collapsible side-panel entry for the app's panels, and bring bpmn-workbench onto it too, so the whole side-panel experience is consistent.
- **Prerequisites:** The collapsible entry and its features, built upstream in **bpmn-js-side-panel** (see that repo's ROADMAP — entry core, action buttons, reorder, live updates, nesting, filter; the workbench pins it by commit).
- **Details:** Render the app's panels on the shared collapsible entry from bpmn-js-side-panel. In the same effort, migrate bpmn-workbench's Issues panel onto the entry (preserving its severity icons, per-element grouping, and "Show issues" toggle), so bpmn-workbench and the workbench share one entry style rather than diverging.
- **Validation:** The app's panels render on the shared entry; and bpmn-workbench's Issues panel, migrated onto it, behaves identically, matches the properties-panel style, and still passes its lint tests.

**D.2 · Reactive value store** — *bpmnos-workbench*
- **Goal:** Keep a live in-memory copy of the engine's values — globals, per-scope data, and per-token status — for the panels to read.
- **Prerequisites:** A.2.
- **Open decisions:** How should per-scope data be keyed along the scope hierarchy?
- **Temporary assumptions:** The store refreshes only when a token entry arrives; live data updates come in F.2.
- **Details:** Maintain a store fed by the stream, mirroring the engine's shared-reference model (R2), so each value lives once and every view of it stays consistent.
- **Validation:** A debug view shows the store updating during a run.

**D.3 · Tokens panel** — *bpmnos-workbench*
- **Goal:** Show each token's full decision context — its status, its hierarchy-visible data, and the globals — in one place.
- **Prerequisites:** D.1, D.2.
- **Temporary assumptions:** Data and globals refresh only on token advance until F.2.
- **Details:** Render each token as an entry (D.1) showing its status plus the data visible up its scope chain and the globals, read from the store (D.2), with the side-panel entry's all/selected filter and live in-place updates.
- **Validation:** Expand a token to see its status, data, and globals; watch them update through a run; and use the filter.

**D.4 · Messages panel** — *bpmnos-workbench*
- **Goal:** Show the messages flowing through a run.
- **Prerequisites:** D.1, D.2.
- **Details:** List each message as an entry (D.1) whose collapsed summary shows its origin, name, and sender (with the delivery state as a pill) and which expands to its content (R3).
- **Validation:** Run a model with messages and see them listed; expand one to read its content.

### Work package E — interactive (manual) simulation

**E.1 · Interactive control and pending decisions** — *bpmnos-workbench*
- **Goal:** Run the engine interactively: pause at decisions and surface what is pending.
- **Prerequisites:** A.2, C.3.
- **Temporary assumptions:** Decisions are shown raw until the dedicated panels (E.3–E.6); there is no clock yet, added in E.2.
- **Details:** Attach a `Controller`, drive the worker's resume loop, and surface the pending decisions (from `getPendingDecisions` and the decision-request stream entries) in raw form, with a debug control to enqueue a decision and resume.
- **Validation:** In manual mode the run pauses at the first decision, the pending decisions are listed, and the debug control advances it.

**E.2 · Manual clock** — *bpmnos-workbench*
- **Goal:** Let the user drive simulated time in manual mode with play and pause, paced by the animation.
- **Prerequisites:** E.1, C.4.
- **Details:** Advance simulated time by enqueuing clock-tick events in an animation-gated loop — after each tick, animate the resulting entries, then fire the next tick after the greater of the chosen dwell and the time the animation takes — so time never outruns the animation; pause holds time.
- **Validation:** In manual mode, play advances the simulation time (gated by the animation) and pause holds it.

**E.3 · Choices panel** — *bpmnos-workbench*
- **Goal:** Let the user make a decision-task choice: pick a value and commit it.
- **Prerequisites:** D.1, D.3, E.1.
- **Open decisions:** Should the choice attribute's type come from a small bridge addition or be read from the model? (A bridge addition is preferred.)
- **Temporary assumptions:** No evaluation is shown yet; added in F.3.
- **Details:** For each token waiting at a decision task, show an entry (reusing the token renderer) with an enumeration drop-down or a number input whose min, max, and step are set from the candidate bounds per the type (R8); a confirm button enqueues the choice and resumes.
- **Validation:** Pick a value at a decision task, confirm, and watch the engine advance and animate.

**E.4 · Message Deliveries panel** — *bpmnos-workbench*
- **Goal:** Let the user choose which message is delivered to which recipient.
- **Prerequisites:** D.1, D.3, E.1.
- **Temporary assumptions:** No evaluation-based sorting yet; added in F.3.
- **Details:** Show each deliverable message as a nested group (from the side-panel entry) — an envelope with a bullet in the sending token's colour — that expands to its candidate recipient tokens; a confirm button on a recipient enqueues the delivery and resumes; a filter limits the list to messages deliverable to the selected token (R7).
- **Validation:** Pick a recipient, confirm, and watch the message delivered and animated.

**E.5 · Performers panel** — *bpmnos-workbench*
- **Goal:** Let the user set the order in which a sequential performer's activities are entered, with automatic advance.
- **Prerequisites:** D.1, D.3, E.1.
- **Temporary assumptions:** No evaluation-based sorting yet; added in F.3.
- **Details:** Show each busy performer as a nested group (from the side-panel entry) holding an ordered list of the tokens waiting to enter it, followed by an "auto-advance" marker (deletable) that can be moved with the others via the entry’s reorder controls; tokens above the marker have their entry enqueued automatically, in order, and deleting the marker makes all of them advance (R6). Before building, confirm the exact sequential-performer semantics against the engine (`token_flow_logic_*` and `SequentialPerformerUpdate`).
- **Validation:** Reorder the list, watch the marker's cutoff auto-advance the tokens above it, and delete the marker to advance all.

**E.6 · Double-click to act on a decision** — *bpmnos-workbench* (+ *bpmn-js-animation*)
- **Goal:** Double-click a token, in a panel or on the canvas, to jump straight to and act on its decision.
- **Prerequisites:** E.3, E.4, E.5.
- **Open decisions:** When tokens are stacked at a node, which one does a canvas double-click target?
- **Details:** Double-clicking a token (in the Tokens panel or on the canvas) opens its decision panel, focused and filtered to that token (R9). The canvas case needs a token double-click event added upstream in bpmn-js-animation.
- **Validation:** Double-click a decision-task token to open the Choices panel focused on it; double-click a receiving token to open Message Deliveries filtered to it.

### Work package F — richer mapping and extensions (later)

**F.1 · Animation for the remaining node types** — *bpmnos-workbench* (+ *bpmn-js-animation*)
- **Goal:** Extend the animation to gateways, events, sub-processes, multi-instance activities, and boundary events.
- **Prerequisites:** B.1, B.2.
- **Temporary assumptions:** Replaces the activities-only mapping of B.2.
- **Details:** Extend the B.2 mapping beyond activities, following each node type's `token_flow_logic_*` document.
- **Validation:** Those constructs animate correctly.

**F.2 · Live data and globals updates** — *bpmnos-wasm* (+ *bpmnos-workbench*)
- **Goal:** Make data and globals update live in the panels while tokens sit still.
- **Prerequisites:** D.2.
- **Open decisions:** How should the changed values reach the workbench — serialise them on the bridge, add a query the workbench calls on the signal, or re-emit the affected token?
- **Temporary assumptions:** Replaces D.2's advance-only refresh.
- **Details:** The engine's `DataUpdate` observable carries only which attributes changed, with no values and no serialiser (verified), so the chosen route must supply the current values, which then feed the store (D.2).
- **Validation:** Data and globals in the Tokens panel update while a token is stationary.

**F.3 · Decision evaluations** — *bpmnos-wasm* (+ *bpmnos-workbench*)
- **Goal:** Show the engine's evaluation of decisions, sort candidates by it, and preview a choice's value before committing.
- **Prerequisites:** D.1, E.3, E.4, E.5.
- **Open decisions:** What bridge surface should expose each candidate's reward and the what-if evaluation of an uncommitted choice?
- **Details:** Expose each candidate's evaluation (the evaluator's reward) and a what-if evaluation of an uncommitted choice through the bridge; show these in the decision entries (updating in place), sort the Performers and Message-Deliveries candidates by value, and update a choice's evaluation live as the user changes the selection (R10, and the extensions noted in R6, R7, R8).
- **Validation:** Decision entries show an evaluation, candidate lists sort by it, and a choice shows the evaluation of the selected value before it is confirmed.

**F.4 · On-canvas message tray (optional)** — *bpmnos-workbench*
- **Goal:** Show an at-a-glance count of in-flight messages on the canvas.
- **Prerequisites:** D.4.
- **Temporary assumptions:** Optional extension, not a core deliverable.
- **Details:** Show a fixed tray of stacked envelopes with a "+k" count, coloured by state and deliberately not anchored to message flows or nodes (R4).
- **Validation:** The tray shows the count of in-flight messages.

## App files (created by the tasks above)

`package.json`, `vite.config.js` (preact-jsx + wasm asset), `index.html`, `src/app.js`,
`src/worker.js` (engine driver), `src/adapter/*` (B.2), `src/clock/*` (E.2),
`.github/workflows/deploy.yml`, `test/`. Upstream changes (per the design principle) land in
`bpmn-js-animation` (positions/effects), `bpmn-js-side-panel` (expandable-entry primitive), and
`bpmn-workbench` (`mode-buttons`/`Mode` generalization).
