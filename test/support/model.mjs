import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';

import bpmnos from 'bpmnos-js/moddle' with { type: 'json' };
import { collectExecutionData, getElements } from 'bpmnos-js/collect-execution-data';

/**
 * The test harness: a model parsed from a fixture, and the execution data registry collected from it.
 *
 * Nothing here runs a diagram. `collectExecutionData` reads the moddle tree alone, so what a node declares
 * and inherits is available under `node --test` exactly as it is in the modeller, where the same collection
 * is kept current by `bpmnos-js`'s `executionData` service.
 */

const moddle = new BpmnModdle({ bpmnos });

// what an element carrying no execution data reports, as the `executionData` service reports it
const EMPTY = { status: [], data: [], globals: [] };

/**
 * Parse a model, named either by a file in `test/fixtures` or by a URL, which is how a test reaches a model
 * the application itself bundles.
 *
 * @param {String|URL} source  a fixture's file name, e.g. `nested-data.bpmn`, or a URL
 * @return {Promise<ModdleElement>}  the `bpmn:Definitions`
 */
export async function parse(source) {
  const url = source instanceof URL ? source : new URL('../fixtures/' + source, import.meta.url);

  const { rootElement, warnings } = await moddle.fromXML(await readFile(fileURLToPath(url), 'utf8'));

  if (warnings.length) {
    throw new Error(url.pathname + ' did not parse cleanly: ' + JSON.stringify(warnings));
  }

  return rootElement;
}

/**
 * The registry of a model, in the shape the store asks for: the two methods of `bpmnos-js`'s
 * `executionData` service that the store uses, over the collection of that model.
 *
 * @param {String|URL|ModdleElement} source  a fixture's file name, a URL, or a parsed `bpmn:Definitions`
 * @return {Promise<{ get: function(String): Object, getElements: function(String): String[] }>}
 */
export async function registryOf(source) {
  const definitions = source && source.$type === 'bpmn:Definitions' ? source : await parse(source);

  const registry = collectExecutionData(definitions);

  return {
    get: (element) => registry.byElement.get(element) || EMPTY,
    getElements: (element, attribute) => getElements(registry, element, attribute)
  };
}

/**
 * The declaration of an attribute, by identifier, as it is visible at an element. Every value is reached
 * through a declaration, so a test names the element it reads at and the identifier it reads.
 */
export function attribute(registry, element, id) {
  const declared = registry.get(element);

  const found = [ ...declared.status, ...declared.data, ...declared.globals ]
    .find((candidate) => candidate.id === id);

  if (!found) {
    throw new Error('no attribute ' + id + ' is visible at ' + element);
  }

  return found;
}
