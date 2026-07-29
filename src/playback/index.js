import { AnimationModule } from 'bpmn-js-animation';

import EngineLogPlayer from './EngineLogPlayer.js';

/**
 * bpmn-js additionalModule that registers EngineLogPlayer as the **`playback`** service — overriding
 * bpmn-js-animation's packaged `Playback` so its **TokenPanel** (Load log / run / pause / speed) drives
 * our native BPMN-OS engine-log playback instead. Same interface, native resolution (no intermediate
 * execution-log translation). List this AFTER `TokenPanelModule` so the override wins. Pulls in the
 * animation enabling API (`animation` + `primitives`) via `__depends__`.
 *
 * Where the host also provides the `executionState` service (this repo's execution-state module), the player
 * writes each record's values into it as it replays that record. It is resolved optionally, so playback is
 * unaffected in a host that wants the animation without the values.
 */
export const EnginePlaybackModule = {
  __depends__: [ AnimationModule ],
  __init__: [ 'playback' ],
  playback: [ 'type', EngineLogPlayer ]
};

export default EnginePlaybackModule;
