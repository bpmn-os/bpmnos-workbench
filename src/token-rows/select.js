import { tokenAt } from '../animation-tokens.js';

/**
 * Selecting a token by clicking the row that shows it.
 *
 * This is what a click in the Tokens tab does, and every list of this application does it: the token's
 * stacks are brought to the front and the ordinary click-selection is announced, so a token selected in one
 * list is selected on the canvas and in every other list showing it. The reader's own event goes with it,
 * so shift adds a token to the selection or takes it out again, as it does on the canvas.
 *
 * It lives here rather than inside the token row because a row is not the only thing that shows a token. A
 * performer is the token standing at the node that performs, and a decision is the token standing at the
 * decision task, so selecting either is the same act rather than an imitation of it; and a row that
 * selected while a performer beside it did not would be the inconsistency the token rows exist to prevent.
 *
 * A token the animation has not drawn has no stack to reveal and nothing to select, so a row showing one
 * stays inert rather than announcing a click for a token that is not there.
 *
 * A double click is not offered. In the Tokens tab it advances the token, and in this application the
 * engine advances tokens; a panel that advanced one would be a second way to drive the run.
 */

/**
 * Announce the selection of a token, as a click in the Tokens tab announces it.
 *
 * @param {Object} injector
 * @param {Object} eventBus
 * @param {Object} token  the animation's own token, or nothing where it has drawn none
 * @param {Event} [originalEvent]
 */
export function selectToken(injector, eventBus, token, originalEvent) {
  const animation = injector.get('animation', false);

  if (!token || !token.state) {
    return; // a stand-in: the engine is ahead of what has been drawn
  }

  Promise.resolve(animation && animation.reveal(token)).then(() => {
    eventBus.fire('token.click', {
      node: token.node,
      label: token.label,
      sequenceFlow: token.state.sequenceFlow || null,
      stackIndices: token.stackIndices || {},
      originalEvent: originalEvent || {}
    });
  });
}

/**
 * What a row needs in order to select the token it shows: whether that token is selected, which is what
 * tints the row, and the click that announces the selection.
 *
 * Nothing is returned where the animation has drawn no token, so a row showing one the engine has run ahead
 * of takes no pointer and answers no click, rather than offering a selection that cannot happen.
 *
 * @param {Object} injector
 * @param {Object} eventBus
 * @param {{instanceId: string, nodeId: string}} identity
 * @returns {{selected: boolean, onClick: Function}|null}
 */
export function selectionFor(injector, eventBus, identity) {
  const token = tokenAt(
    injector.get('primitives', false),
    injector.get('elementRegistry', false),
    identity.instanceId,
    identity.nodeId
  );

  if (!token) {
    return null;
  }

  return {
    selected: !!token.selected,
    onClick: (originalEvent) => selectToken(injector, eventBus, token, originalEvent)
  };
}
