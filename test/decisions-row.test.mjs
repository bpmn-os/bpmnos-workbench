import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

/**
 * The control a choice is made with, as a function of what the store holds for it.
 *
 * What is covered is what follows from the answer rather than what the row looks like: which of the two
 * controls is drawn, what it offers, and what it reads. The kind is the model's and is carried on the
 * answer, so a choice is drawn as what it is before a run has said what it may take.
 */

// the row reads the global `document` as it is built, so give it one
async function rows() {
  const { document } = parseHTML('<!doctype html><html><body></body></html>');

  globalThis.document = document;

  return (await import('../src/decisions/DecisionEntry.js')).createChoiceRow;
}

const nothing = () => {};

test('an enumerated choice is a drop-down, whether or not it has been answered', async () => {
  const createChoiceRow = await rows();

  const answered = createChoiceRow(
    { attribute: 'mode', kind: 'enumeration', enumeration: [ 'road', 'rail' ] }, nothing);

  const select = answered.querySelector('select');

  assert.ok(select, 'the control is a drop-down');
  assert.equal(select.disabled, false);
  assert.deepEqual([ ...select.querySelectorAll('option') ].map((option) => option.textContent),
    [ 'Select value', 'road', 'rail' ], 'the prompt stands before the values');
  assert.equal(select.value, '', 'and nothing is chosen until the reader chooses');

  // the same choice before it can be made: the model says it is an enumeration, so it is drawn as one
  const unreachable = createChoiceRow({ attribute: 'mode', kind: 'enumeration' }, nothing);

  assert.ok(unreachable.querySelector('select'), 'a choice not yet reachable is a drop-down all the same');
  assert.equal(unreachable.querySelector('select').disabled, true, 'and offers nothing');
});

test('a drop-down reads as the prompt where the value it holds has no option', async () => {
  const createChoiceRow = await rows();

  // The store keeps a value while its options are withdrawn, so that a re-answer admitting it can keep it.
  // A drop-down cannot show a value it has no option for, and telling it to would leave it on no option.
  const row = createChoiceRow({ attribute: 'mode', kind: 'enumeration', value: 'rail' }, nothing);
  const select = row.querySelector('select');

  assert.equal(select.value, '', 'the prompt is what it reads');
  assert.equal(select.querySelector('option[selected]').textContent, 'Select value',
    'rather than no option at all, which is what reads as blank');
});

test('a drop-down reads the value it holds where that value is offered', async () => {
  const createChoiceRow = await rows();

  const row = createChoiceRow(
    { attribute: 'mode', kind: 'enumeration', enumeration: [ 'road', 'rail' ], value: 'rail' }, nothing);

  assert.equal(row.querySelector('select').value, 'rail');
});

test('a choice answered with no value at all says so', async () => {
  const createChoiceRow = await rows();

  const row = createChoiceRow({ attribute: 'mode', kind: 'enumeration', enumeration: [] }, nothing);

  assert.equal(row.querySelector('select').disabled, true);
  assert.match(row.querySelector('.wb-choice-note').textContent, /No value satisfies this choice/);
});

test('a bounded choice is a field with arrows where it has a grid to walk', async () => {
  const createChoiceRow = await rows();

  const walkable = createChoiceRow(
    { attribute: 'x', kind: 'bounds', lowerBound: 1, upperBound: 10, lowest: 1, highest: 10,
      multipleOf: 1, value: 3 }, nothing);

  const input = walkable.querySelector('input');

  assert.equal(input.type, 'text', 'the field is text, so the browser steps nothing');
  assert.equal(input.getAttribute('role'), 'spinbutton');
  assert.equal(input.value, '3');
  assert.equal(walkable.querySelectorAll('button.wb-choice-arrow').length, 2, 'and carries both arrows');

  // no discretizer: there is no grid, so there is nothing for an arrow to walk
  const free = createChoiceRow(
    { attribute: 'share', kind: 'bounds', lowerBound: 0, upperBound: 1, lowest: 0, highest: 1 }, nothing);

  assert.ok(free.querySelector('input'), 'the control is a field all the same');
  assert.equal(free.querySelectorAll('button.wb-choice-arrow').length, 0, 'and carries no arrows');
});

test('an arrow reports the value the choice admits, and stands still at an end', async () => {
  const createChoiceRow = await rows();

  const seen = [];
  const row = createChoiceRow(
    { attribute: 'x', kind: 'bounds', lowerBound: 0, upperBound: 2, lowest: 0, highest: 2,
      multipleOf: 1, value: 1 }, (value) => seen.push(value));

  const [ up, down ] = [ ...row.querySelectorAll('button.wb-choice-arrow') ];

  up.dispatchEvent(new row.ownerDocument.defaultView.Event('click'));
  assert.deepEqual(seen, [ 2 ]);
  assert.equal(row.querySelector('input').value, '2');
  assert.equal(up.disabled, true, 'the end of the grid offers nothing further');

  down.dispatchEvent(new row.ownerDocument.defaultView.Event('click'));
  assert.deepEqual(seen, [ 2, 1 ]);
  assert.equal(up.disabled, false);
});
