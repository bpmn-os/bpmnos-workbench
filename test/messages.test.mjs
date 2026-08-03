import { test } from 'node:test';
import assert from 'node:assert/strict';

import EngineLogPlayer from '../src/playback/EngineLogPlayer.js';
import MessageStore from '../src/messages/Store.js';
import { Messages } from '../src/messages/index.js';

import { parse } from './support/model.mjs';
import { createAnimation, createElementRegistry, createEventBus, createPrimitives } from './support/animation.mjs';

/**
 * A message is held from the record creating it until the one delivering or withdrawing it, which is the
 * span in which it waits for a recipient and the span the Messages tab shows. The records here are of the
 * engine's own shape, `{ origin, state, header, content }`.
 */

const MODEL = new URL('../src/examples/earliest-arrival.bpmn', import.meta.url);

const created = (origin, sender, name, header = {}, content = {}) => ({
  origin,
  state: 'CREATED',
  header: { name, sender, recipient: null, ...header },
  content
});

const disposed = (origin, sender, state) => ({ origin, state, header: { sender } });

test('a created message is held under its origin and its sender', () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request', { machine: 'M1' }, { Duration: '24' }), '#123456');

  const [ message ] = store.all();

  assert.equal(store.all().length, 1);
  assert.equal(message.name, 'Request');
  assert.equal(message.sender, 'Instance1');
  assert.equal(message.origin, 'SendTask');
  assert.equal(message.color, '#123456');
  assert.equal(message.header.machine, 'M1');
  assert.equal(message.content.Duration, '24');
});

test('a message of one sender is told from a message of another at the same node', () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request'));
  store.apply(created('SendTask', 'Instance2', 'Request'));

  assert.deepEqual(store.all().map((message) => message.sender), [ 'Instance1', 'Instance2' ]);
});

test('a delivered message and a withdrawn one are no longer waiting', () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request'));
  store.apply(created('SendTask', 'Instance2', 'Request'));

  store.apply(disposed('SendTask', 'Instance1', 'DELIVERED'));
  store.apply(disposed('SendTask', 'Instance2', 'WITHDRAWN'));

  assert.deepEqual(store.all(), []);
});

test('a node that sent a message may send another under the same key', () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request', { machine: 'M1' }));
  store.apply(disposed('SendTask', 'Instance1', 'DELIVERED'));
  store.apply(created('SendTask', 'Instance1', 'Request', { machine: 'M2' }));

  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].header.machine, 'M2');
});

test('the service announces a change and the messages go when the tokens go', () => {
  const eventBus = createEventBus(),
        messages = new Messages(eventBus),
        announced = [];

  eventBus.on('messages.changed', () => announced.push(messages.all().length));

  messages.apply(created('SendTask', 'Instance1', 'Request'));
  eventBus.fire('tokens.cleared');

  assert.deepEqual(announced, [ 1, 0 ]);
  assert.deepEqual(messages.all(), []);
});

test('the service answers a clearance without answering the event', () => {
  const eventBus = createEventBus(),
        messages = new Messages(eventBus),
        reached = [];

  // a listener returning a value is a listener that has answered the event, and diagram-js stops the event
  // there: were the clearance to answer `diagram.clear`, the canvas would never hear it
  eventBus.on('diagram.clear', () => reached.push('after'));

  messages.apply(created('SendTask', 'Instance1', 'Request'));
  eventBus.fire('diagram.clear');

  assert.deepEqual(reached, [ 'after' ]);
});

test('the player holds a message while it waits, in the colour of the token that sent it', async () => {
  const definitions = await parse(MODEL),
        eventBus = createEventBus(),
        elementRegistry = createElementRegistry(definitions),
        animation = createAnimation(eventBus, elementRegistry),
        messages = new Messages(eventBus);

  const primitives = createPrimitives([ { node: 'SendTask', label: 'Instance1', color: '#abcdef' } ]);

  const player = new EngineLogPlayer(eventBus, animation, primitives, elementRegistry, {
    get: (name) => name === 'messages' ? messages : undefined
  });

  player.setLog([ { message: created('SendTask', 'Instance1', 'Request', { machine: 'M1' }) } ]);
  await player.play();

  assert.equal(messages.all().length, 1);
  assert.equal(messages.all()[0].color, '#abcdef');

  player.setLog([ { message: disposed('SendTask', 'Instance1', 'DELIVERED') } ]);
  await player.play();

  assert.deepEqual(messages.all(), []);
});

/**
 * What a row shows follows from the message alone, so the tab is drawn into a document of its own and read
 * back. The side panel is stubbed by the two calls the panel makes of it.
 */
async function panel(messages) {
  const { parseHTML } = await import('linkedom'),
        { document } = parseHTML('<!doctype html><html><body></body></html>');

  globalThis.document = document;

  const { default: MessagesPanel } = await import('../src/messages/Panel.js');

  const eventBus = createEventBus(),
        body = document.createElement('div');

  const injector = {
    get: (name) => name === 'sidePanel'
      ? { addTab: () => ({ body, footer: document.createElement('div') }), setNote() {} }
      : undefined
  };

  const shown = new MessagesPanel(injector, eventBus, messages, {});

  eventBus.fire('diagram.init');

  return { body, eventBus, shown };
}

test('a tab with nothing to show says so, in the words the Tokens tab uses', async () => {
  const { body } = await panel(new MessageStore());

  assert.equal(body.querySelector('.bjs-token-empty').textContent, 'No messages.');
  assert.equal(body.querySelector('.bjs-token-filter span').textContent, 'Messages');
  assert.equal(body.querySelectorAll('.bjs-token-filter input').length, 2, 'all, or the selected recipients');
});

test('a row is the message name and its sender, marked with an envelope in the sender\'s colour', async () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request', { machine: 'M1' }, { Duration: '24' }), '#c0392b');

  const { body } = await panel(store);

  const row = body.querySelector('.bjs-token-entry');

  assert.equal(row.querySelector('.bjs-token-label').getAttribute('title'), 'Request');
  assert.equal(row.querySelector('.bjs-token-node').textContent, 'Instance1');
  assert.ok(row.querySelector('svg path'), 'the envelope BPMN draws a message with');
  assert.equal(row.querySelector('svg circle').getAttribute('fill'), '#c0392b');
});

test('an expanded row shows the origin, the header and the contents', async () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request', { machine: 'M1' }, { Duration: '24' }));

  const { body } = await panel(store);

  const lines = [ ...body.querySelectorAll('.wb-attribute') ].map((line) => line.textContent);

  assert.equal(lines[0], 'OriginSendTask', 'the node it was sent from, above the header');
  assert.ok(lines.some((line) => /machineM1/.test(line)), 'a header entry');
  assert.ok(lines.some((line) => /recipientundefined/.test(line)), 'an entry the run left unset');
  assert.ok(lines.some((line) => /Duration24/.test(line)), 'a content');
});

test('the header does not repeat what the collapsed row states', async () => {
  const store = new MessageStore();

  store.apply(created('SendTask', 'Instance1', 'Request', { machine: 'M1' }));

  const { body } = await panel(store);

  const names = [ ...body.querySelectorAll('.wb-attribute-name') ].map((name) => name.textContent);

  assert.deepEqual(names, [ 'Origin', 'recipient', 'machine' ]);
});

test('the tab is drawn again when the store announces a change', async () => {
  const eventBus = createEventBus(),
        messages = new Messages(eventBus);

  const { body, eventBus: panelBus } = await panel(messages);

  assert.equal(body.querySelector('.bjs-token-empty').textContent, 'No messages.');

  messages.apply(created('SendTask', 'Instance1', 'Request'));
  panelBus.fire('messages.changed');

  assert.equal(body.querySelectorAll('.bjs-token-entry').length, 1);
});
