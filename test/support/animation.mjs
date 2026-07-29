/**
 * A stub of the services `EngineLogPlayer` drives, enough to replay a log without a diagram.
 *
 * It keeps the part of `bpmn-js-animation`'s token model the player asks about, which is which token rests
 * at which node under which label, and it records every call in order, so a test may assert what the player
 * did as well as what the store then held. Identity is dropped and taken up synchronously, as the real
 * animation does, and the two events the store rides, `token.moved` and `token.removed`, are fired on the
 * same event bus at the same moments.
 */
export function createAnimation(eventBus, elementRegistry) {
  const tokens = new Map(); // node -> Map of label to token
  const calls = [];

  const at = (node) => tokens.get(node) || new Map();

  const add = (node, label) => {
    const held = at(node);

    held.set(label, { node, label });
    tokens.set(node, held);
  };

  const drop = (node, label) => at(node).delete(label);

  // the node a sequence flow leads to, which is where a hop puts the token
  const target = (flow) => {
    const element = elementRegistry.get(flow),
          targetRef = element && element.businessObject.get('targetRef');

    return targetRef && targetRef.id;
  };

  return {
    calls,

    getToken: (node, label) => at(node).get(label),

    createToken({ node, label, parentNode, parentLabel }) {
      calls.push({ call: 'createToken', node, label, parentNode, parentLabel });
      add(node, label);
    },

    advanceToken({ node, label, sequenceFlow, position }) {
      calls.push({ call: 'advanceToken', node, label, sequenceFlow, position });

      const to = sequenceFlow && target(sequenceFlow);

      if (to) {
        drop(node, label);
        add(to, label);
        eventBus.fire('token.moved', { token: { node: to, label }, label, from: node, to });
      }

      return Promise.resolve();
    },

    consumeToken({ node, label }) {
      const token = at(node).get(label);

      calls.push({ call: 'consumeToken', node, label });
      drop(node, label);
      eventBus.fire('token.removed', { token: token || { node, label } });

      return Promise.resolve();
    },

    setCue(node, label, animate) {
      calls.push({ call: 'setCue', node, label, animate });
    },

    focusToken() {},
    isAutoFocus: () => false,
    whenFocused: () => Promise.resolve(),
    whenEntered: () => Promise.resolve(),

    clear() {
      tokens.clear();
      calls.push({ call: 'clear' });
      eventBus.fire('tokens.cleared');
    }
  };
}

/** A minimal event bus, carrying the events the store and the player exchange. */
export function createEventBus() {
  const listeners = new Map();

  return {
    on(events, callback) {
      [].concat(events).forEach((event) =>
        listeners.set(event, (listeners.get(event) || []).concat(callback)));
    },
    fire(event, payload) {
      (listeners.get(event) || []).forEach((callback) => callback(payload || {}));
    }
  };
}

/** The animation primitives the player asks for its timing and its one-shot effects. */
export function createPrimitives() {
  return {
    getAnimationDuration: () => 0,
    setAnimationDuration() {},
    playTokenEffect() {},
    drillTo() {}
  };
}

/**
 * An element registry over a parsed model, answering what the player asks of an element: its business
 * object, so that `is` and `isAny` decide its type, and its parent, which is the scope containing it.
 */
export function createElementRegistry(definitions) {
  const elements = new Map();

  const record = (businessObject, parent) => {
    const element = { id: businessObject.id, businessObject, parent, $type: businessObject.$type };

    elements.set(businessObject.id, element);

    (businessObject.get('flowElements') || []).forEach((child) => record(child, element));
  };

  (definitions.get('rootElements') || [])
    .filter((rootElement) => rootElement.$type === 'bpmn:Process')
    .forEach((process) => record(process, null));

  return { get: (id) => elements.get(id) };
}
