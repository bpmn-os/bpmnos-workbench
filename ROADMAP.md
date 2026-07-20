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

**Consumption caveats (feed into W1):**
- **`dist` may not be published**; until it is, W1 consumes the locally built
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
- **Tokens** (R2) — all run/playback modes: token list (expandable `status`/`data`) + central Globals;
  filter ( ) all ( ) selected.
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

### R1 · Token lifecycle → animation, for **activities** (drives W2)

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

### R2 · Expandable token list + globals in the side panel

The side-panel token list needs **expandable/collapsible token rows** that reveal each token's
**`status` and `data`**, plus a separate **expandable/collapsible "Globals" section**.

- **Source (verified in code).** `Token::jsonify()` emits `status`, `data`, **and `globals`** on every
  token (`engine/execution/engine/src/Token.cpp:85-111`, over `attributeRegistry.globalAttributes`). So
  all three are already in the stream — **no engine/wasm change needed.**
- **Globals shown once, centrally.** Globals ride on every token but are identical globally, so hoist
  the `globals` field into a **single central Globals section** (updated as they change) — **do not**
  repeat them per token row. Token rows expand to `status`/`data` only.
- **Separation — the expandable-entry primitive goes in `bpmn-js-side-panel`.** Not `bpmn-js-animation`
  (it has no side panel) and not `bpmn-workbench`. The side panel owns tabs, so it should also provide a
  reusable **expandable-entry list**: entries with a **collapsed summary + optional expandable custom
  content**, made expandable **only when extra content is supplied** (plain rows otherwise). This is a
  single modest upstream capability **reused by Issues, Tokens, and Messages** (see R3). The BPMNOS
  `status`/`data` renderer fills the token entry's content slot from the workbench; the central
  **Globals** section is workbench-side.
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

### R5 · Decisions panel for manual simulation (drives the last WP)

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
`bpmn-js-side-panel` expandable-entry primitive (W0/R2). Verify the exact sequential-entry/performer
semantics against the engine (`token_flow_logic_*` + `SequentialPerformerUpdate`) when building this WP.

### R6 · Performers panel — the Performer-Sequence decision UI (refines R5; drives W0 scope)

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

**Impact on W0 (plan accordingly).** The collapsible-entry primitive must support, beyond basic
expand/collapse: (1) a **per-entry controls slot** — action icons (trash) + **up/down reorder toggles**
(with a reorder callback; reorder logic stays consumer-side); (2) **non-expandable entries that still
carry controls** (the marker); (3) **nesting** — a collapsible group whose expanded content is itself a
list of collapsible entries plus the marker; (4) a shareable **collapsed-summary renderer** (a
performer's collapsed view *is* a token's). Mirror properties-panel's `ListGroup`/`ListEntry` (which have
add/remove) where possible; **up/down reorder is the net-new bit**. Design W0/W0b to this richer shape
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
- **Impact on W0:** reinforces **nesting** (message group → recipient token entries), **custom collapsed
  summaries** (envelope + instance-colored bullet), and **reuse of the token-entry renderer** as sub-
  entries — already in W0's scope via R6; add the instance-color bullet as a summary decoration.

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
- **W0 reuse:** the choice inputs live in the entry's **custom expandable-content slot** (dropdown /
  number input are just content) — no new W0 feature; reuses the collapsible entry + token-entry renderer.

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
  token entry) commits the decision — another action in **W0's controls slot** (alongside trash, up/down).
- **Cross-panel routing** = select the token + `sidePanel.activate(<decisionPanel>)` + set that panel's
  **"selected" filter** + focus the input. The routing target is BPMNOS-specific → workbench-side.
- **Double-click hook:** if the Tokens panel reuses `bpmn-js-animation`'s TokenPanel, its double-click
  action (currently hard-wired to advance) must become **configurable/overridable upstream** (modest
  change per the design principle). If the BPMNOS Tokens panel is workbench-built on W0, the routing is
  entirely workbench-side.
- **Canvas token double-click** = the same routing, triggered from a token on the diagram. Tokens are
  rendered by `bpmn-js-animation`, so expose a **token double-click event/hook upstream** (modest change)
  for the workbench to route on. Stacking nuance: pick the front/visible token, or the node's
  decision-relevant token when the decision is node-scoped.

## Work packages

Each WP: **Goal → Deliverable → Test**. *infra* = scaffolding/plumbing, *logic* = detailed logic.
**Order: W0 foundation first; then greedy + playback (W1–W3); manual simulation last (W4)** — the last
has the highest requirements (live Controller loop + user choices / sequential-entry / message-delivery
decisions).

### W0 — Collapsible entries in the side panel (`bpmn-js-side-panel`) · *infra / upstream*
- **Goal/Deliverable.** Add the reusable **expandable-entry list** primitive to `bpmn-js-side-panel`
  (R2): entries with a **collapsed summary + optional expandable custom content**, expandable **only when
  content is supplied** (plain rows otherwise). Match `@bpmn-io/properties-panel`'s **`CollapsibleEntry`**
  in both **look/feel** (`bio-properties-panel-collapsible-entry` markup/classes/CSS vars — already
  loaded) and **API** (`{ id, label, entries/content, open }`). Plain-DOM (min-dom), no preact. This is
  the shared foundation **reused by Tokens (R2), Messages (R3), and later Issues**. Upstream change +
  repin (`github:bpmn-os/bpmn-js-side-panel#<sha>`).
  **Design for the richer shape R6/R7 need** (so the Performers / Message-Deliveries panels don't force
  rework): a **per-entry controls slot** (action icons — e.g. trash, **check/confirm**, + **up/down
  reorder toggles**),
  **non-expandable entries that still carry controls**, **nesting** (a group whose expanded content is a
  list of entries), a **custom collapsed-summary renderer** (reusable across panels; supports decorations
  like an instance-colored bullet), and a reusable **( ) all / ( ) selected filter** header. Mirror
  properties-panel `ListGroup`/`ListEntry` (add/remove) where possible; up/down reorder is net-new.
  **Reorder boundary (decided):** the side panel owns the **up/down toggle rendering + reorder
  interaction** — standardized toggles, disabled at list ends, a11y, and a **reorder callback**
  (`onMove(id,dir)` / `onReorder(from,to)`) that re-renders in the new order. The **consumer owns the
  ordered data and the *meaning* of the order** (BPMNOS Performer auto-advance/hold; trash handler). Same
  for the trash icon: rendered by the generic controls slot, handler supplied by the consumer.
- **Test.** `bpmn-js-side-panel`'s own test setup: an entry **with** content expands/collapses on click;
  an entry **without** content is a plain, non-expandable row; class/DOM parity with the properties-panel
  collapsible entry; a **non-expandable entry with controls** renders its trash + up/down and fires the
  callbacks; **up/down reorder** moves an entry and reports the new order; a **nested group** renders a
  sub-list; the **filter** toggles all/selected.

### W0b — Modernise `bpmn-workbench` onto the new side-panel entries · *infra / upstream*
- **Goal/Deliverable.** Migrate `bpmn-workbench`'s side-panel panels — chiefly **Issues** — onto W0's
  collapsible-entry primitive, giving them properties-panel-consistent look/API and replacing the bespoke
  expand-caret markup. **Preserve the bespoke behaviour** through the custom summary/content slots: Issues'
  severity icons, per-element grouping, and the "Show issues" toggle (`bpmn-workbench/src/modules/issues/`).
  This is R2's "migrate Issues as a separate scoped step." Upstream change to `bpmn-workbench` + repin. (The
  Tokens inspector lives in `bpmn-js-animation`; if in scope, migrate it there the same way.)
- **Test.** Before/after visual checks: severity icons, grouping and the toggle intact; entries expand/
  collapse; class/DOM parity with the properties-panel collapsible entry; existing lint-rule tests still
  pass (`node --test test/*.test.mjs`).

### W1 — App scaffold + wasm-in-worker + autonomous run · *infra*
- **Goal/Deliverable.** Vite app mirroring `bpmn-workbench`+`bpmnos-js`: package.json (git deps
  `bpmnos-js`/`bpmn-workbench`/`bpmn-js-animation`/`bpmn-js-side-panel` + properties-panel stack, and
  `bpmnos-wasm`), vite preact-jsx config + **`.wasm` asset handling**, index.html (canvas+side-panel),
  `src/app.js` = union of BPMNOS extension + side panel + lint + issues + animation modules +
  event-subprocess + context-pad shim; gh-pages workflow; `test/`. Includes a **three-toggle mode bar**
  (port of `mode-buttons.js`) — Manual simulation (`fa-hand-pointer`), Greedy (`fa-microchip`), Playback
  (`fa-play`) — see "Modes & toggles" above. Includes the **Input** panel (instance CSV + model-driven
  lookup pickers + provider/seed; model comes from the canvas via the existing toolbar). A **worker**
  (mirroring the demo) loads `createBPMNOS()`, builds `Input` → `Monitor` → `Engine(input, config, monitor,
  null)`, runs an autonomous **greedy** engine (`run(0)`) on the diagram + instances, and forwards each
  `Monitor.addObserver` entry to the page.
- **Test.** Headless Chrome: app boots, a model imports, a greedy run completes, and the ordered engine
  entry stream arrives on the page (counted/asserted). A `node` test drives the worker path headless.

### W2 — Engine-token → animation mapping + on-canvas playback · *logic* (the core)
- **Goal/Deliverable.** Translate the engine `{token|event|message}` stream into on-canvas animation for
  **greedy + playback** (b/c), implementing the **R1 state→position/effect model** (positions arrival·
  ready·busy·completion·departure; effects flip/pulse/fade/error; bounce is manual-only). Per the design
  principle, **add the extra positions/effects to `bpmn-js-animation`** (generic) and keep only the
  BPMNOS mapping here. Feed the existing `Playback` (do not rebuild playback). Keyed by `label=instanceId`
  (`#k` MI / `^EventSub`), `node`/`sequenceFlow` = element ids; fork/join detection; create/consume at
  start/end.
- **Test.** `node --test`: map recorded engine fixtures (from `bpmnos-wasm` / native `Recorder`) → assert
  the produced animation instructions; replay headless through `bpmn-js-animation` with no "unknown
  element" throw. Validate the mapping against fixtures **before** wiring live wasm.

### W3 — Transport control + observation panels (Tokens, Messages) · *logic*
- **Goal/Deliverable.** (1) The **transport** for greedy/playback: play/pause + speed slider (reuse
  `bpmn-js-animation`'s `primitives.setAnimationDuration` + `Playback`) + on-canvas **time chip** (log
  timestamps). (2) The **`bpmn-js-side-panel` expandable-entry primitive** (R2: properties-panel look/API)
  and the **Tokens** panel (expandable `status`/`data` + central **Globals**, R2) and **Messages** panel
  (R3). These observation panels work in greedy/playback (and later manual). *(The manual live clock is
  W4; playback/greedy need no clock ticks.)*
- **Test.** Headless: speed changes alter animation duration; pause/resume gate it; the time chip tracks
  the animated entry; a token row expands to its `status`/`data`; Globals shows once; the Messages panel
  lists `{message}` entries (collapsed `origin`+`header.name`+`header.sender`, expand → `content`).

### W4 — Manual simulation (last; highest requirements) · *logic*
- **Goal/Deliverable.** Pass a `Controller` to the `Engine`; the worker resume-loop reads
  `getPendingDecisions()` (and the `{…Request}` monitor entries). The **live animation-gated clock**
  (manual transport: play/pause advances/holds `getCurrentTime()` via `enqueueClockTickEvent()` +
  `resume()`, next tick after `max(dwell, animations-drained)` — see the timing model above). The decision
  panels — **Choices (R8)**, **Message Deliveries (R7)**, **Performers (R6)** — each issue the matching
  `enqueue…Decision(...)` (payloads from `getChoiceCandidates`/`getMessageCandidates`) then `resume()`;
  `enqueueTerminationEvent()` supported. Non-sequential entries/exits + direct messages auto-resolve
  upstream (never surface). Manual-mode effect: bounce (input-needed) instead of pulse (R1).
- **Test.** Headless: a scripted decision sequence (choices + message deliveries + sequential entries)
  drives a model with known decision points to a terminal state; rendered result matches the engine
  trace; assert direct messages / non-sequential entries never appear in `pending[]`; the clock advances
  only on play and never outruns animation.

## Sequencing & milestones

- **Foundation** = **W0** (side-panel collapsible entries) — unblocks the Tokens/Messages panels in W3;
  small, upstream, can run in parallel with W1/W2. **W0b** (modernise `bpmn-workbench`/Issues onto W0)
  depends on W0 but is **independent of the workbench core** (W1–W4 consume Issues as-is), so it can land
  anytime after W0 without blocking the greedy/playback path.
- **Playback + greedy milestone (first)** = W1 → W2 → W3. Greedy and playback share the run→log→animate
  path; W2 can be built/tested against captured fixtures in parallel with W1.
- **Manual simulation milestone (last)** = W4 — the highest-requirement WP (Controller loop, live clock,
  Choices / Message Deliveries / Performer Sequence decisions). Depends on `Controller` +
  `enqueueClockTickEvent` (present upstream).

## Verification

- W0: `bpmn-js-side-panel` test — entry with content expands/collapses; entry without content is a plain
  row; class/DOM parity with the properties-panel collapsible entry.
- W0b: `bpmn-workbench` Issues before/after visual check (icons/grouping/toggle intact); lint-rule tests
  still pass.
- W1: headless boot + run; ordered entries received.
- W2: `node --test` adapter units vs. fixtures + headless replay through `bpmn-js-animation`.
- W3: headless speed/pause assertions in both modes; time readout tracks `getCurrentTime()`.
- W4: headless scripted-decision run reaches terminal state matching the engine trace.
- Cross-repo: confirm the `bpmnos-wasm` module version the app pins (local build until `#dist`
  publishes) and that the `.wasm` asset is served beside the glue.

## App files (created during the WPs)

`package.json`, `vite.config.js` (preact-jsx + wasm asset), `index.html`, `src/app.js`,
`src/worker.js` (engine driver), `src/adapter/*` (W2), `src/clock/*` (W3),
`.github/workflows/deploy.yml`, `test/`. Upstream changes (per the design principle) land in
`bpmn-js-animation` (positions/effects), `bpmn-js-side-panel` (expandable-entry primitive), and
`bpmn-workbench` (`mode-buttons`/`Mode` generalization).
