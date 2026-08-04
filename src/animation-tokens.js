/**
 * The seam between the identities this application speaks and the tokens the animation holds.
 *
 * A token is named here by the instance it belongs to and the node it stands at, and a node is always a
 * process rather than the pool drawn for it. The animation draws a process-level token at that pool and
 * reports the pool as the token's node, so the two are translated here and nowhere else.
 */

/** The process a node stands for: the process of a pool, and otherwise the node itself. */
export function processOf(elementRegistry, id) {
  const element = id && elementRegistry && elementRegistry.get(id),
        businessObject = element && element.businessObject;

  return (businessObject && businessObject.processRef && businessObject.processRef.id) || id;
}

/** The animation's token for an identity, or nothing where none has been drawn. */
export function tokenAt(primitives, elementRegistry, label, node) {
  if (!primitives) {
    return null;
  }

  return primitives.getTokens().find((token) =>
    token.label === label && (token.node === node || processOf(elementRegistry, token.node) === node)) || null;
}
