import { test } from 'node:test';
import assert from 'node:assert/strict';

import EngineRunner from '../src/engine/EngineRunner.js';

/**
 * The runner speaks to a worker that answers one request at a time, and it is the runner's business that
 * this is so rather than every caller's. The callers are set off by things that know nothing of each other —
 * the player catching up, the reader choosing, the reader deciding — so a request that arrives while another
 * is being answered waits its turn rather than being refused.
 *
 * The worker here is a stub that records what it was asked and answers when the test says so, which is the
 * only way to hold two requests in flight at once and see what becomes of them.
 */
function createWorker() {
  const asked = [];

  const worker = {
    asked,
    postMessage(message) { asked.push(message); },
    answer(reply) { worker.onmessage({ data: reply }); },
    onmessage: null,
    onerror: null,
    terminate() {}
  };

  return worker;
}

test('a request made while another is being answered waits rather than failing', async () => {
  const worker = createWorker(),
        runner = new EngineRunner(worker);

  const first = runner.advance(),
        second = runner.choiceCandidates('Instance_1', 'Task_1', []);

  assert.deepEqual(worker.asked.map((message) => message.type), [ 'advance' ],
    'the second waits: the worker is answering the first');

  worker.answer({ type: 'step', entries: [], advanced: true });

  assert.equal((await first).advanced, true);
  assert.deepEqual(worker.asked.map((message) => message.type), [ 'advance', 'choiceCandidates' ],
    'and is asked as soon as the first is answered');

  worker.answer({ type: 'choiceCandidates', candidates: { attribute: 'x' } });

  assert.deepEqual(await second, { attribute: 'x' });
});

test('requests are answered in the order they were made', async () => {
  const worker = createWorker(),
        runner = new EngineRunner(worker),
        answered = [];

  runner.advance().then(() => answered.push('advance'));
  runner.choiceCandidates('Instance_1', 'Task_1', []).then(() => answered.push('choices'));
  runner.stop().then(() => answered.push('stop'));

  worker.answer({ type: 'step', entries: [], advanced: true });
  worker.answer({ type: 'choiceCandidates', candidates: {} });
  worker.answer({ type: 'stopped' });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(answered, [ 'advance', 'choices', 'stop' ]);
});

test('a channel that fails fails everything waiting on it', async () => {
  const worker = createWorker(),
        runner = new EngineRunner(worker);

  const first = runner.advance(),
        second = runner.advance();

  worker.answer({ type: 'error', error: 'the engine gave up' });

  // nothing behind a failed channel will ever be served, so it is told rather than left waiting
  await assert.rejects(first, /the engine gave up/);
  await assert.rejects(second, /the engine gave up/);
});
