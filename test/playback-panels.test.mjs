import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { DIVIDER } from '../src/sequences/Store.js';

/**
 * What the three tabs a run concerns list while a log is replayed.
 *
 * A replayed log lists what the records say and withholds only what an engine would have to answer: a
 * message is listed from the moment it was sent, with no token that might take it until the one that did
 * is named; a decision task is listed while it waits, with no options to its choices; a performer is listed
 * for what it has performed and is performing, and not for a queue whose entries only it may grant.
 *
 * Both controls of such a tab are greyed and state what it is showing rather than asking the reader: a
 * selection is a question about a run in progress, so the filter reads `all`, and a log is read whole, so
 * the archive is listed. Neither setting narrows anything while it is fixed.
 *
 * The panels are driven here as the workbench drives them — a store, a side panel and the source the mode
 * buttons announce — so what is asserted is what a reader would see.
 */

function dom() {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');

  globalThis.document = document;
  globalThis.window = window;

  return document;
}

// the events the panels listen to, and nothing else
function bus() {
  const listeners = new Map();

  return {
    on(events, fn) {
      [].concat(events).forEach((event) => listeners.set(event, (listeners.get(event) || []).concat(fn)));
    },
    fire(event, payload) {
      (listeners.get(event) || []).forEach((fn) => fn(payload || {}));
    }
  };
}

// a side panel that hands out the three regions a tab is built in, and remembers its name
function sidePanel(document) {
  const tabs = new Map();

  return {
    labels: new Map(),
    addTab({ id }) {
      const parts = {
        header: document.createElement('div'),
        body: document.createElement('div'),
        footer: document.createElement('div')
      };

      tabs.set(id, parts);

      return parts;
    },
    setTabLabel(id, label) {
      this.labels.set(id, label);
    },
    getTab(id) {
      return tabs.get(id);
    },
    setNote() {}
  };
}

function injectorOf(services) {
  return { get: (name) => services[name] || null };
}

/** Build a panel over a store of things given by hand, in a run whose source is announced. */
async function panelFor(module, service, held, source) {
  const document = dom();
  const eventBus = bus();
  const panel = sidePanel(document);
  const Panel = (await import(module)).default;

  const instance = new Panel(
    injectorOf({ sidePanel: panel }),
    eventBus,
    { all: () => held, frozenValues: () => null, recipients: () => [], [service]: true },
    {}
  );

  eventBus.fire('diagram.init');
  eventBus.fire('source.changed', { source });

  return { instance, panel, eventBus, document };
}

test('Messages lists a message from the moment it was sent, with no candidate to take it', async () => {
  const inFlight = { key: 'a', origin: 'Sender', header: {}, content: {}, archived: false, state: 'CREATED' },
        delivered = { key: 'b', origin: 'Sender', header: {}, content: {}, archived: true, state: 'DELIVERED' };

  const replay = await panelFor('../src/messages/Panel.js', 'messages', [ inFlight, delivered ], 'playback');

  assert.equal(replay.panel.labels.get('messages'), 'Messages (2)',
    'both are listed, the one in flight as much as the one that was delivered');
  assert.equal(replay.instance._candidates(inFlight), null,
    'and nothing is said of who might take the one in flight');
});

test('Decisions lists a task while it waits, with no options to its choices', async () => {
  const choices = [ { attribute: 'mode', kind: 'enumeration' } ];
  const waiting = { key: 'a|T', instanceId: 'a', nodeId: 'T', choices, archived: false },
        answered = { key: 'b|T', instanceId: 'b', nodeId: 'T', choices: [], archived: true };

  const replay = await panelFor('../src/decisions/Panel.js', 'decisions', [ waiting, answered ], 'playback');

  assert.equal(replay.panel.labels.get('decisions'), 'Decisions (2)',
    'the one being waited at is listed with the one that was answered');

  const body = replay.instance._body_(waiting);

  assert.equal(body.querySelector('select'), null, 'a choice offers no options to pick from');
  assert.equal(body.querySelector('.wb-choice-control'), null, 'and no control to pick with');
  assert.ok(body.querySelector('.wb-choice-made'), 'it is written as an attribute, as a read choice is');
});

test('Sequences lists a performer from the moment its token is busy, and not what it is queueing', async () => {
  const closed = performer('a', { closed: true }),
        conducting = performer('b', { conducting: 'x|Task', order: [ 'x|Task', DIVIDER, 'y|Task' ] }),
        opened = performer('c', { order: [ DIVIDER ] });

  const replay = await panelFor('../src/sequences/Panel.js', 'sequences',
    [ closed, conducting, opened ], 'playback');

  assert.equal(replay.panel.labels.get('sequences'), 'Sequences (3)',
    'a performer standing busy is listed, whether or not it has conducted anything yet');

  const greedy = await panelFor('../src/sequences/Panel.js', 'sequences',
    [ closed, conducting, opened ], 'greedy');
  const greedyList = greedy.instance._list(conducting);

  // what it is conducting is a record; what is queued behind is an entry only the performer may grant
  const list = replay.instance._list(conducting);

  assert.equal(list.querySelector('.wb-performer-divider'), null, 'the divider goes with the queue');
  assert.ok(greedyList.querySelector('.wb-performer-divider'),
    'which a run in progress draws, so the assertion above is about the replay and not the selector');
  assert.equal(list.textContent.includes('y'), false, 'and the waiting token is not listed');

  // a performer that has neither performed nor is performing opens on nothing, so it is a plain row
  const rows = [ ...replay.instance._inspector.children ];

  assert.equal(rows[2].querySelector('.bjs-collapsible-entry-arrow').disabled, true,
    'the one holding nothing carries no working caret');
  assert.equal(rows[1].querySelector('.bjs-collapsible-entry-arrow').disabled, false,
    'and the one conducting a token does');
});

test('a message in flight says nothing of who may take it, rather than that none may', async () => {
  const inFlight = { key: 'a', origin: 'Sender', header: {}, content: {}, archived: false, state: 'CREATED' };

  const replay = await panelFor('../src/messages/Panel.js', 'messages', [ inFlight ], 'playback');
  const greedy = await panelFor('../src/messages/Panel.js', 'messages', [ inFlight ], 'greedy');

  assert.equal(replay.instance._candidates(inFlight), null,
    'nothing to say is not the same as saying none');
  assert.equal(replay.instance._inspector.textContent.includes('No tokens'), false,
    'so the section the denial would stand in is not drawn');
  assert.equal(greedy.instance._inspector.textContent.includes('No tokens'), true,
    'where a run is in progress it is, the answer being one the engine gave');
});

test('both controls are greyed and state what the tab is showing', async () => {
  for (const [ module, service, id ] of [
    [ '../src/messages/Panel.js', 'messages', 'messages' ],
    [ '../src/sequences/Panel.js', 'sequences', 'sequences' ],
    [ '../src/decisions/Panel.js', 'decisions', 'decisions' ]
  ]) {
    const replay = await panelFor(module, service, [], 'playback');
    const tab = replay.panel.getTab(id);
    const toggle = tab.footer.querySelector('.wb-archive-toggle input');
    const options = [ ...tab.header.querySelectorAll('.bjs-token-filter label input') ];

    assert.equal(toggle.checked, true, id + ': the archive is listed');
    assert.equal(toggle.disabled, true, id + ': and a log is read whole, so saying otherwise is not offered');
    assert.deepEqual(options.map((one) => one.disabled), [ true, true ],
      id + ': the filter is greyed, selecting on a selection there is none of');
    assert.equal(options[0].checked, true, id + ': and reads all, so it narrows nothing');

    replay.eventBus.fire('source.changed', { source: 'greedy' });

    assert.equal(tab.footer.querySelector('.wb-archive-toggle input').disabled, false,
      id + ': and a run in progress has both back');
    assert.deepEqual([ ...tab.header.querySelectorAll('.bjs-token-filter label input') ]
      .map((one) => one.disabled), [ false, false ]);
  }
});

function performer(key, held) {
  return {
    key,
    label: key,
    node: 'Performer',
    order: [],
    archived: new Set(),
    tokens: new Map(),
    closed: false,
    conducting: null,
    committed: null,
    ...held
  };
}
