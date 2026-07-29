import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * The workbench offers its modules to a host that wants one of them without the application, on the pattern
 * `bpmn-workbench` uses. Each subpath is imported here by the package's own name, which is what a consumer
 * writes, so the export map is exercised rather than the file layout.
 *
 * The playback and greedy subpaths are not imported here. Both reach `bpmn-js-animation` and the wasm
 * engine, whose sources use extensionless relative imports and a worker, so they resolve under a bundler
 * and not under Node. They are exported for a bundling host and their loading is covered by the production
 * build.
 */

test('the execution state is consumable as a module, a store, its rows and its view', async () => {
  const module = await import('bpmnos-workbench/execution-state');

  assert.equal(typeof module.default.executionState[1], 'function', 'the diagram-js module');
  assert.equal(typeof module.createTokenDetailRenderer, 'function');
  assert.equal(typeof module.createExecutionStateView, 'function');
  assert.equal(typeof module.ExecutionStateStore, 'function');
  assert.equal(typeof module.isKeyword, 'function');

  const { default: Store } = await import('bpmnos-workbench/execution-state/store');
  const { default: sections } = await import('bpmnos-workbench/execution-state/sections');
  const { default: createView } = await import('bpmnos-workbench/execution-state/view');

  assert.equal(Store, module.ExecutionStateStore);
  assert.equal(createView, module.createExecutionStateView);
  assert.equal(typeof sections, 'function');
});

test('the stylesheet the view expects a host to import is where the export map says', async () => {
  const path = fileURLToPath(new URL('../src/execution-state/execution-state.css', import.meta.url));

  await assert.doesNotReject(access(path));
});
