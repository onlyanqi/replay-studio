import type { Redis } from 'ioredis';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { key, ttl, stepDelay, backoff } from './config';
import {
  failureFor,
  retryDelay,
  type RunData,
  type Receipt,
  type TimelineEvent,
} from '../src/model';
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function event(redis: Redis, jobId: string, info: Omit<TimelineEvent, 'id' | 'at'>) {
  const entry: TimelineEvent = { id: randomUUID(), at: Date.now(), ...info };
  await redis
    .multi()
    .rpush(key('events', jobId), JSON.stringify(entry))
    .ltrim(key('events', jobId), -150, -1)
    .expire(key('events', jobId), ttl)
    .exec();
}
/** The receipt and duplicate check are one atomic operation, shared by all workers. */
export async function deliverOnce(
  redis: Redis,
  data: RunData,
): Promise<{ duplicate: boolean; receipt: Receipt }> {
  const proposed: Receipt = {
    id: randomUUID(),
    operationId: data.operationId,
    createdAt: Date.now(),
    title: 'Summer campaign delivery',
  };
  const result = (await redis.eval(
    `
 local previous=redis.call('HGET',KEYS[1],ARGV[1])
 if previous then return {'duplicate',previous} end
 redis.call('HSET',KEYS[1],ARGV[1],ARGV[2])
 redis.call('EXPIRE',KEYS[1],ARGV[3])
 return {'created',ARGV[2]}
 `,
    1,
    key('receipts', data.sandbox),
    data.operationId,
    JSON.stringify(proposed),
    ttl,
  )) as [string, string];
  return { duplicate: result[0] === 'duplicate', receipt: JSON.parse(result[1]) };
}
export async function processDelivery(redis: Redis, job: Job<RunData>) {
  const id = job.id!;
  const attempt = job.attemptsMade + 1;
  await event(redis, id, {
    kind: 'started',
    title: `Attempt ${attempt} started`,
    detail: 'A worker acquired the job and is preparing the delivery.',
    attempt,
  });
  await job.updateProgress(20);
  await delay(stepDelay);
  const fault = failureFor(job.data, attempt);
  if (fault === 'before') {
    const next = attempt < (job.opts.attempts || 3);
    await event(redis, id, {
      kind: 'failed',
      title: 'Receiver unavailable · 503',
      detail: next
        ? `BullMQ will retry after a ${retryDelay(attempt, backoff) / 1000}s backoff.`
        : 'The retry budget is exhausted. This run is retained for inspection and manual replay.',
      attempt,
    });
    throw new Error('Controlled receiver failure: 503 Service Unavailable');
  }
  await job.updateProgress(60);
  const result = await deliverOnce(redis, job.data);
  await event(redis, id, {
    kind: result.duplicate ? 'deduplicated' : 'committed',
    title: result.duplicate ? 'Existing receipt found' : 'Delivery recorded',
    detail: result.duplicate
      ? 'The same operation already has a receipt. Its side effect was skipped.'
      : 'The controlled receiver wrote one durable receipt for this operation.',
    attempt,
  });
  await delay(stepDelay);
  if (fault === 'after') {
    await event(redis, id, {
      kind: 'failed',
      title: 'Acknowledgement lost',
      detail:
        'The receipt exists, but this attempt reports a timeout. The next attempt must check before delivering again.',
      attempt,
    });
    throw new Error('Controlled acknowledgement timeout after receipt commit');
  }
  await job.updateProgress(100);
  await event(redis, id, {
    kind: 'completed',
    title: result.duplicate ? 'Recovered without a duplicate' : 'Delivery confirmed',
    detail: `Receipt ${result.receipt.id.slice(0, 8)} confirms this operation.`,
    attempt,
  });
  return { receiptId: result.receipt.id, duplicate: result.duplicate };
}
