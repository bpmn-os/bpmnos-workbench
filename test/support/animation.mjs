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
  // node -> Map of key to token, the key being the label and, for a token resting on a flow, that flow:
  // the branches of a fork are several tokens of one label at one node, told apart by the flow they sit on
  const tokens = new Map();
  const calls = [];

  const at = (node) => tokens.get(node) || new Map();

  const key = (label, sequenceFlow) => label + '|' + (sequenceFlow || '');

  const add = (node, label, sequenceFlow) => {
    const held = at(node);

    held.set(key(label, sequenceFlow), { node, label, sequenceFlow });
    tokens.set(node, held);
  };

  const drop = (node, label, sequenceFlow) => at(node).delete(key(label, sequenceFlow));

  // any token of that label at the node, whichever flow it rests on
  const find = (node, label) =>
    [ ...at(node).values() ].find((token) => token.label === label);

  // the flows leaving a node, which is what tells a branch of a fork from the token that arrived
  const outgoing = (node) => {
    const element = elementRegistry.get(node);

    return ((element && element.businessObject.get('outgoing')) || []).map((flow) => flow.id);
  };

  // the node a sequence flow leads to, which is where a hop puts the token
  const target = (flow) => {
    const element = elementRegistry.get(flow),
          targetRef = element && element.businessObject.get('targetRef');

    return targetRef && targetRef.id;
  };

  return {
    calls,

    getToken: (node, label) => find(node, label),

    createToken({ node, label, parentNode, parentLabel }) {
      calls.push({ call: 'createToken', node, label, parentNode, parentLabel });
      add(node, label);
    },

    // places a branch on an outflow at the node without travelling it, the first taking the token that was
    // resting there and each later one standing beside it
    forkToken({ node, label, sequenceFlow }) {
      calls.push({ call: 'forkToken', node, label, sequenceFlow });

      const outflows = outgoing(node);

      const branched = [ ...at(node).values() ]
        .some((token) => token.label === label && outflows.includes(token.sequenceFlow));

      // the first fork takes the token resting at the node, wherever it rests; a later one stands beside it
      if (!branched) {
        const resting = find(node, label);

        if (!resting) {
          throw new Error('forkToken: no token <' + label + '> at <' + node + '>');
        }

        drop(node, label, resting.sequenceFlow);
      }

      add(node, label, sequenceFlow);

      return Promise.resolve();
    },

    advanceToken({ node, label, sequenceFlow, position }) {
      calls.push({ call: 'advanceToken', node, label, sequenceFlow, position });

      const to = sequenceFlow && target(sequenceFlow);

      if (to) {
        const branch = at(node).get(key(label, sequenceFlow)) || find(node, label);

        if (!branch) {
          throw new Error('advanceToken: no token <' + label + '> at <' + node + '>');
        }

        drop(node, label, branch.sequenceFlow);
        add(to, label, sequenceFlow);
        eventBus.fire('token.moved', { token: { node: to, label }, label, from: node, to });
      }

      return Promise.resolve();
    },

    consumeToken({ node, label }) {
      const token = find(node, label);

      calls.push({ call: 'consumeToken', node, label });
      drop(node, label, token && token.sequenceFlow);
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

/**
 * The animation primitives the player asks for its timing, its one-shot effects, and the tokens on show,
 * which is where a colour is read from. The tokens a test wants answered are given here.
 */
export function createPrimitives(tokens = []) {
  return {
    getAnimationDuration: () => 0,
    setAnimationDuration() {},
    playTokenEffect() {},
    drillTo() {},
    getTokens: (filter) => filter ? tokens.filter(filter) : tokens
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
