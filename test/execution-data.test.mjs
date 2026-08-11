import { test } from 'node:test';
import assert from 'node:assert/strict';

import { registryOf } from './support/model.mjs';

/**
 * The harness itself: a model parsed from a fixture reports, at every element, the attributes that element
 * declares and inherits. This is what the store and the view resolve every value through, and in the
 * modeller it is the same collection, kept current by `bpmnos-js`'s `executionData` service.
 */

test('a node reports what it declares and what it inherits, outermost first', async () => {
  const registry = await registryOf('nested-data.bpmn');

  const declared = registry.get('PlainTask');

  assert.deepEqual(declared.status.map((attribute) => attribute.id),
    [ 'Timestamp', 'Status_Amount', 'Status_Note' ]);
  assert.deepEqual(declared.data.map((attribute) => attribute.id),
    [ 'Instance', 'Data_Main', 'Data_Plain' ]);
  assert.deepEqual(declared.globals.map((attribute) => attribute.id), [ 'Objective', 'Global_Budget' ]);
});

test('a data attribute names the scope declaring it, which is the scope its container belongs to', async () => {
  const registry = await registryOf('nested-data.bpmn');

  const declaring = Object.fromEntries(registry.get('MultiTask').data
    .map((attribute) => [ attribute.id, attribute.declaringElement ]));

  assert.deepEqual(declaring, {
    Instance: 'MainProcess',
    Data_Main: 'MainProcess',
    Data_Multi: 'MultiSub'
  });
});

test('the elements seeing an attribute are those within the scope declaring it', async () => {
  const registry = await registryOf('nested-data.bpmn');

  const sees = new Set(registry.getElements('EventTask', 'Data_Event'));

  assert.ok(sees.has('EventSub'), 'the declaring scope sees its own data');
  assert.ok(sees.has('EventStart') && sees.has('EventTask'), 'so does everything within it');
  assert.ok(!sees.has('MainProcess'), 'and nothing outside it does');
});

test('each participant of a collaboration declares its own keyword attributes', async () => {
  const registry = await registryOf('job-shop.bpmn');

  const job = registry.get('JobProcess'),
        machine = registry.get('MachineProcess');

  assert.equal(job.status[0].id, 'Timestamp');
  assert.equal(machine.status[0].id, 'Timestamp');
  assert.equal(job.data[0].id, 'Instance');
  assert.equal(machine.data[0].id, 'Instance');

  assert.notEqual(job.status[0].declaringElement, machine.status[0].declaringElement);
  assert.notEqual(job.data[0].declaringElement, machine.data[0].declaringElement);
});
