import { Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { connection, prefix, key } from './config';
import { processDelivery } from './engine';
import type { RunData } from '../src/model';
const redis = connection(true);
const workerRedis = connection(true);
const id = randomUUID();
const worker = new Worker<RunData>('deliveries', (job) => processDelivery(redis, job), {
  connection: workerRedis,
  prefix,
  concurrency: 2,
});
worker.on('error', (error) => console.error('Worker connection:', error.message));
worker.on('failed', (job, error) =>
  console.log(`Run ${job?.id?.slice(0, 8)} attempt failed: ${error.message}`),
);
worker.on('completed', (job) => console.log(`Run ${job.id?.slice(0, 8)} completed`));
const beat = async () => {
  try {
    await redis.set(key('worker', id), 'online', 'EX', 8);
  } catch {
    /* Store outages are reflected by expired heartbeats. */
  }
};
await worker.waitUntilReady();
await beat();
const heartbeat = setInterval(beat, 2000);
console.log('Replay Studio worker ready (concurrency 2).');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeat);
  await worker.close();
  await redis.del(key('worker', id));
  await workerRedis.quit();
  await redis.quit();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
