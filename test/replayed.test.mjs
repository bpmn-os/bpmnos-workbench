import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import replayed from '../src/replayed.js';
import answerable from '../src/answerable.js';

/**
 * What a replayed log is, and what the filter a tab's heading carries does about it.
 *
 * Three sources run in this workbench and the tabs treat them in two different ways, so the two questions
 * are asked separately: whether the reader may answer what is shown, which is manual alone, and whether
 * there is anything but the record to show, which is a replayed log alone. A greedy run is the case that
 * tells them apart, being unanswerable and a run in progress at once.
 */

// a bus that is nothing but the source announcement the mode buttons make
function bus() {
  const listeners = new Map();

  return {
    on(event, fn) {
      listeners.set(event, (listeners.get(event) || []).concat(fn));
    },
    fire(event, payload) {
      (listeners.get(event) || []).forEach((fn) => fn(payload));
    },
    say(source) {
      this.fire('source.changed', { source });
    }
  };
}

test('a replayed log is the one source that is a record, and greedy is not', () => {
  const eventBus = bus();
  const isRecord = replayed(eventBus, () => {});
  const mayAnswer = answerable(eventBus, () => {});

  assert.equal(isRecord(), false, 'nothing is a record before a run has a source');

  eventBus.say('manual');
  assert.equal(isRecord(), false);
  assert.equal(mayAnswer(), true, 'a manual run is the reader\'s to answer');

  eventBus.say('greedy');
  assert.equal(isRecord(), false, 'a greedy run is a run in progress, whoever answers it');
  assert.equal(mayAnswer(), false);

  eventBus.say('playback');
  assert.equal(isRecord(), true);
  assert.equal(mayAnswer(), false);

  eventBus.say('model');
  assert.equal(isRecord(), false);
});

test('the answer is reported only where it changes', () => {
  const eventBus = bus();
  let changes = 0;

  replayed(eventBus, () => changes++);

  eventBus.say('manual');
  eventBus.say('greedy');
  assert.equal(changes, 0, 'neither is a record, so nothing changed');

  eventBus.say('playback');
  assert.equal(changes, 1);

  eventBus.say('playback');
  assert.equal(changes, 1, 'the same source again is no change');

  eventBus.say('greedy');
  assert.equal(changes, 2);
});

test('the filter is fixed on all rather than taken away', async () => {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');

  globalThis.document = document;

  const addFilter = (await import('../src/panel-filter.js')).default;
  const heading = document.createElement('div');

  let value = 'all';
  const filter = addFilter(heading, { name: 'wb-test-filter', onChange: (v) => (value = v) });

  const [ all, selected ] = [ ...heading.querySelectorAll('input') ];

  assert.equal(all.checked, true, 'a filter reads all until the reader says otherwise');

  // the reader narrows the list, as a click on the second option does
  selected.checked = true;
  selected.dispatchEvent(new document.defaultView.Event('change'));
  assert.equal(value, 'selected');

  filter.setFixed(true);
  assert.deepEqual([ ...heading.querySelectorAll('label') ].map((one) => one.classList.contains('wb-filter-fixed')),
    [ true, true ], 'the control stays and is greyed, so the tab keeps its shape');
  assert.deepEqual([ all.disabled, selected.disabled ], [ true, true ], 'and takes no press');
  assert.equal(all.checked, true, 'what it reads is all, which is what the tab lists');

  filter.setFixed(false);
  assert.deepEqual([ all.disabled, selected.disabled ], [ false, false ]);
  assert.equal(all.checked, true, 'it is released reading all rather than what it read before');
});

