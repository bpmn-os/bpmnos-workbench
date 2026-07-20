# ROADMAP — bpmnos-workbench: consume the wasm engine for playback & simulation

## Context

The infrastructure is **built**. `bpmnos-wasm` (sibling repo) already compiles the C++ BPMN-OS engine
to WebAssembly and exposes a tested interactive JS API (`Engine`/`Monitor`/`Controller` in
`BPMNOS::WASM`; all four decision kinds implemented). So the entire engine↔wasm bridge is **done
upstream and owned there**; `bpmnos-wasm` has its own ROADMAP.

This roadmap covers only the **`bpmnos-workbench`** (still bare: README + LICENSE + CLAUDE.md). Its job:
a production web app that **consumes the wasm module** to play back and simulate real BPMN-OS processes.
The remaining work is the app scaffold, the **engine-token → animation mapping**, a **clock/transport
control**, the **observation panels**, and **interactive (manual) simulation**. The cross-repo interface
is the engine's own `jsonify` stream; the animation translation is internal to the workbench (both
CLAUDE.mds fix this boundary).

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

**Consumption caveats (feed into U2):**
- **`dist` may not be published**; until it is, U2 consumes the locally built
  `bpmnos-wasm/build-wasm/bpmnos.{mjs,wasm}` (a `file:`/path dep); switch to `#dist` once CI publishes.
- **Vite must emit/serve `bpmnos.wasm` as a separate asset** (the `.mjs` fetches it relative to itself;
  do not inline). Handle via `?url`/asset config; the worker needs the `.wasm` beside the glue.
- **Run the Engine in a Web Worker** (`run`/`resume` block); the `Monitor` observer posts each entry to
  the page in order. Mirror `bpmnos-wasm/demo/worker.mjs`.

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

### R1 · Token lifecycle → animation, for **activities** (drives U3/U4)

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
messages; this on-canvas tray is a nice-to-have layered on later — do not fold it into the main WPs.

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

### R5 · Decisions panel for manual simulation (drives U22–U24)

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
`bpmn-js-side-panel` expandable-entry primitive (U11+U15–U19 / R2). Verify the exact sequential-entry/
performer semantics against the engine (`token_flow_logic_*` + `SequentialPerformerUpdate`) when building
U24.

### R6 · Performers panel — the Performer-Sequence decision UI (refines R5; drives U15–U19 scope)

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

**Impact on the side-panel primitive (U11 + U15–U19).** The collapsible-entry primitive must support, beyond basic
expand/collapse: (1) a **per-entry controls slot** — action icons (trash) + **up/down reorder toggles**
(with a reorder callback; reorder logic stays consumer-side); (2) **non-expandable entries that still
carry controls** (the marker); (3) **nesting** — a collapsible group whose expanded content is itself a
list of collapsible entries plus the marker; (4) a shareable **collapsed-summary renderer** (a
performer's collapsed view *is* a token's). Mirror properties-panel's `ListGroup`/`ListEntry` (which have
add/remove) where possible; **up/down reorder is the net-new bit**. Design U11/U15–U19 to this richer shape
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
  token entry) commits the decision — another action in **the side-panel controls slot (U15)** (alongside trash, up/down).
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

- **Design implication for the side-panel primitive (U11/U17):** the collapsible-entry primitive must support
  **in-place updates** of an entry's summary and content (re-render on data change) **without losing
  expand/collapse state, focus, scroll position, or an input in progress**. Design the API for update, not
  render-once — U11/U17 must not lock in a static structure.
- **Source (future bridge):** the heuristic/value would come from the engine's `Evaluator` (e.g.
  `GuidedEvaluator` reward), not currently exposed by `getPendingDecisions`/`getChoiceCandidates` — a
  future modest bridge addition (per-candidate score). Out of scope for the core WPs.

## Units (small, dependency-ordered, incrementally visual)

Replaces the coarse work packages. **Each unit is small, testable, and leaves a working version that can
be visually validated** — functionality accretes in vertical slices, not internal-only plumbing. Format:
**Issue** (one thing) · **Prereqs** (units that must land first) · **Visual** (on-screen check) ·
**Open** (design decisions still to make) · **Temp** (assumptions a later unit supersedes, naming it).
Scope tag: *wb* = bpmnos-workbench, *sp* = bpmn-js-side-panel, *an* = bpmn-js-animation,
*bw* = bpmn-workbench, *wasm* = bpmnos-wasm. Upstream units (*sp/an/bw/wasm*) end in a commit + repin.

**Mock data is allowed.** Where it speeds design, a unit may build and visually validate its **UI against
mock data** ahead of the real data handler / wasm interface — list the mock as a **Temp** assumption
naming the unit that replaces it. This lets UI units land (and be visually checked) *before* their data
source, so a data-source prereq becomes "soft" (needed for live data, not for the UI shell). E.g. the
decision panels (U22–U24), Tokens/Messages (U13/U14), and evaluation display (U29) can be prototyped on
mock candidates/tokens/values first.

### Milestone A — app runs, engine streams
**U1 · App scaffold** — *wb*
- Issue: Vite app — bpmn-js modeler + BPMNOS extension (`bpmnos-js`) + side panel + issues + toolbar; model mode (edit).
- Prereqs: — · Visual: open app, edit a BPMNOS diagram; Properties + Issues tabs render.
- Temp: no mode bar (model only → U7); `.wasm` not yet consumed (→ U2).

**U2 · Wasm-in-worker greedy run (raw stream)** — *wb*
- Issue: worker `createBPMNOS()` → `Input`→`Monitor`→`Engine(input,cfg,monitor,null)` → `run(0)`; forward each `addObserver` entry to the page; show the raw entry list.
- Prereqs: U1 · Visual: click Run → `{token|event|message}` JSON entries stream into a list.
- Open: consume local `build-wasm` path-dep until `#dist` publishes; Vite `.wasm` asset serving.
- Temp: instance CSV + provider hardcoded (→ U8); raw JSON, no animation (→ U5).

### Milestone B — on-canvas playback (the core visual)
**U3 · Animation positions + effects** — *an* (upstream)
- Issue: add positions arrival·ready·departure (beyond entry/busy/completion) + effects flip/pulse/bounce/fade/error to `bpmn-js-animation` (R1).
- Prereqs: — · Visual: the lib demo shows each new position + effect.
- Open: geometry of arrival/ready/departure per node; glyph/motion per effect.

**U4 · Token-state → animation mapping (activities)** — *wb*
- Issue: pure mapping of the engine stream → animation instructions per R1 (**activities**); fork/join; create/consume; `label=instanceId` (`#k`/`^EventSub`).
- Prereqs: U3 · Visual: `node --test` vs recorded fixtures (on-canvas via U5).
- Open: gateway/event/subprocess/MI/boundary mappings (each `token_flow_logic_*`).
- Temp: activities only (others naive/pass-through → U26).

**U5 · On-canvas greedy playback** — *wb*
- Issue: pipe greedy stream (U2) → mapping (U4) → `bpmn-js-animation` `Playback`.
- Prereqs: U2, U4 · Visual: click Run → tokens animate through a greedy run on the diagram.
- Temp: greedy only, default speed (load-log → U10; manual → U20; transport → U9).

### Milestone C — modes, input, transport (usable playback)
**U6 · Generalise mode-buttons + Mode for N modes** — *bw* (upstream)
- Issue: make `mode-buttons`/`Mode` configurable for N modes so a third toggle needs no fork.
- Prereqs: — · Visual: bw demo shows a configurable mode bar.
- Open: greedy as its own `Mode` vs a source within `playback` (roadmap: shares `playback`; bar tracks source).

**U7 · Three-toggle mode bar** — *wb*
- Issue: on-canvas bar (`fa-hand-pointer`/`fa-microchip`/`fa-play`) via U6; switch modes; active-source highlight for shared playback.
- Prereqs: U1, U6 · Visual: three toggles; switching runs greedy (U5) / stubs the rest.
- Temp: manual inert (→ U20); playback = greedy stream until U10.

**U8 · Input panel** — *wb*
- Issue: Input tab — instance CSV, model-driven lookup pickers (`getLookupTableNames`), provider/seed; feeds U2's run.
- Prereqs: U1, U2 · Visual: enter data/provider in the panel → the run uses it.
- Temp: supersedes U2's hardcoded stub; save-log later (U10).

**U9 · Transport control** — *wb*
- Issue: play/pause + speed slider (`setAnimationDuration` + `Playback`) + on-canvas time chip (`getCurrentTime`/log timestamps).
- Prereqs: U5 · Visual: play/pause/speed the greedy playback; time chip updates.
- Temp: animation pacing only (manual clock → U21).

**U10 · Load-log / save-log playback** — *wb*
- Issue: play a loaded engine-log JSON via U5's pipeline; save a run's log.
- Prereqs: U5, U7 · Visual: load a log → tokens animate; save a greedy run.
- Open: log = the native `{token|event|message}` stream array.

### Milestone D — side-panel primitive + observation panels
**U11 · Collapsible entry (core)** — *sp* (upstream)
- Issue: collapsible entry (summary + optional expandable content, expandable only if content); properties-panel look/feel + API; plain-DOM (R2).
- Prereqs: — · Visual: sp demo — entry expands/collapses; content-less entry is a plain row; matches properties-panel.
- Temp: no controls/reorder/nesting/filter/in-place yet (→ U15–U19).

**U12 · Reactive value store** — *wb*
- Issue: store of globals / per-scope `data` / per-token `status`, fed from the stream (R2; JS analog of `SharedValues`).
- Prereqs: U2 · Visual: a debug view shows the store update during a run.
- Open: per-scope data keying (the scope hierarchy).
- Temp: refreshes only on token entries — no live `DataUpdate` (→ U27).

**U13 · Tokens panel** — *wb*
- Issue: entries (U11) showing `status` + hierarchy-visible `data` + `globals` in-context, from the store (U12); all/selected filter.
- Prereqs: U11, U12 · Visual: expand a token → status/data/globals; values update through a run; filter works.
- Temp: local filter (→ U19); re-render may reset expand until U17; no live `DataUpdate` (→ U27).

**U14 · Messages panel** — *wb*
- Issue: `{message}` entries (U11) — collapsed `origin`+`header.name`+`header.sender` (+`state` pill), expand → `content` (R3).
- Prereqs: U11, U12 · Visual: run with messages → Messages tab lists them; expand → content.

### Milestone E — side-panel richer features (for decisions & dynamic updates)
**U15 · Entry controls slot** — *sp* (upstream)
- Issue: per-entry action icons (check/confirm, trash), incl. on non-expandable entries; consumer supplies handlers.
- Prereqs: U11 · Visual: demo entry fires check/trash; a non-expandable entry still shows controls.

**U16 · Up/down reorder** — *sp* (upstream)
- Issue: standardized up/down toggles + reorder callback (`onMove`/`onReorder`), disabled at ends, a11y; consumer owns order.
- Prereqs: U15 · Visual: demo list reorders, reports new order, ends disabled.

**U17 · In-place entry updates** — *sp* (upstream)
- Issue: update summary/content without losing expand/collapse, focus, scroll, or in-progress input (R10).
- Prereqs: U11 · Visual: demo updates an entry live while it stays expanded/focused.

**U18 · Nested entry groups** — *sp* (upstream)
- Issue: a collapsible group whose expanded content is itself a list of entries.
- Prereqs: U11 · Visual: demo nested group renders a sub-list.

**U19 · All/selected filter header** — *sp* (upstream)
- Issue: reusable ( ) all / ( ) selected filter header for entry lists.
- Prereqs: U11 · Visual: demo toggles all/selected. · Temp: supersedes U13's local filter.

### Milestone F — interactive simulation
**U20 · Interactive control + raw pending decisions** — *wb*
- Issue: attach a `Controller`; worker resume loop; surface `getPendingDecisions()` + `{…Request}` entries raw; a debug enqueue+resume.
- Prereqs: U2, U8 · Visual: manual mode runs to first decision; pending listed; debug enqueue advances it.
- Temp: raw decisions (dedicated panels → U22–U25); no clock (→ U21).

**U21 · Manual clock** — *wb*
- Issue: `enqueueClockTickEvent()` + animation-gated loop; manual transport advances/holds `getCurrentTime()`, next tick after `max(dwell, drained)`.
- Prereqs: U20, U9 · Visual: manual mode — play advances sim time (gated by animation); pause holds.

**U22 · Choices panel** — *wb*
- Issue: entry per BUSY decision-task token (U13 renderer) — enumeration dropdown / number input (type-cased `min`/`max`/`step`, R8), check (U15) → `enqueueChoiceDecision` → `resume`.
- Prereqs: U13, U15, U17, U20 · Visual: pick a value at a decision task, check → engine advances, animates.
- Open: expose choice `type` via bridge addition vs read from moddle (prefer bridge).
- Temp: no evaluation display (→ U29).

**U23 · Message Deliveries panel** — *wb*
- Issue: message groups (U18) → candidate recipient tokens (U13); envelope + sender-color bullet; check (U15) → `enqueueMessageDeliveryDecision` → `resume`; deliverable-to-selected filter (R7).
- Prereqs: U18, U15, U13, U19, U20 · Visual: pick a recipient, check → delivered, animates.
- Temp: no eval sort (→ U29).

**U24 · Performers panel** — *wb*
- Issue: performer groups (U18) → ordered token list + auto-advance marker (non-expandable, trash U15) + up/down (U16); auto-`enqueueEntryDecision` above the marker; filter (R6).
- Prereqs: U18, U16, U15, U13, U20 · Visual: reorder; the marker cutoff auto-advances tokens above it; trash → all auto.
- Open: verify sequential-performer semantics (`token_flow_logic_*` + `SequentialPerformerUpdate`).
- Temp: no eval sort (→ U29).

**U25 · Double-click → route to decision** — *wb* (+ *an* hook)
- Issue: double-click a token (Tokens panel or canvas) → its decision panel, focused + selected filter (R9).
- Prereqs: U22, U23, U24 · Visual: double-click a decision-task token → Choices focused; a receive token → Deliveries filtered.
- Open: a canvas token double-click event upstream in `an`; stacking (which token).

### Milestone G — richer mapping & extensions (later)
**U26 · Extend mapping (gateways/events/subprocess/MI/boundary)** — *wb* (+ *an*)
- Issue: extend U4 beyond activities per each `token_flow_logic_*`.
- Prereqs: U4, U3 · Visual: those constructs animate correctly. · Temp: supersedes U4's activities-only.

**U27 · Live data/globals updates (`DataUpdate`)** — *wasm* (+ *wb*)
- Issue: deliver live values — `DataUpdate` has no values/`jsonify` (checked); add bridge serialization reading current values from state, or a `getData/getGlobals` query; feed the store (U12).
- Prereqs: U12 · Visual: data/globals update in the Tokens panel while a token is stationary.
- Open: which delivery route (serialize-values vs query vs token re-notify). · Temp: supersedes U12's advance-only refresh.

**U28 · Migrate Issues onto side-panel entries (was W0b)** — *bw* (upstream)
- Issue: migrate `bpmn-workbench` Issues onto U11 (+U15/U18); preserve severity icons/grouping/"Show issues" toggle.
- Prereqs: U11 · Visual: before/after — Issues behave identically, properties-panel-consistent; lint tests pass.

**U29 · Evaluation values + display + sorting** — *wasm* (+ *wb*)
- Issue: expose per-candidate evaluation (`Evaluator` reward) + a choice preview `evaluateChoice` (what-if, uncommitted); show in decision entries (in-place U17); auto-sort Performers/Deliveries by value; live choice-eval on selection (R10; R6/R7/R8 extensions).
- Prereqs: U22, U23, U24, U17 · Visual: entries show evaluation; lists sort by it; choice shows eval-of-selected before check.
- Open: bridge surface for reward + the what-if eval query.

**U30 · On-canvas message tray (optional)** — *wb*
- Issue: fixed +k envelope tray, state-colored, not flow/node-anchored (R4).
- Prereqs: U14 · Visual: tray shows the in-flight message count. · Temp: optional extension.

## App files (created during the WPs)

`package.json`, `vite.config.js` (preact-jsx + wasm asset), `index.html`, `src/app.js`,
`src/worker.js` (engine driver), `src/adapter/*` (U4), `src/clock/*` (U21),
`.github/workflows/deploy.yml`, `test/`. Upstream changes (per the design principle) land in
`bpmn-js-animation` (positions/effects), `bpmn-js-side-panel` (expandable-entry primitive), and
`bpmn-workbench` (`mode-buttons`/`Mode` generalization).
