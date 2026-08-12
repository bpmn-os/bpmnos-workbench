import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

import collectPerformers from '../src/sequences/performers.js';

/**
 * The sequential performers a model states, read where a replayed log has no engine to ask.
 *
 * What is asserted is the engine's resolution rather than the shape of any model that happens to exist:
 * `SequentialAdHocSubProcess` climbs from the subprocess outward for an activity declaring a sequential
 * performer, stops at an enclosing ad hoc subprocess, falls back to the process where the process declares
 * one, and to the subprocess itself where nothing does. Each of those four is a case here.
 */

const moddle = new BpmnModdle();

async function performersOf(body) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d" targetNamespace="t">
      ${body}
    </bpmn:definitions>`;

  const { rootElement } = await moddle.fromXML(xml);

  return collectPerformers(rootElement);
}

const SEQUENTIAL = '<bpmn:performer name="Sequential" />';

test('the subprocess performs for itself where nothing declares the role', async () => {
  assert.deepEqual(await performersOf(`
    <bpmn:process id="P">
      <bpmn:adHocSubProcess id="Ad" ordering="Sequential">
        <bpmn:task id="Task1" />
        <bpmn:task id="Task2" />
      </bpmn:adHocSubProcess>
    </bpmn:process>`),
  [ { performer: 'Ad', activities: [ 'Task1', 'Task2' ] } ]);
});

test('the process performs where it declares the role', async () => {
  assert.deepEqual(await performersOf(`
    <bpmn:process id="P">
      ${SEQUENTIAL}
      <bpmn:adHocSubProcess id="Ad" ordering="Sequential">
        <bpmn:task id="Task1" />
      </bpmn:adHocSubProcess>
    </bpmn:process>`),
  [ { performer: 'P', activities: [ 'Task1' ] } ]);
});

test('an enclosing activity that declares the role performs, and is taken before the process', async () => {
  assert.deepEqual(await performersOf(`
    <bpmn:process id="P">
      ${SEQUENTIAL}
      <bpmn:subProcess id="Outer">
        ${SEQUENTIAL}
        <bpmn:adHocSubProcess id="Ad" ordering="Sequential">
          <bpmn:task id="Task1" />
        </bpmn:adHocSubProcess>
      </bpmn:subProcess>
    </bpmn:process>`),
  [ { performer: 'Outer', activities: [ 'Task1' ] } ], 'the nearest one performs');
});

test('the subprocess itself is taken before anything enclosing it', async () => {
  assert.deepEqual(await performersOf(`
    <bpmn:process id="P">
      ${SEQUENTIAL}
      <bpmn:adHocSubProcess id="Ad" ordering="Sequential">
        ${SEQUENTIAL}
        <bpmn:task id="Task1" />
      </bpmn:adHocSubProcess>
    </bpmn:process>`),
  [ { performer: 'Ad', activities: [ 'Task1' ] } ]);
});

test('the climb stops at an enclosing ad hoc subprocess, whose performer is its own affair', async () => {
  const performers = await performersOf(`
    <bpmn:process id="P">
      ${SEQUENTIAL}
      <bpmn:adHocSubProcess id="Outer" ordering="Sequential">
        <bpmn:adHocSubProcess id="Inner" ordering="Sequential">
          <bpmn:task id="Task1" />
        </bpmn:adHocSubProcess>
      </bpmn:adHocSubProcess>
    </bpmn:process>`);

  assert.deepEqual(performers.find((one) => one.performer === 'Inner'),
    { performer: 'Inner', activities: [ 'Task1' ] },
    'the inner one performs for itself rather than reaching the process past the outer one');
  assert.deepEqual(performers.find((one) => one.performer === 'P'),
    { performer: 'P', activities: [ 'Inner' ] },
    'and the outer one is the process\'s, an ad hoc subprocess being an activity like any other');
});

test('one node performs for several subprocesses, and only direct children are performed', async () => {
  assert.deepEqual(await performersOf(`
    <bpmn:process id="P">
      ${SEQUENTIAL}
      <bpmn:adHocSubProcess id="Ad1" ordering="Sequential">
        <bpmn:task id="Task1" />
        <bpmn:subProcess id="Nested">
          <bpmn:task id="Deep" />
        </bpmn:subProcess>
      </bpmn:adHocSubProcess>
      <bpmn:adHocSubProcess id="Ad2" ordering="Sequential">
        <bpmn:task id="Task2" />
      </bpmn:adHocSubProcess>
    </bpmn:process>`),
  [ { performer: 'P', activities: [ 'Task1', 'Nested', 'Task2' ] } ],
  'the nested subprocess is performed, what it holds is not');
});

test('a model stating no ad hoc subprocess states no performer', async () => {
  assert.deepEqual(await performersOf(`
    <bpmn:process id="P">${SEQUENTIAL}<bpmn:task id="Task1" /></bpmn:process>`), []);
  assert.deepEqual(collectPerformers(null), [], 'and neither does no model at all');
});
