import ExecutionStateStore from './Store.js';
import createExecutionStateView from './View.js';

/**
 * ExecutionState — the value store as a diagram-js service, keeping its keys in step with the animation.
 *
 * The store itself knows nothing of a diagram and is written and read as a plain object, which is what makes
 * it testable without one. Only two things tie it to a running diagram, and both are identity rather than
 * value: a token's key follows the token when it hops from one node to the next, and a token's entries are
 * dropped when the token leaves the model. Both are announced by `bpmn-js-animation` as it happens, and the
 * animation drops a token's identity synchronously, before any gesture plays, so a store following those
 * events never disagrees with the token model a view resolves against.
 *
 * Values are not written here. They are written by the player, one record at a time, at the step at which it
 * issues that record's animation call, so that what a token entry shows is what the token held at the moment
 * the diagram is showing.
 */
export class ExecutionState extends ExecutionStateStore {

  constructor(eventBus, executionData, elementRegistry) {
    super(executionData);

    const node = (id) => processIdOf(elementRegistry, id);

    eventBus.on('token.moved', event =>
      this.moveToken({ label: event.label, from: node(event.from), to: node(event.to) }));

    eventBus.on('token.removed', event =>
      this.removeToken({ node: node(event.token.node), label: event.token.label }));

    eventBus.on([ 'tokens.cleared', 'diagram.clear' ], () => this.clear());
  }
}

ExecutionState.$inject = [ 'eventBus', 'executionData', 'elementRegistry' ];

/**
 * The identifier a token at `node` is held under, which is a process rather than a participant.
 *
 * A process has no shape of its own in a collaboration; its pool has. `bpmn-js-animation` therefore holds a
 * process-level token under the pool's identifier, mapping a process to it as it takes one, whereas the
 * engine reports a process and the execution data registry names a process as the element declaring what a
 * process declares. The workbench keeps the engine's vocabulary, since it is also the model's, and maps a
 * canvas identifier back at every edge where one arrives: a pool becomes the process it stands for, and
 * anything else, a flow node or a pool-less process, is already what it names.
 */
export function processIdOf(elementRegistry, node) {
  const element = elementRegistry && elementRegistry.get(node),
        processRef = element && element.businessObject && element.businessObject.processRef;

  return processRef ? processRef.id : node;
}

/**
 * The execution state module. It requires `bpmnos-js`'s `executionData` registry, which the host adds
 * itself, since which of the BPMN-OS modules a host wants is the host's choice.
 */
export default {
  __init__: [ 'executionState' ],
  executionState: [ 'type', ExecutionState ]
};

/**
 * The body renderer a token list is configured with, as `config.tokenPanel.renderTokenDetail` for the
 * packaged Tokens tab or as `createTokenEntry`'s `renderDetail` for a panel composing its own rows.
 *
 * A panel's configuration is read as the panel is built, which is before the services it needs exist, so the
 * view is created on the first row that is drawn and held from then on. One view serves every panel of a
 * host, holding one subscription to the store between them.
 *
 * @param {djs.injector} injector  the modeller, or anything answering `get`
 * @return {function(Object, Element): void}  (token, element) => void
 */
export function createTokenDetailRenderer(injector) {
  let view = null;

  return (token, element) => {
    view = view || createExecutionStateView(injector.get('executionData'), injector.get('executionState'));

    view.render(processIdOf(injector.get('elementRegistry'), token.node), token.label, element);
  };
}

export { default as ExecutionStateStore, attributeName, isKeyword, INSTANCE, TIMESTAMP, OBJECTIVE } from './Store.js';
export { default as createExecutionStateView } from './View.js';
export { default as sections } from './sections.js';
