import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureFor, retryDelay, type RunData } from '../src/model';
const base: RunData = {
  sandbox: 'test',
  operationId: 'one',
  scenario: 'transient',
  restored: false,
};
test('transient fault recovers on the third attempt', () => {
  assert.deepEqual(
    [1, 2, 3].map((n) => failureFor(base, n)),
    ['before', 'before', null],
  );
});
test('outage exhausts the three-attempt budget', () => {
  assert.deepEqual(
    [1, 2, 3].map((n) => failureFor({ ...base, scenario: 'outage' }, n)),
    ['before', 'before', 'before'],
  );
});
test('acknowledgement fault occurs after the first commit only', () => {
  assert.equal(failureFor({ ...base, scenario: 'acknowledgement' }, 1), 'after');
  assert.equal(failureFor({ ...base, scenario: 'acknowledgement' }, 2), null);
});
test('restored replay does not reintroduce a controlled fault', () => {
  for (const scenario of ['transient', 'outage', 'acknowledgement'] as const)
    assert.equal(failureFor({ ...base, scenario, restored: true }, 1), null);
});
test('exponential retry delays grow from the configured base', () => {
  assert.deepEqual(
    [1, 2, 3].map((n) => retryDelay(n)),
    [1500, 3000, 6000],
  );
});
