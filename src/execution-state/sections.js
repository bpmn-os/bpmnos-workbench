import { attributeName, isKeyword } from './Store.js';

/**
 * What a token entry shows, as data rather than as DOM.
 *
 * The rows are fixed by the model and the values by the run: the attributes are exactly those the registry
 * declares at the token's node, in the order it reports them, outermost first and the node's own last, which
 * is the order a token carries them in, and each is paired with what the store holds for that token. Since
 * the set is a property of the node, it stands for as long as the token's node does, which is what lets a
 * body be written into rather than rebuilt while a run advances.
 *
 * Neither keyword is shown. A token's `Instance` is the label on its own summary row and its `Timestamp` is
 * what the clock on the canvas reads, so both would be a second copy of something already on the screen.
 *
 * A section holding no rows is left out. In a well-formed model that is the globals of a model declaring
 * none, and either of the other two where the process declares nothing beyond the keyword itself.
 */

const CATEGORIES = [
  { category: 'status', label: 'Status' },
  { category: 'data', label: 'Data' },
  { category: 'globals', label: 'Globals' }
];

/**
 * @param {{ get: function(String): Object }} executionData  the execution data registry
 * @param {ExecutionStateStore} store                        the values the run has produced
 * @param {String} node                                      the node the token rests at
 * @param {String} label                                     the token's label
 *
 * @return {Array<{ category: String, label: String, rows: Array<{ id, name, value }> }>}
 */
export default function sections(executionData, store, node, label) {
  const declared = executionData.get(node);

  return CATEGORIES
    .map(({ category, label: heading }) => ({
      category,
      label: heading,
      rows: (declared[category] || [])
        .filter((attribute) => !isKeyword(attribute))
        .map((attribute) => ({
          id: attribute.id,
          name: attributeName(attribute),
          value: store.getValue(node, label, attribute)
        }))
    }))
    .filter((section) => section.rows.length);
}
