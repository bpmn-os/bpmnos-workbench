import createTokenEntry from 'bpmn-js-animation/lib/TokenEntry.js';

import { processOf, tokenAt } from '../animation-tokens.js';

/**
 * TokenRows — a token of a run, drawn as the Tokens tab draws it, wherever a panel needs to show one.
 *
 * A panel that asks something of the reader shows the token it is about: the message a token may receive,
 * the activity a performer takes on next, the choice a decision task waits for. Such a row is the Tokens
 * tab's row rather than a description of it, so it is built with the same entry and told the same things,
 * and it is kept current the same way — the animation reports that a token moved, changed, was removed or
 * was selected, and the row is updated in place.
 *
 * What the panel adds is its own: a control the row carries, and a contribution to what the row discloses.
 * The control sits in the row's controls slot, where its clicks do not select the token; the contribution
 * is drawn after the host's own detail, in the same body.
 *
 * A click on the row selects the token it shows, as a click in the Tokens tab does, so that a token picked
 * out in one list is picked out in every list and on the canvas.
 *
 * A token the animation has not drawn stands in for itself with the instance and the node it waits at, the
 * engine running ahead of what has been played.
 *
 * A row is held under the key its caller gives it, which is where the row is shown rather than which token
 * it shows: one token is a candidate for many messages, and later a candidate at many performers, and one
 * element cannot stand in two lists. A panel drawing its list again is handed the rows it already has, so
 * what a reader expanded, or typed into a choice, survives the redraw.
 */
export function TokenRows(injector, eventBus) {
  this._injector = injector;
  this._eventBus = eventBus;
  this._rows = new Map();

  eventBus.on([
    'token.added', 'token.updated', 'token.moved', 'token.removed', 'token.selection.changed'
  ], () => this._rows.forEach((row) => row.update()));

  eventBus.on('tokens.cleared', () => {
    this._rows.forEach((row) => row.update());
  });
}

TokenRows.$inject = [ 'injector', 'eventBus' ];

/**
 * The row of one token at one place, made once and handed back thereafter.
 *
 * @param {string} key  where the row is shown, which is the caller's to name
 * @param {{instanceId: string, nodeId: string}} identity  the token, as the engine names it
 * The row is made once and handed back thereafter, so what a caller gives here is what the row was made
 * with. A control that comes and goes with a token's state is mounted by its panel into `controlsEl`, which
 * is handed back with the row for exactly that.
 *
 * @param {Object} [options]
 * @param {Element} [options.control]  a control the row carries from the start
 * @param {Function} [options.detail]  (token, contentEl) => void, drawn after the host's own detail
 * @param {boolean} [options.frozen]   the row shows a token that is gone, so the host's detail, which reads
 *                                     the running state, is left out and the panel's detail is the whole
 *                                     of what it discloses
 * @returns {{ element: Element, controlsEl: Element, update: () => void, destroy: () => void }}
 */
TokenRows.prototype.create = function(key, identity, options = {}) {
  const held = this._rows.get(key);

  if (held) {
    return held;
  }

  const entry = createTokenEntry(this._token(identity), {
    controls: options.control,
    displayNode: (id) => this._displayNode(id),
    renderDetail: this._detail(options.detail, options.frozen),
    onClick: (token, event) => this._select(token, event)
  });

  const row = {
    element: entry.element,
    controlsEl: entry.controlsEl,
    update: () => entry.update(this._token(identity)),
    destroy: () => this._rows.delete(key)
  };

  this._rows.set(key, row);

  return row;
};

/**
 * Selecting the token a row shows, which is what a click on it does, exactly as a click in the Tokens tab
 * does: the token's stacks are brought to the front and the ordinary click-selection is announced, so a
 * token selected here is selected on the canvas and in every other list showing it. The reader's own event
 * goes with it, so shift adds a token to the selection, or takes it out again, as it does on the canvas.
 *
 * A token the animation has not drawn is a stand-in with no stack to reveal and nothing to select, so its
 * row stays inert rather than announcing a click for a token that is not there.
 *
 * A double click is not offered. In the Tokens tab it advances the token, and in this application the
 * engine advances tokens; a decision panel that advanced one would be a second way to drive the run.
 */
TokenRows.prototype._select = function(token, originalEvent) {
  const animation = this._injector.get('animation', false);

  if (!token.state) {
    return; // a stand-in: the engine is ahead of what has been drawn
  }

  Promise.resolve(animation && animation.reveal(token)).then(() => {
    this._eventBus.fire('token.click', {
      node: token.node,
      label: token.label,
      sequenceFlow: token.state.sequenceFlow || null,
      stackIndices: token.stackIndices || {},
      originalEvent: originalEvent || {}
    });
  });
};

/**
 * What a row discloses: what the host gives the token panel, so a token reads the same wherever it is
 * shown, and after it whatever the panel has to add. A frozen row leaves the host out, showing a token the
 * run no longer holds, of which the host would report nothing. Where neither is given the row discloses
 * nothing and is drawn as a row without a caret.
 */
TokenRows.prototype._detail = function(detail, frozen) {
  const host = frozen ? null : (this._injector.get('config.tokenPanel', false) || {}).renderTokenDetail;

  if (!host && !detail) {
    return undefined;
  }

  return (token, contentEl) => {
    if (host) {
      host(token, contentEl);
    }
    if (detail) {
      detail(token, contentEl);
    }
  };
};

/** The animation's token, where it has drawn one, and otherwise the identity standing in for it. */
TokenRows.prototype._token = function({ instanceId, nodeId }) {
  return tokenAt(
    this._injector.get('primitives', false),
    this._injector.get('elementRegistry', false),
    instanceId, nodeId
  ) || { label: instanceId, node: nodeId };
};

/** A pool shows the process it stands for, as the Tokens tab shows it. */
TokenRows.prototype._displayNode = function(id) {
  return processOf(this._injector.get('elementRegistry', false), id);
};

export default {
  __init__: [ 'tokenRows' ],
  tokenRows: [ 'type', TokenRows ]
};
