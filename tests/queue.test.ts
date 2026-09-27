import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { Run, Snapshot, RunData } from '../src/model';
process.env.QUEUE_PREFIX = `replay-test-${process.pid}`;
process.env.STEP_DELAY_MS = '25';
process.env.RETRY_DELAY_MS = '50';
const { makeApp } = await import('../server/app');
const { Worker } = await import('bullmq');
const { processDelivery, deliverOnce } = await import('../server/engine');
const { connection, key, prefix, origin } = await import('../server/config');
const service = makeApp();
let server: Server;
let base: string;
let cookie: string;
let workerRedis = connection(true);
let worker: InstanceType<typeof Worker<RunData>>;
async function startWorker() {
  worker = new Worker<RunData>('deliveries', (job) => processDelivery(service.redis, job), {
    connection: workerRedis,
    prefix,
    concurrency: 3,
  });
  worker.on('error', () => {});
  await worker.waitUntilReady();
}
async function request(path: string, body?: unknown, session = cookie, requestOrigin = origin) {
  return fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      Origin: requestOrigin,
      ...(session ? { Cookie: session } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function state(session = cookie): Promise<Snapshot> {
  const r = await request('/api/state', undefined, session);
  assert.equal(r.status, 200);
  return r.json();
}
async function submit(body: unknown) {
  const r = await request('/api/runs', body);
  assert.equal(r.status, 201, await r.clone().text());
  return (await r.json()).id as string;
}
async function terminal(id: string) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const run = (await state()).runs.find((r) => r.id === id);
    if (run && (run.state === 'completed' || run.state === 'failed')) return run;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Run ${id} did not finish`);
}
before(async () => {
  await service.redis.ping();
  server = service.app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.on('listening', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const r = await request('/api/state', undefined, '');
  cookie = r.headers.get('set-cookie')!.split(';')[0];
  await startWorker();
});
after(async () => {
  if (worker) await worker.close();
  await workerRedis.quit();
  let cursor = '0';
  do {
    const [next, keys] = await service.redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
    cursor = next;
    if (keys.length) await service.redis.del(...keys);
  } while (cursor !== '0');
  await service.close();
  server?.closeAllConnections();
  await new Promise<void>((r) => server?.close(() => r()));
});
test('real queue retries a transient failure with increasing delay', async () => {
  const run = await terminal(await submit({ type: 'create', scenario: 'transient' }));
  assert.equal(run.state, 'completed');
  assert.equal(run.attemptsStarted, 3);
  assert.equal(run.events.filter((e) => e.kind === 'failed').length, 2);
  assert.ok(run.receipt);
  const starts = run.events.filter((e) => e.kind === 'started');
  const failures = run.events.filter((e) => e.kind === 'failed');
  assert.ok(starts[1].at - failures[0].at >= 45);
  assert.ok(starts[2].at - failures[1].at >= 95);
});
test('exhausted run replays with the same operation and preserved history', async () => {
  const failed = await terminal(await submit({ type: 'create', scenario: 'outage' }));
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attemptsStarted, 3);
  assert.equal(failed.receipt, null);
  const replay = await terminal(await submit({ type: 'replay', runId: failed.id }));
  assert.equal(replay.state, 'completed');
  assert.equal(replay.operationId, failed.operationId);
  assert.equal(replay.parentId, failed.id);
  assert.equal(replay.attemptsStarted, 1);
  const original = (await state()).runs.find((r) => r.id === failed.id)!;
  assert.equal(original.state, 'failed');
  assert.deepEqual(original.events, failed.events);
});
test('lost acknowledgement and subsequent replay leave one receipt', async () => {
  const run = await terminal(await submit({ type: 'create', scenario: 'acknowledgement' }));
  assert.equal(run.attemptsStarted, 2);
  assert.ok(run.events.some((e) => e.kind === 'deduplicated'));
  assert.equal(run.events.filter((e) => e.kind === 'committed').length, 1);
  const replay = await terminal(await submit({ type: 'replay', runId: run.id }));
  assert.equal(replay.receipt?.id, run.receipt?.id);
  assert.ok(replay.events.some((e) => e.kind === 'deduplicated'));
});
test('simultaneous deliveries atomically produce one effect', async () => {
  const data: RunData = {
    sandbox: 'atomic-test',
    operationId: 'one-operation',
    scenario: 'transient',
    restored: true,
  };
  const results = await Promise.all(
    Array.from({ length: 20 }, () => deliverOnce(service.redis, data)),
  );
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(new Set(results.map((r) => r.receipt.id)).size, 1);
  assert.equal(await service.redis.hlen(key('receipts', 'atomic-test')), 1);
});
test('another session cannot list or replay existing runs', async () => {
  const id = (await state()).runs[0].id;
  const other = await request('/api/state', undefined, '');
  const otherCookie = other.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await state(otherCookie)).runs.length, 0);
  assert.equal(
    (await request('/api/runs', { type: 'replay', runId: id }, otherCookie)).status,
    404,
  );
});
test('cross-origin mutations and invalid scenarios are rejected', async () => {
  assert.equal(
    (
      await request(
        '/api/runs',
        { type: 'create', scenario: 'transient' },
        cookie,
        'https://elsewhere.example',
      )
    ).status,
    403,
  );
  assert.equal((await request('/api/runs', { type: 'create', scenario: 'unknown' })).status, 400);
});
test('queued work waits while the worker is stopped and finishes after restart', async () => {
  await worker.close();
  const id = await submit({ type: 'create', scenario: 'acknowledgement' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await state()).runs.find((r) => r.id === id)?.state, 'waiting');
  await startWorker();
  assert.equal((await terminal(id)).state, 'completed');
});
